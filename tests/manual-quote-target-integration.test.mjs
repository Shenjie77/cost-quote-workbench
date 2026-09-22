/** Persisted target pricing remains explicit, exportable and detached from customer/history detail metadata. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  updateResource,
} from '../server/workspace-resources.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { buildQuoteWorkbookBuffer } from '../features/quote/export-quote-workbook.ts';
import { fillQuoteExcelTemplate } from '../features/quote/fill-excel-template.ts';
import { calculatePricing } from '../features/quote/domain.ts';

const projectId = 'TARGET-PRICE-TEST';
const publicLineKeys = [
  'amount',
  'description',
  'id',
  'quantity',
  'unit',
  'unitPrice',
];

/** One fixed line plus a weighted two-unit line exactly matches the requested pre-discount target. */
function targetPricing() {
  return {
    lineMode: 'manual',
    manualTargetPrice: 250,
    targetGrossMargin: 25,
    discount: 10,
    gstPercent: 9,
    manualLines: [
      {
        id: 'fixed',
        description: 'Equipment',
        quantity: 1,
        unit: 'piece',
        unitPrice: 100,
        allocationWeight: 0,
        priceFixed: true,
      },
      {
        id: 'weighted',
        description: 'Delivery service',
        quantity: 2,
        unit: 'day',
        unitPrice: 75,
        allocationWeight: 3,
        priceFixed: false,
      },
    ],
  };
}

/** Creates only disposable data; real CLI exports and CAS updates operate on this temporary SQLite database. */
function setup(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'manual-quote-target-'));
  const database = path.join(directory, 'workbench.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inspect = (callback) => {
    const repo = openWorkspaceRepository(database);
    try {
      return callback(repo);
    } finally {
      repo.close();
    }
  };
  inspect((repo) => {
    const resources = repo.globalMasterData.get('resources');
    repo.globalMasterData.update(
      'resources',
      { upsert: [{ id: 'rt-local-l1', mandayRate: 100 }] },
      resources.revision,
    );
    createProject(repo, {
      id: projectId,
      name: 'Customer delivery',
      client: 'Fixture Customer',
    });
    let revision = repo.get(projectId).revision;
    revision = updateResource(
      repo,
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
          manualCosts: { localPurchasedEquipment: 0, otherServiceRate: 0 },
        },
      },
      revision,
    ).revision;
    revision = updateResource(
      repo,
      projectId,
      'cost',
      { section: 'rows', version: 'V1' },
      {
        upsert: [
          {
            id: 'delivery',
            scope: 'Delivery',
            bu: 'Delivery',
            reTypeId: 'rt-local-l1',
            inputMode: 'mandays',
            mdPerSite: 0,
            years: ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((bucket, index) => ({
              bucket,
              sites: 0,
              mandays: index === 0 ? 1 : 0,
              cost: 0,
            })),
          },
        ],
      },
      revision,
    ).revision;
    updateResource(
      repo,
      projectId,
      'cost',
      { section: 'settings', version: 'V1' },
      { set: { state: 'Confirmed' } },
      revision,
    );
  });
  const run = (args, changes, status = 0) => {
    const input = changes
      ? {
          apiVersion: 'cost-workbench/v2',
          kind: 'OperationRequest',
          requestId: 'manual-target-update',
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
        ...(input ? ['--input', '-'] : []),
      ],
      {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        input: input ? JSON.stringify(input) : undefined,
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
        String(inspect((repo) => repo.get(projectId).revision)),
      ],
      { set: { pricing } },
    );
  return { directory, inspect, run, updatePricing };
}

/** Checks the exact serialized boundary instead of relying on TypeScript's structural declarations. */
function assertCustomerLines(lines) {
  for (const line of lines)
    assert.deepEqual(Object.keys(line).sort(), publicLineKeys);
}

test('CLI narrow pricing updates preserve target and allocation settings; zero-tax export archives customer-only lines', async (t) => {
  const { directory, inspect, run, updatePricing } = setup(t);
  const costVersions = inspect(
    (repo) => repo.get(projectId).workspace.costVersions,
  );
  updatePricing(targetPricing());
  updatePricing({ gstPercent: 0 });
  const saved = run([
    'quote',
    'get',
    '--project-id',
    projectId,
    '--section',
    'settings',
  ]).data.value.pricing;
  assert.deepEqual(saved.manualLines, targetPricing().manualLines);
  assert.equal(saved.manualTargetPrice, 250);
  assert.equal(saved.gstPercent, 0);
  const input = inspect((repo) =>
    validatedQuoteInput(repo.get(projectId).workspace, 'Q-TARGET'),
  );
  assert.equal(input.pricing.listPrice, 250);
  assert.equal(input.pricing.quoteBeforeTax, 240);
  assert.equal(input.pricing.gstAmount, 0);
  assert.equal(input.pricing.quoteAfterTax, 240);
  assertCustomerLines(input.lines);
  const filename = path.join(directory, 'target-quotation.xlsx');
  run(['quote', 'export', '--project-id', projectId, '--output', filename]);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(readFileSync(filename));
  const sheet = book.getWorksheet('Quotation');
  assert.equal(sheet.getCell('D12').value, 250);
  assert.equal(sheet.getCell('D13').value, 10);
  assert.equal(sheet.getCell('D14').value, 240);
  assert.equal(sheet.getCell('D15').value, 0);
  assert.equal(sheet.getCell('D16').value, 240);
  assert.doesNotMatch(
    JSON.stringify(sheet.getSheetValues()),
    /manualTargetPrice|allocationWeight|priceFixed|weighted|targetGrossMargin/,
  );
  const history = inspect((repo) => {
    const workspace = repo.get(projectId).workspace;
    assert.deepEqual(workspace.costVersions, costVersions);
    assert.equal(workspace.quoteHistory.length, 1);
    assertCustomerLines(workspace.quoteHistory[0].lineSnapshots);
    assert.equal(workspace.quoteHistory[0].quoteBeforeTax, 240);
    assert.equal(workspace.quoteHistory[0].gstAmount, 0);
    return workspace.quoteHistory[0];
  });
  updatePricing({
    manualTargetPrice: 999,
    manualLines: [
      {
        ...saved.manualLines[0],
        unitPrice: 999,
        allocationWeight: 9,
        priceFixed: false,
      },
    ],
  });
  inspect((repo) =>
    assert.deepEqual(repo.get(projectId).workspace.quoteHistory[0], history),
  );
});

test('a stored unapplied target blocks CLI and direct workbook output without repricing rows or writing history', async (t) => {
  const { directory, inspect, run, updatePricing } = setup(t);
  updatePricing({ ...targetPricing(), manualTargetPrice: 251, gstPercent: 0 });
  const before = inspect((repo) => repo.get(projectId));
  const filename = path.join(directory, 'blocked.xlsx');
  const failure = run(
    ['quote', 'export', '--project-id', projectId, '--output', filename],
    undefined,
    6,
  );
  assert.equal(failure.error.code, 'BUSINESS_VALIDATION_FAILED');
  assert.match(failure.error.message, /target|match|apply|reconcil/i);
  assert.equal(existsSync(filename), false);
  inspect((repo) => {
    assert.deepEqual(repo.get(projectId), before);
    assert.deepEqual(
      repo.files.list(projectId, { category: 'quote' }).files,
      [],
    );
  });
  // A caller with a previously valid workbook input must not bypass the target error at either export boundary.
  const validWorkspace = structuredClone(before.workspace);
  validWorkspace.pricing.manualTargetPrice = 250;
  const input = validatedQuoteInput(validWorkspace, 'Q-DIRECT');
  input.pricing = calculatePricing(100, before.workspace.pricing);
  await assert.rejects(
    buildQuoteWorkbookBuffer(input),
    /target|match|apply|reconcil/i,
  );
  await assert.rejects(
    fillQuoteExcelTemplate(new Uint8Array(), input),
    /target|match|apply|reconcil/i,
  );
});

test('optional fields preserve legacy manual quotes and explicit zero targets remain valid', (t) => {
  const { inspect, updatePricing } = setup(t);
  const legacy = targetPricing();
  delete legacy.manualTargetPrice;
  for (const line of legacy.manualLines) {
    delete line.allocationWeight;
    delete line.priceFixed;
  }
  updatePricing({ ...legacy, gstPercent: 0 });
  const saved = inspect((repo) => repo.get(projectId).workspace);
  assert.equal(Object.hasOwn(saved.pricing, 'manualTargetPrice'), false);
  assert.equal(
    validatedQuoteInput(saved, 'Q-LEGACY').pricing.quoteBeforeTax,
    240,
  );
  updatePricing({
    manualTargetPrice: 0,
    discount: 0,
    manualLines: [
      {
        id: 'free',
        description: 'Included service',
        quantity: 1,
        unit: 'lot',
        unitPrice: 0,
        allocationWeight: 0,
        priceFixed: true,
      },
    ],
  });
  const quote = inspect((repo) =>
    validatedQuoteInput(repo.get(projectId).workspace, 'Q-ZERO'),
  );
  assert.equal(quote.pricing.listPrice, 0);
  assert.equal(quote.pricing.quoteAfterTax, 0);
  assert.equal(quote.lines[0].amount, 0);
  assertCustomerLines(quote.lines);
});

test('schema rejects invalid target and allocation values atomically while customer line snapshots stay strict', (t) => {
  const { inspect, updatePricing } = setup(t);
  updatePricing(targetPricing());
  inspect((repo) => {
    const before = repo.get(projectId);
    const invalid = [
      { manualTargetPrice: -1 },
      { manualTargetPrice: 1e12 + 1 },
      {
        manualLines: [
          { ...targetPricing().manualLines[0], allocationWeight: -1 },
        ],
      },
      {
        manualLines: [
          { ...targetPricing().manualLines[0], allocationWeight: 1e6 + 1 },
        ],
      },
      {
        manualLines: [
          { ...targetPricing().manualLines[0], priceFixed: 'true' },
        ],
      },
    ];
    for (const pricing of invalid) {
      assert.throws(
        () =>
          updateResource(
            repo,
            projectId,
            'quote',
            { section: 'settings' },
            { set: { pricing } },
            before.revision,
          ),
        /schema|number|boolean|minimum|maximum|allowed/i,
      );
      assert.deepEqual(repo.get(projectId), before);
    }
  });
});

test('mapped customer XLSX receives reconciled target prices and zero tax without internal allocation fields', async (t) => {
  const { inspect, updatePricing } = setup(t);
  updatePricing({ ...targetPricing(), gstPercent: 0 });
  const input = inspect((repo) =>
    validatedQuoteInput(repo.get(projectId).workspace, 'Q-MAPPED'),
  );
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Customer');
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
    assetId: 'a'.repeat(64),
    fileName: 'synthetic.xlsx',
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
  const output = new ExcelJS.Workbook();
  await output.xlsx.load(
    await fillQuoteExcelTemplate(
      new Uint8Array(await book.xlsx.writeBuffer()),
      input,
    ),
  );
  const result = output.getWorksheet('Customer');
  assert.equal(result.getCell('B4').value, 250);
  assert.equal(result.getCell('B6').value, 240);
  assert.equal(result.getCell('B8').value, 0);
  assert.equal(result.getCell('B9').value, 240);
  assert.equal(result.getCell('E16').value, 100);
  assert.equal(result.getCell('F16').value, 100);
  assert.equal(result.getCell('E17').value, 75);
  assert.equal(result.getCell('F17').value, 150);
  assert.doesNotMatch(
    JSON.stringify(result.getSheetValues()),
    /manualTargetPrice|allocationWeight|priceFixed|targetGrossMargin/,
  );
});
