import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { migrateWorkspaceDocument } from '../server/workspace-document.mjs';
import {
  readResource,
  updateResource,
  applyMasterRates,
  createCostDraft,
  syncVersion,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  costLockReason,
  getCostVersionLocks,
} from '../features/cost/cost-lock.ts';
import {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  closeCondition,
  isStale,
  commercialBasisKey,
} from '../features/ssr/domain.ts';

const ID = 'VERSION-LOCK-TEST';
const LOCKED_AT = '2026-09-01T00:00:00.000Z';
const editorFields = [
  'costRows',
  'rateSettings',
  'travelSettings',
  'travelRows',
  'travelUplift',
  'manualCosts',
];
const activate = (w, version) => {
  const target = w.costVersions.find((v) => v.code === version);
  assert.ok(target);
  w.activeVersion = version;
  for (const field of editorFields) w[field] = structuredClone(target[field]);
};
const fixture = () => {
  const w = createBlankWorkspace(
    projectRecord(ID, 'Version lock fixture', 'Client'),
    'costing',
  );
  w.costVersionLocks = {};
  w.rateSettings = {
    ...w.rateSettings,
    quoteAsOf: '2026-09-01',
    tdStart: '2026-09-01',
    tdEnd: '2030-12-31',
    baseYear: 2026,
    defaultUplift: 0,
    annualUplifts: [0, 0, 0, 0, 0],
  };
  const resource = w.resourceTypes.find((r) => r.pool === 'LOCAL');
  w.costRows = [
    {
      id: 'LOCK-ROW',
      scope: 'Deployment',
      bu: 'Delivery',
      reTypeId: resource.id,
      mdPerSite: 10,
      years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, i) => ({
        bucket,
        sites: i === 0 ? 1 : 0,
        cost: 0,
      })),
    },
  ];
  w.costVersions = [
    createCostVersion('V1', 'Draft', null, {
      ...w,
      resourceTypes: w.costVersions[0].resourceTypes,
    }),
  ];
  syncVersion(w, 'V1');
  w.costVersions.push(
    createCostVersion('V2', 'Draft', 'V1', w.costVersions[0]),
  );
  w.workflowVersion = 'V1';
  w.versionWorkflows = Object.fromEntries(
    w.costVersions.map((v) => [
      v.code,
      {
        currentWorkflowStepCode: w.currentWorkflowStepCode,
        processSteps: structuredClone(w.processSteps),
        projectStatus: w.projectStatus,
      },
    ]),
  );
  return w;
};
const setup = (t, w = fixture()) => {
  const repo = openWorkspaceRepository(':memory:');
  t.after(() => repo.close());
  repo.save(ID, w, null);
  return repo;
};
const saveChange = (repo, change) => {
  const record = repo.get(ID);
  change(record.workspace);
  return repo.save(ID, record.workspace, record.revision);
};
const completeDrb = (w) => {
  w.processSteps[0] = {
    ...w.processSteps[0],
    code: 'DRB',
    name: 'DRB review',
    state: 'completed',
  };
  w.currentWorkflowStepCode = 'DRB';
  w.selectedStep = 0;
};
const confirmAndCompleteDrbInRepository = (repo) => {
  let record = repo.get(ID);
  const version =
    record.workspace.workflowVersion || record.workspace.activeVersion;
  if (
    record.workspace.costVersions.find((v) => v.code === version).state !==
    'Confirmed'
  ) {
    updateResource(
      repo,
      ID,
      'cost',
      { version, section: 'settings' },
      { set: { state: 'Confirmed' } },
      record.revision,
    );
    record = repo.get(ID);
  }
  const target = record.workspace.processSteps.findIndex(
    (step) => step.code === 'DELIVERY_REVIEW',
  );
  assert.ok(target >= 0);
  for (const original of record.workspace.processSteps.slice(0, target + 1)) {
    let current = repo.get(ID);
    let step = current.workspace.processSteps.find(
      (value) => value.code === original.code,
    );
    if (['completed', 'skipped'].includes(step.state)) continue;
    if (step.state === 'not_started') {
      repo.applyWorkflowAction(
        ID,
        { nodeCode: step.code, action: 'start' },
        current.revision,
      );
      current = repo.get(ID);
      step = current.workspace.processSteps.find(
        (value) => value.code === original.code,
      );
    }
    repo.applyWorkflowAction(
      ID,
      {
        nodeCode: step.code,
        action: 'complete',
        confirmed: true,
        fields: Object.fromEntries(
          (step.requiredFields || []).map((key) => [
            key,
            'Verified company fixture information',
          ]),
        ),
      },
      current.revision,
    );
  }
  return repo.get(ID);
};
const assertOnlyLocked = (w, codes) => {
  assert.deepEqual(
    Object.keys(getCostVersionLocks(w)).sort((a, b) => a.localeCompare(b)),
    [...codes].sort((a, b) => a.localeCompare(b)),
  );
  for (const version of w.costVersions)
    assert.equal(
      Boolean(costLockReason(w, version.code)),
      codes.includes(version.code),
      version.code,
    );
};

// Legacy inputs omit the new field on purpose. An empty map is a migration marker.
test('legacy locks migrate once to the evidenced version rather than all versions or a later active version', () => {
  const legacy = fixture();
  delete legacy.costVersionLocks;
  legacy.costVersions[0].state = 'Confirmed';
  activate(legacy, 'V2');
  legacy.costLock = {
    reason: '成本已定稿（V1），项目成本及 RE 费率已锁定。',
    lockedAt: LOCKED_AT,
  };
  completeDrb(legacy);
  const migrated = migrateWorkspaceDocument(legacy);
  assert.equal(migrated.costLock, undefined);
  assertOnlyLocked(migrated, ['V1']);
  assert.equal(migrated.costVersionLocks.V1.lockedAt, LOCKED_AT);
  assert.deepEqual(migrateWorkspaceDocument(migrated), migrated);
  assert.ok(legacy.costLock, 'migration must not mutate the input object');
});

test('unbound legacy completion falls back once to the persisted active version; an explicit map suppresses generic inference', () => {
  const legacy = fixture();
  delete legacy.costVersionLocks;
  legacy.costLock = {
    reason: 'DRB 评审节点已完成，项目成本已锁定。',
    lockedAt: LOCKED_AT,
  };
  completeDrb(legacy);
  const migrated = migrateWorkspaceDocument(legacy);
  assertOnlyLocked(migrated, ['V1']);
  assert.equal(migrated.costVersionLocks.V1.lockedAt, LOCKED_AT);
  activate(migrated, 'V2');
  assertOnlyLocked(migrated, ['V1']);
  assertOnlyLocked(migrateWorkspaceDocument(migrated), ['V1']);
  const explicitlyMigrated = fixture();
  completeDrb(explicitlyMigrated);
  assert.deepEqual(getCostVersionLocks(explicitlyMigrated), {});
});

test('workflow DRB completion locks its current version and existing completion does not relock a new active draft', (t) => {
  const repo = setup(t);
  const locked = confirmAndCompleteDrbInRepository(repo).workspace;
  assertOnlyLocked(locked, ['V1']);
  const original = structuredClone(locked.costVersions[0]);
  const switched = saveChange(repo, (w) => activate(w, 'V2')).workspace;
  assertOnlyLocked(switched, ['V1']);
  const receipt = updateResource(
    repo,
    ID,
    'cost',
    { version: 'V2', section: 'rows' },
    { upsert: [{ id: 'LOCK-ROW', mdPerSite: 20 }] },
    repo.get(ID).revision,
  );
  assert.equal(receipt.costLockReason, null);
  saveChange(repo, (w) => {
    w.project.name = 'Unrelated metadata update';
  });
  const after = repo.get(ID).workspace;
  assertOnlyLocked(after, ['V1']);
  assert.deepEqual(after.costVersions[0], original);
  assert.equal(after.costRows[0].mdPerSite, 20);
  assert.throws(
    () =>
      updateResource(
        repo,
        ID,
        'cost',
        { version: 'V1', section: 'rows' },
        { upsert: [{ id: 'LOCK-ROW', mdPerSite: 21 }] },
        repo.get(ID).revision,
      ),
    /锁定/,
  );
  // Viewing V2 does not retarget the V1 workflow; its completion cannot lock V2.
  repo.applyWorkflowAction(
    ID,
    {
      nodeCode: 'DELIVERY_REVIEW',
      action: 'reopen',
      reason: 'Verify unchanged company DRB again',
    },
    repo.get(ID).revision,
  );
  repo.applyWorkflowAction(
    ID,
    { nodeCode: 'DELIVERY_REVIEW', action: 'complete', confirmed: true },
    repo.get(ID).revision,
  );
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
});

test('historical review gates remain read-only and never extend a lock to another selected version', (t) => {
  const w = fixture();
  w.costVersions[0].state = 'Confirmed';
  w.reviewGates.push({
    id: 'GATE-DRB',
    projectId: ID,
    gate: 'DRB review',
    gateZh: 'DRB评审',
    owner: 'PM',
    dueDate: '2026-09-10',
    status: 'completed',
    note: '',
    noteZh: '',
    workflowStepCode: w.processSteps[0].code,
    lastUpdatedAt: LOCKED_AT,
    followUps: [],
  });
  const repo = setup(t, w);
  const initial = repo.get(ID);
  assert.throws(
    () =>
      saveChange(repo, (next) => {
        next.reviewGates[0].status = 'in_review';
      }),
    /read-only/,
  );
  assert.deepEqual(repo.get(ID), initial);
  assertOnlyLocked(initial.workspace, ['V1']);
  saveChange(repo, (next) => activate(next, 'V2'));
  saveChange(repo, (next) => {
    next.project.name = 'Historical gate remains completed';
  });
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
});

test('historical DRB conditions cannot be rewritten after switching versions and only their baseline stays locked', (t) => {
  const w = fixture();
  let drbId;
  {
    const baseline = w.costVersions[0];
    baseline.state = 'Confirmed';
    let ssr = {
      ...emptySsr(),
      enabled: true,
      proposalNumber: 'P-LOCK',
      scopeBrief: 'Deployment',
      commercialBasis: commercialBasisKey(w),
    };
    const submit = (kind) => {
      ssr = recordSubmission(ssr, baseline, {
        kind,
        domain: '',
        owner: 'PM',
        dueDate: '2026-09-10',
        applicationNumber: kind + '-LOCK',
        evidence: 'Company fixture',
      });
    };
    submit('DTRB');
    ssr = recordReviewResult(ssr, ssr.submissions.at(-1).id, {
      outcome: 'approved',
      evidence: 'DTRB approved',
      conditions: [],
    });
    submit('DRB');
    drbId = ssr.submissions.at(-1).id;
    w.ssr = recordReviewResult(ssr, drbId, {
      outcome: 'conditional',
      evidence: 'DRB conditional',
      conditions: ['Scope evidence'],
    });
  }
  const repo = setup(t, w);
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
  saveChange(repo, (w) => activate(w, 'V2'));
  const beforeClosure = repo.get(ID);
  assert.throws(
    () =>
      saveChange(repo, (w) => {
        w.ssr = closeCondition(
          w.ssr,
          drbId,
          'Scope evidence',
          'Signed scope fixture',
        );
      }),
    /read-only/,
  );
  assert.deepEqual(repo.get(ID), beforeClosure);
  const after = repo.get(ID).workspace;
  assert.equal(after.activeVersion, 'V2');
  assertOnlyLocked(after, ['V1']);
  const submission = after.ssr.submissions.find((s) => s.id === drbId);
  assert.equal(submission.costBaseline.code, 'V1');
  assert.equal(
    readResource(repo, ID, 'cost', { version: 'V2', section: 'settings' })
      .costLockReason,
    null,
  );
});

test('locked versions can produce blank or cloned Drafts without transferring the lock or changing captured inputs', (t) => {
  const w = fixture();
  w.costVersions[0].state = 'Confirmed';
  const repo = setup(t, w),
    before = repo.get(ID).workspace;
  const receipt = createCostDraft(
    repo,
    ID,
    { mode: 'clone', sourceVersion: 'V1' },
    1,
  );
  assert.equal(receipt.version, 'V3');
  assert.equal(receipt.costLockReason, null);
  assert.throws(
    () => createCostDraft(repo, ID, { mode: 'blank' }, 1),
    /revision|changed/i,
  );
  const blank = createCostDraft(repo, ID, { mode: 'blank' }, 2);
  assert.equal(blank.version, 'V4');
  assert.equal(blank.costLockReason, null);
  const after = repo.get(ID).workspace;
  assert.equal(after.activeVersion, 'V4');
  assertOnlyLocked(after, ['V1']);
  assert.deepEqual(after.costVersions.slice(0, 2), before.costVersions);
  assert.deepEqual(
    after.costVersions[2].costRows,
    before.costVersions[0].costRows,
  );
  assert.deepEqual(
    after.costVersions[2].resourceTypes,
    before.costVersions[0].resourceTypes,
  );
  assert.equal(after.costVersions[2].state, 'Draft');
  assert.deepEqual(after.costVersions[3].costRows, []);
  assert.deepEqual(after.costRows, []);
});

test('target-version reads, updates and master-rate application remain available while a different active version is locked', (t) => {
  const w = fixture();
  w.costVersions[0].state = 'Confirmed';
  const repo = setup(t, w),
    before = repo.get(ID).workspace;
  assert.match(readResource(repo, ID, 'project').costLockReason, /锁定/);
  assert.match(
    readResource(repo, ID, 'cost', { version: 'V1', section: 'rows' })
      .costLockReason,
    /锁定/,
  );
  assert.equal(
    readResource(repo, ID, 'cost', { version: 'V2', section: 'rows' })
      .costLockReason,
    null,
  );
  const changed = updateResource(
    repo,
    ID,
    'cost',
    { version: 'V2', section: 'settings' },
    { set: { manualCosts: { riskContingency: 100 } } },
    1,
  );
  assert.equal(changed.costLockReason, null);
  const resourceId = before.costRows[0].reTypeId;
  const oldRate = before.resourceTypes.find(
    (r) => r.id === resourceId,
  ).mandayRate;
  const beforeMasterUpdate = repo.get(ID);
  repo.globalMasterData.update(
    'resources',
    { upsert: [{ id: resourceId, mandayRate: oldRate * 2 }] },
    1,
  );
  assert.deepEqual(repo.get(ID), beforeMasterUpdate);
  assert.throws(() => applyMasterRates(repo, ID, 'V1', 2), /锁定/);
  const applied = applyMasterRates(repo, ID, 'V2', 2);
  assert.equal(applied.costLockReason, null);
  const after = repo.get(ID).workspace;
  assert.deepEqual(after.costVersions[0], before.costVersions[0]);
  assert.deepEqual(after.costRows, before.costRows);
  assert.equal(
    after.costVersions[1].costRows[0].years[0].cost,
    before.costVersions[1].costRows[0].years[0].cost * 2,
  );
});

test('saved locks survive omitted metadata, workflow reset and attempted cost mutation or removal through full saves', (t) => {
  const repo = setup(t);
  const locked = confirmAndCompleteDrbInRepository(repo).workspace;
  const expectedLock = structuredClone(locked.costVersionLocks.V1);
  saveChange(repo, (w) => {
    activate(w, 'V2');
    delete w.costVersionLocks;
  });
  repo.applyWorkflowAction(
    ID,
    {
      nodeCode: 'DELIVERY_REVIEW',
      action: 'reopen',
      reason: 'Recheck company workflow without changing costs',
    },
    repo.get(ID).revision,
  );
  const after = repo.get(ID);
  assert.deepEqual(after.workspace.costVersionLocks.V1, expectedLock);
  assertOnlyLocked(after.workspace, ['V1']);
  for (const tamper of [
    (w) => {
      w.costVersions[0].costRows[0].mdPerSite = 99;
    },
    (w) => {
      w.costVersions[0].resourceTypes[0].mandayRate += 1;
    },
    (w) => {
      w.costVersions = w.costVersions.filter((v) => v.code !== 'V1');
      w.costVersions[0].sourceVersion = null;
    },
  ]) {
    const attempted = structuredClone(after.workspace);
    attempted.costVersionLocks = {};
    tamper(attempted);
    assert.throws(() => repo.save(ID, attempted, after.revision));
    assert.deepEqual(repo.get(ID), after);
  }
});

test('a legacy DRB-locked Draft permits unchanged confirmation but rejects downgrades and combined input changes', (t) => {
  const w = fixture();
  w.costVersionLocks.V1 = { reason: '历史 DRB 锁定 V1', lockedAt: LOCKED_AT };
  const repo = setup(t, w);
  const before = repo.get(ID);
  assert.throws(
    () =>
      updateResource(
        repo,
        ID,
        'cost',
        { version: 'V1', section: 'settings' },
        { set: { state: 'Confirmed', manualCosts: { riskContingency: 123 } } },
        before.revision,
      ),
    /锁定/,
  );
  const receipt = updateResource(
    repo,
    ID,
    'cost',
    { version: 'V1', section: 'settings' },
    { set: { state: 'Confirmed' } },
    before.revision,
  );
  assert.match(receipt.costLockReason, /锁定/);
  assert.throws(
    () =>
      updateResource(
        repo,
        ID,
        'cost',
        { version: 'V1', section: 'settings' },
        { set: { state: 'Draft' } },
        receipt.revision,
      ),
    /锁定/,
  );
  const after = repo.get(ID).workspace;
  assertOnlyLocked(after, ['V1']);
  assert.deepEqual(
    { ...after.costVersions[0], state: 'Draft' },
    before.workspace.costVersions[0],
  );
});

test('persisted version locks survive repository reopen and project deletion/restoration without extending to drafts', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'version-lock-reopen-')),
    file = path.join(dir, 'test.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let repo = openWorkspaceRepository(file);
  t.after(() => repo?.close());
  repo.save(ID, fixture(), null);
  confirmAndCompleteDrbInRepository(repo);
  const lock = structuredClone(repo.get(ID).workspace.costVersionLocks.V1);
  createCostDraft(
    repo,
    ID,
    { mode: 'clone', sourceVersion: 'V1' },
    repo.get(ID).revision,
  );
  saveChange(repo, (w) => activate(w, 'V3'));
  repo.close();
  repo = openWorkspaceRepository(file);
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
  const deleted = repo.setDeleted(ID, repo.get(ID).revision, true);
  assert.equal(repo.get(ID), null);
  repo.setDeleted(ID, deleted.revision, false);
  const restored = repo.get(ID).workspace;
  assert.equal(restored.activeVersion, 'V3');
  assertOnlyLocked(restored, ['V1']);
  assert.deepEqual(restored.costVersionLocks.V1, lock);
});

test('CLI imports into an unlocked inactive version while rejecting the locked active target', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'version-lock-import-')),
    file = path.join(dir, 'test.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const w = fixture();
  w.costVersions[0].state = 'Confirmed';
  let repo = openWorkspaceRepository(file);
  repo.save(ID, w, null);
  repo.close();
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet('TD').addRows([
    ['Scope', 'MD'],
    ['Extra deployment', 5],
  ]);
  const xlsx = path.join(dir, 'TD.xlsx');
  writeFileSync(xlsx, await workbook.xlsx.writeBuffer());
  const request = {
    apiVersion: 'cost-workbench/v2',
    kind: 'OperationRequest',
    requestId: 'version-lock-import',
    data: {
      schemaVersion: '1.0.0',
      operation: 'cost.import',
      mapping: {
        sheet: 'TD',
        headerRow: 1,
        role: 'TD',
        mode: 'mandays',
        year: 'Y2',
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
        defaultResource: w.costRows[0].reTypeId,
      },
    },
  };
  const run = (version, revision, expected) => {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'cost',
        'import',
        '--project-id',
        ID,
        '--version',
        version,
        '--file',
        xlsx,
        '--input',
        '-',
        '--apply',
        '--compact',
        '--expected-revision',
        String(revision),
        '--db',
        file,
      ],
      {
        cwd: path.resolve(import.meta.dirname, '..'),
        encoding: 'utf8',
        input: JSON.stringify(request),
      },
    );
    assert.equal(result.status, expected, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const imported = run('V2', 1, 0);
  assert.equal(imported.kind, 'MutationResult');
  assert.equal(imported.data.version, 'V2');
  assert.equal(imported.data.costLockReason, null);
  run('V1', 2, 6);
  repo = openWorkspaceRepository(file);
  try {
    const after = repo.get(ID).workspace;
    assert.equal(after.activeVersion, 'V1');
    assert.equal(after.costRows.length, 1);
    assert.equal(after.costVersions[1].costRows.length, 2);
    assertOnlyLocked(after, ['V1']);
  } finally {
    repo.close();
  }
});

for (const changedBasis of ['cost', 'scope']) {
  test(`a pending DRB preserves confirmed cost and tracks scope applicability (${changedBasis} changed)`, (t) => {
    const w = fixture();
    let drbId;
    {
      const baseline = w.costVersions[0];
      baseline.state = 'Confirmed';
      let ssr = {
        ...emptySsr(),
        enabled: true,
        proposalNumber: 'P-PENDING',
        scopeBrief: 'Deployment original scope',
        commercialBasis: commercialBasisKey(w),
      };
      const submit = (kind) => {
        ssr = recordSubmission(ssr, baseline, {
          kind,
          domain: '',
          owner: 'PM',
          dueDate: '2026-09-10',
          applicationNumber: `${kind}-PENDING`,
          evidence: 'Company submitted fixture',
        });
      };
      submit('DTRB');
      ssr = recordReviewResult(ssr, ssr.submissions.at(-1).id, {
        outcome: 'approved',
        evidence: 'DTRB approved fixture',
        conditions: [],
      });
      submit('DRB');
      drbId = ssr.submissions.at(-1).id;
      w.ssr = ssr;
    }
    const repo = setup(t, w);
    assertOnlyLocked(repo.get(ID).workspace, ['V1']);
    const submitted = structuredClone(
      repo.get(ID).workspace.ssr.submissions.at(-1).costBaseline,
    );
    if (changedBasis === 'cost') {
      assert.throws(
        () =>
          updateResource(
            repo,
            ID,
            'cost',
            { version: 'V1', section: 'rows' },
            {
              upsert: [{ id: 'LOCK-ROW', mdPerSite: 20 }],
            },
            repo.get(ID).revision,
          ),
        /锁定/,
      );
    } else {
      updateResource(
        repo,
        ID,
        'ssr',
        { section: 'settings' },
        {
          set: { scopeBrief: 'Deployment scope revised while DRB was pending' },
        },
        repo.get(ID).revision,
      );
    }
    const beforeResult = repo.get(ID);
    assert.throws(
      () =>
        saveChange(repo, (w) => {
          w.ssr = recordReviewResult(w.ssr, drbId, {
            outcome: 'approved',
            evidence: 'Actual company DRB result for submitted fixture',
            conditions: [],
          });
        }),
      /read-only/,
    );
    assert.deepEqual(repo.get(ID), beforeResult);
    const after = repo.get(ID).workspace;
    const submission = after.ssr.submissions.find((s) => s.id === drbId);
    assert.deepEqual(submission.costBaseline, submitted);
    assert.equal(
      isStale(after.ssr, submission, after.costVersions[0]),
      changedBasis === 'scope',
    );
    assertOnlyLocked(after, ['V1']);
    {
      // Only the unchanged submitted cost is frozen; stale Scope review remains stale.
      assert.deepEqual(after.costVersions[0], submitted);
      assert.throws(
        () =>
          updateResource(
            repo,
            ID,
            'cost',
            { version: 'V1', section: 'rows' },
            {
              upsert: [{ id: 'LOCK-ROW', mdPerSite: 21 }],
            },
            repo.get(ID).revision,
          ),
        /锁定/,
      );
    }
  });
}

test('a completed custom node cannot be rewritten as DRB or extend its version lock to the active editor', (t) => {
  const w = fixture();
  w.costVersions[0].state = 'Confirmed';
  w.processSteps.unshift({
    ...w.processSteps[0],
    code: 'CUSTOM_CHECK',
    name: 'Logistics checklist',
    state: 'completed',
    required: false,
    autoSkip: true,
    roundStart: false,
    finishesWorkflow: false,
    requiresConfirmedCost: false,
  });
  w.processSteps.forEach((step, index) => {
    step.no = String(index + 1).padStart(2, '0');
  });
  w.selectedStep = w.processSteps.findIndex(
    (step) => step.code === w.currentWorkflowStepCode,
  );
  const repo = setup(t, w);
  saveChange(repo, (next) => activate(next, 'V2'));
  const before = repo.get(ID);
  assert.throws(
    () =>
      saveChange(repo, (next) => {
        next.processSteps[0].name = 'DRB review';
      }),
    /server-owned|workflow-action|publish/,
  );
  assert.deepEqual(repo.get(ID), before);
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
  assert.equal(
    readResource(repo, ID, 'cost', { version: 'V2', section: 'settings' })
      .costLockReason,
    null,
  );
  repo.applyWorkflowAction(
    ID,
    {
      nodeCode: 'CUSTOM_CHECK',
      action: 'reopen',
      reason: 'Recheck the logistics fixture',
    },
    repo.get(ID).revision,
  );
  repo.applyWorkflowAction(
    ID,
    { nodeCode: 'CUSTOM_CHECK', action: 'complete' },
    repo.get(ID).revision,
  );
  assertOnlyLocked(repo.get(ID).workspace, ['V1']);
});

test('legacy DRB lock with only an application number stays on its stale V1 baseline when V2 is active', () => {
  const w = fixture();
  const baseline = { ...w.costVersions[0], state: 'Confirmed' };
  let ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P-LEGACY',
    scopeBrief: 'Original deployment',
    commercialBasis: commercialBasisKey(w),
  };
  for (const kind of ['DTRB', 'DRB']) {
    ssr = recordSubmission(ssr, baseline, {
      kind,
      domain: '',
      owner: 'PM',
      dueDate: '2026-09-10',
      applicationNumber: `${kind}-LEGACY-42`,
      evidence: 'Historical company fixture',
    });
    ssr = recordReviewResult(ssr, ssr.submissions.at(-1).id, {
      outcome: 'approved',
      evidence: 'Historical approved result',
      conditions: [],
    });
  }
  w.ssr = ssr;
  w.costVersions[0].costRows[0].mdPerSite = 20;
  activate(w, 'V2');
  assert.equal(isStale(ssr, ssr.submissions.at(-1), w.costVersions[0]), true);
  delete w.costVersionLocks;
  w.costLock = {
    reason: 'DRB 已完成（DRB-LEGACY-42），项目成本已锁定。',
    lockedAt: LOCKED_AT,
  };
  const original = structuredClone(w);
  const migrated = migrateWorkspaceDocument(w);
  assertOnlyLocked(migrated, ['V1']);
  assert.equal(migrated.activeVersion, 'V2');
  assert.equal(migrated.costVersionLocks.V1.lockedAt, LOCKED_AT);
  assert.match(migrated.costVersionLocks.V1.reason, /历史/);
  assert.equal(migrated.costLock, undefined);
  assert.deepEqual(migrated.costVersions, original.costVersions);
  assert.deepEqual(migrated.ssr, original.ssr);
  assert.deepEqual(w, original);
  assert.deepEqual(migrateWorkspaceDocument(migrated), migrated);
});
