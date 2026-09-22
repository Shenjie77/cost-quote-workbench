/** Default tax changes apply to new inputs; saved commercial terms and exported history remain exact. */
import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import { quoteHistoryRecord } from '../features/quote/history-record.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
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

/** Read exported customer totals by their business label rather than a layout-dependent row index. */
function workbookAmount(sheet, label) {
  let amount;
  sheet.eachRow((row) => {
    if (row.getCell(2).value === label) amount = row.getCell(4).value;
  });
  assert.notEqual(amount, undefined, `Missing workbook amount: ${label}`);
  return amount;
}

test('new browser and API projects start at zero tax and have independent pricing settings', () => {
  assert.equal(initialPricingSettings.gstPercent, 0);
  const blank = createBlankWorkspace(
    projectRecord('BROWSER-ZERO-TAX', 'New project', 'Customer'),
    'input_preparation',
  );
  assert.equal(blank.pricing.gstPercent, 0);
  const repository = openWorkspaceRepository(':memory:');
  try {
    for (const id of ['NEW-A', 'NEW-B'])
      createProject(repository, { id, name: id, client: 'Customer' });
    const first = repository.get('NEW-A');
    const second = repository.get('NEW-B');
    assert.equal(first.workspace.pricing.gstPercent, 0);
    assert.equal(second.workspace.pricing.gstPercent, 0);
    const price = calculatePricing(1000, first.workspace.pricing);
    assert.equal(price.gstAmount, 0);
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
        assumptions: [],
        pricing: calculatePricing(1000, terms),
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
  } finally {
    repository.close();
  }
});

test('customer workbook uses zero for new default tax while honoring explicitly saved tax rates', async () => {
  for (const [gstPercent, expectedTax, expectedTotal] of [
    [0, 0, 1250],
    [9, 112.5, 1362.5],
  ]) {
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildQuoteWorkbookBuffer(input));
    const sheet = workbook.getWorksheet('Quotation');
    assert.equal(
      workbookAmount(sheet, `GST ${gstPercent.toFixed(2)}%`),
      expectedTax,
    );
    assert.equal(input.pricing.quoteAfterTax, expectedTotal);
    assert.deepEqual(input, before);
  }
});
