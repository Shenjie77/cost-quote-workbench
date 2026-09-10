import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
  renameSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import Ajv2020 from 'ajv/dist/2020.js';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { makeCostSnapshot } from './helpers.mjs';

const root = path.resolve(import.meta.dirname, '..');
const validateResponse = new Ajv2020({ allErrors: true, strict: true }).compile(
  JSON.parse(
    readFileSync(
      path.join(root, 'schemas/command-envelope.schema.json'),
      'utf8',
    ),
  ),
);
const request = (operation, data, requestId = 'files-cli-test') => ({
  apiVersion: 'cost-workbench/v2',
  kind: 'OperationRequest',
  requestId,
  data: { schemaVersion: '1.0.0', operation, ...data },
});
const setup = (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-files-cli-'));
  const db = path.join(directory, 'workspace.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const run = (args, input, expected = 0) => {
    const child = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        db,
        ...(input ? ['--input', '-'] : []),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        input: input ? JSON.stringify(input) : undefined,
      },
    );
    assert.equal(child.status, expected, child.stdout + child.stderr);
    const envelope = JSON.parse(child.stdout);
    assert.equal(
      validateResponse(envelope),
      true,
      JSON.stringify(validateResponse.errors),
    );
    return envelope;
  };
  const inspect = (fn) => {
    const repository = openWorkspaceRepository(db);
    try {
      return fn(repository);
    } finally {
      repository.close();
    }
  };
  const create = () =>
    run(
      ['project', 'create'],
      request('project.create', {
        project: {
          id: 'FILES-TEST',
          name: 'Document fixture',
          client: 'Test client',
        },
      }),
    );
  return { directory, db, run, inspect, create };
};

test('file settings are global, revision checked, and create no project', (t) => {
  const { directory, run } = setup(t);
  const before = run(['files', 'settings']);
  assert.equal(before.kind, 'FileSettingsResult');
  const archiveRoot = path.join(directory, 'chosen archive');
  const updated = run([
    'files',
    'settings',
    '--root',
    archiveRoot,
    '--expected-revision',
    String(before.data.revision),
  ]);
  assert.equal(updated.data.rootPath, realpathSync(archiveRoot));
  assert.equal(updated.data.revision, before.data.revision + 1);
  const conflict = run(
    [
      'files',
      'settings',
      '--root',
      archiveRoot,
      '--expected-revision',
      String(before.data.revision),
    ],
    undefined,
    5,
  );
  assert.equal(conflict.error.code, 'REVISION_CONFLICT');
  assert.deepEqual(run(['project', 'list']).data.items, []);
  run(['files', 'settings', '--root', archiveRoot], undefined, 2);
});

test('node documents archive and download exact bytes without changing project workflow or cost', (t) => {
  const { directory, run, inspect, create } = setup(t);
  create();
  const before = inspect((repo) => repo.get('FILES-TEST'));
  const nodeCode = before.workspace.processSteps[0].code;
  const source = path.join(directory, '节点证明.pdf');
  const bytes = Buffer.from('%PDF fixture\n\u0000\u0001\u00ff');
  writeFileSync(source, bytes);
  const args = [
    'files',
    'upload',
    '--project-id',
    'FILES-TEST',
    '--node-code',
    nodeCode,
    '--version',
    'V1',
    '--input',
    source,
    '--request-id',
    'upload-node-1',
    '--compact',
  ];
  const uploaded = run(args);
  assert.equal(uploaded.kind, 'ProjectFileResult');
  assert.equal(uploaded.data.file.category, 'workflow');
  assert.equal(uploaded.data.file.originalName, '节点证明.pdf');
  assert.equal(run(args).data.file.id, uploaded.data.file.id);
  const listing = run([
    'files',
    'list',
    '--project-id',
    'FILES-TEST',
    '--node-code',
    nodeCode,
    '--version',
    'V1',
  ]);
  assert.equal(listing.data.files.length, 1);
  assert.equal(existsSync(listing.data.projectPath), true);
  assert.deepEqual(
    inspect((repo) => repo.get('FILES-TEST')),
    before,
  );
  const output = path.join(directory, 'downloads', 'proof.pdf');
  const download = [
    'files',
    'download',
    '--project-id',
    'FILES-TEST',
    '--file-id',
    uploaded.data.file.id,
    '--output',
    output,
  ];
  assert.equal(run(download).kind, 'FileDownloadResult');
  assert.deepEqual(readFileSync(output), bytes);
  run(download, undefined, 5);
  run([...download, '--overwrite']);
  assert.deepEqual(readFileSync(output), bytes);
  const invalid = run(
    [
      'files',
      'upload',
      '--project-id',
      'FILES-TEST',
      '--node-code',
      'MISSING_NODE',
      '--input',
      source,
    ],
    undefined,
    3,
  );
  assert.equal(invalid.ok, false);
  assert.deepEqual(
    inspect((repo) => repo.get('FILES-TEST')),
    before,
  );
});

test('project cost exports are archived by version and leave workspace revision unchanged', (t) => {
  const { directory, run, inspect, create } = setup(t);
  create();
  inspect((repo) => {
    const record = repo.get('FILES-TEST');
    const snapshot = makeCostSnapshot();
    snapshot.costRows = snapshot.costRows.filter(
      (row) =>
        snapshot.resourceTypes.find((resource) => resource.id === row.reTypeId)
          ?.category !== 'subcontract',
    );
    for (const field of [
      'rateSettings',
      'travelSettings',
      'resourceTypes',
      'costRows',
      'manualCosts',
    ]) {
      record.workspace[field] = structuredClone(snapshot[field]);
      record.workspace.costVersions[0][field] = structuredClone(
        snapshot[field],
      );
    }
    repo.save('FILES-TEST', record.workspace, record.revision);
  });
  const before = inspect((repo) => repo.get('FILES-TEST'));
  const output = path.join(directory, 'cost.xlsx');
  const exported = run([
    'cost',
    'export',
    '--project-id',
    'FILES-TEST',
    '--version',
    'V1',
    '--format',
    'simple',
    '--output',
    output,
  ]);
  assert.equal(exported.kind, 'CostExportResult');
  const files = run([
    'files',
    'list',
    '--project-id',
    'FILES-TEST',
    '--category',
    'cost',
    '--version',
    'V1',
  ]).data.files;
  assert.equal(files.length, 1);
  assert.equal(files[0].sha256, exported.data.artifact.sha256);
  assert.deepEqual(
    inspect((repo) => repo.files.read('FILES-TEST', files[0].id).buffer),
    readFileSync(output),
  );
  assert.deepEqual(
    inspect((repo) => repo.get('FILES-TEST')),
    before,
  );
  const location = run(['files', 'list', '--project-id', 'FILES-TEST']).data;
  const categoryFolder = path.join(location.projectPath, 'cost');
  renameSync(categoryFolder, `${categoryFolder}.retained`);
  writeFileSync(categoryFolder, 'Blocked archive folder fixture');
  const failedOutput = path.join(directory, 'cost-needs-manual-archive.xlsx');
  const failed = run(
    [
      'cost',
      'export',
      '--project-id',
      'FILES-TEST',
      '--format',
      'simple',
      '--output',
      failedOutput,
    ],
    undefined,
    8,
  );
  assert.equal(failed.error.code, 'PROJECT_FILE_ARCHIVE_FAILED');
  assert.match(failed.error.message, /Workbook written to .*files upload/);
  assert.equal(existsSync(failedOutput), true);
  assert.deepEqual(
    inspect((repo) => repo.get('FILES-TEST')),
    before,
  );
});

test('cost preview keeps files untouched and successful apply archives its exact source', async (t) => {
  const { directory, run, inspect, create } = setup(t);
  create();
  inspect((repo) => {
    const record = repo.get('FILES-TEST');
    record.workspace.rateSettings.tdStart = '2026-01-01';
    record.workspace.costVersions[0].rateSettings.tdStart = '2026-01-01';
    repo.save('FILES-TEST', record.workspace, record.revision);
  });
  const resourceId = inspect(
    (repo) =>
      repo
        .get('FILES-TEST')
        .workspace.resourceTypes.find((r) => r.pool === 'LOCAL').id,
  );
  const source = path.join(directory, 'TD.xlsx');
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('TD').addRows([
    ['Scope', 'MD'],
    ['HLD design', 3],
  ]);
  writeFileSync(source, await workbook.xlsx.writeBuffer());
  const mapping = request('cost.import', {
    mapping: {
      sheet: 'TD',
      headerRow: 1,
      role: 'TD',
      mode: 'mandays',
      year: 'Y1',
      columns: {
        scope: 1,
        bu: 0,
        resource: 0,
        mandays: 2,
        sites: 0,
        mdPerSite: 0,
        cost: 0,
      },
      defaultBu: 'Delivery',
      defaultResource: resourceId,
    },
  });
  const args = [
    'cost',
    'import',
    '--project-id',
    'FILES-TEST',
    '--version',
    'V1',
    '--file',
    source,
    '--compact',
  ];
  run(args, mapping);
  assert.equal(
    run(['files', 'list', '--project-id', 'FILES-TEST']).data.files.length,
    0,
  );
  const applied = run(
    [...args, '--apply', '--expected-revision', '2'],
    mapping,
  );
  assert.equal(applied.kind, 'MutationResult');
  assert.equal(applied.data.revision, 3);
  const files = run([
    'files',
    'list',
    '--project-id',
    'FILES-TEST',
    '--category',
    'source',
  ]).data.files;
  assert.equal(files.length, 1);
  assert.equal(files[0].versionCode, 'V1');
  assert.deepEqual(
    inspect((repo) => repo.files.read('FILES-TEST', files[0].id).buffer),
    readFileSync(source),
  );
});
