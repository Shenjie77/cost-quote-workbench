/** Local template persistence and transport tests use synthetic workbooks and temporary databases. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync, backup } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import {
  openQuoteTemplateStore,
  routeQuoteTemplateAssets,
  MAX_QUOTE_TEMPLATE_BYTES,
} from '../server/quote-template-assets.mjs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { validateGlobalMasterDataRows } from '../server/global-master-data.mjs';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { recalculateCostRows } from '../features/cost/domain.ts';

/** Produces an ordinary customer template without using any company documents. */
async function templateBytes(label = 'Customer quotation') {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customer');
  sheet.getCell('B2').value = label;
  sheet.getCell('B12').value = 'Description';
  sheet.getCell('F12').value = 0;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Owns every test database and closes it before removing the isolated directory. */
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'quote-template-assets-'));
  const databasePath = path.join(directory, 'workbench.sqlite');
  const store = openQuoteTemplateStore(databasePath);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, databasePath, directory };
}

/** Calls the same HTTP router without opening a listening socket. */
async function call(
  store,
  pathname,
  method = 'GET',
  bytes = Buffer.alloc(0),
  headers = {},
) {
  const request = Readable.from([bytes.subarray(0, 11), bytes.subarray(11)]);
  Object.assign(request, { method, headers });
  const result = {};
  result.handled = await routeQuoteTemplateAssets({
    store,
    request,
    url: new URL(pathname, 'http://localhost'),
    origin: 'http://localhost:3000',
    response: {
      writeHead(status, responseHeaders) {
        Object.assign(result, { status, headers: responseHeaders });
      },
      end(buffer) {
        result.buffer = buffer;
      },
    },
    respond(status, body) {
      Object.assign(result, { status, body });
    },
  });
  return result;
}

test('template originals are immutable, deduplicated and included in SQLite backups', async (t) => {
  const { store, databasePath, directory } = fixture(t);
  const original = await templateBytes();
  const first = await store.upload('Customer.xlsx', original);
  const duplicate = await store.upload('Renamed.xlsx', original);
  assert.equal(first.assetId, duplicate.assetId);
  assert.deepEqual(first.sheets, [
    { name: 'Customer', rowCount: 12, columnCount: 6 },
  ]);
  const replacement = await store.upload(
    'Customer.xlsx',
    await templateBytes('Revised'),
  );
  assert.notEqual(replacement.assetId, first.assetId);
  assert.deepEqual(store.read(first.assetId), original);
  const db = new DatabaseSync(databasePath);
  const copyPath = path.join(directory, 'backup.sqlite');
  try {
    await backup(db, copyPath);
  } finally {
    db.close();
  }
  const restored = openQuoteTemplateStore(copyPath);
  try {
    assert.deepEqual(restored.read(first.assetId), original);
    assert.deepEqual(
      restored.inspect(replacement.assetId),
      store.inspect(replacement.assetId),
    );
  } finally {
    restored.close();
  }
});

test('binary upload, inventory and download retain exact bytes and local CORS', async (t) => {
  const { store } = fixture(t);
  const bytes = await templateBytes();
  const upload = await call(
    store,
    '/api/local/quote-template-assets?fileName=Customer%20A.xlsx',
    'POST',
    bytes,
  );
  assert.equal(upload.status, 201);
  const id = upload.body.data.assetId;
  const inventory = await call(store, `/api/local/quote-template-assets/${id}`);
  assert.equal(inventory.body.data.assetId, id);
  const download = await call(
    store,
    `/api/local/quote-template-assets/${id}/content`,
  );
  assert.deepEqual(download.buffer, bytes);
  assert.equal(
    download.headers['Access-Control-Allow-Origin'],
    'http://localhost:3000',
  );
  assert.equal(download.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(download.headers['Content-Disposition'], /attachment/);
  assert.equal((await call(store, '/api/local/health')).handled, false);
});

test('invalid file types, paths, missing assets and oversized streams are rejected without writes', async (t) => {
  const { store } = fixture(t);
  for (const name of [
    'Legacy.xls',
    'Macro.xlsm',
    '../Customer.xlsx',
    'D:\\Customer.xlsx',
  ]) {
    await assert.rejects(
      store.upload(name, await templateBytes()),
      /plain file name/,
    );
  }
  await assert.rejects(
    store.upload('Fake.xlsx', Buffer.from('not an Excel file')),
  );
  assert.throws(() => store.read('../escape'), /identifier/);
  assert.throws(() => store.read('a'.repeat(64)), /Upload the original/);
  await assert.rejects(
    call(
      store,
      '/api/local/quote-template-assets?fileName=Customer.xlsx',
      'POST',
      Buffer.alloc(0),
      { 'content-length': MAX_QUOTE_TEMPLATE_BYTES + 1 },
    ),
    /10 MiB/,
  );
  await assert.rejects(
    call(
      store,
      '/api/local/quote-template-assets?fileName=Customer.xlsx&path=escape',
      'POST',
    ),
    /query/,
  );
  await assert.rejects(
    call(
      store,
      '/api/local/quote-template-assets?fileName=Customer.xlsx&fileName=Other.xlsx',
      'POST',
    ),
    /query/,
  );
  await assert.rejects(
    call(store, `/api/local/quote-template-assets/${'a'.repeat(64)}`, 'DELETE'),
    /Invalid Excel template request/,
  );
});

test('customer mappings and manual lines survive persistence and CLI export without a running API', async (t) => {
  const { store, databasePath, directory } = fixture(t);
  const original = await templateBytes();
  const asset = await store.upload('Customer.xlsx', original);
  const repository = openWorkspaceRepository(databasePath);
  const project = createBlankWorkspace(
    projectRecord('P-EXCEL', 'Synthetic quotation', 'Test customer'),
  );
  project.workflowMode = 'project';
  project.costVersions[0].state = 'Confirmed';
  const version = project.costVersions[0];
  version.costRows = recalculateCostRows(
    [{ ...structuredClone(initialCostRows[0]), mdPerSite: 0.1 }],
    version.resourceTypes || project.resourceTypes,
    version.rateSettings,
  );
  project.costRows = structuredClone(version.costRows);
  project.quoteTemplates[0].excel = {
    assetId: asset.assetId,
    fileName: asset.fileName,
    sheetName: 'Customer',
    detailRow: 12,
    columns: { description: 'B', quantity: 'C', unitPrice: 'E', amount: 'F' },
    cells: {
      quoteNumber: 'B4',
      client: 'B5',
      project: 'B6',
      validityDays: 'B7',
      paymentTerms: 'B8',
      discount: 'F10',
      quoteBeforeTax: 'F14',
      gstAmount: 'F15',
      quoteAfterTax: 'F16',
      assumptions: 'B18',
    },
  };
  project.pricing = {
    targetGrossMargin: 25,
    discount: 10,
    gstPercent: 9,
    lineMode: 'manual',
    manualLines: [
      {
        id: 'a',
        description: 'Site installation',
        quantity: 2,
        unit: 'site',
        unitPrice: 50,
      },
      {
        id: 'b',
        description: 'Acceptance',
        quantity: 1,
        unit: 'lot',
        unitPrice: 25,
      },
    ],
  };
  try {
    assert.doesNotThrow(() =>
      validateGlobalMasterDataRows('quote-templates', project.quoteTemplates),
    );
    const invalid = structuredClone(project.quoteTemplates);
    invalid[0].excel.columns.amount = 'B';
    assert.throws(
      () => validateGlobalMasterDataRows('quote-templates', invalid),
      /more than one/,
    );
    repository.save(project.project.id, project, null);
    const output = path.join(directory, 'customer-output.xlsx');
    const cli = fileURLToPath(new URL('../cli/cost-cli.mjs', import.meta.url));
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'quote.export',
        '--project-id',
        project.project.id,
        '--output',
        output,
        '--db',
        databasePath,
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(readFileSync(output));
    const sheet = workbook.getWorksheet('Customer');
    assert.equal(sheet.getCell('B12').value, 'Site installation');
    assert.equal(sheet.getCell('F12').value, 100);
    assert.equal(sheet.getCell('B13').value, 'Acceptance');
    assert.equal(sheet.getCell('F13').value, 25);
    assert.equal(sheet.getCell('F17').value, 125.35);
    const history = repository.get(project.project.id).workspace
      .quoteHistory[0];
    assert.equal(history.lineSnapshots.length, 2);
    assert.equal(history.lineMode, 'manual');
    assert.equal(history.templateSnapshot.excel.assetId, asset.assetId);
    assert.deepEqual(store.read(asset.assetId), original);
  } finally {
    repository.close();
  }
});
