/** Project List edits change live identity/references without rewriting cost or quote evidence. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  updateResource,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import {
  projectDetails,
  applyProjectDetails,
} from '../features/projects/project-details.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { costLockReason } from '../features/cost/cost-lock.ts';
import { emptySsr, commercialBasisKey } from '../features/ssr/domain.ts';
import { completeWorkflowThrough } from './helpers/workflow-actions.mjs';

const ID = 'PROJECT-DETAILS';
function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-details-'));
  const database = path.join(directory, 'workspace.sqlite');
  let repository = openWorkspaceRepository(database);
  t.after(() => {
    repository.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const workspace = createBlankWorkspace(
    projectRecord(ID, 'Original project', 'Original client'),
    'input_preparation',
  );
  workspace.costRows = structuredClone(initialCostRows);
  workspace.costVersions = [createCostVersion('V1', 'Draft', null, workspace)];
  workspace.ssr = {
    ...emptySsr(),
    proposalNumber: 'P-OLD',
    companyUrl: 'https://isales.example/P-OLD',
    cpqUrl: 'https://cpq.example/P-OLD',
    scopeBrief: 'Original scope',
    technicalBasis: 'Original design',
  };
  workspace.quoteTemplates[0].termsAndConditions =
    'Original client commercial evidence';
  workspace.quoteHistory = [
    {
      id: 'HISTORY-ORIGINAL',
      quoteNumber: 'QT-ORIGINAL',
      generatedAt: '2026-09-05T01:00:00.000Z',
      costVersion: 'V1',
      templateId: workspace.quoteTemplates[0].id,
      status: 'Final',
      costAmount: 100,
      quoteBeforeTax: 125,
      gstAmount: 0,
      quoteAfterTax: 125,
      grossMarginPercent: 20,
      note: 'Issued for original client',
      templateSnapshot: structuredClone(workspace.quoteTemplates[0]),
      assumptionSnapshots: structuredClone(workspace.quoteAssumptions),
    },
  ];
  repository.save(ID, workspace, null);
  return {
    get repository() {
      return repository;
    },
    reopen() {
      repository.close();
      repository = openWorkspaceRepository(database);
      return repository;
    },
  };
}
const confirm = (repository, version) =>
  updateResource(
    repository,
    ID,
    'cost',
    { section: 'settings', version },
    { set: { state: 'Confirmed' } },
    repository.get(ID).revision,
  );
const editedDetails = (baseline) => ({
  ...baseline,
  name: '  Updated service project  ',
  client: '  Updated client  ',
  proposalNumber: '  P-NEW  ',
  companyUrl: '  https://isales.example/P-NEW?region=SG  ',
  cpqUrl: '  https://cpq.example/config/P-NEW  ',
  scopeBrief: '  Updated scope brief  ',
  technicalBasis: '  Updated TD reference  ',
});

test('Project Edit persists name, client, proposal and links while retaining every locked version, DRB record and prior quote snapshot after reopen', (t) => {
  const f = fixture(t);
  confirm(f.repository, 'V1');
  completeWorkflowThrough(f.repository, ID, 'DELIVERY_REVIEW');
  createCostDraft(
    f.repository,
    ID,
    { mode: 'clone', sourceVersion: 'V1' },
    f.repository.get(ID).revision,
  );
  confirm(f.repository, 'V2');
  completeWorkflowThrough(f.repository, ID, 'DELIVERY_REVIEW');
  const before = f.repository.get(ID);
  assert.ok(costLockReason(before.workspace, 'V1'));
  assert.ok(costLockReason(before.workspace, 'V2'));
  assert.ok(before.workspace.workflowUpdates.length > 0);
  const baseline = projectDetails(before.workspace);
  const requested = editedDetails(baseline);
  const inputCopy = structuredClone(before.workspace);
  const result = applyProjectDetails(before.workspace, requested, baseline);
  assert.deepEqual(
    before.workspace,
    inputCopy,
    'transform does not mutate the loaded workspace',
  );
  assert.equal(
    requested.name,
    '  Updated service project  ',
    'form inputs remain untouched',
  );
  const saved = f.repository.save(ID, result, before.revision);
  const expected = {
    ...before.workspace,
    project: {
      ...before.workspace.project,
      name: 'Updated service project',
      client: 'Updated client',
    },
    ssr: {
      ...before.workspace.ssr,
      proposalNumber: 'P-NEW',
      companyUrl: 'https://isales.example/P-NEW?region=SG',
      cpqUrl: 'https://cpq.example/config/P-NEW',
      scopeBrief: 'Updated scope brief',
      technicalBasis: 'Updated TD reference',
    },
  };
  // The current commercial fingerprint includes live project identity. Historical evidence does not.
  expected.ssr.commercialBasis = commercialBasisKey(expected);
  assert.deepEqual(
    saved.workspace,
    expected,
    'only explicitly editable metadata changes',
  );
  const reloaded = f.reopen().get(ID);
  assert.deepEqual(reloaded.workspace, expected);
  for (const field of [
    'costRows',
    'costVersions',
    'costVersionLocks',
    'versionWorkflows',
    'processSteps',
    'workflowUpdates',
    'reviewGates',
    'quoteHistory',
    'rateSettings',
    'manualCosts',
    'subcontractCost',
  ])
    assert.deepEqual(
      reloaded.workspace[field],
      before.workspace[field],
      `${field} remains preserved`,
    );
  assert.equal(
    reloaded.workspace.quoteHistory[0].templateSnapshot.termsAndConditions,
    'Original client commercial evidence',
  );
});

test('an unrelated cost autosave may advance repository revision without invalidating the open project metadata form', (t) => {
  const f = fixture(t);
  const opened = f.repository.get(ID);
  const baseline = projectDetails(opened.workspace);
  updateResource(
    f.repository,
    ID,
    'cost',
    { section: 'settings', version: 'V1' },
    { set: { manualCosts: { riskContingency: 432.1 } } },
    opened.revision,
  );
  const latest = f.repository.get(ID);
  assert.ok(latest.revision > opened.revision);
  assert.equal(latest.workspace.manualCosts.riskContingency, 432.1);
  const saved = f.repository.save(
    ID,
    applyProjectDetails(latest.workspace, editedDetails(baseline), baseline),
    latest.revision,
  );
  assert.equal(saved.workspace.project.name, 'Updated service project');
  assert.deepEqual(saved.workspace.costRows, latest.workspace.costRows);
  assert.deepEqual(saved.workspace.costVersions, latest.workspace.costVersions);
  assert.deepEqual(saved.workspace.manualCosts, latest.workspace.manualCosts);
  assert.deepEqual(saved.workspace.quoteHistory, latest.workspace.quoteHistory);
});

test('a concurrent change to any editable information rejects the stale form atomically instead of overwriting it', (t) => {
  const f = fixture(t);
  const fields = {
    name: 'External project name',
    client: 'External client',
    proposalNumber: 'EXTERNAL-P',
    companyUrl: 'https://isales.example/external',
    cpqUrl: 'https://cpq.example/external',
    scopeBrief: 'External scope',
    technicalBasis: 'External design',
  };
  for (const [field, value] of Object.entries(fields)) {
    const opened = f.repository.get(ID);
    const baseline = projectDetails(opened.workspace);
    f.repository.save(
      ID,
      applyProjectDetails(
        opened.workspace,
        { ...baseline, [field]: value },
        baseline,
      ),
      opened.revision,
    );
    const external = f.repository.get(ID);
    assert.throws(
      () =>
        f.repository.save(
          ID,
          applyProjectDetails(
            external.workspace,
            editedDetails(baseline),
            baseline,
          ),
          external.revision,
        ),
      /Project information changed.*Reopen Edit/,
    );
    assert.deepEqual(
      f.repository.get(ID),
      external,
      `concurrent ${field} is preserved`,
    );
  }
});

test('blank/oversized identity and non-http links fail before persistence; optional links can be cleared', (t) => {
  const f = fixture(t);
  const before = f.repository.get(ID);
  const baseline = projectDetails(before.workspace);
  for (const patch of [
    { name: '  ' },
    { client: '\n' },
    { name: 'x'.repeat(201) },
    { client: 'x'.repeat(201) },
    { companyUrl: 'javascript:alert(1)' },
    { companyUrl: 'not a link' },
    { cpqUrl: 'file:///tmp/example.xlsx' },
    { cpqUrl: 'https://' },
  ]) {
    assert.throws(
      () =>
        f.repository.save(
          ID,
          applyProjectDetails(
            before.workspace,
            { ...baseline, ...patch },
            baseline,
          ),
          before.revision,
        ),
      /required|valid http or https/,
    );
    assert.deepEqual(f.repository.get(ID), before);
  }
  const saved = f.repository.save(
    ID,
    applyProjectDetails(
      before.workspace,
      { ...baseline, companyUrl: ' ', cpqUrl: '' },
      baseline,
    ),
    before.revision,
  );
  assert.equal(saved.workspace.ssr.companyUrl, '');
  assert.equal(saved.workspace.ssr.cpqUrl, '');
  assert.deepEqual(saved.workspace.costVersions, before.workspace.costVersions);
});
