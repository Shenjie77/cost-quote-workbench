import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// Small hook adapter lets controller tests drive real event handlers without a browser.
// Normal server-render tests continue to use React's own hook implementation.
const hookHarnessKey = Symbol.for('project-files-test-hooks');
const hookAdapterUrl = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('project-files-test-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      context.parentURL?.endsWith('/project-files-panel.tsx')
    )
      return { url: hookAdapterUrl, shortCircuit: true };
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const client = await import('../features/projects/project-files.ts');
const {
  ProjectFileList,
  ProjectFilesPanel,
  ArchiveSettingsPanel,
  ArchiveFolderButton,
  ProjectFileDropzone,
} = await import('../features/projects/project-files-panel.tsx');
const { ProjectWorkflowPage } =
  await import('../features/projects/project-workflow-page.tsx');
hooks.deregister();

const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const record = (overrides = {}) => ({
  id: 'file-1',
  projectId: 'PROJECT A',
  originalName: 'TD plan & estimate.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  createdAt: '2026-09-10T02:00:00.000Z',
  category: 'workflow',
  nodeCode: 'RETIRED',
  nodeName: 'Previous DRB Review',
  versionCode: 'V1',
  relativePath: 'workflow/V1/RETIRED/file-1.xlsx',
  ...overrides,
});
const response = (data, status = 200) =>
  new Response(
    JSON.stringify({
      ok: status < 400,
      ...(status < 400 ? { data } : { error: { message: data } }),
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );

test('document list exposes original names, prior-round/retired-node associations and encoded project download URLs', () => {
  const html = render(ProjectFileList, {
    projectId: 'PROJECT A',
    files: [record()],
    showAssociation: true,
  });
  assert.match(html, /TD plan &amp; estimate.xlsx/);
  assert.match(html, /workflow · V1 · Previous DRB Review/);
  assert.match(html, /2.0 KiB/);
  assert.match(html, /SGT/);
  assert.match(html, /projects\/PROJECT%20A\/files\/file-1\/content/);
  assert.match(html, /download="TD plan &amp; estimate.xlsx"/);
  assert.match(
    html,
    /aria-label="Open folder for TD plan &amp; estimate.xlsx"/,
  );
  assert.match(html, /aria-label="Delete TD plan &amp; estimate.xlsx"/);
  assert.doesNotMatch(html, /href="file:/);
  const fallback = render(ProjectFileList, {
    projectId: 'P',
    files: [record({ nodeName: undefined })],
    showAssociation: true,
  });
  assert.match(fallback, /V1 · RETIRED/);
  assert.match(
    render(ProjectFileList, { projectId: 'P', files: [] }),
    /No documents archived yet/,
  );
});

test('node file controllers are isolated by project, workflow round and node rather than visible node name', () => {
  const base = {
    projectId: 'A',
    nodeCode: 'DRB',
    nodeName: 'Review',
    versionCode: 'V1',
  };
  const element = ProjectFilesPanel(base);
  assert.equal(element.props.projectId, 'A');
  assert.equal(element.props.versionCode, 'V1');
  for (const change of [
    { projectId: 'B' },
    { versionCode: 'V2' },
    { nodeCode: 'DTRB' },
  ])
    assert.notEqual(ProjectFilesPanel({ ...base, ...change }).key, element.key);
  assert.equal(
    ProjectFilesPanel({ ...base, nodeName: 'Renamed Review' }).key,
    element.key,
  );
});

test('node uploads and all-project archives remain accessible on held, completed and cost-locked workflows', () => {
  for (const mode of ['held', 'completed', 'locked']) {
    const project = projectRecord(`FILES-${mode}`, 'Archive test', 'Client');
    const workspace = createBlankWorkspace(project, 'input_preparation');
    workspace.workflowVersion = 'V1';
    if (mode === 'held')
      workspace.workflowHold = { startedAt: '2026-09-10T01:00:00Z' };
    if (mode === 'completed')
      workspace.processSteps = workspace.processSteps.map((step) => ({
        ...step,
        state: 'completed',
      }));
    if (mode === 'locked')
      workspace.costVersions = workspace.costVersions.map((version) => ({
        ...version,
        state: 'Confirmed',
      }));
    const before = JSON.stringify(workspace);
    const html = render(ProjectWorkflowPage, {
      project,
      workspace,
      onAction: async () => {},
      onSaveReferences: async () => {},
      onBack: () => {},
      onRefresh: async () => {},
      onOpenCost: () => {},
    });
    assert.match(html, /Workflow Step Documents/);
    assert.match(html, /Drop files here/);
    assert.match(html, /Project Files &amp; Archive/);
    assert.match(html, /All project documents/);
    assert.doesNotMatch(html, /Upload Documents|Project file filter/);
    const input = html.match(
      /<input[^>]*aria-label="Choose step documents"[^>]*>/,
    )?.[0];
    assert.ok(input);
    assert.doesNotMatch(input, /disabled/);
    assert.equal(JSON.stringify(workspace), before);
  }
});

const dropEvent = (files, types = ['Files']) => {
  const calls = { prevented: 0, stopped: 0 };
  return {
    calls,
    dataTransfer: { files, types, dropEffect: 'none' },
    relatedTarget: null,
    preventDefault() {
      calls.prevented += 1;
    },
    stopPropagation() {
      calls.stopped += 1;
    },
  };
};
const walkElements = (node) =>
  Array.isArray(node)
    ? node.flatMap(walkElements)
    : React.isValidElement(node)
      ? [node, ...walkElements(node.props.children)]
      : [];

/** Keep hook slots across explicit renders and execute only effects with changed dependencies. */
function componentHarness(component, props) {
  const slots = [];
  const pending = [];
  let cursor = 0;
  const backend = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index])
        slots[index] = {
          value: typeof initial === 'function' ? initial() : initial,
        };
      return [
        slots[index].value,
        (next) => {
          slots[index].value =
            typeof next === 'function' ? next(slots[index].value) : next;
        },
      ];
    },
    useRef(value) {
      const index = cursor++;
      slots[index] ||= { current: value };
      return slots[index];
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies?.some(
          (value, i) => !Object.is(value, previous.dependencies?.[i]),
        )
      ) {
        slots[index] = { dependencies, cleanup: previous?.cleanup };
        pending.push(() => {
          slots[index].cleanup?.();
          slots[index].cleanup = effect();
        });
      }
    },
  };
  return {
    render() {
      cursor = 0;
      globalThis[hookHarnessKey] = backend;
      let element;
      try {
        element = component(props);
      } finally {
        delete globalThis[hookHarnessKey];
      }
      for (const effect of pending.splice(0)) effect();
      return element;
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.();
    },
  };
}
const settleRequests = () => new Promise((resolve) => setImmediate(resolve));

test('node upload cards show the saved destination when step folders are disabled', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    response({
      projectId: 'PROJECT A',
      rootPath: '/archive',
      projectPath: '/archive/PROJECT A',
      uploadFolder: 'workflow',
      files: [],
    }),
  );
  const controller = ProjectFilesPanel({
    projectId: 'PROJECT A',
    nodeCode: 'DRB',
    nodeName: 'Delivery Review',
    versionCode: 'V2',
  });
  const harness = componentHarness(controller.type, controller.props);
  t.after(() => harness.unmount());
  assert.equal(harness.render().props.target, 'workflow / Delivery Review');
  await settleRequests();
  const loaded = harness.render();
  assert.equal(loaded.props.target, 'workflow');
  const html = render(ProjectFileDropzone, loaded.props);
  assert.match(html, /Choose files for workflow/);
  assert.doesNotMatch(html, /workflow \/ Delivery Review/);
});

test('delete confirmation, request lock and list refresh recover correctly after a failed request', async (t) => {
  const previousWindow = globalThis.window;
  let approved = false;
  const confirmations = [];
  globalThis.window = {
    confirm: (message) => {
      confirmations.push(message);
      return approved;
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
  let files = [record()];
  let changed = 0;
  const deletes = [];
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (options?.method === 'DELETE')
      return new Promise((resolve) => deletes.push(resolve));
    reads += 1;
    return response({
      projectId: 'PROJECT A',
      rootPath: '/archive',
      projectPath: '/archive/PROJECT A',
      files,
    });
  });
  const controller = ProjectFilesPanel({
    projectId: 'PROJECT A',
    onArchived: () => {
      changed += 1;
    },
  });
  const harness = componentHarness(controller.type, controller.props);
  t.after(() => harness.unmount());
  harness.render();
  await settleRequests();
  const list = () =>
    walkElements(harness.render()).find(
      (element) => element.type === ProjectFileList,
    );
  list().props.onDelete(files[0]);
  assert.equal(deletes.length, 0, 'cancel must not issue a delete');
  approved = true;
  const remove = list().props.onDelete;
  remove(files[0]);
  remove(files[0]);
  assert.equal(deletes.length, 1, 'repeat clicks share the in-flight guard');
  assert.equal(list().props.deletingFileId, 'file-1');
  assert.match(confirmations[1], /TD plan & estimate.xlsx/);
  deletes[0](response('Document is in use.', 409));
  await settleRequests();
  const failed = harness.render();
  assert.match(JSON.stringify(failed), /Document is in use/);
  assert.equal(
    list().props.files.length,
    1,
    'failure must keep the file visible',
  );
  assert.equal(list().props.deletingFileId, null);
  assert.equal(changed, 0);
  assert.equal(failed.props.loading, false);
  list().props.onDelete(files[0]);
  files = [];
  deletes[1](response({ id: 'file-1', deleted: true }));
  await settleRequests();
  assert.equal(
    harness.render().props.loading,
    true,
    'successful deletion starts a list reload',
  );
  await settleRequests();
  assert.equal(list().props.files.length, 0);
  assert.equal(harness.render().props.loading, false);
  assert.equal(list().props.deletingFileId, null);
  assert.equal(reads, 2);
  assert.equal(
    changed,
    1,
    'other archive panels receive one change notification',
  );
});

test('folder opening prevents repeat requests and clears a failed attempt before retrying', async (t) => {
  const attempts = [];
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Promise((resolve) => attempts.push(resolve)),
  );
  const harness = componentHarness(ArchiveFolderButton, {
    projectId: 'PROJECT A',
    fileId: 'file-1',
    description: 'Open document folder',
  });
  t.after(() => harness.unmount());
  const button = () =>
    walkElements(harness.render()).find(
      (element) => element.props['aria-label'] === 'Open document folder',
    );
  const click = button().props.onClick;
  click();
  click();
  assert.equal(attempts.length, 1);
  assert.equal(button().props.disabled, true);
  attempts[0](response('Folder is unavailable.', 404));
  await settleRequests();
  assert.match(JSON.stringify(harness.render()), /Folder is unavailable/);
  assert.equal(button().props.disabled, false);
  button().props.onClick();
  assert.equal(attempts.length, 2);
  assert.doesNotMatch(
    JSON.stringify(harness.render()),
    /Folder is unavailable/,
  );
  attempts[1](response({ opened: true }));
  await settleRequests();
  assert.equal(button().props.disabled, false);
});

test('document deletion controls forward only the chosen file and disable all deletes during a request', () => {
  const files = [record(), record({ id: 'file-2', originalName: 'scope.pdf' })];
  const deleted = [];
  const props = {
    projectId: 'PROJECT A',
    files,
    onDelete: (file) => deleted.push(file),
  };
  const elements = walkElements(ProjectFileList(props));
  const button = elements.find(
    (node) => node.props['aria-label'] === 'Delete scope.pdf',
  );
  assert.ok(button);
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.deepEqual(deleted, [files[1]]);
  for (const state of [{ disabled: true }, { deletingFileId: 'file-1' }]) {
    const controls = walkElements(ProjectFileList({ ...props, ...state }));
    const remove = controls.filter((node) =>
      node.props['aria-label']?.startsWith('Delete '),
    );
    assert.equal(remove.length, files.length);
    assert.ok(remove.every((node) => node.props.disabled));
    const folders = controls.filter(
      (node) => node.type === ArchiveFolderButton,
    );
    assert.equal(folders.length, files.length);
    assert.ok(folders.every((node) => node.props.disabled));
  }
  assert.match(
    render(ProjectFileList, { ...props, deletingFileId: 'file-1' }),
    /Deleting…/,
  );
});

test('saved archive folders use accessible API buttons for root, project and document locations', () => {
  for (const props of [
    { description: 'Open saved project archive root folder' },
    {
      projectId: 'PROJECT A',
      description: 'Open saved project archive folder',
    },
    {
      projectId: 'PROJECT A',
      fileId: 'file-1',
      description: 'Open document folder',
    },
  ]) {
    const html = render(ArchiveFolderButton, props);
    assert.match(html, /Open Folder/);
    assert.doesNotMatch(html, /href=/);
    assert.match(
      render(ArchiveFolderButton, { ...props, disabled: true }),
      /<button[^>]*disabled/,
    );
  }
});
const dropzoneProps = (changes = {}) => ({
  title: 'Documents',
  target: 'workflow / DTRB Review',
  versionCode: 'V2',
  node: true,
  onDraggingChange: () => {},
  onFiles: () => {},
  onBrowse: () => {},
  onRefresh: () => {},
  ...changes,
});

test('dropping multiple files anywhere on the selected node card immediately forwards all files and prevents browser navigation', () => {
  const files = [
    new File(['TD'], 'TD plan.xlsx'),
    new File(['Scope'], 'scope.pdf'),
  ];
  const selected = [],
    feedback = [];
  const card = ProjectFileDropzone(
    dropzoneProps({
      onFiles: (values) => selected.push(values),
      onDraggingChange: (value) => feedback.push(value),
    }),
  );
  const enter = dropEvent([]);
  card.props.onDragEnter(enter);
  assert.equal(enter.dataTransfer.dropEffect, 'copy');
  assert.equal(enter.calls.prevented, 1);
  const over = dropEvent([]);
  card.props.onDragOver(over);
  assert.equal(
    over.calls.prevented,
    1,
    'dragover must be cancelled for the browser to permit a drop',
  );
  const dropped = dropEvent(files);
  card.props.onDrop(dropped);
  assert.deepEqual(selected, [files]);
  assert.deepEqual(feedback, [true, true, false]);
  assert.deepEqual(dropped.calls, { prevented: 1, stopped: 1 });
  assert.equal(card.props['aria-label'], 'Workflow Step Documents');
});

test('archive dropzone ignores text/link drags and rejects files during upload or workflow switching without opening them', () => {
  const uploads = [],
    feedback = [];
  const props = dropzoneProps({
    onFiles: (values) => uploads.push(values),
    onDraggingChange: (value) => feedback.push(value),
  });
  const active = ProjectFileDropzone(props);
  for (const eventName of ['onDragEnter', 'onDragOver', 'onDrop']) {
    const text = dropEvent([], ['text/plain', 'text/uri-list']);
    active.props[eventName](text);
    assert.deepEqual(text.calls, { prevented: 0, stopped: 0 });
  }
  assert.deepEqual(feedback, []);
  assert.deepEqual(uploads, []);
  for (const state of [{ uploading: true }, { disabled: true }]) {
    const blocked = ProjectFileDropzone({ ...props, ...state });
    const over = dropEvent([]);
    blocked.props.onDragOver(over);
    assert.equal(over.dataTransfer.dropEffect, 'none');
    assert.equal(over.calls.prevented, 1);
    const drop = dropEvent([new File(['x'], 'plan.xlsx')]);
    blocked.props.onDrop(drop);
    assert.deepEqual(drop.calls, { prevented: 1, stopped: 1 });
    assert.deepEqual(uploads, []);
    const browse = walkElements(blocked).find((node) => node.type === 'button');
    assert.equal(browse.props.disabled, true);
  }
});

test('drop card visibly names the chosen destination, highlights active drops and provides one native click/keyboard picker', () => {
  let browseCount = 0;
  const props = dropzoneProps({
    onBrowse: () => {
      browseCount += 1;
    },
  });
  const card = ProjectFileDropzone(props);
  const button = walkElements(card).find((node) => node.type === 'button');
  assert.equal(button.props.type, 'button');
  assert.equal(button.props.disabled, false);
  assert.equal(
    button.props['aria-label'],
    'Choose files for workflow / DTRB Review',
  );
  button.props.onClick();
  assert.equal(browseCount, 1);
  const normal = render(ProjectFileDropzone, props);
  assert.match(normal, /workflow \/ DTRB Review/);
  assert.match(normal, /V2/);
  assert.match(normal, /Drop files here/);
  assert.match(normal, /click to browse · 50 MiB per file/);
  assert.doesNotMatch(normal, /Upload Documents/);
  const active = render(ProjectFileDropzone, { ...props, dragging: true });
  assert.match(active, /Release to upload/);
  assert.match(active, /ring-2/);
  const feedback = [];
  ProjectFileDropzone({
    ...props,
    onDraggingChange: (value) => feedback.push(value),
  }).props.onDragLeave(dropEvent([]));
  assert.deepEqual(feedback, [false]);
});

test('archive setup clearly explains existing folder stability and starts with edits disabled until server settings load', () => {
  const html = render(ArchiveSettingsPanel, {});
  assert.match(html, /Server folder · absolute path/);
  assert.match(
    html,
    /Existing project folders remain in their original location/,
  );
  assert.match(html, /Save Folder/);
  assert.match(html, /aria-label="Open saved project archive root folder"/);
  assert.match(html, /<input[^>]*disabled/);
});

test('opening saved folders uses encoded dedicated endpoints without accepting browser file paths', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response({ opened: true });
  });
  await client.openArchiveFolder();
  await client.openArchiveFolder('PROJECT A');
  await client.openArchiveFolder('PROJECT A', 'file/A & B');
  assert.deepEqual(
    calls.map((call) => call.url.pathname),
    [
      '/api/local/archive-settings/open-folder',
      '/api/local/projects/PROJECT%20A/files/open-folder',
      '/api/local/projects/PROJECT%20A/files/file%2FA%20%26%20B/open-folder',
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), {
      apiVersion: 'cost-workbench/local-v1',
      kind: 'ArchiveFolderOpenRequest',
    });
  }
  await assert.rejects(
    client.openArchiveFolder(undefined, 'file-1'),
    /project is required/,
  );
  assert.equal(calls.length, 3);
});

test('document deletion identifies one project/file and preserves backend failures for UI feedback', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return calls.length === 1
      ? response({ id: 'file/A', deleted: true })
      : response('The document could not be deleted.', 409);
  });
  assert.deepEqual(await client.deleteProjectFile('PROJECT A', 'file/A'), {
    id: 'file/A',
    deleted: true,
  });
  assert.equal(
    calls[0].url.pathname,
    '/api/local/projects/PROJECT%20A/files/file%2FA',
  );
  assert.equal(calls[0].options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'ProjectFileDeleteRequest',
  });
  await assert.rejects(
    client.deleteProjectFile('PROJECT A', 'file/A'),
    (error) =>
      error.status === 409 && /could not be deleted/.test(error.message),
  );
});

test('workflow loading disables both node and general upload controls until the selected project context is ready', () => {
  const project = projectRecord('FILES-SWITCH', 'Changing project', 'Client');
  const workspace = createBlankWorkspace(project, 'input_preparation');
  const html = render(ProjectWorkflowPage, {
    project,
    workspace,
    busy: true,
    onAction: async () => {},
    onSaveReferences: async () => {},
    onBack: () => {},
    onRefresh: async () => {},
    onOpenCost: () => {},
  });
  for (const label of ['Choose step documents', 'Choose project files']) {
    const input = html.match(
      new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`),
    )?.[0];
    assert.ok(input);
    assert.match(input, /disabled/);
  }
  assert.match(html, /Wait for the current update/);
});

test('archive move sends the reported Windows destination and current path unchanged', async (t) => {
  const projectPath = String.raw`D:\QuotePlatform\Test Project`;
  const expectedProjectPath = String.raw`D:\QuotePlatform\Original Project`;
  const location = {
    projectId: 'PROJECT A',
    projectPath,
    rootPath: String.raw`D:\QuotePlatform`,
  };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(
      new URL(url).pathname,
      '/api/local/projects/PROJECT%20A/files/location',
    );
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), {
      apiVersion: 'cost-workbench/local-v1',
      kind: 'ProjectArchiveMoveRequest',
      projectPath,
      expectedProjectPath,
    });
    return response(location);
  });
  assert.deepEqual(
    await client.moveProjectArchive(
      'PROJECT A',
      projectPath,
      expectedProjectPath,
    ),
    location,
  );
});

test('file transport reads only dedicated project/round/node filters and retries uploads with the same idempotency key', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response(
      options?.method === 'POST'
        ? record()
        : {
            projectId: 'PROJECT A',
            rootPath: '/archive',
            projectPath: '/archive/PROJECT A',
            files: [],
          },
    );
  });
  await client.listProjectFiles('PROJECT A', {
    category: 'workflow',
    nodeCode: 'DRB/Review',
    versionCode: 'V2',
  });
  assert.equal(calls[0].url.pathname, '/api/local/projects/PROJECT%20A/files');
  assert.deepEqual(Object.fromEntries(calls[0].url.searchParams), {
    category: 'workflow',
    nodeCode: 'DRB/Review',
    versionCode: 'V2',
  });
  const file = new File(['sample'], '设计 & 计划.xlsx', {
    type: 'application/x-test',
  });
  const options = {
    category: 'workflow',
    nodeCode: 'DRB/Review',
    versionCode: 'V2',
    requestId: 'stable-retry-id',
  };
  await client.archiveProjectFile('PROJECT A', file, options);
  await client.archiveProjectFile('PROJECT A', file, options);
  assert.equal(calls[1].url.href, calls[2].url.href);
  assert.equal(calls[1].url.searchParams.get('originalName'), file.name);
  assert.equal(calls[1].url.searchParams.get('requestId'), 'stable-retry-id');
  assert.equal(
    calls[1].options.headers['Content-Type'],
    'application/octet-stream',
  );
  assert.equal(calls[1].options.body, file);
  assert.equal(calls[1].options.method, 'POST');
  assert.ok(calls.every((call) => !call.url.pathname.includes('workspaces')));
  await assert.rejects(
    client.archiveProjectFile(
      'PROJECT A',
      { size: client.MAX_PROJECT_FILE_BYTES + 1 },
      options,
    ),
    /50 MiB/,
  );
  assert.equal(calls.length, 3);
});

test('global archive folder saves use their own revision without project data and propagate conflicts for explicit reload', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 3)
      return response('Archive settings changed. Reload and retry.', 409);
    return response({
      rootPath: '/new-archive',
      defaultRootPath: '/default',
      revision: 8,
    });
  });
  assert.equal((await client.getArchiveSettings()).revision, 8);
  await client.updateArchiveSettings('/new-archive', 7);
  const body = JSON.parse(calls[1].options.body);
  assert.deepEqual(body, {
    apiVersion: 'cost-workbench/local-v1',
    kind: 'ArchiveSettingsUpdateRequest',
    rootPath: '/new-archive',
    expectedRevision: 7,
  });
  assert.ok(
    calls.every((call) => call.url.endsWith('/api/local/archive-settings')),
  );
  await assert.rejects(
    client.updateArchiveSettings('/another', 7),
    (error) => error.status === 409 && /Reload/.test(error.message),
  );
});
