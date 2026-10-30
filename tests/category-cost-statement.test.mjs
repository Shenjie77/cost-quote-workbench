import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCostSnapshot } from './helpers.mjs';
import {
  buildGroupCostSummary,
  buildGroupCostSections,
  categoryStatementAmounts,
  allocateCategoryAmount,
} from '../features/cost/group-cost-summary.ts';
import {
  buildCostStatementRows,
  getHQTravelSummary,
  roundMoney,
  getY1Year,
} from '../features/cost/domain.ts';
import { buildSimpleCostWorkbook } from '../features/cost/export-simple-workbook.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  createProject,
} from '../server/workspace-resources.mjs';

const fixture = () => {
  const s = makeCostSnapshot();
  s.costRows.forEach((row, i) => {
    row.category = i % 2 ? 'Optional' : 'Mandatory';
    row.groupName = 'Delivery';
  });
  s.manualCosts.otherServiceRate = 0.01;
  s.manualCosts.riskContingency = 1000.01;
  s.manualCosts.settlement = 12.34;
  return s;
};
const summarize = (s) =>
  buildGroupCostSections(
    buildGroupCostSummary(
      s.costRows,
      s.resourceTypes,
      s.travelSettings,
      s.manualCosts,
      s.subcontractCost,
      getY1Year(s.rateSettings),
    ),
  );

test('every Category statement account reconciles to the project and EHS follows eligible cost', () => {
  const s = fixture(),
    sections = summarize(s);
  const values = sections.map((section) =>
    categoryStatementAmounts(section.items),
  );
  const rows = buildCostStatementRows(
    s.costRows,
    s.resourceTypes,
    getHQTravelSummary(s.costRows, s.resourceTypes, s.travelSettings).totalCost,
    s.manualCosts,
    s.subcontractCost,
    getY1Year(s.rateSettings),
  );
  for (const row of rows)
    assert.equal(
      roundMoney(values.reduce((sum, item) => sum + (item[row.code] ?? 0), 0)),
      row.amount,
      row.code,
    );
  for (let i = 0; i < sections.length; i++) {
    assert.equal(values[i][''], sections[i].totals.total);
    assert.ok(
      Math.abs(
        values[i]['2.3.4.2'] -
          (values[i]['2.3.1'] + values[i]['2.3.2'] + values[i]['2.3.3']) * 0.01,
      ) <= 0.02,
    );
    const totalBeforeRisk = values.reduce((sum, item) => sum + item['2'], 0);
    assert.ok(
      Math.abs(
        sections[i].items.find((item) => item.accountCode === '15').riskWeight -
          values[i]['2'] / totalBeforeRisk,
      ) < 1e-10,
    );
  }
});

test('saved risk shares change only category allocation, preserve cents and validate persistence', async () => {
  const s = fixture();
  const before = summarize(s);
  s.manualCosts.categoryRiskWeights = [
    { category: 'Mandatory', weight: 0.7 },
    { category: 'Optional', weight: 0.3 },
  ];
  assert.deepEqual(
    validateCostExportSnapshot(s).filter((issue) => issue.severity === 'error'),
    [],
  );
  const after = summarize(structuredClone(s));
  assert.deepEqual(
    after.map((section) => section.totals.risk),
    [700.01, 300],
  );
  assert.equal(
    roundMoney(after.reduce((sum, section) => sum + section.totals.total, 0)),
    roundMoney(before.reduce((sum, section) => sum + section.totals.total, 0)),
  );
  const book = await buildSimpleCostWorkbook(s);
  assert.equal(
    book.getWorksheet('Cost Statement').getCell('C4').value,
    'Mandatory Cost (SGD) / 成本',
  );
  assert.equal(
    book.getWorksheet('Cost Statement').getCell('D4').value,
    'Optional Cost (SGD) / 成本',
  );
  assert.equal(book.getWorksheet('Cost Statement').getCell('B3').value, 0.01);
  assert.ok(book.getWorksheet('Cost Statement').getRow(3).height >= 20);
  assert.equal(
    book.getWorksheet('Cost Statement').getCell('C21').result,
    700.01,
  );
  assert.equal(book.getWorksheet('Cost Statement').getCell('D21').result, 300);
  assert.equal(book.getWorksheet('Category Calculations').state, 'hidden');
  const group = book.getWorksheet('Summary Group');
  const weights = [];
  group.eachRow((row) => {
    if (row.getCell(2).value === 'Risk Contingency')
      weights.push(row.getCell(13).value);
  });
  assert.deepEqual(weights, [0.7, 0.3]);
  s.manualCosts.categoryRiskWeights.push({ category: 'Mandatory', weight: -1 });
  assert.ok(
    validateCostExportSnapshot(s).some(
      (issue) => issue.code === 'INVALID_CATEGORY_RISK_WEIGHTS',
    ),
  );
});

test('zero cost and fractional cents have deterministic reconciled allocations', () => {
  assert.deepEqual(allocateCategoryAmount(0.01, [0, 0, 0]), [0, 0.01, 0]);
  assert.deepEqual(allocateCategoryAmount(100, [0, 1]), [0, 100]);
  assert.deepEqual(allocateCategoryAmount(0, [1, 2]), [0, 0]);
});

test('Group preserves the template project rows and rolls Car Fee into EHS', async () => {
  const s = fixture();
  s.manualCosts.settlement = 0;
  s.manualCosts.carFee = 123.45;
  const sections = summarize(s);
  for (const section of sections) {
    assert.deepEqual(
      section.items
        .filter((item) => item.kind === 'Project')
        .map((item) => item.label),
      ['EHS', 'Risk Contingency'],
    );
    const values = categoryStatementAmounts(section.items);
    assert.equal(
      section.items.find((item) => item.label === 'EHS').total,
      values['2.3.4'],
    );
    assert.equal(
      values['2.3.4'],
      roundMoney(values['2.3.4.1'] + values['2.3.4.2']),
    );
  }
  const book = await buildSimpleCostWorkbook(s);
  const labels = [];
  book.getWorksheet('Summary Group').eachRow((row) => {
    if (row.getCell(3).value === 'Project') labels.push(row.getCell(2).value);
    if (row.getCell(2).value === 'EHS') {
      assert.match(row.getCell(8).formula, /'Category Calculations'!K\d+/);
      assert.match(row.getCell(8).formula, /'Category Calculations'!M\d+/);
    }
  });
  assert.ok(
    labels.every((label) =>
      ['Subcontract', 'EHS', 'Risk Contingency'].includes(label),
    ),
  );
  assert.match(
    book.getWorksheet('Cost Statement').getCell('A19').value,
    /2\.3\.4\.1.*Car Fee/,
  );
});

test('category risk overrides survive workspace save and version cloning', () => {
  const repository = openWorkspaceRepository(':memory:');
  try {
    createProject(repository, {
      id: 'P-RISK',
      name: 'Risk allocation',
      client: 'Fixture',
    });
    let record = repository.get('P-RISK');
    const weights = [
      { category: 'Mandatory', weight: 0.7 },
      { category: 'Optional', weight: 0.3 },
    ];
    record.workspace.manualCosts.categoryRiskWeights = weights;
    record.workspace.costVersions[0].manualCosts.categoryRiskWeights = weights;
    record = repository.save('P-RISK', record.workspace, record.revision);
    assert.deepEqual(
      repository.get('P-RISK').workspace.manualCosts.categoryRiskWeights,
      weights,
    );
    createCostDraft(
      repository,
      'P-RISK',
      { mode: 'clone', sourceVersion: 'V1' },
      record.revision,
    );
    assert.deepEqual(
      repository.get('P-RISK').workspace.costVersions[1].manualCosts
        .categoryRiskWeights,
      weights,
    );
  } finally {
    repository.close();
  }
});
