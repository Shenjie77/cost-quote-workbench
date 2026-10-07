import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { fillQuoteExcelTemplate } from '../features/quote/fill-excel-template.ts';
import { book2StructuredMapping } from '../features/quote/book2-example-mapping.ts';
import { validateQuoteExcelMapping } from '../features/quote/excel-template-mapping.ts';
import {
  structuredBodyRows,
  editableSectionLayout,
} from '../features/quote/structured-body.ts';
import { customerDocument } from '../features/quote/customer-document.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { emptyMaintenance } from '../features/maintenance/domain.ts';

function input(count = 2, optional = false) {
  const excel = book2StructuredMapping({
    assetId: 'a'.repeat(64),
    fileName: 'test.xlsx',
    sheetName: 'Quote',
    detailRow: 17,
    columns: { description: 'C', amount: 'G' },
    cells: {},
  });
  return {
    project: { id: 'P', name: 'Campus', client: 'Customer', currency: 'SGD' },
    quoteNumber: 'Q1',
    costVersion: 'V1',
    issuedAt: '2026-10-02',
    template: { ...initialQuoteTemplates[0], excel },
    assumptions: [],
    pricing: calculatePricing(count * 80, {
      targetGrossMargin: 20,
      discount: optional ? 0 : 10,
      gstPercent: 0,
      lineGroups: Object.fromEntries(
        Array.from({ length: count }, (_, i) => [
          `s${i}`,
          {
            category: i % 2 ? 'Deployment' : 'Professional Service',
            inclusion: optional && i === count - 1 ? 'optional' : 'mandatory',
          },
        ]),
      ),
    }),
    lines: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      description: `Work ${i}`,
      quantity: 1,
      unit: 'lot',
      unitPrice: 100,
      amount: 100,
    })),
  };
}
async function fixture(configure = () => {}) {
  const workbook = new ExcelJS.Workbook(),
    sheet = workbook.addWorksheet('Quote');
  sheet.columns = [3, 10, 45, 12, 18, 12, 20].map((width) => ({ width }));
  sheet.getCell('C14').value = 'Header';
  for (const row of [15, 16, 17, 25, 27, 28, 29, 31]) {
    sheet.getCell(`B${row}`).value = 'WRONG NUMBER';
    sheet.getCell(`C${row}`).value = 'OLD SAMPLE TITLE';
    sheet.getCell(`G${row}`).value = 999;
  }
  sheet.getCell('C31').value = 'Total price for optional item OLD';
  sheet.mergeCells('B25:F25');
  sheet.getCell('B25').value = 'OLD MANDATORY TOTAL';
  sheet.getCell('G25').value = { formula: 'SUM(G17:G23)' };
  sheet.getCell('G31').value = { formula: 'SUM(G29)' };
  sheet.getRow(17).height = 31;
  sheet.getCell('G17').numFmt = '#,##0.00';
  sheet.getCell('C16').font = { bold: true, color: { argb: 'FF123456' } };
  sheet.mergeCells('C33:G33');
  sheet.getCell('C33').value = 'OLD ASSUMPTIONS';
  sheet.getCell('C42').value = 'Retained footer';
  sheet.getRow(42).height = 27;
  sheet.getCell('G43').value = { formula: 'LEN(C42)' };
  workbook.addWorksheet('Summary').getCell('A1').value = {
    formula: "'Quote'!C42",
  };
  sheet.pageSetup.printArea = 'B2:G43';
  configure(workbook, sheet);
  return workbook.xlsx.writeBuffer();
}
async function output(data, configure) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    await fillQuoteExcelTemplate(await fixture(configure), data),
  );
  return book;
}
function allText(sheet) {
  const cells = [];
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (!cell.isMerged || cell.master === cell) cells.push(cell.text);
    }),
  );
  return cells.join('\n');
}
for (const count of [1, 8, 30])
  test(`structured body generates ${count} lines, removes all Optional samples and preserves footer geometry`, async () => {
    const data = input(count),
      before = structuredClone(data),
      plan = structuredBodyRows(data, data.template.excel.body, {
        project: 'Campus',
      });
    const book = await output(data),
      sheet = book.getWorksheet('Quote'),
      delta = plan.length - 18;
    assert.deepEqual(data, before);
    assert.doesNotMatch(allText(sheet), /OLD|WRONG|optional/i);
    assert.equal(sheet.getCell(`C${42 + delta}`).value, 'Retained footer');
    assert.equal(sheet.getRow(42 + delta).height, 27);
    assert.equal(
      sheet.getCell(`G${43 + delta}`).formula,
      `LEN(C${42 + delta})`,
    );
    assert.equal(
      book.getWorksheet('Summary').getCell('A1').formula,
      `'Quote'!C${42 + delta}`,
    );
    assert.equal(sheet.pageSetup.printArea, `B2:G${43 + delta}`);
    for (const [i, row] of plan.entries()) {
      const n = 15 + i;
      if (row.line) {
        assert.equal(sheet.getCell(`B${n}`).value, row.number);
        assert.equal(sheet.getRow(n).height, 31);
        assert.equal(sheet.getCell(`G${n}`).numFmt, '#,##0.00');
      }
      if (row.role === 'category')
        assert.equal(sheet.getCell(`C${n}`).font.color.argb, 'FF123456');
      if (row.sum) {
        assert.equal(sheet.getCell(`G${n}`).result, row.amount);
        assert.equal(
          sheet.getCell(`G${n}`).formula,
          `ROUND(SUM(${row.sum.map((j) => `G${15 + j}`).join(',')})${row.subtract === undefined ? '' : `-G${15 + row.subtract}`},2)`,
        );
      }
    }
    assert.equal(
      sheet.getCell(`G${15 + plan.length - 1}`).result,
      count * 100 - 10,
    );
  });

test('custom titles/order/numbering repeat across categories and Optional remains excluded', async () => {
  const data = input(4, true),
    body = data.template.excel.body;
  body.categoryOrder = ['Deployment', 'Professional Service'];
  body.titles.mandatory = 'Base scope — {project}';
  body.titles.optional = 'Additional scope';
  body.titles.category = '{chapterNumber}: {category}';
  const sheet = (await output(data)).getWorksheet('Quote');
  assert.equal(sheet.getCell('C15').value, 'Base scope — Campus');
  assert.equal(sheet.getCell('C16').value, '1: Deployment');
  assert.equal(sheet.getCell('B17').value, '1.1.1');
  const rows = structuredBodyRows(data, body, { project: 'Campus' });
  assert.deepEqual(
    rows
      .filter((r) => r.role === 'total' || r.role === 'grandTotal')
      .map((r) => r.amount),
    [300, 100, 400],
  );
  assert.deepEqual(
    rows.filter((r) => r.role === 'chapter').map((r) => r.number),
    ['1', '2'],
  );
  assert.doesNotMatch(allText(sheet), /OLD|WRONG/);
  for (const numbering of ['continuous', 'alphabetic']) {
    body.numbering = numbering;
    const generated = structuredBodyRows(data, body, {
      project: 'Campus',
    }).filter((r) => r.line);
    assert.deepEqual(
      generated.map((r) => r.number),
      numbering === 'continuous' ? ['1', '2', '3', '4'] : ['a', 'a', 'b', 'a'],
    );
  }
});

test('zero-valued Optional items remain visible and Optional-only chapters start at 1', async () => {
  const data = input(2, true);
  data.lines[1].unitPrice = 0;
  data.lines[1].amount = 0;
  data.pricing = calculatePricing(80, {
    targetGrossMargin: 20,
    discount: 0,
    gstPercent: 0,
    lineGroups: data.pricing.lineGroups,
  });
  const sheet = (await output(data)).getWorksheet('Quote');
  assert.match(allText(sheet), /Total price for Optional items/);
  const rows = structuredBodyRows(data, data.template.excel.body, {
    project: 'Campus',
  });
  assert.equal(
    rows.find((r) => r.description === 'Total price for Optional items').amount,
    0,
  );
  assert.equal(rows.at(-1).amount, 100);
  data.pricing.lineGroups.s0.inclusion = 'optional';
  const only = structuredBodyRows(data, data.template.excel.body, {
    project: 'Campus',
  });
  assert.deepEqual(
    only.filter((r) => r.role === 'chapter').map((r) => r.number),
    ['1'],
  );
  assert.doesNotMatch(
    only.map((r) => r.description).join('\n'),
    /Mandatory items|Total price for mandatory/i,
  );
});

test('metadata remains editable outside body; conflicting formulas and geometry fail clearly', async () => {
  const data = input();
  assert.deepEqual(validateQuoteExcelMapping(data.template.excel), []);
  const invalid = structuredClone(data.template.excel);
  invalid.textCells.push({ address: 'C17', content: '{project}' });
  assert.match(
    validateQuoteExcelMapping(invalid).join(' '),
    /inside the generated body/,
  );
  invalid.body.styles.detail = 40;
  invalid.body.titles.category = '{unknown}';
  assert.match(validateQuoteExcelMapping(invalid).join(' '), /style row/);
  assert.match(validateQuoteExcelMapping(invalid).join(' '), /unknown/);
  await assert.rejects(
    output(data, (_, sheet) => {
      sheet.getCell('G44').value = { formula: 'SUM(G15:G32)' };
    }),
    /total placeholder/,
  );
  await assert.rejects(
    output(data, (_, sheet) => sheet.mergeCells('C18:C19')),
    /horizontal merges/,
  );
  await assert.rejects(
    output(data, (_, sheet) => sheet.mergeCells('C17:D17')),
    /share a merged cell/,
  );
});

test('structured body schema round-trips and rejects unknown keys', () => {
  const schema = JSON.parse(
    readFileSync(
      new URL('../schemas/workspace-state.schema.json', import.meta.url),
    ),
  );
  const validate = new Ajv({ strict: false }).compile({
    $ref: '#/$defs/quoteExcelTemplate',
    $defs: schema.$defs,
  });
  const mapping = JSON.parse(JSON.stringify(input().template.excel));
  assert.equal(validate(mapping), true, JSON.stringify(validate.errors));
  mapping.body.spacing = { section: 1 };
  mapping.body.sectionSpacing = [{ section: 'Implementation', rows: 2 }];
  mapping.body.titles.section = '{section}';
  mapping.body.titles.sectionTotal = '{section} Total';
  assert.equal(validate(mapping), true, JSON.stringify(validate.errors));
  mapping.body.sectionSpacing[0].rows = 6;
  assert.equal(validate(mapping), false);
  mapping.body.sectionSpacing[0].rows = 2;
  mapping.body.unexpected = true;
  assert.equal(validate(mapping), false);
});

test('maintenance descriptions use explicit text or model and node count without a start year', () => {
  const data = input();
  data.maintenance = {
    ...emptyMaintenance(),
    startYear: 2026,
    boq: [
      {
        id: 'm',
        model: 'NE8000',
        description: '',
        quantity: 2,
        durationYears: 2,
        ct: 30,
        spms: 10,
        unitAnnualQuote: 0,
        serviceLevel: '8x5',
        site: '',
        referenceId: '',
        basis: '',
        source: 'manual',
      },
    ],
  };
  assert.equal(customerDocument(data).maintenance[0].description, 'NE8000 (2)');
  data.maintenance.boq[0].unit = 'routers';
  assert.equal(
    customerDocument(data).maintenance[0].description,
    'NE8000 (2 routers)',
  );
  data.maintenance.boq[0].description = 'Customer router support';
  assert.equal(
    customerDocument(data).maintenance[0].description,
    'Customer router support',
  );
});

test('custom section names and selected blank rows preserve numbering, shifted footers and exact total references', async () => {
  const data = input(4, true),
    body = data.template.excel.body;
  body.sectionNames = { mandatory: 'Base scope', optional: 'Additional scope' };
  body.titles.subtotal = '{section} / {category} Subtotal';
  body.spacing = { chapterHeading: 1, category: 0, mandatory: 2, optional: 1 };
  body.categorySpacing = [{ category: 'Deployment', rows: 2 }];
  const plan = structuredBodyRows(data, body, { project: 'Campus' });
  assert.deepEqual(
    plan.filter((r) => r.role === 'chapter').map((r) => r.description),
    [
      'Base scope items for Campus',
      'Additional scope items (excluded from mandatory total)',
    ],
  );
  assert.equal(plan.filter((r) => r.role === 'blank').length, 9);
  assert.deepEqual(
    plan.filter((r) => r.role === 'detail').map((r) => r.number),
    ['1.1.1', '1.1.2', '1.2.1', '2.1.1'],
  );
  const book = await output(data),
    sheet = book.getWorksheet('Quote');
  for (const [i, row] of plan.entries()) {
    const n = body.startRow + i;
    if (row.role === 'blank') {
      assert.equal(sheet.getRow(n).actualCellCount, 0);
      assert.equal(sheet.getRow(n).height, 12);
    }
    if (row.sum) {
      assert.equal(sheet.getCell(`G${n}`).result, row.amount);
      assert.equal(
        sheet.getCell(`G${n}`).formula,
        `ROUND(SUM(${row.sum.map((index) => `G${body.startRow + index}`).join(',')})${row.subtract === undefined ? '' : `-G${body.startRow + row.subtract}`},2)`,
      );
    }
  }
  const delta = plan.length - (body.endRow - body.startRow + 1);
  assert.equal(sheet.getCell(`C${42 + delta}`).value, 'Retained footer');
  assert.match(allText(sheet), /Total price for Base scope items/);
  assert.match(allText(sheet), /Additional scope \/ Deployment Subtotal/);
  data.lines = data.lines.slice(0, 3);
  data.pricing = calculatePricing(240, {
    targetGrossMargin: 20,
    discount: 0,
    gstPercent: 0,
  });
  const without = structuredBodyRows(data, body, { project: 'Campus' });
  assert.equal(without.filter((row) => row.role === 'chapter').length, 1);
  assert.doesNotMatch(
    without.map((row) => row.description).join('\n'),
    /Additional scope/,
  );
  const invalid = structuredClone(data.template.excel);
  invalid.body.spacing.mandatory = 6;
  assert.match(validateQuoteExcelMapping(invalid).join(' '), /0 to 5/);
  invalid.body.spacing.mandatory = 1;
  invalid.body.categorySpacing.push({ category: ' deployment ', rows: 1 });
  assert.match(validateQuoteExcelMapping(invalid).join(' '), /unique names/);
});

test('quote-owned custom sections generate chapters, isolate category discounts, and use an independent Grand Total prototype', async () => {
  const data = input(4, true);
  data.pricing.lineGroups.s0.section = 'Design';
  data.pricing.lineGroups.s1.section = 'Rollout';
  data.pricing.lineGroups.s2.section = 'Design';
  data.pricing.lineGroups.s3.section = 'Enhancements';
  data.template.excel.body.styles.grandTotal = 28;
  const template = structuredClone(data.template);
  for (const mode of ['total', 'section', 'category']) {
    data.pricing = calculatePricing(320, {
      targetGrossMargin: 20,
      discount: 40,
      gstPercent: 0,
      lineGroups: data.pricing.lineGroups,
      discountAllocation: { mode },
    });
    const plan = structuredBodyRows(data, data.template.excel.body, {
      project: 'Campus',
    });
    assert.deepEqual(
      plan.filter((r) => r.role === 'chapter').map((r) => r.description),
      [
        'Design items for Campus',
        'Rollout items for Campus',
        'Enhancements items (excluded from mandatory total)',
      ],
    );
    assert.equal(plan.at(-1).amount, 360);
    assert.equal(plan.at(-1).role, 'grandTotal');
    plan
      .filter((r) => r.sum)
      .forEach((row) => {
        assert.equal(
          row.amount,
          Math.round(
            (row.sum.reduce((sum, i) => sum + plan[i].amount, 0) -
              (row.subtract === undefined ? 0 : plan[row.subtract].amount)) *
              100,
          ) / 100,
        );
      });
    const book = await output(data, (_book, sheet) => {
      sheet.getCell('C28').font = {
        name: 'Arial',
        size: 18,
        bold: true,
        color: { argb: 'FF008080' },
      };
      sheet.getCell('G28').numFmt = '"SGD "#,##0.000';
      sheet.getCell('G28').fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFABCDEF' },
      };
      sheet.getCell('G28').border = { top: { style: 'double' } };
      sheet.getRow(28).height = 38;
    });
    const row = book
      .getWorksheet('Quote')
      .getRow(data.template.excel.body.startRow + plan.length - 1);
    assert.equal(row.getCell(3).font.size, 18);
    assert.equal(row.getCell(3).font.color.argb, 'FF008080');
    assert.equal(row.getCell(7).numFmt, '"SGD "#,##0.000');
    assert.equal(row.getCell(7).fill.fgColor.argb, 'FFABCDEF');
    assert.equal(row.getCell(7).border.top.style, 'double');
    assert.equal(row.getCell(7).result, 360);
    assert.equal(row.height, 38);
    assert.deepEqual(data.template, template);
  }
  data.template.excel.body.styles.grandTotal = 99;
  assert.match(
    validateQuoteExcelMapping(data.template.excel).join(' '),
    /grandTotal style row must be inside/,
  );
});

test('heading spacing and named category end spacing occupy different positions and override rather than add', () => {
  const data = input(2);
  const body = data.template.excel.body;
  body.spacing = { chapterHeading: 1, category: 1 };
  body.categorySpacing = [{ category: 'Deployment', rows: 2 }];
  const plan = structuredBodyRows(data, body, { project: 'Campus' });
  assert.equal(plan[1].role, 'blank');
  const after = (text) => {
    let index = plan.findIndex((r) => r.description === text) + 1,
      count = 0;
    while (plan[index]?.role === 'blank') {
      index++;
      count++;
    }
    return count;
  };
  assert.equal(after('Professional Service Subtotal'), 1);
  assert.equal(after('Deployment Subtotal'), 2);
  body.categorySpacing[0].rows = 0;
  const without = structuredBodyRows(data, body, { project: 'Campus' });
  const index = without.findIndex(
    (r) => r.description === 'Deployment Subtotal',
  );
  assert.notEqual(without[index + 1].role, 'blank');
});

test('named section rules override old inclusion settings and same-name chapters merge in XLSX', async () => {
  const data = input(3);
  data.pricing.lineGroups = {
    s0: {
      section: 'Implementation',
      category: 'Service',
      inclusion: 'mandatory',
    },
    s1: {
      section: 'Implementation',
      category: 'Service',
      inclusion: 'optional',
    },
    s2: { section: 'Support', category: 'Maintenance', inclusion: 'optional' },
  };
  data.pricing.discountAllocation = { mode: 'section' };
  const body = data.template.excel.body;
  body.titles.section = '{section} heading';
  body.titles.sectionTotal = '{section} Total';
  body.spacing = { section: 1, mandatory: 5, optional: 5 };
  body.sectionSpacing = [
    { section: ' implementation ', rows: 2 },
    { section: 'Support', rows: 0 },
  ];
  assert.deepEqual(validateQuoteExcelMapping(data.template.excel), []);
  const plan = structuredBodyRows(data, body, {});
  assert.deepEqual(
    plan.filter((r) => r.role === 'chapter').map((r) => r.description),
    ['Implementation heading', 'Support heading'],
  );
  for (const [title, blanks, amount] of [
    ['Implementation Total', 2, 193.33],
    ['Support Total', 0, 96.67],
  ]) {
    const index = plan.findIndex((r) => r.description === title);
    assert.equal(plan[index].amount, amount);
    let count = 0;
    while (plan[index + count + 1]?.role === 'blank') count++;
    assert.equal(count, blanks);
  }
  assert.equal(plan.at(-1).amount, 290);
  const sheet = (await output(data)).getWorksheet('Quote');
  for (const title of [
    'Implementation heading',
    'Support heading',
    'Implementation Total',
    'Support Total',
  ]) {
    const index = plan.findIndex((r) => r.description === title);
    assert.ok(
      sheet
        .getRow(body.startRow + index)
        .values.some((value) => value === title),
      title,
    );
  }
  body.sectionSpacing.push({ section: 'Implementation', rows: 3 });
  assert.match(
    validateQuoteExcelMapping(data.template.excel).join(' '),
    /Section spacing requires unique names/,
  );
});

test('editing old section spacing exposes named exceptions without mutating the saved layout', () => {
  const body = input().template.excel.body;
  body.sectionNames = { mandatory: 'Deployment', optional: 'Support' };
  body.spacing = { chapterHeading: 1, category: 2, mandatory: 1, optional: 3 };
  const before = structuredClone(body);
  const editable = editableSectionLayout(body);
  assert.deepEqual(body, before);
  assert.deepEqual(editable.spacing, {
    chapterHeading: 1,
    category: 2,
    section: 1,
  });
  assert.deepEqual(editable.sectionSpacing, [{ section: 'Support', rows: 3 }]);
  assert.equal(editable.titles.section, '{section} items for {project}');
  assert.equal(editable.titles.sectionTotal, 'Total price for {section} items');
  assert.deepEqual(editableSectionLayout(editable), editable);
});
