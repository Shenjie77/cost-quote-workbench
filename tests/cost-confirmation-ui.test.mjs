import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { makeCostSnapshot } from './helpers.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
// Node strips .ts natively, but TSX needs a test-only transform. Resolve only
// application modules; leave dependency resolution and production builds alone.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), 'utf8'),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    return { format: 'module', source, shortCircuit: true };
  },
});

const {
  costConfirmationDetails,
  confirmReviewedCost,
  workflowConfirmationFingerprint,
} = await import('../features/cost/cost-confirmation.ts');
const { CostConfirmationBody } =
  await import('../features/cost/cost-confirmation-dialog.tsx');
const { submitReviewFromView, applySsrEditFromView } =
  await import('../features/ssr/review-submission-action.ts');
const { SsrView } = await import('../features/ssr/ssr-view.tsx');
const { createBlankWorkspace, createCostVersion, projectRecord } =
  await import('../features/workbench/workspace-factories.ts');
const {
  emptySsr,
  recordSubmission,
  recordReviewResult,
  closeCondition,
  assertSsrTransition,
} = await import('../features/ssr/domain.ts');
const { recalculateCostRows } = await import('../features/cost/domain.ts');
hooks.deregister();
const noop = () => {};
const makeWorkspace = () => {
  const snapshot = makeCostSnapshot();
  const base = createBlankWorkspace(
    projectRecord('P-CONFIRM', 'Confirmation Project', 'Fixture Client'),
    'input_preparation',
  );
  const v1 = createCostVersion('V1', 'Draft', null, snapshot);
  const v2 = createCostVersion('V2', 'Draft', 'V1', snapshot);
  return {
    ...base,
    activeVersion: 'V1',
    workflowVersion: 'V2',
    costVersionLocks: {},
    costVersions: [v1, v2],
    costRows: v1.costRows,
    rateSettings: v1.rateSettings,
    resourceTypes: snapshot.resourceTypes,
    travelSettings: v1.travelSettings,
    manualCosts: v1.manualCosts,
  };
};
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];

test('a project hold or resume invalidates a pending workflow confirmation without changing cost', () => {
  const workspace = makeWorkspace();
  const before = workflowConfirmationFingerprint(workspace);
  const held = {
    ...workspace,
    workflowHold: { startedAt: '2026-09-09T01:00:00.000Z' },
  };
  assert.notEqual(workflowConfirmationFingerprint(held), before);
  assert.equal(
    costConfirmationDetails(held, 'V2').costKey,
    costConfirmationDetails(workspace, 'V2').costKey,
  );
  const resumed = { ...held };
  delete resumed.workflowHold;
  assert.notEqual(
    workflowConfirmationFingerprint(resumed),
    workflowConfirmationFingerprint(held),
  );
});

test('cost confirmation is a read-only preview; only explicit approval finalizes the named version', () => {
  const workspace = makeWorkspace();
  const original = structuredClone(workspace);
  const details = costConfirmationDetails(workspace, 'V2');
  assert.deepEqual(details.errors, []);
  assert.deepEqual(workspace, original);
  const next = confirmReviewedCost(workspace, 'V2', details.costKey);
  assert.equal(next.costVersions[0].state, 'Draft');
  assert.equal(next.costVersions[1].state, 'Confirmed');
  assert.deepEqual(
    next.costVersions[1].costRows,
    original.costVersions[1].costRows,
  );
  assert.deepEqual(next.ssr, original.ssr);
  assert.equal(workspace.costVersions[1].state, 'Draft');
});

test('changed amounts and hard cost errors cannot be confirmed from an outdated dialog', () => {
  const workspace = makeWorkspace();
  const details = costConfirmationDetails(workspace, 'V2');
  workspace.costVersions[1].manualCosts.riskContingency += 1;
  assert.throws(
    () => confirmReviewedCost(workspace, 'V2', details.costKey),
    /成本已变化/,
  );
  workspace.costVersions[1].costRows[0].years[0].cost = -1;
  const invalid = costConfirmationDetails(workspace, 'V2');
  assert.ok(invalid.errors.length);
  assert.throws(
    () => confirmReviewedCost(workspace, 'V2', invalid.costKey),
    /先修正成本/,
  );
});

test('an already locked historical Draft can confirm unchanged amounts with a missing TD year warning', () => {
  const workspace = makeWorkspace();
  const version = workspace.costVersions[0];
  version.rateSettings.tdStart = '';
  version.rateSettings.tdEnd = '';
  version.costRows = recalculateCostRows(
    version.costRows,
    version.resourceTypes || workspace.resourceTypes,
    version.rateSettings,
  );
  workspace.costVersionLocks.V1 = {
    reason: 'Legacy DRB lock',
    lockedAt: '2026-09-07T00:00:00Z',
  };
  const details = costConfirmationDetails(workspace, 'V1');
  assert.ok(
    details.issues.some(
      (issue) =>
        issue.code === 'DELIVERY_YEAR_REQUIRED' && issue.severity === 'warning',
    ),
  );
  assert.deepEqual(details.errors, []);
  const confirmed = confirmReviewedCost(workspace, 'V1', details.costKey);
  assert.equal(confirmed.costVersions[0].state, 'Confirmed');
  assert.deepEqual(confirmed.costVersions[0].costRows, version.costRows);
});

test('DRB submission from a Draft asks for confirmation and never mutates or invents approval', () => {
  const workspace = makeWorkspace();
  let requested = 0,
    changes = 0;
  const input = {
    kind: 'DRB',
    domain: '',
    owner: 'PM Fixture',
    dueDate: '2026-09-10',
    applicationNumber: 'DRB-FIXTURE',
    evidence: 'Fixture application',
  };
  submitReviewFromView({
    value: emptySsr(),
    baseline: workspace.costVersions[1],
    input,
    onChange: () => {
      changes += 1;
    },
    onRequestConfirmCost: (copy) => {
      requested += 1;
      assert.deepEqual(copy, input);
      assert.notEqual(copy, input);
    },
    announce: noop,
  });
  assert.equal(requested, 1);
  assert.equal(changes, 0);
  assert.equal(workspace.costVersions[1].state, 'Draft');
});

test('after explicit cost confirmation DRB captures the Confirmed version and remains pending', () => {
  const workspace = makeWorkspace();
  const draft = workspace.costVersions[1];
  let ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'PROPOSAL-FIXTURE',
    scopeBrief: 'Fixture delivery scope',
  };
  ssr = recordSubmission(ssr, draft, {
    kind: 'DTRB',
    domain: '',
    owner: 'TD Fixture',
    dueDate: '2026-09-10',
    applicationNumber: 'DTRB-FIXTURE',
    evidence: 'Fixture source',
  });
  ssr = recordReviewResult(ssr, ssr.submissions[0].id, {
    outcome: 'approved',
    evidence: 'Fixture technical approval',
    conditions: [],
  });
  const details = costConfirmationDetails(workspace, 'V2');
  const next = confirmReviewedCost(workspace, 'V2', details.costKey);
  let saved;
  submitReviewFromView({
    value: ssr,
    baseline: next.costVersions[1],
    input: {
      kind: 'DRB',
      domain: '',
      owner: 'PM Fixture',
      dueDate: '2026-09-10',
      applicationNumber: 'DRB-FIXTURE',
      evidence: 'Fixture application',
    },
    onChange: (value) => {
      saved = value;
    },
    onRequestConfirmCost: () => assert.fail('already explicitly confirmed'),
    announce: (message) => {
      if (!saved) assert.fail(message);
    },
  });
  const drb = saved.submissions.at(-1);
  assert.equal(drb.costBaseline.code, 'V2');
  assert.equal(drb.costBaseline.state, 'Confirmed');
  assert.deepEqual(drb.results, []);
});

test('confirmation dialog shows exact version and calculated total without auto-confirming', () => {
  const details = costConfirmationDetails(makeWorkspace(), 'V2');
  let confirmations = 0,
    cancellations = 0;
  const props = {
    details,
    action: '进入本版 DRB',
    busy: false,
    error: '',
    onConfirm: () => {
      confirmations += 1;
    },
    onCancel: () => {
      cancellations += 1;
    },
    onViewCost: noop,
  };
  const markup = renderToStaticMarkup(
    React.createElement(CostConfirmationBody, props),
  );
  assert.match(markup, /Confirmation Project/);
  assert.match(markup, /V2/);
  assert.match(markup, /计算后总成本/);
  assert.equal(confirmations, 0);
  const buttons = walk(CostConfirmationBody(props)).filter(
    (node) => typeof node.props.onClick === 'function',
  );
  buttons[0].props.onClick();
  assert.equal(cancellations, 1);
  assert.equal(confirmations, 0);
  const blocked = walk(
    CostConfirmationBody({
      ...props,
      details: {
        ...details,
        errors: [{ severity: 'error', message: 'Invalid cost' }],
      },
    }),
  )
    .filter((node) => typeof node.props.onClick === 'function')
    .at(-1);
  assert.equal(blocked.props.disabled, true);
});

test('SSR defaults to the current workflow version and keeps a visible history entry', () => {
  const workspace = makeWorkspace();
  let value = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'P-FIXTURE',
    scopeBrief: 'Fixture scope',
  };
  for (const version of workspace.costVersions)
    value = recordSubmission(value, version, {
      kind: 'DTRB',
      domain: '',
      owner: 'TD Fixture',
      dueDate: '2026-09-10',
      applicationNumber: `${version.code}-APP`,
      evidence: 'Fixture source',
    });
  const markup = renderToStaticMarkup(
    React.createElement(SsrView, {
      value,
      baseline: workspace.costVersions[1],
      baselines: workspace.costVersions,
      onChange: noop,
      onRequestConfirmCost: noop,
      announce: noop,
    }),
  );
  assert.match(markup, /V2-APP/);
  assert.doesNotMatch(markup, /V1-APP/);
  assert.match(markup, /DTRB · 本版成本待确认/);
  assert.match(markup, /显示所有版本的历史送审记录/);
});

const legacyDrbWorkspace = () => {
  const workspace = makeWorkspace();
  const baseline = { ...workspace.costVersions[0], state: 'Confirmed' };
  let ssr = {
    ...emptySsr(),
    enabled: true,
    proposalNumber: 'LEGACY-PROPOSAL',
    scopeBrief: 'Fixture legacy delivery',
  };
  for (const kind of ['DTRB', 'DRB']) {
    ssr = recordSubmission(ssr, baseline, {
      kind,
      domain: '',
      owner: 'Fixture owner',
      dueDate: '2026-09-10',
      applicationNumber: `${kind}-LEGACY`,
      evidence: 'Fixture actual submission',
    });
    if (kind === 'DTRB')
      ssr = recordReviewResult(ssr, ssr.submissions.at(-1).id, {
        outcome: 'approved',
        evidence: 'Fixture actual TD approval',
        conditions: [],
      });
  }
  // Pre-existing legacy Draft submission, retained by migration. No new Draft
  // DRB submission can be created through the production function.
  ssr.submissions.at(-1).costBaseline.state = 'Draft';
  workspace.ssr = ssr;
  return workspace;
};

for (const outcome of ['approved', 'conditional']) {
  test(`legacy Draft DRB ${outcome} waits for explicit confirmation of its own version; cancelling preserves all evidence`, () => {
    const workspace = legacyDrbWorkspace();
    const original = structuredClone(workspace);
    const next = recordReviewResult(
      workspace.ssr,
      workspace.ssr.submissions.at(-1).id,
      {
        outcome,
        evidence: 'Fixture actual PM decision',
        conditions:
          outcome === 'conditional' ? ['Complete fixture action'] : [],
      },
    );
    let requested,
      saved = 0;
    const applied = applySsrEditFromView({
      previous: workspace.ssr,
      next,
      versions: workspace.costVersions,
      onChange: () => saved++,
      onRequestConfirmCost: (code, value) => {
        requested = { code, value };
      },
    });
    assert.equal(applied, false);
    assert.equal(saved, 0);
    assert.equal(requested.code, 'V1');
    assert.equal(workspace.workflowVersion, 'V2');
    assert.deepEqual(workspace, original); // Cancelling leaves the pending value unapplied.
    const details = costConfirmationDetails(workspace, requested.code);
    const confirmed = confirmReviewedCost(
      workspace,
      requested.code,
      details.costKey,
    );
    assert.doesNotThrow(() =>
      assertSsrTransition(
        workspace.ssr,
        requested.value,
        confirmed.costVersions,
      ),
    );
    assert.equal(confirmed.costVersions[0].state, 'Confirmed');
    assert.equal(confirmed.costVersions[1].state, 'Draft');
    assert.deepEqual(confirmed.ssr, original.ssr); // Cost confirmation alone invents no review result.
  });
}

test('legacy Draft DRB condition closure waits for confirmation and remains open on cancellation', () => {
  const workspace = legacyDrbWorkspace();
  const id = workspace.ssr.submissions.at(-1).id;
  workspace.ssr = recordReviewResult(workspace.ssr, id, {
    outcome: 'conditional',
    evidence: 'Fixture actual condition',
    conditions: ['Complete fixture action'],
  });
  const before = structuredClone(workspace.ssr);
  const next = closeCondition(
    workspace.ssr,
    id,
    'Complete fixture action',
    'Fixture closure evidence',
  );
  let requested;
  assert.equal(
    applySsrEditFromView({
      previous: workspace.ssr,
      next,
      versions: workspace.costVersions,
      onChange: () => assert.fail('must wait for cost confirmation'),
      onRequestConfirmCost: (code, value) => {
        requested = { code, value };
      },
    }),
    false,
  );
  assert.equal(requested.code, 'V1');
  assert.deepEqual(workspace.ssr, before);
  assert.deepEqual(workspace.ssr.submissions.at(-1).closures, []);
  assert.equal(requested.value.submissions.at(-1).closures.length, 1);
});

test('Confirmed DRB evidence and Draft rejection remain ordinary SSR edits', () => {
  for (const outcome of ['approved', 'rejected', 'withdrawn']) {
    const workspace = legacyDrbWorkspace();
    if (outcome === 'approved') workspace.costVersions[0].state = 'Confirmed';
    const next = recordReviewResult(
      workspace.ssr,
      workspace.ssr.submissions.at(-1).id,
      {
        outcome,
        evidence: 'Fixture actual PM decision',
        conditions: [],
      },
    );
    let saved;
    assert.equal(
      applySsrEditFromView({
        previous: workspace.ssr,
        next,
        versions: workspace.costVersions,
        onChange: (value) => {
          saved = value;
        },
        onRequestConfirmCost: () =>
          assert.fail('no extra confirmation required'),
      }),
      true,
    );
    assert.equal(saved, next);
  }
});

test('pending action fingerprint detects newly recorded SSR evidence', () => {
  const workspace = legacyDrbWorkspace();
  const before = workflowConfirmationFingerprint(workspace);
  const next = recordReviewResult(
    workspace.ssr,
    workspace.ssr.submissions.at(-1).id,
    {
      outcome: 'rejected',
      evidence: 'A later actual decision',
      conditions: [],
    },
  );
  assert.notEqual(
    workflowConfirmationFingerprint({ ...workspace, ssr: next }),
    before,
  );
  assert.equal(
    workflowConfirmationFingerprint(structuredClone(workspace)),
    before,
  );
});
