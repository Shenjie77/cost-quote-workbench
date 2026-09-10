/** Public CLI, portfolio and customer output agree on governed BU profit share. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import ExcelJS from 'exceljs';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createProject,
  updateResource,
} from '../server/workspace-resources.mjs';
import { validatedQuoteInput } from '../features/quote/validated-input.ts';

const root = path.resolve(import.meta.dirname, '..');
const validateResponse = new Ajv2020({ allErrors: true, strict: true }).compile(
  JSON.parse(
    readFileSync(
      path.join(root, 'schemas/command-envelope.schema.json'),
      'utf8',
    ),
  ),
);
const projectId = 'PRJ-SHARE-INTEGRATION';
const share = {
  id: 'SHARE-NETWORK',
  bu: 'Network',
  ratePercent: 20,
  active: true,
};
const operation = (name, changes) => ({
  apiVersion: 'cost-workbench/v2',
  kind: 'OperationRequest',
  requestId: `test-${name.replaceAll('.', '-')}`,
  data: { schemaVersion: '1.0.0', operation: name, changes },
});
const portfolioPricing = (repo) => {
  const entry = repo.list().find((item) => item.projectId === projectId);
  return {
    totalCost: entry.totalCost,
    totalQuote: entry.totalQuote,
    grossMarginPercent: entry.grossMarginPercent,
  };
};

function fixture(t) {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'profit-share-integration-'),
  );
  const db = path.join(directory, 'workbench.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const inspect = (read) => {
    const repo = openWorkspaceRepository(db);
    try {
      return read(repo);
    } finally {
      repo.close();
    }
  };
  const run = (args, input, status = 0) => {
    const child = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        ...args,
        '--db',
        db,
        ...(input ? ['--input', '-'] : []),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        input: input ? JSON.stringify(input) : undefined,
      },
    );
    assert.equal(child.signal, null, child.stderr);
    assert.equal(child.status, status, child.stdout + child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(
      validateResponse(result),
      true,
      JSON.stringify(validateResponse.errors),
    );
    return result;
  };
  const initial = run(['masterdata', 'get', '--tab', 'profit-share']);
  assert.equal(initial.kind, 'GlobalMasterDataResult');
  assert.equal(initial.data.scope, 'global');
  assert.equal(initial.data.tab, 'profit-share');
  assert.equal(initial.data.revision, 1);
  assert.equal(initial.data.total, 0);
  assert.equal('projectId' in initial.data, false);
  assert.equal('workspace' in initial.data, false);
  const updated = run(
    [
      'masterdata',
      'update',
      '--tab',
      'profit-share',
      '--expected-revision',
      '1',
    ],
    operation('masterdata.update', { upsert: [share] }),
  );
  assert.equal(updated.kind, 'GlobalMasterDataMutationResult');
  assert.equal(updated.data.tab, 'profit-share');
  assert.equal(updated.data.revision, 2);
  inspect((repo) => {
    assert.deepEqual(
      repo.headers(),
      [],
      'global pricing maintenance needs no project',
    );
    const resources = repo.globalMasterData.get('resources');
    repo.globalMasterData.update(
      'resources',
      {
        upsert: [{ id: 'rt-local-l1', mandayRate: 45 }],
      },
      resources.revision,
    );
    createProject(repo, {
      id: projectId,
      name: 'Network Service',
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
            quoteAsOf: '2026-09-10',
            tdStart: '2026-09-10',
            tdEnd: '2026-09-11',
            baseYear: 2026,
          },
          manualCosts: {
            otherService: 0,
            otherServiceRate: 0,
            riskContingency: 5,
          },
        },
      },
      revision,
    ).revision;
    revision = updateResource(
      repo,
      projectId,
      'cost',
      { version: 'V1' },
      {
        upsert: [
          {
            id: 'NETWORK-DESIGN',
            scope: 'Network design',
            bu: 'Network',
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
    revision = updateResource(
      repo,
      projectId,
      'quote',
      { section: 'settings' },
      {
        set: { pricing: { targetGrossMargin: 30, discount: 0, gstPercent: 0 } },
      },
      revision,
    ).revision;
    updateResource(
      repo,
      projectId,
      'cost',
      { section: 'settings', version: 'V1' },
      {
        set: { state: 'Confirmed' },
      },
      revision,
    );
  });
  return { directory, inspect, run };
}

test('captured BU share reconciles portfolio, real CLI quotation, immutable archive and later explicit adoption', async (t) => {
  const { directory, inspect, run } = fixture(t);
  const before = inspect((repo) => {
    const record = repo.get(projectId);
    assert.deepEqual(record.workspace.pricing.profitShareRates, [share]);
    assert.equal(record.workspace.pricing.profitShareMasterDataRevision, 2);
    const quote = validatedQuoteInput(record.workspace, 'Q-SHARE-CHECK');
    assert.equal(quote.pricing.cost, 50);
    assert.equal(quote.pricing.quoteBeforeTax, 100);
    assert.equal(quote.pricing.profitShareAmount, 20);
    assert.equal(quote.pricing.salesGrossProfit, 30);
    assert.equal(quote.pricing.grossMarginPercent, 30);
    assert.equal(quote.pricing.profitShareBreakdown[0].directCost, 45);
    assert.equal(quote.pricing.profitShareBreakdown[0].unassignedCost, 5);
    assert.deepEqual(portfolioPricing(repo), {
      totalCost: 50,
      totalQuote: 100,
      grossMarginPercent: 30,
    });
    return record;
  });

  const output = path.join(directory, 'Quotation.xlsx');
  const exported = run([
    'quote',
    'export',
    '--project-id',
    projectId,
    '--output',
    output,
  ]);
  assert.equal(exported.kind, 'WorkbookExportResult');
  assert.equal(existsSync(output), true);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(output));
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['Quotation'],
  );
  const sheet = workbook.getWorksheet('Quotation');
  assert.equal(sheet.getCell('D14').value, 100);
  const labels = [],
    amounts = [];
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (typeof cell.value === 'string') labels.push(cell.value);
      if (typeof cell.value === 'number') amounts.push(cell.value);
    }),
  );
  assert.doesNotMatch(
    labels.join('\n'),
    /profit[\s-]*share|gross[\s-]*(?:profit|margin)|sales\s*GP|total\s*cost|成本(?:合计|金额|总额)|销售毛利|分成/i,
  );
  assert.deepEqual(
    amounts,
    [100, 0, 100, 0, 100],
    'customer XLSX contains only public price, discount and tax amounts',
  );
  const archived = inspect((repo) => {
    const record = repo.get(projectId);
    assert.deepEqual(
      record.workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.equal(record.workspace.quoteHistory.length, 1);
    const history = record.workspace.quoteHistory[0];
    assert.equal(history.quoteBeforeTax, 100);
    assert.equal(history.grossMarginPercent, 30);
    assert.deepEqual(history.profitShareSnapshot, {
      weightedProfitShareRate: 20,
      profitShareAmount: 20,
      salesGrossProfit: 30,
      masterDataRevision: 2,
      profitShareBreakdown: [
        {
          bu: 'Network',
          cost: 50,
          costWeight: 1,
          ratePercent: 20,
          allocatedRevenue: 100,
          profitShareAmount: 20,
          directCost: 45,
          unassignedCost: 5,
          configured: true,
        },
      ],
    });
    const files = repo.files.list(projectId, { category: 'quote' }).files;
    assert.equal(files.length, 1);
    assert.match(files[0].relativePath, /^quotation\//);
    assert.deepEqual(
      repo.files.read(projectId, files[0].id).buffer,
      readFileSync(output),
    );
    return { record, portfolio: portfolioPricing(repo) };
  });

  run(
    [
      'masterdata',
      'update',
      '--tab',
      'profit-share',
      '--expected-revision',
      '2',
    ],
    operation('masterdata.update', {
      upsert: [{ id: share.id, ratePercent: 35 }],
    }),
  );
  inspect((repo) => {
    assert.deepEqual(repo.get(projectId), archived.record);
    assert.deepEqual(portfolioPricing(repo), archived.portfolio);
  });
  const applied = run([
    'project',
    'apply-masterdata',
    '--project-id',
    projectId,
    '--tab',
    'profit-share',
    '--expected-revision',
    String(archived.record.revision),
  ]);
  assert.equal(applied.data.masterDataRevision, 3);
  inspect((repo) => {
    const current = repo.get(projectId);
    assert.deepEqual(
      current.workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.deepEqual(
      current.workspace.quoteHistory,
      archived.record.workspace.quoteHistory,
    );
    assert.equal(current.workspace.pricing.profitShareRates[0].ratePercent, 35);
    const quote = validatedQuoteInput(current.workspace, 'Q-SHARE-UPDATED');
    // The algebraic 142.857... needs two extra cents because profit share is
    // also rounded to cents; the final displayed amounts must meet target GP.
    assert.equal(quote.pricing.quoteBeforeTax, 142.88);
    assert.ok(quote.pricing.grossMarginPercent >= 30);
    assert.ok(Math.abs(quote.pricing.grossMarginPercent - 30) < 0.01);
    assert.deepEqual(portfolioPricing(repo), {
      totalCost: quote.pricing.cost,
      totalQuote: quote.pricing.quoteBeforeTax,
      grossMarginPercent: quote.pricing.grossMarginPercent,
    });
  });
});

test('an impossible Sales GP plus profit-share rate blocks real CLI export before artifact or history writes', (t) => {
  const { directory, inspect, run } = fixture(t);
  inspect((repo) => {
    const current = repo.get(projectId);
    updateResource(
      repo,
      projectId,
      'quote',
      { section: 'settings' },
      {
        set: { pricing: { targetGrossMargin: 80 } },
      },
      current.revision,
    );
  });
  const before = inspect((repo) => repo.get(projectId));
  const output = path.join(directory, 'Impossible.xlsx');
  const rejected = run(
    ['quote', 'export', '--project-id', projectId, '--output', output],
    undefined,
    6,
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'BUSINESS_VALIDATION_FAILED');
  assert.match(rejected.error.message, /100%|below 100|less than 100/i);
  assert.equal(existsSync(output), false);
  inspect((repo) => {
    assert.deepEqual(repo.get(projectId), before);
    assert.deepEqual(
      repo.files.list(projectId, { category: 'quote' }).files,
      [],
    );
  });
});
