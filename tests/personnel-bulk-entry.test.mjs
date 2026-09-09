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

test('Fenced Markdown tables recognize decorated headers without rewriting business text or numeric cells', () => {
  for (const fence of ['```markdown', '```md', '```', '~~~markdown']) {
    const closing = fence.startsWith('~') ? '~~~' : '```';
    const text = `${fence}\n| **Group** | __Scope__ | \`BU\` | **\`RE Type\`** | **Y1** \`MD\` | \`Cost\` |\n| --- | :--- | --- | --- | ---: | ---: |\n| **North** | \`Deploy router\` | Network | LOCAL-L1 | 2 MD | 9999 |\n${closing}`;
    const preview = parsePersonnelBulkEntry(text, options());
    assert.equal(preview.canConfirm, true, `${fence}: ${errors(preview)}`);
    assert.equal(preview.rows[0].groupName, '**North**');
    assert.equal(preview.rows[0].scope, '`Deploy router`');
    assert.equal(preview.rows[0].years[0].mandays, 2);
    assert.equal(preview.entries[0].sourceRow, 4);
    assert.match(preview.notices.join('\n'), /Markdown code fence removed/);
    assert.match(preview.notices.join('\n'), /Markdown separator ignored/);
    assert.match(preview.notices.join('\n'), /Cost.*ignored/);
  }
  const invalidNumber = parsePersonnelBulkEntry(
    '| **Scope** | **MD** |\n| --- | --- |\n| Work | `2 MD` |',
    options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(
    invalidNumber.canConfirm,
    false,
    'Formatting removal must never rewrite numeric business values.',
  );
  const unclosed = parsePersonnelBulkEntry(
    '```md\n| Scope | MD |\n| Work | 2 |',
    options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(unclosed.canConfirm, false);
  assert.match(errors(unclosed), /fence is not closed/);
  const financial = parsePersonnelBulkEntry(
    '| **Scope** | **Co**st |\n| Work | 999 |',
    options({
      defaultBU: 'BU',
      defaultRETypeId: 'rt-local-l1',
      mapping: { 1: 'mandays' },
    }),
  );
  assert.equal(financial.columns[1].target, 'ignore');
  assert.equal(financial.canConfirm, false);
});

test('MD headers and explicit unit values recognize English, Chinese, bilingual labels and safe thousands', () => {
  for (const heading of [
    'MD',
    'Man-days',
    'Man day',
    '人天',
    'MD / 人天',
    'Man-days（人天）',
  ]) {
    const preview = parsePersonnelBulkEntry(
      `Scope / 工作范围\tBU / 业务单元\tRE Type / 资源类型\t${heading}\nSupport\tBU\tLOCAL-L1\t1 MD\nInstall\tBU\tLOCAL-L1\t3days\nTest\tBU\tLOCAL-L1\t3天\nMigration\tBU\tLOCAL-L1\t1,000.5 man-days\nPlan\tBU\tLOCAL-L1\t1\u202f000 人天`,
      options(),
    );
    assert.equal(preview.canConfirm, true, `${heading}: ${errors(preview)}`);
    assert.deepEqual(
      preview.rows.map((row) => row.years[0].mandays),
      [1, 3, 3, 1000.5, 1000],
    );
    assert.ok(preview.rows.every((row) => row.inputMode === 'mandays'));
  }
  const annual = parsePersonnelBulkEntry(
    'Scope\tY1 MD / 人天\t2027年 Man-day\nWork\t1 MD\t2.5 days',
    options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(annual.canConfirm, true, errors(annual));
  assert.deepEqual(
    annual.rows[0].years.map((year) => year.mandays),
    [1, 2.5, 0, 0, 0],
  );
  const paired = parsePersonnelBulkEntry(
    'Scope\tY1 · 2026 MD\tY2 (2027) 人天\nWork\t1\t2',
    options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(paired.canConfirm, true, errors(paired));
  assert.deepEqual(
    paired.rows[0].years.map((year) => year.mandays),
    [1, 2, 0, 0, 0],
  );
  for (const heading of ['Y1 · 2027 MD', 'Y1 · 2035 MD', 'Y1 Y2 MD']) {
    const ambiguous = parsePersonnelBulkEntry(
      `Scope\t${heading}\nWork\t2`,
      options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
    );
    assert.equal(ambiguous.canConfirm, false);
    assert.match(errors(ambiguous), /Ambiguous year header/);
  }
  for (const amount of [
    'MD',
    '3 SGD',
    '$3',
    '1,20 MD',
    '1 2 days',
    '-1天',
    '1 MD/site',
    '1 month',
  ]) {
    const invalid = parsePersonnelBulkEntry(
      `Scope\tMD\nWork\t${amount}`,
      options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
    );
    assert.equal(invalid.canConfirm, false, amount);
  }
  const sites = parsePersonnelBulkEntry(
    'Scope\tMD/Site\tSites\nWork\t1 MD\t3days',
    options({ defaultBU: 'BU', defaultRETypeId: 'rt-local-l1' }),
  );
  assert.equal(
    sites.canConfirm,
    false,
    'A day unit cannot silently become a site count.',
  );
});

test('Fixed headerless MD formats preserve every row and require explicit BU/RE defaults', () => {
  const missing = parsePersonnelBulkEntry(
    'Installation\t1 MD\nTesting\t3days',
    options({ inputFormat: 'scope-md' }),
  );
  assert.equal(missing.canConfirm, false);
  assert.match(errors(missing), /BU is required/);
  assert.match(errors(missing), /Select an active internal RE Type/);
  const fixed = parsePersonnelBulkEntry(
    'Installation\t1 MD\nTesting\t3days',
    options({
      inputFormat: 'scope-md',
      defaultYear: 2,
      defaultBU: 'Chosen BU',
      defaultRETypeId: 'rt-hq-l1',
    }),
  );
  assert.equal(fixed.canConfirm, true, errors(fixed));
  assert.equal(fixed.rows.length, 2);
  assert.deepEqual(
    fixed.rows.map((row) => row.years[2].mandays),
    [1, 3],
  );
  assert.match(fixed.notices.join('\n'), /Fixed 2-column MD format/);
  const grouped = parsePersonnelBulkEntry(
    'North\tInstall\t2\n\tTest\t3',
    options({
      inputFormat: 'group-scope-md',
      defaultBU: 'BU',
      defaultRETypeId: 'rt-local-l1',
      fillDownGroup: true,
    }),
  );
  assert.equal(grouped.canConfirm, true, errors(grouped));
  assert.deepEqual(
    grouped.rows.map((row) => [row.groupName, row.scope]),
    [
      ['North', 'Install'],
      ['North', 'Test'],
    ],
  );
  const extra = parsePersonnelBulkEntry(
    'Install\t2\t999',
    options({
      inputFormat: 'scope-md',
      defaultBU: 'BU',
      defaultRETypeId: 'rt-local-l1',
    }),
  );
  assert.equal(extra.canConfirm, false);
  assert.match(errors(extra), /extra cells/);
  const mapped = parsePersonnelBulkEntry(
    '2\tInstall',
    options({
      inputFormat: 'scope-md',
      defaultBU: 'BU',
      defaultRETypeId: 'rt-local-l1',
      mapping: { 0: 'mandays:4', 1: 'scope' },
    }),
  );
  assert.equal(mapped.canConfirm, true, errors(mapped));
  assert.equal(mapped.rows[0].years[4].mandays, 2);
});

test('Two-tier Excel annual headings are flattened safely while cost leaves, repeated headers and totals are reported', () => {
  const text =
    'Group\tScope\tBU\tRE Type\tY1\t\tY2\t\n\t\t\t\tMD\tCost\tMan day / 人天\tCost\nNorth\tDeploy\tBU\tLOCAL-L1\t1 MD\t9999\t3days\t8888\n\tTotal / 合计\t\t\t1\t9999\t3\t8888';
  const preview = parsePersonnelBulkEntry(text, options());
  assert.equal(preview.canConfirm, true, errors(preview));
  assert.equal(preview.rows.length, 1);
  assert.deepEqual(
    preview.rows[0].years.map((year) => year.mandays),
    [1, 3, 0, 0, 0],
  );
  assert.equal(preview.entries[0].sourceRow, 3);
  assert.match(preview.notices.join('\n'), /two-row year headers combined/);
  assert.match(preview.notices.join('\n'), /Y1 Cost.*ignored/);
  assert.match(preview.notices.join('\n'), /summary row.*skipped/);
  const repeated = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tMD\nDeploy\tBU\tLOCAL-L1\t2\nScope\tBU\tRE Type\tMD\nTest\tBU\tLOCAL-L1\t3',
    options(),
  );
  assert.equal(repeated.canConfirm, true, errors(repeated));
  assert.equal(repeated.rows.length, 2);
  assert.match(repeated.notices.join('\n'), /repeated header row skipped/);
  const ambiguous = parsePersonnelBulkEntry(
    'Scope\tBU\tRE Type\tY1\t\n\t\t\tEffort?\tCost\nWork\tBU\tLOCAL-L1\t2\t999',
    options(),
  );
  assert.equal(ambiguous.canConfirm, false);
  assert.doesNotMatch(ambiguous.notices.join('\n'), /headers combined/);
});

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
  assert.match(errors(emptyCells), /No table cells/);
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
