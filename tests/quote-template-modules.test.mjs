import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { fillQuoteExcelTemplate } from '../features/quote/fill-excel-template.ts';
import { validateQuoteExcelMapping } from '../features/quote/excel-template-mapping.ts';
import { calculatePricing } from '../features/quote/domain.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { emptyMaintenance } from '../features/maintenance/domain.ts';

function mapping() {
  return {
    assetId: 'a'.repeat(64),
    fileName: 'test.xlsx',
    sheetName: 'Quote',
    detailRow: 12,
    columns: {
      number: 'B',
      description: 'C',
      unit: 'E',
      unitPrice: 'F',
      quantity: 'G',
      amount: 'H',
    },
    cells: { quoteBeforeTax: 'H31' },
    dateFormat: 'dd-mmm-yyyy',
    variables: {
      companyName: 'Sample Supplier',
      companyAddress: 'Sample Address',
    },
    textCells: [
      { address: 'B1', content: '{companyName} — {companyAddress}' },
      { address: 'B2', content: 'Date of quotation: {date}' },
      { address: 'B3', content: '{quoteNumber}: {client} / {project}' },
      {
        address: 'B4',
        content: 'Validity {validityDays} days. {paymentTerms}',
      },
      { address: 'B10', content: 'Mandatory items for {project}' },
      { address: 'B32', content: 'Total: {quoteBeforeTax}' },
    ],
    regions: [
      {
        source: 'service',
        startRow: 10,
        endRow: 15,
        detailRow: 12,
        detailEndRow: 14,
      },
      {
        source: 'maintenance',
        startRow: 17,
        endRow: 21,
        detailRow: 19,
        detailEndRow: 20,
      },
      {
        source: 'optional',
        startRow: 23,
        endRow: 27,
        detailRow: 25,
        detailEndRow: 26,
      },
    ],
  };
}
async function fixture(count = 1, withMaintenance = true) {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet('Quote');
  for (const row of [12, 13, 14, 19, 20, 25, 26]) {
    sheet.getCell(`C${row}`).value = 'OLD SAMPLE';
    sheet.getCell(`H${row}`).value = 999;
  }
  sheet.getCell('B10').value = 'Mandatory';
  sheet.getCell('B17').value = 'Maintenance';
  sheet.getCell('B23').value = 'Optional';
  sheet.mergeCells('C12:D12');
  sheet.getCell('C12').font = { bold: true };
  sheet.getRow(12).height = 28;
  sheet.getCell('H15').value = { formula: 'SUM(H12:H14)' };
  sheet.getCell('H21').value = { formula: 'SUM(H19:H20)' };
  sheet.getCell('H27').value = { formula: 'SUM(H25:H26)' };
  sheet.getCell('H30').value = { formula: 'SUM(H15,H21,H27)' };
  sheet.getCell('B33').value = 'Footer';
  sheet.pageSetup.printArea = 'B1:H33';
  book.addWorksheet('Summary').getCell('A1').value = { formula: `'Quote'!H30` };
  const bytes = await book.xlsx.writeBuffer();
  const input = {
    project: { id: 'P1', name: 'Project', client: 'Client', currency: 'SGD' },
    quoteNumber: 'QT-1',
    costVersion: 'V1',
    issuedAt: '2026-09-30T00:00:00Z',
    documentStatus: 'Draft',
    template: { ...initialQuoteTemplates[0], excel: mapping() },
    assumptions: [],
    pricing: calculatePricing(count * 80, {
      targetGrossMargin: 20,
      discount: 0,
      gstPercent: 0,
    }),
    lines: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`,
      description: `Service ${i + 1}`,
      unit: 'lot',
      quantity: 1,
      unitPrice: 100,
      amount: 100,
    })),
    maintenance: {
      ...emptyMaintenance(),
      startYear: 2027,
      boq: withMaintenance
        ? [
            {
              id: 'm1',
              model: 'Router',
              quantity: 2,
              ct: 30,
              spms: 10,
              durationYears: 2,
              unitAnnualQuote: 0,
              serviceLevel: '',
              site: '',
              referenceId: '',
              basis: '',
              source: 'manual',
            },
          ]
        : [],
    },
  };
  return { bytes, input };
}
for (const count of [1, 5])
  test(`module output resizes ${count} service rows, removes empty optional block and shifts footer references`, async () => {
    const { bytes, input } = await fixture(count),
      before = structuredClone(input),
      original = Buffer.from(bytes);
    const out = new ExcelJS.Workbook();
    await out.xlsx.load(await fillQuoteExcelTemplate(bytes, input));
    const sheet = out.getWorksheet('Quote'),
      delta = count - 3 - 1 - 5;
    assert.equal(sheet.getCell('B2').value, 'Date of quotation: 30-Sep-2026');
    assert.equal(sheet.getCell('B3').value, 'DRAFT-QT-1: Client / Project');
    assert.equal(sheet.getCell('B10').value, 'Mandatory items for Project');
    assert.equal(sheet.getCell(`H${31 + delta}`).value, count * 100 + 160);
    assert.equal(
      sheet.getCell(`B${32 + delta}`).value,
      `Total: ${count * 100 + 160}`,
    );
    assert.equal(sheet.getCell(`B${33 + delta}`).value, 'Footer');
    assert.equal(
      sheet.getCell(`H${30 + delta}`).formula,
      `SUM(H${15 + count - 3},H${21 + count - 3 - 1},0)`,
    );
    assert.equal(
      out.getWorksheet('Summary').getCell('A1').formula,
      `'Quote'!H${30 + delta}`,
    );
    assert.equal(sheet.pageSetup.printArea, `B1:H${33 + delta}`);
    assert.doesNotMatch(
      JSON.stringify(sheet.getSheetValues()),
      /OLD SAMPLE|Optional/,
    );
    for (let i = 0; i < count; i++) {
      assert.equal(sheet.getCell(`C${12 + i}`).value, `Service ${i + 1}`);
      assert.equal(sheet.getCell(`C${12 + i}`).font.bold, true);
      assert.equal(sheet.getCell(`D${12 + i}`).master.address, `C${12 + i}`);
    }
    assert.deepEqual(input, before);
    assert.deepEqual(Buffer.from(bytes), original);
  });
test('empty maintenance deletes its title and subtotal, preserving service-only total', async () => {
  const { bytes, input } = await fixture(1, false),
    book = new ExcelJS.Workbook();
  await book.xlsx.load(await fillQuoteExcelTemplate(bytes, input));
  assert.doesNotMatch(
    JSON.stringify(book.worksheets[0].getSheetValues()),
    /Maintenance|Optional|OLD SAMPLE/,
  );
  assert.equal(book.worksheets[0].getCell('H19').value, 100);
});
test('mapping validation accepts tokens as required fields and rejects overlapping rows, unknown tokens and collisions', () => {
  const value = mapping();
  assert.deepEqual(validateQuoteExcelMapping(value), []);
  value.textCells.push({ address: 'B8', content: '{internalCost}' });
  assert.match(
    validateQuoteExcelMapping(value).join(' '),
    /Unknown placeholder/,
  );
  value.textCells.pop();
  value.textCells.push({ address: 'C12', content: 'overwrites items' });
  assert.match(validateQuoteExcelMapping(value).join(' '), /repeated detail/);
  value.regions[1].startRow = 14;
  assert.match(validateQuoteExcelMapping(value).join(' '), /overlap/);
});
test('missing maintenance mapping and ambiguous sample-row formulas fail before exporting', async () => {
  const { bytes, input } = await fixture();
  input.template.excel.regions = input.template.excel.regions.filter(
    (r) => r.source !== 'maintenance',
  );
  await assert.rejects(
    () => fillQuoteExcelTemplate(bytes, input),
    /Map each quotation group.*maintenance/,
  );
  const fixture2 = await fixture();
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(fixture2.bytes);
  book.getWorksheet('Quote').getCell('H30').value = { formula: 'H13+H14' };
  const changed = await book.xlsx.writeBuffer();
  await assert.rejects(
    () => fillQuoteExcelTemplate(changed, fixture2.input),
    /individual sample items/,
  );
});

test('text tokens keep numeric zero, clear blanks, and use the Singapore quotation date', async () => {
  const { renderTemplateText, templateDate } =
    await import('../features/quote/template-text.ts');
  assert.equal(renderTemplateText('{amount}', { amount: 0 }), 0);
  assert.equal(renderTemplateText('', {}), null);
  assert.equal(renderTemplateText('{companyName}', { companyName: '' }), null);
  assert.equal(
    renderTemplateText('Total: {amount}', { amount: 125 }),
    'Total: 125',
  );
  const { input } = await fixture();
  input.issuedAt = '2026-09-30T17:00:00Z';
  assert.equal(templateDate(input), '01-Oct-2026');
  input.template.excel.dateFormat = 'yyyy-mm-dd';
  assert.equal(templateDate(input), '2026-10-01');
});

test('custom category and inclusion route each line once; Optional stays out of Mandatory total', async () => {
  const { bytes, input } = await fixture(3, false);
  input.pricing.lineGroups = {
    s0: { category: 'Implementation', inclusion: 'mandatory' },
    s1: { category: 'implementation', inclusion: 'optional' },
    s2: { category: 'Training', inclusion: 'mandatory' },
  };
  const regions = input.template.excel.regions;
  Object.assign(regions[0], {
    source: 'category',
    category: 'Implementation',
    inclusion: 'mandatory',
  });
  Object.assign(regions[1], {
    source: 'category',
    category: 'Training',
    inclusion: 'mandatory',
  });
  Object.assign(regions[2], {
    source: 'category',
    category: 'Implementation',
    inclusion: 'optional',
  });
  input.template.excel.textCells.push({
    address: 'B34',
    content: 'Options: {optionalPrice}',
  });
  assert.deepEqual(validateQuoteExcelMapping(input.template.excel), []);
  const { customerDocument } =
    await import('../features/quote/customer-document.ts');
  const doc = customerDocument(input);
  assert.equal(doc.total, 300);
  assert.equal(doc.mandatoryTotal, 200);
  assert.equal(doc.optionalAmount, 100);
  assert.deepEqual(
    doc.sections.map((s) => [s.category, s.inclusion]),
    [
      ['Implementation', 'mandatory'],
      ['Training', 'mandatory'],
      ['implementation', 'optional'],
    ],
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await fillQuoteExcelTemplate(bytes, input));
  const sheet = workbook.getWorksheet('Quote');
  const descriptions = [];
  sheet.eachRow((row) => {
    const v = row.getCell(3).value;
    if (typeof v === 'string' && v.startsWith('Service ')) descriptions.push(v);
  });
  assert.deepEqual(descriptions, ['Service 1', 'Service 3', 'Service 2']);
  assert.ok(JSON.stringify(sheet.getSheetValues()).includes('Options: 100'));
  input.template.excel.regions[2].category = 'Missing group';
  await assert.rejects(
    () => fillQuoteExcelTemplate(bytes, input),
    /Map each quotation group/,
  );
});

test('group settings validate before saving prices and do not change internal GP calculation', () => {
  const settings = { targetGrossMargin: 20, discount: 0, gstPercent: 0 };
  const before = calculatePricing(100, settings);
  const after = calculatePricing(100, {
    ...settings,
    lineGroups: { x: { category: 'Custom support', inclusion: 'optional' } },
  });
  assert.equal(after.quoteBeforeTax, before.quoteBeforeTax);
  assert.equal(after.grossMarginPercent, before.grossMarginPercent);
  assert.equal(after.lineGroups.x.category, 'Custom support');
  assert.equal(
    calculatePricing(100, {
      ...settings,
      lineGroups: { x: { category: '', inclusion: 'mandatory' } },
    }).valid,
    false,
  );
});

test('template regions accept more than three custom groups and reject ambiguous optional mappings', () => {
  const map = mapping();
  map.regions = Array.from({ length: 5 }, (_, i) => ({
    source: 'category',
    category: `Category ${i + 1}`,
    inclusion: 'mandatory',
    startRow: 40 + i * 5,
    detailRow: 41 + i * 5,
    detailEndRow: 42 + i * 5,
    endRow: 43 + i * 5,
  }));
  assert.deepEqual(validateQuoteExcelMapping(map), []);
  map.regions[1].category = 'Category 1';
  assert.match(validateQuoteExcelMapping(map).join(' '), /only once/);
  map.regions[1].category = 'Category 2';
  map.regions[1].inclusion = 'optional';
  map.regions[0].source = 'optional';
  assert.match(validateQuoteExcelMapping(map).join(' '), /not both/);
});
