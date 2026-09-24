/** Verify GP-driven quotation persistence and real customer exports against disposable project data. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  createProject,
  updateResource,
} from '../server/workspace-resources.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { fillQuoteExcelTemplate } from '../features/quote/fill-excel-template.ts';

const projectId = 'GP-ALLOCATION-TEST';
const publicLineKeys = [
  'amount',
  'description',
  'id',
  'quantity',
  'unit',
  'unitPrice',
];

/** Saved draft prices are intentionally stale so exports must use the effective GP allocation. */
function gpPricing() {
  return {
    lineMode: 'manual',
    manualPricingBasis: 'gp',
    manualTargetPrice: 999,
    targetGrossMargin: 50,
    manualLines: [
      {
        id: 'percentage',
        description: 'Planning',
        quantity: 1,
        unit: 'lot',
        unitPrice: 7,
        allocationWeight: 25,
        allocationFixed: true,
      },
      {
        id: 'price',
        description: 'Equipment',
        quantity: 1,
        unit: 'piece',
        unitPrice: 20,
        priceFixed: true,
      },
      {
        id: 'delivery',
        description: 'Delivery',
        quantity: 1,
        unit: 'lot',
        unitPrice: 7,
        allocationWeight: 1,
      },
      {
        id: 'support',
        description: 'Support',
        quantity: 1,
        unit: 'lot',
        unitPrice: 7,
        allocationWeight: 99,
      },
    ],
  };
}

/** Keep SQL, files and CLI writes inside one temporary directory that is removed after each test. */
function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'quote-gp-allocation-'));
  const database = path.join(directory, 'workspace.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inspect = (callback) => {
    const repository = openWorkspaceRepository(database);
    try {
      return callback(repository);
    } finally {
      repository.close();
    }
  };
  inspect((repository) => {
    createProject(repository, {
      id: projectId,
      name: 'GP allocation fixture',
      client: 'Fixture Customer',
    });
    // Keep the required personnel section present while isolating the monetary fixture in equipment cost.
    updateResource(
      repository,
      projectId,
      'cost',
      { section: 'rows', version: 'V1' },
      {
        upsert: [
          {
            id: 'personnel-placeholder',
            scope: 'Equipment delivery',
            bu: 'Delivery',
            reTypeId: 'rt-local-l1',
            inputMode: 'mandays',
            mdPerSite: 0,
            years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket) => ({
              bucket,
              sites: 0,
              mandays: 0,
              cost: 0,
            })),
          },
        ],
      },
      repository.get(projectId).revision,
    );
    updateResource(
      repository,
      projectId,
      'cost',
      { section: 'settings', version: 'V1' },
      {
        set: {
          rateSettings: {
            quoteAsOf: '2026-09-22',
            tdStart: '2026-10-01',
            tdEnd: '2026-12-31',
            baseYear: 2026,
          },
          manualCosts: { localPurchasedEquipment: 100, otherServiceRate: 0 },
          state: 'Confirmed',
        },
      },
      repository.get(projectId).revision,
    );
  });
  const run = (args, changes, status = 0) => {
    const request = changes
      ? {
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'gp-allocation-test',
          data: { schemaVersion: '1.0.0', operation: 'quote.update', changes },
        }
      : undefined;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        database,
        ...(request ? ['--input', '-'] : []),
      ],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        input: request ? JSON.stringify(request) : undefined,
      },
    );
    assert.equal(result.status, status, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  const updatePricing = (pricing) =>
    run(
      [
        'quote',
        'update',
        '--project-id',
        projectId,
        '--section',
        'settings',
        '--expected-revision',
        String(inspect((repository) => repository.get(projectId).revision)),
      ],
      { set: { pricing } },
    );
  const quote = () =>
    inspect((repository) =>
      validatedQuoteInput(repository.get(projectId).workspace, 'Q-GP'),
    );
  const changeCost = (amount) =>
    inspect((repository) => {
      createCostDraft(
        repository,
        projectId,
        { mode: 'clone', sourceVersion: 'V1' },
        repository.get(projectId).revision,
      );
      const record = repository.get(projectId);
      updateResource(
        repository,
        projectId,
        'cost',
        { section: 'settings', version: record.workspace.activeVersion },
        {
          set: {
            manualCosts: { localPurchasedEquipment: amount },
            state: 'Confirmed',
          },
        },
        record.revision,
      );
    });
  return { directory, inspect, run, updatePricing, quote, changeCost };
}

/** Check commercial line amounts and the strict public boundary, including default zero tax. */
function assertAllocation(input, total, amounts) {
  assert.equal(input.pricing.listPrice, total);
  assert.equal(input.pricing.gstPercent, 0);
  assert.equal(input.pricing.gstAmount, 0);
  assert.equal(input.pricing.quoteAfterTax, input.pricing.quoteBeforeTax);
  assert.deepEqual(
    input.lines.map((line) => line.amount),
    amounts,
  );
  for (const line of input.lines)
    assert.deepEqual(Object.keys(line).sort(), publicLineKeys);
}

test('new quote inputs omit retired system tax assumptions without rewriting saved custom terms or history', (t) => {
  const { inspect } = setup(t);
  inspect((repository) => {
    const workspace = repository.get(projectId).workspace;
    workspace.quoteAssumptions = [
      { id: 'assumption-tax', text: '', textZh: '', included: true },
      {
        id: 'referenced-tax',
        sourceAssumptionId: 'assumption-tax',
        text: 'Former system tax clause',
        textZh: '',
        included: true,
      },
      {
        id: 'customer-tax',
        text: 'Customer handles tax documentation.',
        textZh: '',
        included: true,
      },
    ];
    const before = structuredClone(workspace);
    const input = validatedQuoteInput(workspace, 'Q-NO-TAX');
    assert.deepEqual(input.assumptions, [before.quoteAssumptions[2]]);
    assert.deepEqual(workspace, before);
    input.assumptions[0].text = 'Changed detached output';
    assert.deepEqual(workspace, before);
  });
});

/** Read back generated XLSX detail prices and totals, not only the in-memory calculation. */
async function assertExportFile(filename, total, amounts) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(filename));
  const summary = workbook.getWorksheet('Quotation');
  assert.equal(summary.getCell('D12').value, total);
  let quoteTotal;
  summary.eachRow((row) => {
    if (row.getCell(2).value === 'Quote Total')
      quoteTotal = row.getCell(4).value;
  });
  assert.equal(quoteTotal, total);
  assert.doesNotMatch(JSON.stringify(summary.getSheetValues()), /GST|Tax/);
  const details = workbook.getWorksheet('Quotation Details');
  assert.deepEqual(
    amounts.map((_, index) => details.getCell(index + 2, 6).value),
    amounts,
  );
  assert.doesNotMatch(
    JSON.stringify(workbook.worksheets.map((sheet) => sheet.getSheetValues())),
    /manualPricingBasis|manualTargetPrice|allocationWeight|allocationFixed|priceFixed/,
  );
}

test('GP and cost changes drive CLI export, preserve locks and leave saved drafts and prior history unchanged', async (t) => {
  const { directory, inspect, run, updatePricing, quote, changeCost } =
    setup(t);
  updatePricing(gpPricing());
  const first = quote();
  assert.equal(first.pricing.cost, 100);
  assertAllocation(first, 200, [50, 20, 65, 65]);
  const before = inspect((repository) => repository.get(projectId).workspace);
  const filename = path.join(directory, 'initial.xlsx');
  run(['quote', 'export', '--project-id', projectId, '--output', filename]);
  await assertExportFile(filename, 200, [50, 20, 65, 65]);
  const history = inspect((repository) => {
    const workspace = repository.get(projectId).workspace;
    assert.deepEqual(workspace.pricing, before.pricing);
    assert.deepEqual(workspace.costVersions, before.costVersions);
    assert.deepEqual(workspace.quoteHistory[0].lineSnapshots, first.lines);
    return workspace.quoteHistory[0];
  });
  updatePricing({ targetGrossMargin: 60 });
  assertAllocation(quote(), 250, [62.5, 20, 83.75, 83.75]);
  const updated = path.join(directory, 'gp-changed.xlsx');
  run(['quote', 'export', '--project-id', projectId, '--output', updated]);
  await assertExportFile(updated, 250, [62.5, 20, 83.75, 83.75]);
  updatePricing({ targetGrossMargin: 50 });
  changeCost(150);
  assertAllocation(quote(), 300, [75, 20, 102.5, 102.5]);
  const changedCost = path.join(directory, 'cost-changed.xlsx');
  run(['quote', 'export', '--project-id', projectId, '--output', changedCost]);
  await assertExportFile(changedCost, 300, [75, 20, 102.5, 102.5]);
  inspect((repository) => {
    const workspace = repository.get(projectId).workspace;
    assert.deepEqual(workspace.pricing.manualLines, gpPricing().manualLines);
    assert.equal(
      workspace.pricing.manualTargetPrice,
      999,
      'Legacy target remains inert under GP mode',
    );
    assert.deepEqual(workspace.costVersions[0], before.costVersions[0]);
    assert.deepEqual(
      workspace.quoteHistory.find((entry) => entry.id === history.id),
      history,
    );
    assert.deepEqual(
      workspace.quoteHistory
        .map((entry) => entry.quoteBeforeTax)
        .sort((a, b) => a - b),
      [200, 250, 300],
    );
  });
});

test('invalid percentage or contradictory locks block CLI output without files or history changes', (t) => {
  const { directory, inspect, run, updatePricing } = setup(t);
  const invalidRows = [
    gpPricing().manualLines.map((line, index) =>
      index === 0 ? { ...line, allocationWeight: 101 } : line,
    ),
    gpPricing().manualLines.map((line, index) =>
      index === 0 ? { ...line, priceFixed: true } : line,
    ),
    gpPricing().manualLines.map((line, index) =>
      index === 1 ? { ...line, unitPrice: 201 } : line,
    ),
  ];
  for (const [index, manualLines] of invalidRows.entries()) {
    updatePricing({ ...gpPricing(), manualLines });
    const before = inspect((repository) => repository.get(projectId));
    const filename = path.join(directory, `invalid-${index}.xlsx`);
    const result = run(
      ['quote', 'export', '--project-id', projectId, '--output', filename],
      undefined,
      6,
    );
    assert.equal(result.error.code, 'BUSINESS_VALIDATION_FAILED');
    assert.match(result.error.message, /fixed|percent|lock|100|target/i);
    assert.equal(existsSync(filename), false);
    inspect((repository) =>
      assert.deepEqual(repository.get(projectId), before),
    );
  }
});

test('unmarked legacy manual quotes keep saved prices through GP and cost changes without charging old tax', (t) => {
  const { inspect, updatePricing, quote, changeCost } = setup(t);
  updatePricing({
    lineMode: 'manual',
    targetGrossMargin: 50,
    gstPercent: 9,
    manualTargetPrice: 250,
    manualLines: [
      {
        id: 'legacy',
        description: 'Previously agreed price',
        quantity: 1,
        unit: 'lot',
        unitPrice: 250,
      },
    ],
  });
  const saved = inspect(
    (repository) => repository.get(projectId).workspace.pricing,
  );
  assert.equal(Object.hasOwn(saved, 'manualPricingBasis'), false);
  assert.equal(quote().pricing.listPrice, 250);
  updatePricing({ targetGrossMargin: 60 });
  changeCost(150);
  const input = quote();
  assert.equal(input.pricing.cost, 150);
  assert.equal(input.pricing.listPrice, 250);
  assert.equal(input.pricing.gstAmount, 0);
  assert.equal(input.pricing.quoteAfterTax, 250);
  assert.deepEqual(
    input.lines.map((line) => line.amount),
    [250],
  );
  inspect((repository) => {
    const pricing = repository.get(projectId).workspace.pricing;
    assert.equal(Object.hasOwn(pricing, 'manualPricingBasis'), false);
    assert.deepEqual(pricing.manualLines, saved.manualLines);
    assert.equal(pricing.manualTargetPrice, 250);
    assert.equal(pricing.gstPercent, 9);
  });
  updatePricing({ manualTargetPrice: 251 });
  assert.throws(
    quote,
    /target|match/i,
    'The old explicit target still constrains legacy output',
  );
});

test('schema accepts GP and percentage-lock metadata but rejects malformed values atomically', (t) => {
  const { inspect, updatePricing } = setup(t);
  updatePricing(gpPricing());
  inspect((repository) => {
    const before = repository.get(projectId);
    assert.equal(before.workspace.pricing.manualPricingBasis, 'gp');
    assert.equal(before.workspace.pricing.manualLines[0].allocationFixed, true);
    for (const pricing of [
      { manualPricingBasis: 'cost' },
      { manualPricingBasis: true },
      {
        manualLines: [
          { ...gpPricing().manualLines[0], allocationFixed: 'true' },
        ],
      },
    ]) {
      assert.throws(
        () =>
          updateResource(
            repository,
            projectId,
            'quote',
            { section: 'settings' },
            { set: { pricing } },
            before.revision,
          ),
        /schema|boolean|enum|allowed|string/i,
      );
      assert.deepEqual(repository.get(projectId), before);
    }
  });
});

test('mapped customer XLSX receives effective GP prices and omits all internal allocation fields', async (t) => {
  const { updatePricing, quote } = setup(t);
  updatePricing(gpPricing());
  const input = quote();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Customer');
  const fields = [
    'quoteNumber',
    'client',
    'project',
    'servicePrice',
    'discount',
    'quoteBeforeTax',
    'gstPercent',
    'gstAmount',
    'quoteAfterTax',
    'validityDays',
    'paymentTerms',
    'termsAndConditions',
    'assumptions',
  ];
  const cells = Object.fromEntries(
    fields.map((field, index) => {
      sheet.getCell(index + 1, 1).value = field;
      sheet.getCell(index + 1, 2).value = '';
      return [field, `B${index + 1}`];
    }),
  );
  sheet.getRow(15).values = [
    'Number',
    'Description',
    'Quantity',
    'Unit',
    'Unit price',
    'Amount',
  ];
  sheet.getRow(16).values = ['', '', '', '', '', ''];
  input.template.excel = {
    assetId: 'b'.repeat(64),
    fileName: 'synthetic-gp.xlsx',
    sheetName: 'Customer',
    detailRow: 16,
    columns: {
      number: 'A',
      description: 'B',
      quantity: 'C',
      unit: 'D',
      unitPrice: 'E',
      amount: 'F',
    },
    cells,
  };
  const result = new ExcelJS.Workbook();
  await result.xlsx.load(
    await fillQuoteExcelTemplate(
      new Uint8Array(await workbook.xlsx.writeBuffer()),
      input,
    ),
  );
  const output = result.getWorksheet('Customer');
  assert.equal(output.getCell('B4').value, 200);
  assert.equal(output.getCell('B7').value, null);
  assert.equal(output.getCell('B8').value, null);
  assert.equal(output.getCell('B9').value, 200);
  assert.deepEqual(
    [16, 17, 18, 19].map((row) => output.getCell(row, 6).value),
    [50, 20, 65, 65],
  );
  assert.doesNotMatch(
    JSON.stringify(output.getSheetValues()),
    /manualPricingBasis|manualTargetPrice|allocationWeight|allocationFixed|priceFixed/,
  );
});
