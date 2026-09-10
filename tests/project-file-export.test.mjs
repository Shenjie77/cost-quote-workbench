/** Real XLSX adapters: browser side effects wait for the matching archive write. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const local =
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (local && specifier.startsWith('.')) {
      const base = fileURLToPath(new URL(specifier, context.parentURL));
      if (existsSync(`${base}.ts`))
        return nextResolve(pathToFileURL(`${base}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});
const { downloadCostWorkbook } =
  await import('../features/cost/export-workbook.ts');
const { downloadSimpleCostWorkbook } =
  await import('../features/cost/export-simple-workbook.ts');
// The adapters load their real archive client dynamically on the first export.
await import('../features/projects/project-files.ts');
hooks.deregister();

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const success = () =>
  new Response(JSON.stringify({ ok: true, data: { id: 'archived-file' } }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
const failure = () =>
  new Response(
    JSON.stringify({
      ok: false,
      error: { message: 'Archive folder is unavailable.' },
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } },
  );

function browser(t) {
  const events = [],
    downloads = [],
    blobs = [];
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    'document',
  );
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag) {
        assert.equal(tag, 'a');
        events.push('create-anchor');
        return {
          style: {},
          href: '',
          download: '',
          click() {
            events.push('download');
            downloads.push({ href: this.href, fileName: this.download });
          },
          remove() {
            events.push('remove-anchor');
          },
        };
      },
      body: {
        appendChild() {
          events.push('attach-anchor');
        },
      },
    },
  });
  t.after(() => {
    if (previousDocument)
      Object.defineProperty(globalThis, 'document', previousDocument);
    else delete globalThis.document;
  });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    blobs.push(blob);
    events.push('create-url');
    return `blob:export-test-${blobs.length}`;
  });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const schedule = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    const timer = schedule(callback, delay, ...args);
    timer.unref();
    return timer;
  });
  return { events, downloads, blobs };
}

for (const { name, download } of [
  { name: 'Full', download: downloadCostWorkbook },
  { name: 'Simple', download: downloadSimpleCostWorkbook },
]) {
  test(
    `${name} export archives the exact downloaded XLSX using the clicked project/version throughout async generation and upload`,
    { timeout: 15_000 },
    async (t) => {
      const view = browser(t);
      const arrived = deferred(),
        reply = deferred();
      let request;
      t.mock.method(globalThis, 'fetch', async (url, options) => {
        request = { url: new URL(url), options };
        view.events.push('archive-request');
        arrived.resolve();
        const response = await reply.promise;
        view.events.push('archive-confirmed');
        return response;
      });
      const input = makeCostSnapshot();
      const before = structuredClone(input);
      const pending = download(input);
      void pending.catch(arrived.reject);
      // Simulate switching context/editing while ExcelJS serializes the workbook.
      input.project.id = 'PRJ-WRONG';
      input.project.name = 'Wrong project after click';
      input.costVersion.code = 'V9';
      input.costRows[0].scope = 'WRONG_SCOPE_AFTER_CLICK';
      await arrived.promise;
      assert.equal(
        request.url.pathname,
        `/api/local/projects/${before.project.id}/files`,
      );
      assert.equal(
        request.url.searchParams.get('versionCode'),
        before.costVersion.code,
      );
      assert.equal(request.url.searchParams.get('category'), 'cost');
      assert.equal(request.options.method, 'POST');
      assert.equal(
        request.options.headers['Content-Type'],
        'application/octet-stream',
      );
      assert.ok(request.options.body instanceof Blob);
      assert.ok(request.options.body.size > 1000);
      assert.deepEqual(
        view.downloads,
        [],
        'archive request alone must not trigger a download',
      );
      assert.deepEqual(
        view.blobs,
        [],
        'object URL is not exposed before archive confirmation',
      );

      const bytes = new Uint8Array(await request.options.body.arrayBuffer());
      assert.deepEqual(
        bytes.slice(0, 2),
        Uint8Array.of(0x50, 0x4b),
        'archive receives a ZIP/XLSX payload',
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes);
      const strings = [];
      workbook.eachSheet((sheet) =>
        sheet.eachRow((row) =>
          row.eachCell((cell) => {
            if (typeof cell.value === 'string') strings.push(cell.value);
          }),
        ),
      );
      assert.ok(strings.some((value) => value.includes(before.project.name)));
      assert.ok(
        strings.some((value) => value.includes(before.costRows[0].scope)),
      );
      assert.ok(
        strings.every(
          (value) =>
            !value.includes('WRONG_SCOPE_AFTER_CLICK') &&
            !value.includes('Wrong project after click'),
        ),
      );
      if (name === 'Full') {
        const readme = workbook.getWorksheet('00_Readme');
        const metadata = new Map();
        readme.eachRow((row) =>
          metadata.set(row.getCell(1).value, row.getCell(2).value),
        );
        assert.equal(metadata.get('Project ID'), before.project.id);
        assert.equal(metadata.get('Cost Version'), before.costVersion.code);
      } else {
        const subtitle = workbook.worksheets[0].getCell('A2').value;
        assert.ok(typeof subtitle === 'string');
        assert.match(subtitle, /V1 \(Draft\)/);
      }

      // Context can also change during an arbitrarily slow archive response.
      input.project.id = 'PRJ-ANOTHER';
      input.costVersion.code = 'V10';
      reply.resolve(success());
      const result = await pending;
      const expectedName = `Cost_${name === 'Simple' ? 'Simple_' : ''}${before.project.id}_${before.costVersion.code}_${before.exportedAt.slice(0, 10)}.xlsx`;
      assert.equal(result.fileName, expectedName);
      assert.equal(result.sizeBytes, bytes.byteLength);
      assert.equal(request.url.searchParams.get('originalName'), expectedName);
      assert.equal(view.blobs.length, 1);
      assert.equal(
        view.blobs[0],
        request.options.body,
        'archive and download share the exact generated Blob',
      );
      assert.deepEqual(
        new Uint8Array(await view.blobs[0].arrayBuffer()),
        bytes,
      );
      assert.deepEqual(view.downloads, [
        { href: 'blob:export-test-1', fileName: expectedName },
      ]);
      assert.deepEqual(view.events, [
        'archive-request',
        'archive-confirmed',
        'create-url',
        'create-anchor',
        'attach-anchor',
        'download',
        'remove-anchor',
      ]);
    },
  );

  test(
    `${name} export reports a failed archive without downloading or mutating the source snapshot`,
    { timeout: 15_000 },
    async (t) => {
      const view = browser(t);
      let archives = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        archives += 1;
        return failure();
      });
      const input = makeCostSnapshot();
      const before = structuredClone(input);
      await assert.rejects(
        download(input),
        (error) =>
          error.status === 503 &&
          error.message === 'Archive folder is unavailable.',
      );
      assert.equal(archives, 1);
      assert.deepEqual(view.events, []);
      assert.deepEqual(view.downloads, []);
      assert.deepEqual(view.blobs, []);
      assert.deepEqual(input, before);
    },
  );
}
