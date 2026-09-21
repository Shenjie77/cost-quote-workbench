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

const options = { defaultYear: 1, defaultBU: '', mapping: {} };
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

test('catalog code imports copy saved values, allocate default year and retain explicit overrides', () => {
  const current = basis();
  const before = structuredClone(current);
  const preview = parse(validText, {}, current);
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.deepEqual(preview.lines[0].quantities, [0, 2.5, 0, 0, 0]);
  assert.equal(preview.lines[0].catalogItemId, 'catalog-a');
  assert.equal(preview.lines[0].description, 'Install cable');
  assert.equal(preview.totalCost, 62.5);
  const override = parse(
    'Code\tDescription\tBU\tUnit\tUnit Price\tY1\t2028 Quantity\nSC-001\tNew scope\tOther\tjob\t0\t2\t3',
  );
  assert.equal(override.canConfirm, true, JSON.stringify(override));
  assert.equal(override.lines[0].unitPrice, 0);
  assert.equal(override.lines[0].description, 'New scope');
  assert.deepEqual(override.lines[0].quantities, [2, 0, 3, 0, 0]);
  assert.deepEqual(current, before);
});

test('templates support manual project and per-site quantities without changing deployments', () => {
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
      catalog: [],
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

test('quoted CSV, Markdown, manual unpriced values and grouped prices are read without numeric coercion', () => {
  const preview = parse(
    'Code,Description,BU,Unit,Unit Price,Quantity\nX,"Install, cable",Network,m,"1,200.25",2\nY,Testing,Network,job,,0',
    {},
    basis({ catalog: [] }),
  );
  assert.equal(preview.canConfirm, true, JSON.stringify(preview));
  assert.equal(preview.totalCost, 2400.5);
  assert.equal(preview.lines[0].description, 'Install, cable');
  assert.equal(preview.lines[1].unitPrice, null);
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
    'Code\tQuantity\tUnit\nSC-001\t1.5\tpcs',
    'Code\tQuantity\tCurrency\nSC-001\t1\tUSD',
    'Code\tQuantity\tY2\nSC-001\t1\t2',
    'Code\t2031\nSC-001\t1',
    'Code\tQuantity\nSC-001\t',
    'Code\tQuantity\nUnknown\t1',
    'Code\tQuantity\nSC-001\t1\textra',
    'Code\tQuantity\tUnit Price\nSC-001\t1\tNaN',
  ];
  for (const input of cases)
    assert.equal(parse(input).canConfirm, false, input);
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
    'Code\tDescription\tBU\tUnit\tUnit Price\tQuantity\nHUGE\tLarge\tNetwork\tjob\t1000000000000\t2',
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
