/** Every public cost consumer uses delivery dates with the independent Subcon baseline. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import ExcelJS from 'exceljs';
import { makeCostSnapshot } from './helpers.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { calculateWorkspaceMetrics } from '../features/workbench/workspace-projections.ts';
import { calculateBuCostAllocation } from '../features/quote/profit-share.ts';
import { buildQuoteLines } from '../features/quote/quote-lines.ts';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { templateData } from '../features/excel/template-workbook.ts';
import { costConfirmationDetails } from '../features/cost/cost-confirmation.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { buildSimpleCostWorkbookBytes } from '../features/cost/export-simple-workbook.ts';
import { buildCpqWorkbook } from '../features/cpq/export-workbook.ts';
import { emptyCpq, costBaselineKey } from '../features/cpq/domain.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';

/** Y1 2028 is one year after Subcon 2027: 100×1.1 + 100×1.1×1.2 = 242. */
function fixture() {
  const snapshot = makeCostSnapshot();
  snapshot.costRows = [];
  snapshot.rateSettings = {
    ...snapshot.rateSettings,
    baseYear: 2026,
    tdStart: '2028-01-01',
    tdEnd: '2032-12-31',
  };
  snapshot.travelSettings = { ...snapshot.travelSettings, enabled: false };
  snapshot.manualCosts = {
    ...snapshot.manualCosts,
    settlement: 10,
    otherServiceRate: 0.1,
  };
  snapshot.subcontractCost = {
    mode: 'project',
    rateSettings: {
      baseYear: 2027,
      defaultUplift: 10,
      annualUplifts: [10, 20, 0, 0, 0],
    },
    lines: [
      {
        id: '001',
        code: '001',
        description: 'Installation',
        bu: 'Network',
        unit: 'lot',
        unitPrice: 100,
        currency: 'SGD',
        quantities: [1, 1, 0, 0, 0],
      },
    ],
    siteTypes: [],
  };
  const workspace = createBlankWorkspace(
    projectRecord(
      snapshot.project.id,
      snapshot.project.name,
      snapshot.project.client,
    ),
    'costing',
  );
  const fields = [
    'costRows',
    'rateSettings',
    'travelSettings',
    'manualCosts',
    'subcontractCost',
    'resourceTypes',
  ];
  for (const field of fields) {
    workspace[field] = structuredClone(snapshot[field]);
    workspace.costVersions[0][field] = structuredClone(snapshot[field]);
  }
  workspace.pricing = {
    targetGrossMargin: 0,
    discount: 0,
    gstPercent: 0,
    lineMode: 'item',
  };
  return { snapshot, workspace };
}

/** Finds a statement account without relying on display row positions. */
function accountRow(sheet, code) {
  let result;
  sheet.eachRow((row) => {
    if (
      row.values.some(
        (value) =>
          value === code ||
          (typeof value === 'string' && value.startsWith(`${code} `)),
      )
    )
      result = row;
  });
  assert.ok(result, `Missing account ${code}`);
  return result;
}

test('schema, version resource and portfolio preserve independent Subcon annual assumptions', () => {
  const { snapshot, workspace } = fixture();
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      readFileSync(
        new URL('../schemas/cost-export.schema.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  assert.equal(validate(snapshot), true, JSON.stringify(validate.errors));
  const invalid = structuredClone(snapshot);
  invalid.subcontractCost.rateSettings.annualUplifts = [10];
  assert.equal(validate(invalid), false);
  const repo = openWorkspaceRepository(':memory:');
  try {
    const initial = repo.save(workspace.project.id, workspace, null);
    assert.deepEqual(
      readResource(repo, workspace.project.id, 'cost', {
        section: 'subcontract',
        version: 'V1',
      }).value.rateSettings,
      snapshot.subcontractCost.rateSettings,
    );
    assert.equal(
      readResource(repo, workspace.project.id, 'cost', {
        section: 'summary',
        version: 'V1',
      }).value.subcontract,
      242,
    );
    assert.equal(repo.list()[0].totalCost, 277.2);
    // Editing the narrow resource retains the same independently captured unit-price baseline.
    updateResource(
      repo,
      workspace.project.id,
      'cost',
      { section: 'subcontract', version: 'V1' },
      {
        set: {
          rateSettings: {
            ...snapshot.subcontractCost.rateSettings,
            annualUplifts: [0, 0, 0, 0, 0],
          },
        },
      },
      initial.revision,
    );
    const saved = repo.get(workspace.project.id).workspace;
    assert.equal(saved.subcontractCost.lines[0].unitPrice, 100);
    assert.equal(saved.rateSettings.baseYear, 2026);
    assert.equal(saved.subcontractCost.rateSettings.baseYear, 2027);
    assert.equal(repo.list()[0].subcontractCost, 200);
  } finally {
    repo.close();
  }
});

test('confirmation, BU allocation, quotation rows and template data agree on uplifted costs and EHS', () => {
  const { snapshot, workspace } = fixture();
  const before = structuredClone(workspace);
  const allocation = calculateBuCostAllocation(workspace);
  assert.equal(allocation.totalCost, 277.2);
  assert.equal(allocation.entries[0].directCost, 242);
  assert.equal(allocation.entries[0].unassignedCost, 35.2);
  assert.equal(
    calculateWorkspaceMetrics(workspace, allocation).totalCost,
    277.2,
  );
  assert.equal(costConfirmationDetails(workspace, 'V1').totalCost, 277.2);
  const data = templateData(workspace, 'cost');
  assert.equal(data.scalars['cost.total'], 277.2);
  assert.equal(data.datasets.costRows[0]['Y1.cost'], 110);
  assert.equal(data.datasets.costRows[0]['Y2.cost'], 132);
  const lines = buildQuoteLines(snapshot, 'item', 277.2);
  assert.equal(
    lines.find((line) => line.description === 'Installation').amount,
    242,
  );
  assert.equal(
    lines.find((line) => line.description === 'Other services').amount,
    25.2,
  );
  assert.deepEqual(workspace, before);
  workspace.workflowMode = 'project';
  workspace.costVersions[0].state = 'Confirmed';
  const quote = validatedQuoteInput(workspace, 'Q-SUBCON-RATES');
  assert.equal(quote.pricing.cost, 277.2);
  assert.equal(quote.pricing.quoteBeforeTax, 277.2);
});

test('both cost workbook formats export actual years, base prices, rate assumptions and reconciled EHS', async () => {
  const { snapshot } = fixture();
  assert.deepEqual(
    validateCostExportSnapshot(snapshot).filter(
      (issue) => issue.severity === 'error',
    ),
    [],
  );
  for (const [build, full] of [
    [buildCostWorkbookBytes, true],
    [buildSimpleCostWorkbookBytes, false],
  ]) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await build(snapshot));
    const detail = book.getWorksheet('Subcon Detail');
    assert.equal(detail.getCell('E5').value, 100);
    assert.equal(detail.getCell('I4').value, 'Y1 2028 Qty');
    assert.equal(detail.getCell('J4').value, 'Y1 2028 Cost');
    assert.equal(detail.getCell('J5').value, 110);
    assert.equal(detail.getCell('L5').value, 132);
    assert.equal(detail.getCell(detail.rowCount, 8).value, 242);
    const rates = book.getWorksheet('Subcon Rates');
    assert.equal(rates.getCell('B5').value, 2027);
    assert.equal(rates.getCell('D4').value, 'Y1 2028');
    assert.deepEqual(rates.getRow(5).values.slice(4), [10, 20, 0, 0, 0]);
    assert.equal(rates.getCell('D6').value, 1.1);
    const statement = book.getWorksheet(
      full ? '06_Cost_Statement' : 'Cost Statement',
    );
    const otherServices = accountRow(statement, '2.3.4.2');
    assert.ok(
      otherServices.values.some(
        (value) => value === 25.2 || value?.result === 25.2,
      ),
    );
    const subcontract = accountRow(statement, '2.3.2');
    const settlement = accountRow(statement, '2.3.3');
    const labour = accountRow(statement, '2.3.1');
    assert.deepEqual(subcontract.getCell(1).fill, labour.getCell(1).fill);
    assert.deepEqual(settlement.getCell(1).fill, labour.getCell(1).fill);
    assert.equal(subcontract.getCell(1).font.bold, true);
    assert.equal(settlement.getCell(1).font.bold, true);
    if (full) {
      assert.equal(
        settlement.getCell(5).value,
        'MANUAL',
        'presentation does not turn settlement into an automatic account',
      );
      const statuses = [];
      book.getWorksheet('07_Reconciliation').eachRow((row) =>
        row.eachCell((cell) => {
          if (cell.value?.formula?.startsWith('IF('))
            statuses.push(cell.value.result);
        }),
      );
      assert.ok(statuses.length && statuses.every((value) => value === 'PASS'));
    }
  }
});

test('CPQ baseline export preserves the archived delivery dates and Subcon assumptions', async () => {
  const { workspace } = fixture();
  const baseline = workspace.costVersions[0];
  const archive = {
    id: 'CPQ-RATE',
    createdAt: '2026-09-21T00:00:00Z',
    costVersion: 'V1',
    costBaseline: baseline,
    costKey: costBaselineKey(baseline),
    proposalNumber: 'Q-001',
    draft: emptyCpq().draft,
    result: {
      lines: [],
      targetCost: 277.2,
      totalCost: 277.2,
      difference: 0,
      searchComplete: true,
    },
  };
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildCpqWorkbook(archive));
  assert.equal(
    book.getWorksheet('Subcon Baseline').getCell('F1').value,
    'Y1 2028 Cost',
  );
  assert.equal(book.getWorksheet('Subcon Baseline').getCell('F2').value, 110);
  assert.equal(book.getWorksheet('Subcon Baseline').getCell('K2').value, 242);
  const parameters = book.getWorksheet('Rates and Assumptions');
  let settings;
  parameters.eachRow((row) => {
    if (row.getCell(1).value === 'Subcon rate settings')
      settings = JSON.parse(row.getCell(2).value);
  });
  assert.deepEqual(settings, baseline.subcontractCost.rateSettings);
});

test('exported prices stay flat through a future Subcon base year and only then compound', async () => {
  const { snapshot } = fixture();
  snapshot.subcontractCost.rateSettings = {
    baseYear: 2030,
    defaultUplift: 10,
    annualUplifts: [10, 10, 10, 10, 10],
  };
  snapshot.subcontractCost.lines[0].quantities = [1, 1, 1, 1, 1];
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await buildSimpleCostWorkbookBytes(snapshot));
  const detail = book.getWorksheet('Subcon Detail');
  assert.deepEqual(
    [10, 12, 14, 16, 18].map((column) => detail.getCell(5, column).value),
    [100, 100, 100, 110, 121],
  );
  assert.equal(detail.getCell(detail.rowCount, 8).value, 531);
  const factors = book.getWorksheet('Subcon Rates').getRow(6).values.slice(4);
  assert.deepEqual(
    factors.map((factor) => Math.round(factor * 100) / 100),
    [1, 1, 1, 1.1, 1.21],
  );
});

test('public CLI cost.calculate reconciles annual Subcon amounts in totals, dimensions and statement', () => {
  const { snapshot } = fixture();
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      'cli/cost-cli.mjs',
      'cost',
      'calculate',
      '--input',
      '-',
    ],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      input: JSON.stringify({
        apiVersion: 'cost-workbench/v2',
        kind: 'CostSnapshotRequest',
        requestId: 'subcon-rate-test',
        data: snapshot,
      }),
    },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout).data;
  assert.equal(output.totals.subcontract, 242);
  assert.equal(output.totals.totalWithRisk, 277.2);
  assert.equal(
    output.summaries.scope.find((row) => row.key === 'Installation').cost,
    242,
  );
  assert.equal(
    output.summaries.statement.find((row) => row.code === '2.3.4.2').amount,
    25.2,
  );
});

test('snapshot and repository boundaries reject annual compounding overflow before saving', () => {
  const { snapshot, workspace } = fixture();
  const excessive = {
    baseYear: 2000,
    defaultUplift: 1000,
    annualUplifts: [1000, 1000, 1000, 1000, 1000],
  };
  snapshot.subcontractCost.rateSettings = excessive;
  assert.ok(
    validateCostExportSnapshot(snapshot).some(
      (issue) => issue.code === 'SUBCONTRACT_TOTAL_OUT_OF_RANGE',
    ),
  );
  const repo = openWorkspaceRepository(':memory:');
  try {
    const saved = repo.save(workspace.project.id, workspace, null);
    assert.throws(
      () =>
        updateResource(
          repo,
          workspace.project.id,
          'cost',
          { section: 'subcontract', version: 'V1' },
          { set: { rateSettings: excessive } },
          saved.revision,
        ),
      /range|amount|total/i,
    );
    assert.equal(repo.get(workspace.project.id).revision, saved.revision);
    assert.deepEqual(
      repo.get(workspace.project.id).workspace.subcontractCost.rateSettings,
      workspace.subcontractCost.rateSettings,
    );
  } finally {
    repo.close();
  }
});
