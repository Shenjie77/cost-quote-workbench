import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';

const envelope = (operation, data) => ({
  apiVersion: 'cost-workbench/v2',
  kind: 'OperationRequest',
  requestId: 'skill-cli-test',
  data: { schemaVersion: '1.0.0', operation, ...data },
});
const setup = (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'skill-cli-create-'));
  const db = path.join(dir, 'test.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (args, request, expected = 0) => {
    const child = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        db,
        ...(request ? ['--input', '-'] : []),
      ],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8',
        input: request ? JSON.stringify(request) : undefined,
      },
    );
    assert.equal(child.status, expected, child.stdout + child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.ok, expected === 0);
    return result;
  };
  const inspect = (fn) => {
    const repo = openWorkspaceRepository(db);
    try {
      return fn(repo);
    } finally {
      repo.close();
    }
  };
  const create = () =>
    run(
      ['project', 'create'],
      envelope('project.create', {
        project: {
          id: 'SKILL-PROJECT',
          name: 'Skill fixture',
          client: 'Test client',
        },
      }),
    );
  return { dir, run, inspect, create };
};

test('project create is a narrow create-only operation with empty business inputs', (t) => {
  const { run, inspect, create } = setup(t);
  const result = create();
  assert.equal(result.kind, 'MutationResult');
  assert.equal(result.data.version, 'V1');
  assert.equal(result.data.revision, 1);
  assert.equal(result.data.workspace, undefined);
  inspect((repo) => {
    const w = repo.get('SKILL-PROJECT').workspace;
    assert.equal(w.activeVersion, 'V1');
    assert.equal(w.costVersions[0].state, 'Draft');
    assert.deepEqual(w.costRows, []);
    assert.equal(w.rateSettings.tdStart, '');
    assert.equal(w.rateSettings.tdEnd, '');
    assert.equal(
      w.rateSettings.quoteAsOf,
      new Date().toISOString().slice(0, 10),
    );
    assert.deepEqual(w.rateSettings.annualUplifts, [0, 0, 0, 0, 0]);
    assert.ok(Object.values(w.manualCosts).every((v) => v === 0));
    assert.ok(Object.values(w.travelSettings).every((v) => v === 0));
    assert.deepEqual(w.subcontractItems, []);
    assert.deepEqual(w.supplementalCostItems, []);
    assert.deepEqual(w.maintenancePriceRecords, []);
  });
  const request = envelope('project.create', {
    project: { id: 'SKILL-PROJECT', name: 'Replacement', client: 'Other' },
  });
  assert.equal(
    run(['project', 'create'], request, 5).error.code,
    'REVISION_CONFLICT',
  );
  run([
    'project',
    'delete',
    '--project-id',
    'SKILL-PROJECT',
    '--expected-revision',
    '1',
  ]);
  assert.equal(
    run(['project', 'create'], request, 4).error.code,
    'PROJECT_DELETED',
  );
  inspect((repo) => assert.equal(repo.headers(true)[0].revision, 2));
});

test('project create validates identity and operation before writing', (t) => {
  const { run, inspect } = setup(t);
  run(
    ['project', 'create'],
    envelope('project.create', {
      project: { id: ' ', name: 'Fixture', client: 'Client' },
    }),
    3,
  );
  run(
    ['project', 'create'],
    envelope('cost.update', { changes: { set: { state: 'Draft' } } }),
    3,
  );
  inspect((repo) => assert.deepEqual(repo.headers(), []));
});

test('cost create selects each new Draft and starts its own workflow while retaining source inputs', (t) => {
  const { run, inspect, create } = setup(t);
  create();
  let before;
  inspect((repo) => {
    const record = repo.get('SKILL-PROJECT'),
      w = record.workspace;
    const resource = w.resourceTypes.find((r) => r.category === 'internal');
    w.costRows = [
      {
        id: 'ROW-1',
        scope: 'Deploy',
        bu: 'Delivery',
        reTypeId: resource.id,
        mdPerSite: 2,
        years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket) => ({
          bucket,
          sites: 1,
          cost: 0,
        })),
      },
    ];
    w.rateSettings.tdStart = '2026-01-01';
    w.rateSettings.localArpAllowanceEnabled = true;
    w.manualCosts.riskContingency = 123;
    // The catalogue now differs from the captured version rate.
    resource.mandayRate += 100;
    before = repo.save(w.project.id, w, record.revision).workspace;
  });
  const clone = run([
    'cost',
    'create',
    '--project-id',
    'SKILL-PROJECT',
    '--mode',
    'clone',
    '--source-version',
    'V1',
    '--expected-revision',
    '2',
  ]);
  assert.equal(clone.kind, 'MutationResult');
  assert.equal(clone.data.version, 'V2');
  assert.equal(clone.data.workflowVersion, 'V2');
  inspect((repo) => {
    const w = repo.get('SKILL-PROJECT').workspace;
    assert.equal(w.activeVersion, 'V2');
    assert.equal(w.workflowVersion, 'V2');
    assert.equal(w.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(
      w.versionWorkflows.V2.currentWorkflowStepCode,
      'TD_EFFORT_REVIEW',
    );
    assert.deepEqual(w.versionWorkflows.V1, before.versionWorkflows.V1);
  });
  const blank = run([
    'cost',
    'create',
    '--project-id',
    'SKILL-PROJECT',
    '--mode',
    'blank',
    '--expected-revision',
    '3',
  ]);
  assert.equal(blank.data.version, 'V3');
  assert.equal(blank.data.workflowVersion, 'V3');
  inspect((repo) => {
    const w = repo.get('SKILL-PROJECT').workspace;
    assert.equal(w.activeVersion, 'V3');
    assert.equal(w.workflowVersion, 'V3');
    assert.equal(w.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    for (const key of [
      'costRows',
      'rateSettings',
      'manualCosts',
      'travelSettings',
      'travelRows',
      'travelUplift',
    ])
      assert.deepEqual(w[key], w.costVersions[2][key]);
    assert.deepEqual(w.resourceTypes, before.resourceTypes);
    assert.deepEqual(w.versionWorkflows.V1, before.versionWorkflows.V1);
    assert.equal(
      w.versionWorkflows.V2.currentWorkflowStepCode,
      'TD_EFFORT_REVIEW',
    );
    assert.equal(
      w.versionWorkflows.V3.currentWorkflowStepCode,
      'TD_EFFORT_REVIEW',
    );
    assert.deepEqual(w.costVersions[0], before.costVersions[0]);
    const v2 = w.costVersions[1],
      v3 = w.costVersions[2];
    assert.equal(v2.state, 'Draft');
    assert.equal(v2.sourceVersion, 'V1');
    assert.deepEqual(v2.costRows, before.costVersions[0].costRows);
    assert.deepEqual(v2.resourceTypes, before.costVersions[0].resourceTypes);
    assert.deepEqual(v2.manualCosts, before.costVersions[0].manualCosts);
    assert.deepEqual(v3.resourceTypes, before.resourceTypes);
    assert.deepEqual(v3.costRows, []);
    assert.equal(v3.sourceVersion, null);
    assert.equal(v3.rateSettings.tdStart, '');
    assert.equal(v3.rateSettings.localArpAllowanceEnabled, false);
    assert.ok(Object.values(v3.manualCosts).every((v) => v === 0));
  });
});

test('cost create rejects invalid requests but allows new drafts after DRB or finalization', (t) => {
  const { run, inspect, create } = setup(t);
  create();
  const args = [
    'cost',
    'create',
    '--project-id',
    'SKILL-PROJECT',
    '--expected-revision',
    '1',
  ];
  run([...args, '--mode', 'unknown'], undefined, 6);
  run([...args, '--mode', 'clone'], undefined, 6);
  run([...args, '--mode', 'blank', '--source-version', 'V1'], undefined, 6);
  run([...args, '--mode', 'clone', '--source-version', 'V99'], undefined, 4);
  run(
    [
      'cost',
      'create',
      '--project-id',
      'SKILL-PROJECT',
      '--mode',
      'blank',
      '--expected-revision',
      '2',
    ],
    undefined,
    5,
  );
  const completeDrb = (w) => {
    let step = w.processSteps.find((entry) => entry.code === 'DRB');
    if (!step) {
      step = { ...w.processSteps[0], code: 'DRB', name: 'DRB', no: '99' };
      w.processSteps.push(step);
    }
    const dtrb = w.processSteps.find(
      (entry) => entry.code === 'TD_EFFORT_REVIEW',
    );
    if (dtrb) dtrb.state = 'completed';
    step.state = 'completed';
    w.currentWorkflowStepCode = step.code;
    w.selectedStep = w.processSteps.indexOf(step);
  };
  inspect((repo) => {
    const record = repo.get('SKILL-PROJECT');
    completeDrb(record.workspace);
    assert.throws(
      () => repo.save('SKILL-PROJECT', record.workspace, record.revision),
      /Confirmed|确认成本/,
    );
    assert.equal(repo.get('SKILL-PROJECT').revision, 1);
    assert.equal(
      repo.get('SKILL-PROJECT').workspace.costVersions[0].state,
      'Draft',
    );
  });
  run(
    [
      'cost',
      'update',
      '--project-id',
      'SKILL-PROJECT',
      '--version',
      'V1',
      '--section',
      'settings',
      '--expected-revision',
      '1',
    ],
    envelope('cost.update', { changes: { set: { state: 'Confirmed' } } }),
  );
  let originalVersion, originalWorkflow;
  inspect((repo) => {
    const record = repo.get('SKILL-PROJECT');
    completeDrb(record.workspace);
    const saved = repo.save('SKILL-PROJECT', record.workspace, record.revision);
    originalVersion = saved.workspace.costVersions[0];
    originalWorkflow = saved.workspace.versionWorkflows.V1;
  });
  const next = run(
    [
      'cost',
      'create',
      '--project-id',
      'SKILL-PROJECT',
      '--mode',
      'blank',
      '--expected-revision',
      '3',
    ],
    undefined,
    0,
  );
  assert.equal(next.data.workflowVersion, 'V2');
  inspect((repo) => {
    const w = repo.get('SKILL-PROJECT').workspace;
    assert.equal(w.costVersions.length, 2);
    assert.deepEqual(w.costVersions[0], originalVersion);
    assert.deepEqual(w.versionWorkflows.V1, originalWorkflow);
    assert.equal(w.activeVersion, 'V2');
    assert.equal(w.workflowVersion, 'V2');
    assert.equal(w.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.equal(w.costVersions[1].state, 'Draft');
    assert.equal(next.data.costLockReason, null);
  });
  // A separate project verifies Confirmed finality independently of DRB.
  run(
    ['project', 'create'],
    envelope('project.create', {
      project: { id: 'FINAL', name: 'Final test', client: 'Client' },
    }),
  );
  run(
    [
      'cost',
      'update',
      '--project-id',
      'FINAL',
      '--version',
      'V1',
      '--section',
      'settings',
      '--expected-revision',
      '1',
    ],
    envelope('cost.update', { changes: { set: { state: 'Confirmed' } } }),
  );
  run(
    [
      'cost',
      'create',
      '--project-id',
      'FINAL',
      '--mode',
      'clone',
      '--source-version',
      'V1',
      '--expected-revision',
      '2',
    ],
    undefined,
    0,
  );
});

test('cost import targets an inactive version using its own assumptions and returns a narrow receipt', async (t) => {
  const { dir, run, inspect, create } = setup(t);
  create();
  run([
    'cost',
    'create',
    '--project-id',
    'SKILL-PROJECT',
    '--mode',
    'blank',
    '--expected-revision',
    '1',
  ]);
  let reType, before;
  inspect((repo) => {
    const record = repo.get('SKILL-PROJECT'),
      w = record.workspace,
      v = w.costVersions[1];
    // Viewing V1 keeps the new V2 workflow round active; imports still target V2.
    w.activeVersion = 'V1';
    for (const field of [
      'costRows',
      'rateSettings',
      'travelSettings',
      'travelRows',
      'travelUplift',
      'manualCosts',
    ])
      w[field] = structuredClone(w.costVersions[0][field]);
    reType = v.resourceTypes.find((r) => r.pool === 'LOCAL');
    reType.mandayRate = 100;
    v.rateSettings = {
      ...v.rateSettings,
      tdStart: '2026-01-01',
      baseYear: 2026,
      localArpAllowanceEnabled: true,
    };
    before = repo.save('SKILL-PROJECT', w, record.revision).workspace;
  });
  const file = path.join(dir, 'TD.xlsx'),
    book = new ExcelJS.Workbook();
  book.addWorksheet('TD').addRows([
    ['Scope', 'Mandays'],
    ['Deployment', 10],
  ]);
  writeFileSync(file, await book.xlsx.writeBuffer());
  const request = envelope('cost.import', {
    mapping: {
      sheet: 'TD',
      headerRow: 1,
      role: 'TD',
      mode: 'mandays',
      year: 'Y3',
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
      defaultResource: reType.id,
    },
  });
  const args = [
    'cost',
    'import',
    '--compact',
    '--project-id',
    'SKILL-PROJECT',
    '--version',
    'V2',
    '--file',
    file,
  ];
  const preview = run(args, request);
  assert.equal(preview.data.version, 'V2');
  assert.equal(preview.data.revision, 3);
  assert.deepEqual(preview.data.issues, []);
  assert.equal(preview.data.rows[0].years[2].cost, 1030);
  run([...args, '--apply', '--expected-revision', '2'], request, 5);
  const result = run([...args, '--apply', '--expected-revision', '3'], request);
  assert.equal(result.kind, 'MutationResult');
  assert.equal(result.data.version, 'V2');
  assert.equal(result.data.workspace, undefined);
  assert.equal(result.data.changedIds.length, 1);
  inspect((repo) => {
    const w = repo.get('SKILL-PROJECT').workspace;
    assert.equal(w.activeVersion, 'V1');
    assert.equal(w.workflowVersion, 'V2');
    assert.equal(w.currentWorkflowStepCode, 'TD_EFFORT_REVIEW');
    assert.deepEqual(w.costRows, before.costRows);
    assert.deepEqual(w.rateSettings, before.rateSettings);
    assert.deepEqual(w.costVersions[0], before.costVersions[0]);
    assert.equal(w.costVersions[1].costRows[0].years[2].cost, 1030);
    assert.equal(w.costVersions[1].costRows[0].source.row, 2);
    assert.equal(w.costVersions[1].costRows[0].source.fileName, 'TD.xlsx');
  });
  run([...args, '--apply', '--expected-revision', '4'], request, 6);
  run(
    [
      'cost',
      'import',
      '--project-id',
      'SKILL-PROJECT',
      '--version',
      'V99',
      '--file',
      file,
    ],
    request,
    4,
  );
  // Omitted version still addresses active V1 (whose delivery date is not set).
  run(
    ['cost', 'import', '--project-id', 'SKILL-PROJECT', '--file', file],
    request,
    6,
  );
  run(
    [
      'cost',
      'update',
      '--project-id',
      'SKILL-PROJECT',
      '--version',
      'V2',
      '--section',
      'settings',
      '--expected-revision',
      '4',
    ],
    envelope('cost.update', { changes: { set: { state: 'Confirmed' } } }),
  );
  run([...args, '--apply', '--expected-revision', '5'], request, 6);
  inspect((repo) => assert.equal(repo.get('SKILL-PROJECT').revision, 5));
});

test('cost import retains active-version and full-response compatibility without compact', async (t) => {
  const { dir, run, inspect, create } = setup(t);
  create();
  let resourceId;
  inspect((repo) => {
    const record = repo.get('SKILL-PROJECT');
    record.workspace.rateSettings.tdStart = '2026-01-01';
    resourceId = record.workspace.resourceTypes.find(
      (r) => r.pool === 'LOCAL',
    ).id;
    repo.save('SKILL-PROJECT', record.workspace, record.revision);
  });
  const file = path.join(dir, 'compat.xlsx'),
    book = new ExcelJS.Workbook();
  book.addWorksheet('TD').addRows([
    ['Scope', 'MD'],
    ['Compatibility', 1],
  ]);
  writeFileSync(file, await book.xlsx.writeBuffer());
  const request = envelope('cost.import', {
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
    'SKILL-PROJECT',
    '--file',
    file,
    '--apply',
  ];
  const full = run([...args, '--expected-revision', '2'], request);
  assert.equal(full.kind, 'WorkspaceRecordResult');
  assert.equal(full.data.workspace.activeVersion, 'V1');
  assert.equal(full.data.workspace.costRows.length, 1);
  request.data.mapping.year = 'Y2';
  const compact = run(
    [...args, '--expected-revision', '3', '--compact'],
    request,
  );
  assert.equal(compact.kind, 'MutationResult');
  assert.equal(compact.data.version, 'V1');
  assert.equal(compact.data.workspace, undefined);
  inspect((repo) =>
    assert.equal(repo.get('SKILL-PROJECT').workspace.costRows.length, 2),
  );
});
