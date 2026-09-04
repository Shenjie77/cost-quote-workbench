/**
 * End-to-end contract tests for the machine-facing cost-cli.
 *
 * These tests intentionally execute a child process instead of importing CLI
 * functions: Agent Skills depend on stdout, exit codes, and option parsing as a
 * complete protocol. Every captured response is validated against the public
 * command-envelope schema before command-specific assertions are made.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import { roundMoney } from '../features/cost/domain.ts';
import { makeCostRequest } from './helpers.mjs';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const CLI_PATH = path.join(ROOT_DIR, 'cli/cost-cli.mjs');
const FIXTURE_DIR = path.join(ROOT_DIR, 'tests/fixtures');
const SCHEMA_DIR = path.join(ROOT_DIR, 'schemas');
const responseSchema = JSON.parse(
  readFileSync(path.join(SCHEMA_DIR, 'command-envelope.schema.json'), 'utf8'),
);
const responseValidator = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(responseSchema);

/** Runs the installed Node binary against cost-cli and parses its sole stdout. */
const runCli = (args, { input } = {}) => {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    input,
  });
  assert.equal(
    result.signal,
    null,
    `CLI terminated by ${result.signal}: ${result.stderr}`,
  );
  assert.notEqual(result.stdout.trim(), '', 'CLI must emit one JSON envelope.');
  let response;
  assert.doesNotThrow(() => {
    response = JSON.parse(result.stdout);
  }, `stdout must be exactly one JSON value: ${result.stdout}`);
  assert.equal(
    responseValidator(response),
    true,
    JSON.stringify(responseValidator.errors, null, 2),
  );
  return { ...result, response };
};

test('all canonical schemas compile in Ajv strict mode', () => {
  const names = [
    'cost-export',
    'maintenance-price',
    'command-request',
    'command-envelope',
    'workspace-state',
  ];
  const schemas = names.map((name) =>
    JSON.parse(
      readFileSync(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'),
    ),
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  assert.doesNotThrow(() => {
    schemas.forEach((schema) => ajv.addSchema(schema));
    schemas.forEach((schema) =>
      assert.equal(Boolean(ajv.getSchema(schema.$id)), true),
    );
  });
});

test('capabilities discovers exact v2 buckets, contracts, and schema hashes', () => {
  const { status, response } = runCli(['system', 'capabilities']);
  assert.equal(status, 0);
  assert.equal(response.apiVersion, 'cost-workbench/v2');
  assert.equal(response.data.envelopeVersion, '2.0.0');
  assert.equal(response.data.calculationEngineVersion, '2.0.0');
  assert.deepEqual(response.data.yearBuckets, ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']);
  assert.equal(response.data.schemas.length, 5);
  assert.equal(response.data.storage, 'local-sqlite');
  response.data.schemas.forEach((schema) => {
    assert.match(schema.sha256, /^[a-f0-9]{64}$/);
    assert.equal(path.isAbsolute(schema.path), true);
  });
});

test('workspace CLI persists with revision checks and can list/read records', () => {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'cost-workbench-workspace-test-'),
  );
  const databasePath = path.join(temporaryDirectory, 'workbench.sqlite');
  const costRequest = makeCostRequest();
  const data = costRequest.data;
  const workspaceRequest = {
    apiVersion: 'cost-workbench/v2',
    kind: 'WorkspaceSaveRequest',
    requestId: 'req_workspace_save_001',
    data: {
      schemaVersion: '1.0.0',
      project: data.project,
      selectedStep: 0,
      processSteps: [],
      activeVersion: 'V3',
      costRows: data.costRows,
      rateSettings: data.rateSettings,
      resourceTypes: data.resourceTypes,
      subcontractItems: [],
      supplementalCostItems: [],
      maintenancePriceRecords: [],
      travelSettings: data.travelSettings,
      travelRows: [],
      travelUplift: 0,
      manualCosts: data.manualCosts,
    },
  };
  try {
    const created = runCli(
      [
        'workspace',
        'save',
        '--input',
        '-',
        '--expected-revision',
        'none',
        '--db',
        databasePath,
      ],
      { input: JSON.stringify(workspaceRequest) },
    );
    assert.equal(created.status, 0);
    assert.equal(created.response.data.revision, 1);

    const fetched = runCli([
      'workspace',
      'get',
      '--project-id',
      data.project.id,
      '--db',
      databasePath,
    ]);
    assert.equal(fetched.status, 0);
    assert.equal(fetched.response.data.workspace.project.id, data.project.id);

    const listed = runCli(['workspace', 'list', '--db', databasePath]);
    assert.equal(listed.status, 0);
    assert.equal(listed.response.data.items.length, 1);
    assert.equal(listed.response.data.items[0].currentWorkflowStepCode, '');
    assert.deepEqual(listed.response.data.items[0].workflowSteps, []);
    assert.equal(listed.response.data.items[0].statusDefinitions.length, 9);
    assert.deepEqual(listed.response.data.items[0].reviewGates, []);

    const digest = runCli([
      'digest',
      'generate',
      '--as-of',
      '2026-09-05',
      '--db',
      databasePath,
    ]);
    assert.equal(digest.status, 0);
    assert.equal(digest.response.kind, 'DigestResult');
    assert.equal(digest.response.data.asOf, '2026-09-05');
    assert.equal(digest.response.data.counts.cost_attention, 1);
    assert.equal(digest.response.data.items[0].projectId, data.project.id);

    const stale = runCli(
      [
        'workspace',
        'save',
        '--input',
        '-',
        '--expected-revision',
        'none',
        '--db',
        databasePath,
      ],
      { input: JSON.stringify(workspaceRequest) },
    );
    assert.equal(stale.status, 5);
    assert.equal(stale.response.error.code, 'REVISION_CONFLICT');
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('cost validate accepts the v2 request envelope', () => {
  const { status, response } = runCli(['cost', 'validate', '--input', '-'], {
    input: JSON.stringify(makeCostRequest()),
  });
  assert.equal(status, 0);
  assert.equal(response.kind, 'CostValidationResult');
  assert.equal(response.requestId, 'req_test_cost_v2');
  assert.equal(response.meta.dataSchemaVersion, '2.0.0');
});

test('cost calculate uses consolidated RE Type summary and upward-cent rounding', () => {
  const { status, response } = runCli(['cost', 'calculate', '--input', '-'], {
    input: JSON.stringify(makeCostRequest()),
  });
  assert.equal(status, 0);
  assert.equal(response.kind, 'CostCalculationResult');
  assert.deepEqual(response.data.yearBuckets, ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']);
  assert.ok(response.data.totals.inHouseLabour > 0);
  assert.equal(
    response.data.summaries.resourceType.some(
      (item) => item.key === 'rt-hq-l3',
    ),
    true,
  );
  assert.equal(Object.hasOwn(response.data.summaries, 'grade'), false);
  assert.equal(response.data.rounding.money, 'CEILING_TO_0.01');
  assert.equal(roundMoney(18848.282), 18848.29);
});

test('maintenance validate accepts only the maintenance request kind', () => {
  const { status, response } = runCli([
    'maintenance',
    'validate',
    '--input',
    path.join(FIXTURE_DIR, 'maintenance-request.valid.json'),
  ]);
  assert.equal(status, 0);
  assert.equal(response.data.recordCount, 1);
  assert.equal(response.meta.dataSchemaVersion, '1.0.0');
});

test('digest rejects calendar-invalid as-of dates with a typed error', () => {
  const { status, response } = runCli([
    'digest',
    'generate',
    '--as-of',
    '2026-02-31',
    '--db',
    ':memory:',
  ]);
  assert.equal(status, 2);
  assert.equal(response.error.code, 'INVALID_AS_OF_DATE');
});

test('raw snapshots are rejected with a typed envelope error', () => {
  const { status, response } = runCli([
    'cost',
    'validate',
    '--input',
    path.join(FIXTURE_DIR, 'cost-export.valid.json'),
  ]);
  assert.equal(status, 3);
  assert.equal(response.error.code, 'REQUEST_ENVELOPE_REQUIRED');
});

test('Y1-Y5 order is mandatory and never shifted positionally', () => {
  const request = makeCostRequest();
  [request.data.costRows[0].years[0], request.data.costRows[0].years[1]] = [
    request.data.costRows[0].years[1],
    request.data.costRows[0].years[0],
  ];
  const { status, response } = runCli(['cost', 'validate', '--input', '-'], {
    input: JSON.stringify(request),
  });
  assert.equal(status, 3);
  assert.equal(response.error.code, 'SCHEMA_VALIDATION_FAILED');
  assert.equal(
    response.error.violations.some((item) => item.path.includes('/bucket')),
    true,
  );
});

test('an unused governed RE Type may be removed from Master Data', () => {
  const request = makeCostRequest();
  request.data.resourceTypes = request.data.resourceTypes.filter(
    (item) => item.code !== 'ARP-L0',
  );
  const { status, response } = runCli(['cost', 'validate', '--input', '-'], {
    input: JSON.stringify(request),
  });
  assert.equal(status, 0);
  assert.equal(response.ok, true);
});

test('malformed JSON, unknown options, and unknown commands stay typed', () => {
  const malformed = runCli(['cost', 'validate', '--input', '-'], {
    input: '{',
  });
  assert.equal(malformed.status, 3);
  assert.equal(malformed.response.error.code, 'MALFORMED_JSON');

  const unknownOption = runCli(['system', 'capabilities', '--typo']);
  assert.equal(unknownOption.status, 2);
  assert.equal(unknownOption.response.error.code, 'UNKNOWN_OPTION');

  const unknownCommand = runCli(['unknown', 'action']);
  assert.equal(unknownCommand.status, 2);
  assert.equal(unknownCommand.response.command, 'unknown.action');
  assert.equal(unknownCommand.response.error.code, 'UNKNOWN_COMMAND');
});

test('export returns the actual nine-sheet workbook manifest', () => {
  const temporaryDirectory = mkdtempSync(
    path.join(tmpdir(), 'cost-workbench-cli-test-'),
  );
  const outputPath = path.join(temporaryDirectory, 'cost-v2.xlsx');
  try {
    const { status, response } = runCli(
      ['cost', 'export', '--input', '-', '--output', outputPath],
      { input: JSON.stringify(makeCostRequest()) },
    );
    assert.equal(status, 0);
    assert.deepEqual(response.data.sheets, [
      '00_Readme',
      '01_Cost_Detail',
      '02_Summary_Scope',
      '03_Summary_BU',
      '04_Summary_RE_Type',
      '05_Summary_RE_Level',
      '06_Cost_Statement',
      '07_Reconciliation',
      '08_Assumptions',
    ]);
    assert.equal(response.data.artifact.path, outputPath);
    assert.match(response.data.artifact.sha256, /^[a-f0-9]{64}$/);

    const conflict = runCli(
      ['cost', 'export', '--input', '-', '--output', outputPath],
      { input: JSON.stringify(makeCostRequest()) },
    );
    assert.equal(conflict.status, 5);
    assert.equal(conflict.response.error.code, 'OUTPUT_ALREADY_EXISTS');
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
