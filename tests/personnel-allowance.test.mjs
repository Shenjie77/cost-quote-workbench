import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import ExcelJS from 'exceljs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  totalRowCost,
  getCostStatementValues,
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  recalculateCostRows,
  roundMoney,
} from '../features/cost/domain.ts';
import { buildCostWorkbookBytes } from '../features/cost/export-workbook.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { makeCostSnapshot } from './helpers.mjs';
import {
  createBlankWorkspace,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';
import { templateData } from '../features/excel/template-workbook.ts';
import { costBaselineKey } from '../features/cpq/domain.ts';
import {
  previewCostImport,
  applyCostImport,
} from '../features/cost/import-workbook.ts';

const fixture = () => {
  const s = makeCostSnapshot();
  s.rateSettings.annualUplifts = [0, 0, 0, 0, 0];
  s.rateSettings.defaultUplift = 0;
  s.travelSettings = { monthlyAllowance: 0, airfarePerTrip: 0, trips: 0 };
  s.manualCosts = Object.fromEntries(
    Object.keys(s.manualCosts).map((key) => [key, 0]),
  );
  const profiles = [
    ['LOCAL', 100.11],
    ['ARP', 200.23],
    ['HQ', 300.99],
    [null, 400.01],
  ];
  const template = s.costRows[0];
  s.costRows = profiles.map(([pool, amount], index) => {
    const re = s.resourceTypes.find((r) => r.pool === pool);
    if (pool) re.mandayRate = amount;
    return {
      ...structuredClone(template),
      id: `allowance-${index}`,
      reTypeId: re.id,
      scope: pool || 'Subcontract',
      bu: `${pool || 'External'} BU`,
      mdPerSite: 1,
      years: template.years.map((y, i) => ({
        bucket: y.bucket,
        sites: i === 0 ? 1 : 0,
        cost: i === 0 ? amount : 0,
      })),
    };
  });
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  return s;
};
const totals = (s, travel = 0) =>
  getCostStatementValues(s.costRows, s.resourceTypes, travel, s.manualCosts);

test('Cost Input includes 3% in every Local/ARP annual cost, without changing effort or other costs', () => {
  const s = fixture();
  for (const row of s.costRows)
    row.years.forEach((year) => {
      year.sites = 1;
    });
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  const before = structuredClone(s.costRows),
    resources = structuredClone(s.resourceTypes);
  s.rateSettings.localArpAllowanceEnabled = true;
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.deepEqual(
    s.costRows[0].years.map((y) => y.cost),
    Array(5).fill(103.12),
  );
  assert.deepEqual(
    s.costRows[1].years.map((y) => y.cost),
    Array(5).fill(206.24),
  );
  assert.deepEqual(s.costRows.slice(2), before.slice(2));
  assert.deepEqual(s.resourceTypes, resources);
  for (let i = 0; i < 2; i++) {
    assert.equal(s.costRows[i].mdPerSite, before[i].mdPerSite);
    assert.deepEqual(
      s.costRows[i].years.map((y) => y.sites),
      before[i].years.map((y) => y.sites),
    );
  }
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(
      recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings),
      s.costRows,
    );
  }
  s.rateSettings.localArpAllowanceEnabled = false;
  assert.deepEqual(
    recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings),
    before,
  );
});

test('annual calculation applies uplift and direct mandays before rounding each final cost to cents', () => {
  const s = fixture();
  s.rateSettings.localArpAllowanceEnabled = true;
  s.rateSettings.tdStart = '2026-01-01';
  s.rateSettings.baseYear = 2026;
  s.rateSettings.annualUplifts = [0, 10, 10, 10, 10];
  const arp = s.costRows[1];
  arp.inputMode = 'mandays';
  arp.mdPerSite = 0;
  arp.years.forEach((y, i) => {
    y.sites = 0;
    y.mandays = i + 1;
    y.cost = 9999;
  });
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.deepEqual(
    s.costRows[1].years.map((y) => y.cost),
    [206.24, 453.73, 748.64, 1098.01, 1509.76],
  );

  const local = s.costRows[0];
  s.resourceTypes.find((r) => r.id === local.reTypeId).mandayRate = 100.01;
  s.rateSettings.annualUplifts = [0, 0, 0, 0, 0];
  local.years.forEach((y, i) => {
    y.sites = i < 2 ? 1 : 0;
  });
  const rounded = recalculateCostRows(
    [local],
    s.resourceTypes,
    s.rateSettings,
  )[0];
  assert.deepEqual(
    rounded.years.map((y) => y.cost),
    [103.02, 103.02, 0, 0, 0],
  );
  assert.equal(totalRowCost(rounded), 206.04);
});

test('summary and dimensions sum calculated costs with no separate allowance fields or statement hierarchy', () => {
  const s = fixture();
  assert.equal(totals(s).totalWithRisk, 1001.34);
  s.rateSettings.localArpAllowanceEnabled = true;
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  assert.equal(totals(s).totalWithRisk, 1010.36);
  assert.equal(totals(s).inHouseLabour, 610.35);
  assert.equal(totals(s).localArpAllowance, undefined);
  assert.equal(totals(s).inHouseBase, undefined);
  const rows = buildCostStatementRows(
    s.costRows,
    s.resourceTypes,
    0,
    s.manualCosts,
  );
  assert.equal(rows.find((r) => r.code === '2.3.1.1').amount, 610.35);
  assert.ok(!rows.some((r) => r.code.startsWith('2.3.1.1.')));
  for (const dimension of ['scope', 'bu', 'resourceType']) {
    const items = buildReconciledCostDimensionSummary(
      s.costRows,
      dimension,
      s.resourceTypes,
      0,
      s.manualCosts,
    );
    assert.equal(
      roundMoney(items.reduce((sum, item) => sum + item.cost, 0)),
      1010.36,
    );
    assert.equal(
      items.reduce((sum, item) => sum + item.mandays, 0),
      4,
    );
  }
  s.manualCosts.nonInHouseLabour = 500;
  assert.equal(totals(s, 1000).totalWithRisk, 2510.36);
  s.rateSettings.localArpAllowanceEnabled = 'true';
  assert.ok(
    validateCostExportSnapshot(s).some(
      (i) => i.code === 'INVALID_ALLOWANCE_SETTING',
    ),
  );
});

test('TD import computes the allowance once and preserves source evidence across later option changes', async () => {
  const s = fixture();
  s.rateSettings.localArpAllowanceEnabled = true;
  const wb = new ExcelJS.Workbook(),
    sheet = wb.addWorksheet('TD');
  sheet.addRow(['Scope', 'MD', 'Cost']);
  sheet.addRow(['Deployment', 1, 100.11]);
  const bytes = new Uint8Array(await wb.xlsx.writeBuffer());
  const mapping = {
    sheet: 'TD',
    headerRow: 1,
    role: 'TD',
    mode: 'mandays',
    year: 'Y5',
    columns: {
      scope: 1,
      mandays: 2,
      cost: 3,
      bu: 0,
      resource: 0,
      sites: 0,
      mdPerSite: 0,
    },
    defaultBu: 'Delivery',
    defaultResource: s.costRows[0].reTypeId,
  };
  const mismatch = await previewCostImport(
    bytes,
    'TD.xlsx',
    mapping,
    s.resourceTypes,
    s.rateSettings,
  );
  assert.match(mismatch.issues.join('\n'), /Local\/ARP 3%/);
  const preview = await previewCostImport(
    bytes,
    'TD.xlsx',
    { ...mapping, columns: { ...mapping.columns, cost: 0 } },
    s.resourceTypes,
    s.rateSettings,
  );
  assert.deepEqual(preview.issues, []);
  const rows = applyCostImport([], preview, {
    resources: s.resourceTypes,
    rates: s.rateSettings,
  });
  assert.deepEqual(
    rows[0].years.map((y) => y.cost),
    [0, 0, 0, 0, 103.12],
  );
  assert.deepEqual(
    recalculateCostRows(rows, s.resourceTypes, s.rateSettings),
    rows,
  );
  const off = { ...s.rateSettings, localArpAllowanceEnabled: false };
  const recalculated = recalculateCostRows(rows, s.resourceTypes, off);
  assert.equal(recalculated[0].years[4].cost, 100.11);
  assert.deepEqual(recalculated[0].source, rows[0].source);
  assert.equal(
    JSON.parse(recalculated[0].source.importedValues).years[4].cost,
    103.12,
  );
  assert.throws(
    () =>
      applyCostImport([], preview, { resources: s.resourceTypes, rates: off }),
    /changed/,
  );
});

const column = (sheet, name) => {
  for (let c = 1; c <= sheet.columnCount; c++)
    if (sheet.getCell(4, c).value === name) return c;
  throw new Error(`Missing column ${name}`);
};
const rowNumber = (sheet, col, value) => {
  for (let r = 5; r <= sheet.rowCount; r++)
    if (sheet.getCell(r, col).value === value) return r;
  throw new Error(`Missing row ${value}`);
};
const value = (cell) =>
  cell.value?.result ?? (cell.value?.formula ? 0 : cell.value);

test('Excel uses calculated annual cells and one internal cost row without synthetic allowance detail', async () => {
  const s = fixture();
  s.rateSettings.localArpAllowanceEnabled = true;
  s.costRows = recalculateCostRows(s.costRows, s.resourceTypes, s.rateSettings);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await buildCostWorkbookBytes(s)));
  assert.equal(workbook.worksheets.length, 9);
  const detail = workbook.getWorksheet('01_Cost_Detail');
  const kind = column(detail, 'Source Kind');
  let effort = 0,
    count = 0;
  for (let r = 5; r <= detail.rowCount; r++) {
    assert.notEqual(detail.getCell(r, kind).value, 'LOCAL_ARP_ALLOWANCE');
    if (detail.getCell(r, kind).value !== 'COST_INPUT') continue;
    count++;
    effort += value(detail.getCell(r, column(detail, 'Total MD')));
    const source = s.costRows.find(
      (row) => row.id === detail.getCell(r, column(detail, 'Line ID')).value,
    );
    assert.ok(source);
    for (const y of source.years)
      assert.equal(
        value(detail.getCell(r, column(detail, `${y.bucket} Cost`))),
        y.cost,
      );
  }
  assert.equal(count, 4);
  assert.equal(effort, 4);
  const statement = workbook.getWorksheet('06_Cost_Statement');
  const statementCost = (key) =>
    statement.getCell(
      rowNumber(statement, column(statement, 'Code'), key),
      column(statement, 'Cost (SGD)'),
    );
  assert.equal(value(statementCost('2.3.1.1')), 610.35);
  for (let r = 5; r <= statement.rowCount; r++) {
    const code = statement.getCell(r, column(statement, 'Code')).value;
    assert.ok(typeof code !== 'string' || !code.startsWith('2.3.1.1.'));
  }
  for (const sheetName of [
    '02_Summary_Scope',
    '03_Summary_BU',
    '04_Summary_RE_Type',
  ]) {
    const sheet = workbook.getWorksheet(sheetName);
    assert.equal(
      value(
        sheet.getCell(
          rowNumber(sheet, 1, 'TOTAL'),
          column(sheet, 'Sales Cost'),
        ),
      ),
      1010.36,
    );
  }
  const grade = workbook.getWorksheet('05_Summary_RE_Level');
  assert.equal(
    value(
      grade.getCell(
        rowNumber(grade, 1, 'TOTAL'),
        column(grade, 'In-house Labour Cost'),
      ),
    ),
    610.35,
  );
  const recon = workbook.getWorksheet('07_Reconciliation');
  for (let r = 5; r <= recon.rowCount; r++) {
    const checkId = recon.getCell(r, column(recon, 'Check ID')).value;
    if (typeof checkId === 'string' && /^(R\d+|OVERALL)$/.test(checkId))
      assert.equal(value(recon.getCell(r, column(recon, 'Status'))), 'PASS');
  }
  const assumptions = workbook.getWorksheet('08_Assumptions');
  assert.equal(
    assumptions.getCell(
      rowNumber(assumptions, 2, 'Local + ARP allowance 3%'),
      3,
    ).value,
    'Enabled',
  );
});

test('CLI persists allowance per version, includes it in quotes/templates and keeps it protected by final cost locks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personnel-allowance-'));
  const db = path.join(dir, 'db.sqlite');
  const s = fixture();
  const w = createBlankWorkspace(
    projectRecord('ALLOWANCE', 'Allowance fixture', 'Customer'),
    'costing',
  );
  for (const field of [
    'costRows',
    'rateSettings',
    'resourceTypes',
    'travelSettings',
    'manualCosts',
  ]) {
    w[field] = structuredClone(s[field]);
    w.costVersions[0][field] = structuredClone(s[field]);
  }
  w.costVersions.push({
    ...structuredClone(w.costVersions[0]),
    code: 'V2',
    sourceVersion: 'V1',
  });
  const repo = openWorkspaceRepository(db);
  const validate = new Ajv2020({ strict: true }).compile(
    JSON.parse(
      readFileSync(
        new URL('../schemas/command-envelope.schema.json', import.meta.url),
      ),
    ),
  );
  const run = (args, changes, expected = 0) => {
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        db,
      ],
      {
        encoding: 'utf8',
        input: changes
          ? JSON.stringify({
              apiVersion: 'cost-workbench/v2',
              kind: 'OperationRequest',
              requestId: 'allowance-test',
              data: {
                schemaVersion: '1.0.0',
                operation: args.slice(0, 2).join('.'),
                changes,
              },
            })
          : undefined,
      },
    );
    assert.equal(result.status, expected, result.stdout + result.stderr);
    const out = JSON.parse(result.stdout);
    assert.ok(validate(out), JSON.stringify(validate.errors));
    return out.data;
  };
  try {
    const before = repo.save('ALLOWANCE', w, null).workspace;
    const settings = (revision) => [
      'cost',
      'update',
      '--project-id',
      'ALLOWANCE',
      '--version',
      'V1',
      '--section',
      'settings',
      '--input',
      '-',
      '--expected-revision',
      String(revision),
    ];
    run(settings(1), {
      set: { rateSettings: { localArpAllowanceEnabled: true } },
    });
    const after = repo.get('ALLOWANCE').workspace;
    assert.equal(after.costRows[0].years[0].cost, 103.12);
    assert.equal(after.costRows[1].years[0].cost, 206.24);
    assert.deepEqual(after.costRows.slice(2), before.costRows.slice(2));
    assert.deepEqual(after.costVersions[1], before.costVersions[1]);
    assert.notEqual(
      costBaselineKey(after.costVersions[0]),
      costBaselineKey(before.costVersions[0]),
    );
    assert.equal(repo.list()[0].totalCost, 1010.36);
    const calculation = run(['cost', 'calculate', '--project-id', 'ALLOWANCE']);
    assert.equal(calculation.totals.localArpAllowance, undefined);
    assert.equal(calculation.totals.totalWithRisk, 1010.36);
    const history = run(['history', 'search', '--scope', 'LOCAL']).items;
    assert.equal(history.length, 2);
    assert.equal(history.find((item) => item.version === 'V1').cost, 103.12);
    assert.equal(history.find((item) => item.version === 'V2').cost, 100.11);
    assert.ok(
      history.every(
        (item) =>
          !Object.hasOwn(item, 'baseCost') &&
          !Object.hasOwn(item, 'allowanceCost'),
      ),
    );
    assert.equal(
      run([
        'cost',
        'get',
        '--project-id',
        'ALLOWANCE',
        '--version',
        'V2',
        '--section',
        'summary',
      ]).value.totalWithRisk,
      1001.34,
    );
    run(settings(2), {
      set: { rateSettings: { localArpAllowanceEnabled: true } },
    });
    assert.deepEqual(repo.get('ALLOWANCE').workspace.costRows, after.costRows);
    run(settings(3), { set: { state: 'Confirmed' } });
    const finalized = repo.get('ALLOWANCE').workspace;
    assert.equal(
      validatedQuoteInput(finalized, 'Q-ALLOWANCE').pricing.cost,
      1010.36,
    );
    const data = templateData(finalized, 'cost');
    assert.equal(data.scalars['cost.allowance'], undefined);
    assert.equal(data.scalars['cost.total'], 1010.36);
    assert.equal(
      templateData(finalized, 'quote', 'Q-ALLOWANCE').scalars['cost.allowance'],
      undefined,
    );
    run(
      settings(4),
      { set: { rateSettings: { localArpAllowanceEnabled: false } } },
      6,
    );
    assert.equal(repo.get('ALLOWANCE').revision, 4);
  } finally {
    repo.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
