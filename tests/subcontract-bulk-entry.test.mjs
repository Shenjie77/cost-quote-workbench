/** Subcontract imports use temporary values only; existing projects and catalog snapshots remain untouched. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appendSubcontractBulkLines,
  confirmSubcontractBulkPreview,
  parseSubcontractBulkEntry,
  subcontractBulkBasisFingerprint,
  subcontractBulkInputKey,
  subcontractBulkTemplate,
} from '../features/cost/subcontract-bulk-entry.ts';

const options = { defaultYear: 1, mapping: {} };
const basis = (extra = {}) => ({
  value: { mode: 'project', lines: [], siteTypes: [] },
  target: { kind: 'project' },
  catalog: [
    {
      id: 'catalog-a',
      code: 'SC-001',
      item: 'Install cable',
      bu: 'Network',
      unit: 'm',
      unitPrice: 25,
      currency: 'SGD',
      active: true,
    },
  ],
  actualYears: [2026, 2027, 2028, 2029, 2030],
  ...extra,
});
const parse = (text, changes = {}, current = basis()) =>
  parseSubcontractBulkEntry(text, { ...options, ...changes }, current);
const validText = 'Code\tQuantity\nSC-001\t2.5';

test('code or description plus quantity works without headers and normalizes only harmless text differences', () => {
  for (const text of [
    ' sc-001 \t2.5',
    ' ＳＣ-００１ \t2.5',
    ' install   CABLE \t2.5',
    'Description\tQuantity\nInstall cable\t2.5',
    'Description\tQuantity\ncable\t2.5',
    'Code Number\tQuantity\nSC-001\t2.5',
  ]) {
    const preview = parse(text);
    assert.equal(preview.canConfirm, true, JSON.stringify(preview));
    assert.equal(preview.lines[0].code, 'SC-001');
    assert.equal(preview.lines[0].description, 'Install cable');
    assert.equal(preview.lines[0].catalogItemId, 'catalog-a');
    assert.deepEqual(preview.lines[0].quantities, [0, 2.5, 0, 0, 0]);
  }
  const item = basis().catalog[0];
  const current = basis({
    catalog: [
      { ...item, code: '00123' },
      { ...item, id: 'second', code: 'SC001', item: 'Other cable' },
    ],
  });
  assert.equal(parse('00123\t2', {}, current).lines[0].code, '00123');
  assert.equal(parse('123\t2', {}, current).canConfirm, false);
  assert.equal(
    parse('Code\tQuantity\nSC-001\t2', {}, current).canConfirm,
    false,
  );
  // Valid quantities can look like calendar headers, and real codes can look like field names.
  assert.equal(parse('SC-001\t2026').lines[0].quantities[1], 2026);
  const headerNamedItem = basis({ catalog: [{ ...item, code: 'BU' }] });
  assert.equal(parse('BU\t2', {}, headerNamedItem).lines[0].code, 'BU');
});

test('unknown, inactive, ambiguous and conflicting identities cannot create manual base items', () => {
  const item = basis().catalog[0];
  const current = basis({
    catalog: [
      item,
      { ...item, id: 'b', code: 'SC-002', item: 'Install cable in rack' },
      {
        ...item,
        id: 'old',
        code: 'OLD',
        item: 'Legacy retired item',
        active: false,
      },
    ],
  });
  const exact = parse('Description\tQuantity\nInstall cable\t2', {}, current);
  assert.equal(exact.canConfirm, true);
  assert.equal(exact.lines[0].code, 'SC-001');
  for (const text of [
    'Description\tQuantity\ncable\t2',
    'Description\tQuantity\nMissing item\t2',
    'OLD\t2',
    'Code\tDescription\tQuantity\nSC-001\tUnrelated description\t2',
    'Code\tItem\tQuantity\nSC-001\tSC-002\t2',
    'Description\tItem\tQuantity\nInstall cable\tSC-002\t2',
    'Code\tDescription\tBU\tUnit\tUnit Price\tQuantity\nNEW\tNew item\tNetwork\tm\t1\t2',
  ]) {
    const preview = parse(text, {}, current);
    assert.equal(preview.canConfirm, false, text);
    assert.equal(preview.lines.length, 0);
    assert.ok(
      preview.entries.some((entry) =>
        entry.issues.some((issue) => issue.includes('Master Data')),
      ),
    );
  }
  const duplicateDescription = basis({
    catalog: [item, { ...item, id: 'duplicate', code: 'SC-002' }],
  });
  assert.equal(
    parse('Description\tQuantity\nInstall cable\t1', {}, duplicateDescription)
      .canConfirm,
    false,
  );
  assert.equal(parse('SC-002\t1', {}, duplicateDescription).canConfirm, true);
  const inactiveCode = basis({
    catalog: [
      { ...item, code: 'ROUTER', active: false },
      { ...item, id: 'active-cable', code: 'CABLE', item: 'Router cabling' },
    ],
  });
  assert.equal(parse('ROUTER\t2', {}, inactiveCode).canConfirm, false);
  assert.equal(
    parse('Description\tQuantity\nRouter cabling\t2', {}, inactiveCode)
      .canConfirm,
    true,
  );
});

test('catalog codes supply all master attributes and pasted metadata cannot override them', () => {
  const current = basis();
  const before = structuredClone(current);
  const preview = parse(validText, {}, current);
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.deepEqual(preview.lines[0].quantities, [0, 2.5, 0, 0, 0]);
  assert.equal(preview.lines[0].catalogItemId, 'catalog-a');
  assert.equal(preview.lines[0].description, 'Install cable');
  assert.equal(preview.totalCost, 62.5);
  const override = parse(
    'Code\tDescription\tBU\tUnit\tUnit Price\tCurrency\tY1\t2028 Quantity\nSC-001\tInstall cable\tOther\tjob\t0\tUSD\t2\t3',
  );
  assert.equal(override.canConfirm, true, JSON.stringify(override));
  assert.equal(override.lines[0].unitPrice, 25);
  assert.equal(override.lines[0].bu, 'Network');
  assert.equal(override.lines[0].unit, 'm');
  assert.equal(override.lines[0].currency, 'SGD');
  assert.equal(override.lines[0].description, 'Install cable');
  assert.equal(
    override.notices.filter((notice) =>
      notice.includes('supplied by Master Data'),
    ).length,
    4,
  );
  assert.deepEqual(override.lines[0].quantities, [2, 0, 3, 0, 0]);
  assert.deepEqual(current, before);
});

test('minimal templates adopt master items for project and per-site quantities without changing deployments', () => {
  for (const target of [{ kind: 'project' }, { kind: 'site', id: 'site-a' }]) {
    const current = basis({
      value: {
        mode: 'site-types',
        lines: [],
        siteTypes: [
          {
            id: 'site-a',
            name: 'Small',
            sites: target.kind === 'site' ? [2, 3, 0, 0, 0] : [0, 0, 0, 0, 0],
            lines: [],
          },
        ],
      },
      target,
    });
    const preview = parse(subcontractBulkTemplate(target, true), {}, current);
    assert.equal(preview.canConfirm, true, JSON.stringify(preview));
    const next = appendSubcontractBulkLines(
      current.value,
      preview.lines,
      target,
    );
    assert.deepEqual(next.siteTypes[0].sites, current.value.siteTypes[0].sites);
    assert.equal(current.value.lines.length, 0);
    assert.equal(current.value.siteTypes[0].lines.length, 0);
    if (target.kind === 'site') {
      assert.equal(next.siteTypes[0].lines[0].quantityPerSite, 2);
      assert.equal(preview.totalCost, 250);
    } else assert.deepEqual(next.lines[0].quantities, [2, 0, 0, 0, 0]);
  }
});

test('description-only CSV and Markdown copy master prices including explicit zero and unpriced values', () => {
  const item = basis().catalog[0];
  const preview = parse(
    'Description,Quantity\n"Install, cable",2\nTesting,0\nFree test,3',
    {},
    basis({
      catalog: [
        {
          ...item,
          id: 'x',
          code: 'X',
          item: 'Install, cable',
          unitPrice: 1200.25,
        },
        { ...item, id: 'y', code: 'Y', item: 'Testing', unitPrice: null },
        { ...item, id: 'z', code: 'Z', item: 'Free test', unitPrice: 0 },
      ],
    }),
  );
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.equal(preview.totalCost, 2400.5);
  assert.equal(preview.lines[0].description, 'Install, cable');
  assert.equal(preview.lines[1].unitPrice, null);
  assert.equal(preview.lines[2].unitPrice, 0);
  assert.ok(
    preview.notices.some((message) => message.includes('price remains blank')),
  );
  const markdown = parse('| Code | Quantity |\n| --- | --- |\n| SC-001 | 4 |');
  assert.equal(markdown.canConfirm, true, JSON.stringify(markdown));
  assert.equal(markdown.totalCost, 100);
});

test('bad quantities, formulas, non-SGD prices, duplicate mappings and unknown years block the entire batch', () => {
  const cases = [
    'Code\tQuantity\nSC-001\t-1',
    'Code\tQuantity\nSC-001\t=2+2',
    'Code\tQuantity\tY2\nSC-001\t1\t2',
    'Code\t2031\nSC-001\t1',
    'Code\tQuantity\nSC-001\t',
    'Code\tQuantity\nUnknown\t1',
    'Code\tQuantity\nSC-001\t1\textra',
  ];
  for (const input of cases)
    assert.equal(parse(input).canConfirm, false, input);
  for (const invalid of [
    { unit: 'pcs' },
    { currency: 'USD' },
    { unitPrice: NaN },
    { bu: '' },
    { unit: '' },
    { active: false },
  ]) {
    const current = basis();
    current.catalog[0] = { ...current.catalog[0], ...invalid };
    assert.equal(
      parse(validText, {}, current).canConfirm,
      false,
      JSON.stringify(invalid),
    );
  }
  const remapped = parse('Code\t2031\nSC-001\t1', {
    mapping: { 1: 'quantity:4' },
  });
  assert.equal(remapped.canConfirm, true);
  assert.deepEqual(remapped.lines[0].quantities, [0, 0, 0, 0, 1]);
});

test('target mismatches, ambiguous catalog codes and over-limit input never create a partial append', () => {
  const current = basis();
  assert.equal(
    parse(
      validText,
      {},
      {
        ...current,
        catalog: [...current.catalog, { ...current.catalog[0], id: 'second' }],
      },
    ).canConfirm,
    false,
  );
  assert.equal(
    parse(
      validText,
      {},
      { ...current, target: { kind: 'site', id: 'missing' } },
    ).canConfirm,
    false,
  );
  assert.equal(parse(validText + ' '.repeat(1_000_001)).canConfirm, false);
  assert.equal(
    parse('Code\tQuantity\n' + 'SC-001\t1\n'.repeat(1001)).canConfirm,
    false,
  );
  assert.throws(
    () =>
      appendSubcontractBulkLines(
        current.value,
        [{ quantityPerSite: 1 }],
        current.target,
      ),
    /annual quantities/,
  );
  assert.throws(
    () =>
      appendSubcontractBulkLines(current.value, [], {
        kind: 'site',
        id: 'gone',
      }),
    /no longer available/,
  );
});

test('independent annual rate adjustments affect preview and the complete combined cost is validated', () => {
  const current = basis({
    value: {
      mode: 'project',
      lines: [],
      siteTypes: [],
      rateSettings: {
        baseYear: 2025,
        defaultUplift: 10,
        annualUplifts: [10, 10, 10, 10, 10],
      },
    },
  });
  const preview = parse('Code\tY1\tY2\nSC-001\t2\t2', {}, current);
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.equal(preview.totalCost, 115.5);
  const overflow = parse(
    'Code\tQuantity\nSC-001\t2',
    {},
    basis({ catalog: [{ ...basis().catalog[0], unitPrice: 1e12 }] }),
  );
  assert.equal(overflow.canConfirm, false);
  assert.ok(overflow.issues.some((issue) => issue.includes('amount range')));
});

test('confirmation rejects changes to input, target, BOQ, catalog, years or rates and honors locks', () => {
  const current = basis();
  const preview = parse(validText, {}, current);
  const key = subcontractBulkInputKey(validText, options, current);
  let calls = 0;
  const attempt = (extra = {}) =>
    confirmSubcontractBulkPreview({
      preview,
      currentKey: key,
      previewKey: key,
      basis: current,
      onConfirm: () => {
        calls++;
        return true;
      },
      announce: () => {},
      ...extra,
    });
  assert.equal(attempt({ currentKey: key + 'changed' }), false);
  assert.equal(attempt({ locked: true }), false);
  for (const changed of [
    { ...current, actualYears: [2027, 2028, 2029, 2030, 2031] },
    { ...current, target: { kind: 'site', id: 'other' } },
    { ...current, catalog: [] },
    {
      ...current,
      value: {
        ...current.value,
        rateSettings: {
          baseYear: 2025,
          defaultUplift: 3,
          annualUplifts: [3, 3, 3, 3, 3],
        },
      },
    },
    { ...current, value: { ...current.value, lines: preview.lines } },
  ])
    assert.equal(attempt({ basis: changed }), false);
  assert.equal(calls, 0);
  assert.equal(attempt(), true);
  assert.equal(calls, 1);
});

test('confirmed batches receive new IDs and preserve repeated codes as separate quoted scope items', () => {
  const current = basis();
  const text = validText + '\nSC-001\t3';
  const preview = parse(text, {}, current);
  const before = structuredClone(preview);
  const key = subcontractBulkInputKey(text, options, current);
  let result;
  assert.equal(
    confirmSubcontractBulkPreview({
      preview,
      currentKey: key,
      previewKey: key,
      basis: current,
      onConfirm: (lines, fingerprint) => {
        assert.equal(fingerprint, subcontractBulkBasisFingerprint(current));
        result = appendSubcontractBulkLines(
          current.value,
          lines,
          current.target,
        );
        return true;
      },
      announce: () => {},
    }),
    true,
  );
  assert.equal(result.lines.length, 2);
  assert.notEqual(result.lines[0].id, result.lines[1].id);
  assert.match(result.lines[0].id, /^SC-[0-9a-f-]{36}$/);
  assert.deepEqual(result.lines[1].quantities, [0, 3, 0, 0, 0]);
  assert.deepEqual(preview, before);
  assert.deepEqual(current.value.lines, []);
});
