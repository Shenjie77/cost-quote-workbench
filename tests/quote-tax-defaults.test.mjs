/** New quotations omit tax and start at 50% GP; saved inputs and exported history remain exact. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import { quoteHistoryRecord } from '../features/quote/history-record.ts';
import {
  initialQuoteAssumptions,
  initialQuoteTemplates,
  isRetiredQuoteAssumption,
} from '../features/quote/types.ts';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { migrateWorkspaceDocument } from '../server/workspace-document.mjs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  createProject,
} from '../server/workspace-resources.mjs';

test('new browser and API projects start at 50% GP without tax and have independent pricing settings', () => {
  assert.equal(initialPricingSettings.targetGrossMargin, 50);
  assert.equal(initialPricingSettings.gstPercent, 0);
  const blank = createBlankWorkspace(
    projectRecord('BROWSER-ZERO-TAX', 'New project', 'Customer'),
    'input_preparation',
  );
  assert.equal(blank.pricing.gstPercent, 0);
  assert.equal(blank.pricing.targetGrossMargin, 50);
  assert.equal(blank.quoteAssumptions.some(isRetiredQuoteAssumption), false);
  const repository = openWorkspaceRepository(':memory:');
  try {
    for (const id of ['NEW-A', 'NEW-B'])
      createProject(repository, { id, name: id, client: 'Customer' });
    const first = repository.get('NEW-A');
    const second = repository.get('NEW-B');
    assert.equal(first.workspace.pricing.gstPercent, 0);
    assert.equal(second.workspace.pricing.gstPercent, 0);
    assert.equal(first.workspace.pricing.targetGrossMargin, 50);
    assert.equal(second.workspace.pricing.targetGrossMargin, 50);
    const price = calculatePricing(1000, first.workspace.pricing);
    assert.equal(price.gstAmount, 0);
    assert.equal(price.listPrice, 2000);
    assert.equal(price.quoteAfterTax, price.quoteBeforeTax);
    first.workspace.pricing.gstPercent = 9;
    repository.save('NEW-A', first.workspace, first.revision);
    assert.equal(repository.get('NEW-A').workspace.pricing.gstPercent, 9);
    assert.equal(repository.get('NEW-B').workspace.pricing.gstPercent, 0);
    assert.equal(initialPricingSettings.gstPercent, 0);
  } finally {
    repository.close();
  }
});

test('real CLI project creation uses the same 50% GP defaults as browser and API factories', (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'quote-default-gp-'));
  const database = path.join(directory, 'workspace.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const child = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      'cli/cost-cli.mjs',
      'project',
      'create',
      '--db',
      database,
      '--input',
      '-',
    ],
    {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8',
      input: JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'OperationRequest',
        requestId: 'new-default-gp',
        data: {
          schemaVersion: '1.0.0',
          operation: 'project.create',
          project: { id: 'CLI-GP', name: 'CLI default GP', client: 'Customer' },
        },
      }),
    },
  );
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(JSON.parse(child.stdout).ok, true);
  const repository = openWorkspaceRepository(database);
  try {
    const workspace = repository.get('CLI-GP').workspace;
    assert.equal(workspace.pricing.targetGrossMargin, 50);
    assert.equal(workspace.pricing.gstPercent, 0);
    assert.equal(calculatePricing(1000, workspace.pricing).listPrice, 2000);
    assert.equal(
      workspace.quoteAssumptions.some(isRetiredQuoteAssumption),
      false,
    );
  } finally {
    repository.close();
  }
});

test('saved tax and quotation history survive migration, persistence and new cost versions', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    createProject(repository, {
      id: 'EXISTING-TAX',
      name: 'Existing project',
      client: 'Customer',
    });
    let record = repository.get('EXISTING-TAX');
    const terms = {
      ...record.workspace.pricing,
      targetGrossMargin: 20,
      gstPercent: 9,
    };
    const history = quoteHistoryRecord(
      {
        project: record.workspace.project,
        quoteNumber: 'EXISTING-TAX-Q1',
        costVersion: 'V1',
        template: initialQuoteTemplates[0],
        assumptions: [
          {
            id: 'assumption-tax',
            text: 'Applicable taxes are shown separately from the pre-tax price.',
            textZh: '适用税费与未税报价分开列示。',
            included: true,
          },
        ],
        // This is an already-issued historical snapshot, not a newly calculated quotation.
        pricing: {
          ...calculatePricing(1000, terms),
          gstPercent: 9,
          gstAmount: 112.5,
          quoteAfterTax: 1362.5,
        },
      },
      { path: 'historical-quote.xlsx', sha256: 'a'.repeat(64) },
    );
    record.workspace.pricing = terms;
    record.workspace.quoteHistory = [history];
    const migrated = migrateWorkspaceDocument(record.workspace);
    assert.deepEqual(migrated.pricing, terms);
    assert.deepEqual(migrated.quoteHistory, [history]);
    record = repository.save('EXISTING-TAX', migrated, record.revision);
    assert.equal(
      repository.get('EXISTING-TAX').workspace.pricing.gstPercent,
      9,
    );
    createCostDraft(
      repository,
      'EXISTING-TAX',
      { mode: 'blank' },
      record.revision,
    );
    const reopened = repository.get('EXISTING-TAX').workspace;
    assert.deepEqual(reopened.pricing, terms);
    assert.deepEqual(reopened.quoteHistory, [history]);
    assert.equal(reopened.quoteHistory[0].gstAmount, 112.5);
    assert.equal(reopened.quoteHistory[0].quoteAfterTax, 1362.5);
    const current = calculatePricing(1000, reopened.pricing);
    assert.equal(current.gstAmount, 0);
    assert.equal(current.quoteAfterTax, 1250);
    assert.deepEqual(repository.get('EXISTING-TAX').workspace.quoteHistory, [
      history,
    ]);
  } finally {
    repository.close();
  }
});

test('new quote history records no tax even when pricing settings retain a saved tax rate', () => {
  for (const gstPercent of [0, 9]) {
    const input = {
      project: {
        id: 'TAX-EXPORT',
        name: 'Tax fixture',
        client: 'Customer',
        currency: 'SGD',
      },
      quoteNumber: 'TAX-Q1',
      costVersion: 'V1',
      template: initialQuoteTemplates[0],
      assumptions: [],
      pricing: calculatePricing(1000, {
        ...initialPricingSettings,
        targetGrossMargin: 20,
        gstPercent,
      }),
    };
    const before = structuredClone(input);
    const history = quoteHistoryRecord(input, {
      path: 'new-quotation.xlsx',
      sha256: 'b'.repeat(64),
    });
    assert.equal(history.gstAmount, 0);
    assert.equal(history.quoteAfterTax, 1250);
    assert.equal(input.pricing.quoteAfterTax, 1250);
    assert.deepEqual(input, before);
  }
});

test('only the retired system assumption identity is filtered, never customer text or old snapshots', () => {
  const original = [
    { id: 'assumption-tax', text: 'Original system clause', included: true },
    {
      id: 'copy',
      sourceAssumptionId: 'assumption-tax',
      text: 'Referenced clause',
      included: true,
    },
    {
      id: 'customer-tax',
      text: 'Customer handles local tax documentation.',
      included: true,
    },
    {
      id: 'customer-matching-text',
      text: 'Applicable taxes are shown separately from the pre-tax price.',
      included: true,
    },
  ];
  const before = structuredClone(original);
  const current = original.filter((row) => !isRetiredQuoteAssumption(row));
  assert.deepEqual(
    current.map((row) => row.id),
    ['customer-tax', 'customer-matching-text'],
  );
  assert.deepEqual(original, before);
  assert.equal(initialQuoteAssumptions.some(isRetiredQuoteAssumption), false);
});
