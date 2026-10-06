import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  syncQuoteAssumptions,
  referenceAssumptions,
} from '../features/quote/catalog-domain.ts';
import { buildQuotePreviewWorkbook } from '../features/quote/preview-workbook.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { newMaintenanceLine } from '../features/maintenance/component-pricing.ts';
const clause = (id, text) => ({
  id,
  text,
  textZh: '',
  name: id,
  category: 'General',
  clientPattern: '*',
  active: true,
});
test('assumption refresh updates references and legacy seeds but retains custom text, exclusions, missing references and source snapshots', () => {
  const old = [
    clause('a', 'Old A'),
    clause('b', 'Old B'),
    clause('c', 'Old C'),
  ];
  const rows = referenceAssumptions(
    [],
    old,
    ['a', 'b', 'c'],
    'Client',
    (() => {
      let n = 0;
      return () => `ref-${++n}`;
    })(),
  );
  rows[0].included = false;
  rows[1].text = 'Special agreed wording';
  rows.push({ id: 'custom', text: 'Local only', textZh: '', included: true });
  const latest = [clause('a', 'New A'), clause('b', 'New B')];
  const before = structuredClone(rows);
  const synced = syncQuoteAssumptions(rows, old, latest, 'Client');
  assert.equal(synced[0].text, 'New A');
  assert.equal(synced[0].included, false);
  assert.equal(synced[1].text, 'Special agreed wording');
  assert.equal(synced[2].text, 'Old C');
  assert.equal(synced[3].text, 'Local only');
  assert.deepEqual(rows, before);
  assert.deepEqual(
    syncQuoteAssumptions(synced, latest, latest, 'Client'),
    synced,
  );
  const legacy = { id: 'a', text: 'Old A', textZh: '', included: true };
  assert.equal(
    syncQuoteAssumptions([legacy], old, latest, 'Client')[0].text,
    'New A',
  );
  assert.equal(
    syncQuoteAssumptions(
      [legacy],
      old,
      [{ ...latest[0], active: false }],
      'Client',
    )[0].text,
    'Old A',
  );
  assert.equal(
    syncQuoteAssumptions(
      [legacy],
      old,
      [{ ...latest[0], clientPattern: 'Other' }],
      'Client',
    )[0].text,
    'Old A',
  );
});
test('equipment units and refreshed assumption baselines persist without changing quoted history', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const workspace = createBlankWorkspace(
      projectRecord('P-PREVIEW', 'Project', 'Client'),
    );
    workspace.maintenanceBoq = {
      coverageMonths: 12,
      boq: [{ ...newMaintenanceLine(), unit: 'routers' }],
      archives: [],
    };
    workspace.quoteAssumptions = referenceAssumptions(
      [],
      [clause('a', 'Latest clause')],
      ['a'],
      'Client',
      () => 'row-a',
    );
    repo.save(workspace.project.id, workspace, null);
    const saved = repo.get(workspace.project.id).workspace;
    assert.equal(saved.maintenanceBoq.boq[0].unit, 'routers');
    assert.equal(saved.quoteAssumptions[0].sourceText, 'Latest clause');
    assert.deepEqual(saved.quoteHistory, workspace.quoteHistory);
  } finally {
    repo.close();
  }
});
test('preview XLSX exports the visible schedule and totals as internal review without mutating inputs or fetching an asset', async () => {
  const input = {
    title: 'Service quote',
    projectName: 'Public title',
    client: 'Client',
    currency: 'SGD',
    quoteNumber: 'QT-1',
    costVersion: 'V1',
    sections: [
      {
        name: 'Base / Services',
        lines: [
          {
            id: 's',
            description: 'Deployment',
            quantity: 1,
            unit: 'lot',
            unitPrice: 100,
            amount: 100,
          },
        ],
      },
      {
        name: 'Option / Support',
        lines: [
          {
            id: 'maintenance:m',
            description: 'Router (2 routers)',
            quantity: 2,
            unit: 'per year',
            unitPrice: 10,
            amount: 20,
          },
        ],
      },
    ],
    servicePrice: 100,
    maintenanceAmount: 20,
    discount: 5,
    optionalAmount: 20,
    validityDays: 30,
    paymentTerms: 'Net 30',
    terms: 'For Public title',
    assumptions: ['Current clause'],
  };
  const before = structuredClone(input),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildQuotePreviewWorkbook(input));
  const sheet = book.worksheets[0];
  const text = JSON.stringify(sheet.getSheetValues());
  assert.match(text, /PREVIEW — Internal review only/);
  assert.match(text, /Public title/);
  assert.match(text, /Router \(2 routers\)/);
  assert.match(text, /For Public title/);
  assert.match(text, /Current clause/);
  let total, optional;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === 'Mandatory Quote Total')
      total = row.getCell(6).value;
    if (row.getCell(1).value === 'Optional total (excluded)')
      optional = row.getCell(6).value;
  });
  assert.equal(total, 95);
  assert.equal(optional, 20);
  assert.deepEqual(input, before);
  await assert.rejects(
    buildQuotePreviewWorkbook({ ...input, discount: 1000 }),
    /Resolve pricing/,
  );
});
