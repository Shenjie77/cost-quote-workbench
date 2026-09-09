import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parsePersonnelBulkEntry,
  personnelBulkBasisFingerprint,
  matchPersonnelBulkResource,
  PERSONNEL_BULK_LIMITS,
} from '../features/cost/personnel-bulk-entry.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { initialRateSettings } from '../features/cost/demo-data.ts';
import { recalculateCostRows } from '../features/cost/domain.ts';

const resources = structuredClone(initialResourceTypes);
const rates = {
  ...initialRateSettings,
  tdStart: '2026-01-01',
  baseYear: 2026,
  annualUplifts: [0, 5, 5, 5, 5],
  allowancePools: ['LOCAL'],
};
const options = (extra = {}) => ({
  resources,
  rates,
  defaultMode: 'sites',
  defaultYear: 0,
  ...extra,
});
const errors = (preview) =>
  [...preview.issues, ...preview.entries.flatMap((entry) => entry.issues)].join(
    '\n',
  );

test('Group aliases produce independent optional grouping labels without changing Scope or calculated cost', () => {
  const base = 'Scope\tBU\tRE Type\tMD\nDeployment\tNetwork\tLOCAL-L1\t2';
  const ungrouped = parsePersonnelBulkEntry(base, options());
  assert.equal(ungrouped.canConfirm, true, errors(ungrouped));
  assert.equal(Object.hasOwn(ungrouped.rows[0], 'groupName'), false);
  for (const header of ['Group', 'Group Name', '分组', '组名']) {
    const preview = parsePersonnelBulkEntry(
      `${header}\t${base.replace('\n', '\n  Branch A  \t')}`,
      options(),
    );
    assert.equal(preview.canConfirm, true, errors(preview));
    assert.equal(preview.rows[0].groupName, 'Branch A');
    assert.equal(preview.rows[0].scope, 'Deployment');
    assert.deepEqual(preview.rows[0].years, ungrouped.rows[0].years);
    assert.equal(preview.totalCost, ungrouped.totalCost);
  }
});

test('Group fill-down is explicitly enabled and remains independent of Scope fill-down', () => {
  const text =
    'Group\tScope\tBU\tRE Type\tMD\nSite A\tDesign\tBU\tLOCAL-L1\t2\n\tDeploy\tBU\tLOCAL-L1\t3\nsite a\t\tBU\tLOCAL-L1\t1';
  const ordinary = parsePersonnelBulkEntry(text, options());
  assert.equal(ordinary.canConfirm, true, errors(ordinary));
  assert.deepEqual(
    ordinary.rows.map((row) => row.groupName),
    ['Site A', '', 'site a'],
  );
  assert.deepEqual(
    ordinary.rows.map((row) => row.scope),
    ['Design', 'Deploy', 'Deploy'],
  );
  assert.doesNotMatch(ordinary.notices.join('\n'), /Group filled down/);
  const filled = parsePersonnelBulkEntry(
    text,
    options({ fillDownGroup: true }),
  );
  assert.equal(filled.canConfirm, true, errors(filled));
  assert.deepEqual(
    filled.rows.map((row) => row.groupName),
    ['Site A', 'Site A', 'site a'],
  );
  assert.match(filled.notices.join('\n'), /Row 3: Group filled down/);
  assert.equal(filled.totalCost, ordinary.totalCost);
  const noScopeFill = parsePersonnelBulkEntry(
    text,
    options({ fillDownGroup: true, fillDownScope: false }),
  );
  assert.equal(noScopeFill.canConfirm, false);
  assert.equal(noScopeFill.entries[2].scope, '');
  assert.equal(noScopeFill.entries[2].groupName, 'site a');
  const long = parsePersonnelBulkEntry(
    `Group\tScope\tBU\tRE Type\tMD\n${'G'.repeat(201)}\tWork\tBU\tLOCAL-L1\t2`,
    options(),
  );
  assert.equal(long.canConfirm, false);
  assert.match(errors(long), /Group must be at most 200/);
});

test('Excel TSV fills merged Scope, reports skipped totals, and recalculates five-year cost with Pool allowance', () => {
  const text =
    'Scope\tBU\tRE Type\tMD/Site\tY1 Sites\tY2_Sites\tY1 Cost\nRouter rollout\tNetwork\tLOCAL-L2\t2\t10\t5\t999999\n\tPMO\tHQ L2\t1.5\t2\t0\t888888\nTotal\t\t\t\t12\t5\t1888887';
  const preview = parsePersonnelBulkEntry(text, options());
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[1].scope, 'Router rollout');
  assert.equal(preview.rows[0].years[0].cost, 15450);
  assert.equal(preview.rows[0].years[1].cost, 8111.25);
  assert.equal(preview.rows[1].years[0].cost, 6600);
  assert.equal(preview.totalCost, 30161.25);
  assert.deepEqual(
    preview.rows[0].years.map((year) => year.bucket),
    ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'],
  );
  assert.ok(preview.rows.every((row) => !('source' in row)));
  assert.match(preview.notices.join('\n'), /Scope filled down/);
  assert.match(preview.notices.join('\n'), /summary row.*skipped/);
  assert.match(preview.notices.join('\n'), /Y1 Cost.*ignored/);
});

test('quoted CSV preserves commas, escaped quotes and multiline Scope while actual years map to delivery years', () => {
  const text =
    'Scope,BU,RE Type,2027 MD,2030 MD\n"Design, ""core""\nphase",Cloud,rt-hq-l1,2.5,1';
  const preview = parsePersonnelBulkEntry(text, options());
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.equal(preview.rows[0].scope, 'Design, "core"\nphase');
  assert.equal(preview.rows[0].inputMode, 'mandays');
  assert.equal(preview.rows[0].mdPerSite, 0);
  assert.deepEqual(
    preview.rows[0].years.map((year) => year.mandays),
    [0, 2.5, 0, 0, 1],
  );
  assert.equal(preview.rows[0].years[1].cost, 4725);
  assert.equal(preview.rows[0].years[4].cost, 2187.92);
});

test('Chinese Markdown and generic MD use the selected default year without losing fractional effort', () => {
  const preview = parsePersonnelBulkEntry(
    '| 工作范围 | 业务单元 | 人员类型 | 人天 | 成本 |\n| --- | --- | --- | ---: | ---: |\n| 远程支持 | 服务 | local l1 | 1.25 | 1 |',
    options({ defaultYear: 3 }),
  );
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.deepEqual(
    preview.rows[0].years.map((year) => year.mandays),
    [0, 0, 0, 1.25, 0],
  );
  assert.match(preview.notices.join('\n'), /Markdown separator/);
  assert.match(preview.notices.join('\n'), /成本.*ignored/);
});

test('missing columns use explicit defaults and plain Y1–Y5 follow default input mode', () => {
  const preview = parsePersonnelBulkEntry(
    'Scope\tY1\tY5\nSupport\t3.25\t0',
    options({
      defaultBU: 'Service',
      defaultRETypeId: 'rt-local-l1',
      defaultMode: 'mandays',
    }),
  );
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.equal(preview.rows[0].bu, 'Service');
  assert.equal(preview.rows[0].reTypeId, 'rt-local-l1');
  assert.equal(preview.rows[0].years[0].mandays, 3.25);
  const zero = parsePersonnelBulkEntry(
    'Scope\tMD\nFuture\t0',
    options({ defaultBU: 'Service', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(zero.canConfirm, true, errors(zero));
  assert.equal(zero.totalCost, 0);
  const missing = parsePersonnelBulkEntry(
    'Scope\tMD\nFuture\t',
    options({ defaultBU: 'Service', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(missing.canConfirm, false);
  assert.match(errors(missing), /Enter at least one annual/);
});

test('unknown and ambiguous RE Types remain unresolved until an explicit row selection', () => {
  const ambiguousResources = [
    ...resources,
    {
      ...resources.find((resource) => resource.id === 'rt-local-l1'),
      id: 'another-local',
      code: 'DIFFERENT',
      name: 'Local L1',
    },
  ];
  assert.equal(
    matchPersonnelBulkResource(' Local L1 ', ambiguousResources).ambiguous,
    true,
  );
  assert.equal(
    matchPersonnelBulkResource('rt-local-l1', ambiguousResources).resource.id,
    'rt-local-l1',
  );
  const text =
    'Scope\tBU\tRE Type\tMD\nSupport\tService\tLocal L1\t2\nInstall\tService\tNot known\t3';
  const preview = parsePersonnelBulkEntry(
    text,
    options({ resources: ambiguousResources }),
  );
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.rows.length, 0);
  assert.match(errors(preview), /ambiguous/);
  assert.match(errors(preview), /Not known/);
  const fixed = parsePersonnelBulkEntry(
    text,
    options({
      resources: ambiguousResources,
      reTypeOverrides: { 2: 'rt-local-l1', 3: 'rt-hq-l1' },
    }),
  );
  assert.equal(fixed.canConfirm, true, errors(fixed));
  const inactive = resources.map((resource) => ({
    ...resource,
    active: resource.id !== 'rt-local-l1',
  }));
  assert.equal(
    matchPersonnelBulkResource('LOCAL-L1', inactive).resource,
    undefined,
  );
  assert.equal(
    matchPersonnelBulkResource('SUBCON', resources).resource,
    undefined,
  );
  const collisionResources = [
    ...resources,
    {
      ...resources[0],
      id: 'collision',
      code: 'rt-local-l1',
      name: 'Alias collision',
    },
  ];
  const explicit = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nTask\tBU\tUnknown\t2',
    options({
      resources: collisionResources,
      reTypeOverrides: { 2: 'rt-local-l1' },
    }),
  );
  assert.equal(explicit.canConfirm, true, errors(explicit));
  assert.equal(explicit.rows[0].reTypeId, 'rt-local-l1');
  const defaulted = parsePersonnelBulkEntry(
    'Scope\tBU\tMD\nTask\tBU\t2',
    options({ resources: collisionResources, defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(defaulted.canConfirm, true, errors(defaulted));
  assert.equal(defaulted.rows[0].reTypeId, 'rt-local-l1');
});

test('unknown columns and duplicate or ambiguous year mappings require deliberate correction', () => {
  const text = 'Task\tBusiness\tRole\tEffort\nInstall\tService\tLOCAL-L1\t5';
  const unknown = parsePersonnelBulkEntry(text, options());
  assert.equal(unknown.canConfirm, false);
  const fixed = parsePersonnelBulkEntry(
    text,
    options({ mapping: { 0: 'scope', 1: 'bu', 2: 'reType', 3: 'mandays:1' } }),
  );
  assert.equal(fixed.canConfirm, true, errors(fixed));
  const duplicate = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tY1 MD\t2026 MD\nTask\tBU\tLOCAL-L1\t3\t4',
    options(),
  );
  assert.equal(duplicate.canConfirm, false);
  assert.match(errors(duplicate), /Duplicate mapping/);
  const ambiguous = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tY1 Y2 MD\nTask\tBU\tLOCAL-L1\t3',
    options(),
  );
  assert.equal(ambiguous.canConfirm, false);
  assert.match(errors(ambiguous), /Ambiguous year/);
  const outside = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\t2032 MD\nTask\tBU\tLOCAL-L1\t3',
    options(),
  );
  assert.equal(outside.canConfirm, false);
  assert.match(errors(outside), /outside this version/);
});

test('negative, fractional Sites, currency, excess values and malformed rows block the whole batch', () => {
  for (const value of [
    '-1',
    '0.5',
    '1000001',
    'SGD 200',
    '1,5',
    'NaN',
    'Infinity',
    '=1+2',
  ]) {
    const preview = parsePersonnelBulkEntry(
      `Scope\tBU\tRE Type\tMD/Site\tY1 Sites\nValid\tBU\tLOCAL-L1\t2\t1\nInvalid\tBU\tLOCAL-L1\t2\t${value}`,
      options(),
    );
    assert.equal(preview.canConfirm, false, value);
    assert.equal(preview.entries.length, 2);
    assert.equal(preview.rows.length, 1);
    assert.match(errors(preview), /whole number/, value);
  }
  const extra = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nTask\tBU\tLOCAL-L1\t2\textra',
    options(),
  );
  assert.equal(extra.canConfirm, false);
  assert.match(errors(extra), /extra cells/);
  const quote = parsePersonnelBulkEntry(
    'Scope,BU,RE Type,MD\n"Unclosed,BU,LOCAL-L1,2',
    options(),
  );
  assert.equal(quote.canConfirm, false);
  assert.match(errors(quote), /quotation marks/);
});

test('pasted money never becomes effort or cost, including attempted manual remapping', () => {
  const preview = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tCost\nTask\tBU\tLOCAL-L1\t3000',
    options({ mapping: { 3: 'mandays:0' } }),
  );
  assert.equal(preview.canConfirm, false);
  assert.equal(preview.columns[3].target, 'ignore');
  assert.match(errors(preview), /Cost-only amounts/);
  assert.equal(preview.rows.length, 0);
  const prorated = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tY1 Prorated MD\tY2 MD\nTask\tBU\tLOCAL-L1\t10\t20',
    options(),
  );
  assert.equal(prorated.canConfirm, false);
  assert.equal(prorated.columns[3].target, 'unmapped');
  assert.match(errors(prorated), /Map column.*Prorated MD/);
  const mapped = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tY1 Prorated MD\tY2 MD\nTask\tBU\tLOCAL-L1\t10\t20',
    options({ mapping: { 3: 'mandays:0' } }),
  );
  assert.equal(mapped.canConfirm, true, errors(mapped));
  assert.equal(mapped.rows[0].years[0].mandays, 10);
});

test('a pasted sites/MD cross-check must reconcile and mixed allocation cannot be silently discarded', () => {
  const text =
    'Scope\tBU\tRE Type\tMD/Site\tY1 Sites\tY1 MD\nTask\tBU\tLOCAL-L1\t2\t3\t6';
  const good = parsePersonnelBulkEntry(text, options());
  assert.equal(good.canConfirm, true, errors(good));
  const bad = parsePersonnelBulkEntry(
    text.replace('\t3\t6', '\t3\t7'),
    options(),
  );
  assert.equal(bad.canConfirm, false);
  assert.match(errors(bad), /does not match/);
  const direct = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMode\tMD/Site\tMD\nTask\tBU\tLOCAL-L1\tDirect MD\t2\t6',
    options(),
  );
  assert.equal(direct.canConfirm, false);
  assert.match(errors(direct), /cannot also contain MD\/Site/);
});

test('headerless and simple spaced tables can be mapped explicitly without dropping data', () => {
  const preview = parsePersonnelBulkEntry(
    'Rollout\tService\tLOCAL-L1\t4\nMigration\tService\tHQ-L1\t2',
    options({
      hasHeader: false,
      mapping: { 0: 'scope', 1: 'bu', 2: 'reType', 3: 'mandays' },
    }),
  );
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.equal(preview.rows.length, 2);
  const spaced = parsePersonnelBulkEntry(
    'Scope  BU  RE Type  MD\nRemote support  Service  LOCAL-L1  1.5',
    options(),
  );
  assert.equal(spaced.canConfirm, true, errors(spaced));
  assert.equal(spaced.rows[0].scope, 'Remote support');
  const disabledFill = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nTask\tBU\tLOCAL-L1\t2\n\tBU\tLOCAL-L1\t3',
    options({ fillDownScope: false }),
  );
  assert.equal(disabledFill.canConfirm, false);
  assert.match(errors(disabledFill), /Scope is required/);
});

test('bounded input fails clearly and basis changes when version rates or allowance change', () => {
  const emptyCells = parsePersonnelBulkEntry('|||', options());
  assert.equal(emptyCells.canConfirm, false);
  assert.match(errors(emptyCells), /No personnel table cells/);
  const tooLong = parsePersonnelBulkEntry(
    'x'.repeat(PERSONNEL_BULK_LIMITS.characters + 1),
    options(),
  );
  assert.match(errors(tooLong), /1,000,000 characters/);
  const tooMany = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\n' +
      Array.from({ length: 1001 }, () => 'Task\tBU\tLOCAL-L1\t1').join('\n'),
    options(),
  );
  assert.equal(tooMany.canConfirm, false);
  assert.match(errors(tooMany), /1,000 data rows/);
  const before = personnelBulkBasisFingerprint(resources, rates);
  assert.equal(
    before,
    personnelBulkBasisFingerprint([...resources].reverse(), { ...rates }),
  );
  assert.notEqual(
    before,
    personnelBulkBasisFingerprint(resources, { ...rates, allowancePools: [] }),
  );
  assert.notEqual(
    before,
    personnelBulkBasisFingerprint(
      resources.map((resource) => ({
        ...resource,
        mandayRate: resource.mandayRate + 1,
      })),
      rates,
    ),
  );
  const preview = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nTask\tBU\tLOCAL-L1\t1',
    options(),
  );
  assert.deepEqual(
    preview.rows,
    recalculateCostRows(preview.rows, resources, rates),
  );
  assert.equal(preview.basisFingerprint, before);
});
