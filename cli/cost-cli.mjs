#!/usr/bin/env node

/**
 * Stable, machine-first control surface for the local Cost & Quote Workbench.
 *
 * Contract rules:
 * - stdout contains exactly one JSON response envelope and no progress text;
 * - JSON-consuming commands require a v2 request envelope, never a raw record;
 * - options are allow-listed per command and unknown/duplicate options fail;
 * - JSON Schema validation runs before shared cross-record business validation;
 * - calculations and workbook generation call the same domain functions as UI;
 * - every response is validated against the public response schema before emit.
 */

import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  YEAR_BUCKETS,
  buildCostStatementRows,
  buildReconciledCostDimensionSummary,
  getCostStatementValues,
  getHQTravelSummary,
} from '../features/cost/domain.ts';
import {
  CLI_ENVELOPE_VERSION,
  COST_CALCULATION_ENGINE_VERSION,
  COST_EXPORT_SCHEMA_VERSION,
  COST_WORKBOOK_CONTRACT_VERSION,
} from '../features/cost/contracts.ts';
import { validateCostExportSnapshot } from '../features/cost/validation.ts';
import {
  buildDailyDigest,
  normalizeDigestDate,
} from '../features/agent/digest-domain.ts';

const API_VERSION = 'cost-workbench/v2';
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const PACKAGE_JSON = JSON.parse(
  await readFile(path.join(ROOT_DIR, 'package.json'), 'utf8'),
);
const CLI_VERSION = String(PACKAGE_JSON.version);

/** Canonical schemas exposed through `schema list/show` and system discovery. */
const SCHEMA_FILES = Object.freeze({
  'cost-export': path.join(ROOT_DIR, 'schemas/cost-export.schema.json'),
  'maintenance-price': path.join(
    ROOT_DIR,
    'schemas/maintenance-price.schema.json',
  ),
  'command-request': path.join(ROOT_DIR, 'schemas/command-request.schema.json'),
  'command-envelope': path.join(
    ROOT_DIR,
    'schemas/command-envelope.schema.json',
  ),
  'workspace-state': path.join(ROOT_DIR, 'schemas/workspace-state.schema.json'),
});

/** Stable process status classes for scripts and Agent Skills. */
const EXIT = Object.freeze({
  SUCCESS: 0,
  USAGE: 2,
  VALIDATION: 3,
  NOT_FOUND: 4,
  CONFLICT: 5,
  BUSINESS_RULE: 6,
  FILE_IO: 8,
  EXPORT_FAILED: 10,
  INTERNAL: 70,
});

const ROUNDING_CONTRACT = Object.freeze({
  money: 'CEILING_TO_0.01',
  quantity: 'HALF_UP_TO_0.0001',
});

const IMPLEMENTED_COMMANDS = Object.freeze([
  'version',
  'help',
  'system capabilities',
  'system doctor',
  'schema list',
  'schema show --name NAME [--schema-version VERSION]',
  'cost validate --input FILE|-',
  'cost calculate --input FILE|-',
  'cost export --input FILE|- --output FILE.xlsx [--overwrite]',
  'maintenance validate --input FILE|-',
  'digest generate [--as-of YYYY-MM-DD] [--db FILE]',
  'workspace list [--db FILE]',
  'workspace get --project-id ID [--db FILE]',
  'workspace save --input FILE|- --expected-revision REVISION|none [--db FILE]',
]);

/**
 * Per-command option specification. Value options consume the next token;
 * boolean options never do. Keeping this explicit prevents silent typos.
 */
const COMMAND_SPECS = Object.freeze({
  version: { values: ['request-id'], booleans: ['pretty'], required: [] },
  help: { values: ['request-id'], booleans: ['pretty'], required: [] },
  'system.capabilities': {
    values: ['request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'system.doctor': {
    values: ['request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'schema.list': {
    values: ['request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'schema.show': {
    values: ['name', 'schema-version', 'request-id'],
    booleans: ['pretty'],
    required: ['name'],
  },
  'cost.validate': {
    values: ['input', 'request-id'],
    booleans: ['pretty'],
    required: ['input'],
  },
  'cost.calculate': {
    values: ['input', 'request-id'],
    booleans: ['pretty'],
    required: ['input'],
  },
  'cost.export': {
    values: ['input', 'output', 'request-id'],
    booleans: ['overwrite', 'pretty'],
    required: ['input', 'output'],
  },
  'maintenance.validate': {
    values: ['input', 'request-id'],
    booleans: ['pretty'],
    required: ['input'],
  },
  'digest.generate': {
    values: ['as-of', 'db', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'workspace.list': {
    values: ['db', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'workspace.get': {
    values: ['project-id', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'workspace.save': {
    values: ['input', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['input', 'expected-revision'],
  },
});

/** Typed operational failure that is converted to the public ErrorResult. */
class CliFault extends Error {
  constructor(
    code,
    message,
    exitCode,
    { violations = [], retryable = false, dataSchemaVersion = null } = {},
  ) {
    super(message);
    this.name = 'CliFault';
    this.code = code;
    this.exitCode = exitCode;
    this.violations = violations;
    this.retryable = retryable;
    this.dataSchemaVersion = dataSchemaVersion;
  }
}

const argv = process.argv.slice(2);
let responseCommand = 'help';
let responseRequestId = `req_${randomUUID()}`;
let responseDataSchemaVersion = null;
const prettyRequested = argv.includes('--pretty');

/** Returns the normalized command and the remaining option tokens. */
const resolveCommand = (tokens) => {
  if (tokens.length === 0) return { command: 'help', optionTokens: [] };
  if (tokens[0] === 'version' || tokens[0] === '--version') {
    return { command: 'version', optionTokens: tokens.slice(1) };
  }
  if (['help', '--help', '-h'].includes(tokens[0])) {
    return { command: 'help', optionTokens: tokens.slice(1) };
  }
  if (
    tokens.length >= 2 &&
    !tokens[0].startsWith('-') &&
    !tokens[1].startsWith('-')
  ) {
    return {
      command: `${tokens[0]}.${tokens[1]}`,
      optionTokens: tokens.slice(2),
    };
  }
  return {
    command: String(tokens[0] || '(none)'),
    optionTokens: tokens.slice(1),
  };
};

/**
 * Parses only options declared by the selected command. Positional arguments,
 * `--name=value`, missing values, and repeated flags are deliberate failures.
 */
const parseOptions = (command, tokens) => {
  const spec = COMMAND_SPECS[command];
  if (!spec) {
    throw new CliFault(
      'UNKNOWN_COMMAND',
      `Unknown command: ${command}.`,
      EXIT.USAGE,
    );
  }
  const valueOptions = new Set(spec.values);
  const booleanOptions = new Set(spec.booleans);
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--') || token === '--') {
      throw new CliFault(
        'UNEXPECTED_ARGUMENT',
        `Unexpected positional argument: ${token}.`,
        EXIT.USAGE,
      );
    }
    const key = token.slice(2);
    if (!key || key.includes('=')) {
      throw new CliFault(
        'INVALID_OPTION_SYNTAX',
        `Use the '--name value' option form: ${token}.`,
        EXIT.USAGE,
      );
    }
    if (!valueOptions.has(key) && !booleanOptions.has(key)) {
      throw new CliFault(
        'UNKNOWN_OPTION',
        `Unknown option for ${command}: --${key}.`,
        EXIT.USAGE,
      );
    }
    if (Object.hasOwn(options, key)) {
      throw new CliFault(
        'DUPLICATE_OPTION',
        `Option may be supplied only once: --${key}.`,
        EXIT.USAGE,
      );
    }
    if (booleanOptions.has(key)) {
      options[key] = true;
      continue;
    }
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new CliFault(
        'OPTION_VALUE_REQUIRED',
        `Option --${key} requires a value.`,
        EXIT.USAGE,
      );
    }
    options[key] = next;
    index += 1;
  }
  for (const key of spec.required) {
    if (!Object.hasOwn(options, key) || String(options[key]).length === 0) {
      throw new CliFault(
        'OPTION_REQUIRED',
        `Option --${key} is required for ${command}.`,
        EXIT.USAGE,
      );
    }
  }
  if (Object.hasOwn(options, 'request-id')) {
    const requestId = String(options['request-id']);
    if (!/\S/.test(requestId) || requestId.length > 160) {
      throw new CliFault(
        'INVALID_REQUEST_ID',
        '--request-id must contain 1 to 160 characters including a non-space character.',
        EXIT.USAGE,
      );
    }
    responseRequestId = requestId;
  }
  return options;
};

/** Maps Ajv diagnostics into the stable, implementation-neutral violation form. */
const toViolations = (errors = []) =>
  errors.map((error) => {
    const suffix =
      error.keyword === 'required' && error.params?.missingProperty
        ? `/${error.params.missingProperty}`
        : '';
    return {
      path: `${error.instancePath || ''}${suffix}` || '/',
      rule: String(error.keyword || 'schema'),
      message: String(error.message || 'Schema validation failed.'),
    };
  });

const schemaCache = new Map();
const validatorCache = new Map();

/** Loads one canonical schema and computes the immutable discovery descriptor. */
const loadSchemaRecord = async (name) => {
  if (schemaCache.has(name)) return schemaCache.get(name);
  const schemaPath = SCHEMA_FILES[name];
  if (!schemaPath) {
    throw new CliFault(
      'SCHEMA_NOT_FOUND',
      `Unknown schema: ${name || '(missing)'}.`,
      EXIT.NOT_FOUND,
    );
  }
  let source;
  try {
    source = await readFile(schemaPath, 'utf8');
  } catch (error) {
    throw new CliFault(
      error?.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_IO_ERROR',
      `Unable to read schema ${name}: ${error instanceof Error ? error.message : 'file error'}.`,
      EXIT.FILE_IO,
    );
  }
  let schema;
  try {
    schema = JSON.parse(source);
  } catch {
    throw new CliFault(
      'SCHEMA_COMPILE_FAILED',
      `Canonical schema ${name} is not valid JSON.`,
      EXIT.INTERNAL,
    );
  }
  const schemaVersion =
    String(schema.$id || '')
      .split('/')
      .at(-1) || 'unknown';
  const record = {
    schema,
    descriptor: {
      name,
      schemaVersion,
      $id: String(schema.$id || ''),
      sha256: createHash('sha256').update(source).digest('hex'),
      path: schemaPath,
    },
  };
  schemaCache.set(name, record);
  return record;
};

/** Compiles a schema in Ajv strict mode and caches the validator for this run. */
const getValidator = async (name) => {
  if (validatorCache.has(name)) return validatorCache.get(name);
  const { schema } = await loadSchemaRecord(name);
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    // Register sibling schemas so workspace-state can reuse governed cost
    // definitions by canonical $id without copying or weakening them.
    for (const siblingName of Object.keys(SCHEMA_FILES)) {
      if (siblingName === name) continue;
      const sibling = await loadSchemaRecord(siblingName);
      ajv.addSchema(sibling.schema);
    }
    const validator = ajv.compile(schema);
    validatorCache.set(name, validator);
    return validator;
  } catch (error) {
    throw new CliFault(
      'SCHEMA_COMPILE_FAILED',
      `Canonical schema ${name} cannot be compiled: ${error instanceof Error ? error.message : 'unknown error'}.`,
      EXIT.INTERNAL,
    );
  }
};

/** Validates data against one named schema and returns normalized violations. */
const validateWithSchema = async (name, data) => {
  const validate = await getValidator(name);
  return {
    valid: Boolean(validate(data)),
    violations: toViolations(validate.errors || []),
  };
};

/** Reads UTF-8 JSON from an absolute/relative file path or stdin (`-`). */
const readJson = async (inputPath) => {
  let source;
  try {
    if (inputPath === '-') {
      source = await new Promise((resolve, reject) => {
        let text = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => {
          text += chunk;
        });
        process.stdin.on('end', () => resolve(text));
        process.stdin.on('error', reject);
      });
    } else {
      source = await readFile(path.resolve(String(inputPath)), 'utf8');
    }
  } catch (error) {
    throw new CliFault(
      error?.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_IO_ERROR',
      `Unable to read JSON input: ${error instanceof Error ? error.message : 'file error'}.`,
      EXIT.FILE_IO,
    );
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new CliFault(
      'MALFORMED_JSON',
      `Input is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}.`,
      EXIT.VALIDATION,
    );
  }
};

/**
 * Accepts the v2 transport envelope, verifies its expected kind, then validates
 * its `data` against the command-specific schema. Raw v1/v2 snapshots are not
 * guessed because doing so would make Agent retries ambiguous.
 */
const readCommandRequest = async (
  options,
  expectedKind,
  dataSchemaName,
  expectedDataSchemaVersion,
) => {
  const request = await readJson(options.input);
  const isObject =
    request !== null && typeof request === 'object' && !Array.isArray(request);
  if (
    !isObject ||
    (!Object.hasOwn(request, 'apiVersion') &&
      (Object.hasOwn(request, 'schemaVersion') ||
        Object.hasOwn(request, 'costRows') ||
        Object.hasOwn(request, 'records')))
  ) {
    throw new CliFault(
      'REQUEST_ENVELOPE_REQUIRED',
      'Wrap command data in a cost-workbench/v2 request envelope.',
      EXIT.VALIDATION,
      { dataSchemaVersion: expectedDataSchemaVersion },
    );
  }
  if (request.apiVersion !== API_VERSION) {
    throw new CliFault(
      'UNSUPPORTED_API_VERSION',
      `Expected apiVersion ${API_VERSION}.`,
      EXIT.VALIDATION,
      {
        violations: [
          {
            path: '/apiVersion',
            rule: 'const',
            message: `must equal ${API_VERSION}`,
          },
        ],
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  const envelopeValidation = await validateWithSchema(
    'command-request',
    request,
  );
  if (!envelopeValidation.valid) {
    throw new CliFault(
      'REQUEST_SCHEMA_VALIDATION_FAILED',
      'Request envelope does not match the command-request schema.',
      EXIT.VALIDATION,
      {
        violations: envelopeValidation.violations,
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  if (request.kind !== expectedKind) {
    throw new CliFault(
      'REQUEST_KIND_MISMATCH',
      `Command requires request kind ${expectedKind}.`,
      EXIT.VALIDATION,
      {
        violations: [
          {
            path: '/kind',
            rule: 'commandKind',
            message: `must equal ${expectedKind}`,
          },
        ],
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  if (
    options['request-id'] &&
    String(options['request-id']) !== String(request.requestId)
  ) {
    throw new CliFault(
      'REQUEST_ID_MISMATCH',
      '--request-id must match the request envelope requestId.',
      EXIT.VALIDATION,
      {
        violations: [
          {
            path: '/requestId',
            rule: 'correlation',
            message: 'does not match --request-id',
          },
        ],
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  responseRequestId = request.requestId;
  responseDataSchemaVersion = expectedDataSchemaVersion;
  if (request.data?.schemaVersion !== expectedDataSchemaVersion) {
    throw new CliFault(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Expected ${dataSchemaName} schema ${expectedDataSchemaVersion}.`,
      EXIT.VALIDATION,
      {
        violations: [
          {
            path: '/data/schemaVersion',
            rule: 'const',
            message: `must equal ${expectedDataSchemaVersion}`,
          },
        ],
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  const dataValidation = await validateWithSchema(dataSchemaName, request.data);
  if (!dataValidation.valid) {
    throw new CliFault(
      'SCHEMA_VALIDATION_FAILED',
      `${dataSchemaName} data does not match schema ${expectedDataSchemaVersion}.`,
      EXIT.VALIDATION,
      {
        violations: dataValidation.violations.map((item) => ({
          ...item,
          path: `/data${item.path === '/' ? '' : item.path}`,
        })),
        dataSchemaVersion: expectedDataSchemaVersion,
      },
    );
  }
  return request.data;
};

/** Produces the exact public success envelope. */
const success = (kind, data, warnings = [], dataSchemaVersion = null) => ({
  apiVersion: API_VERSION,
  kind,
  requestId: responseRequestId,
  command: responseCommand,
  ok: true,
  data,
  meta: {
    envelopeVersion: CLI_ENVELOPE_VERSION,
    dataSchemaVersion,
    generatedAt: new Date().toISOString(),
    warnings,
  },
});

/** Produces the exact public error envelope and assigns the process exit code. */
const failure = (fault) => {
  process.exitCode = fault.exitCode ?? EXIT.INTERNAL;
  return {
    apiVersion: API_VERSION,
    kind: 'ErrorResult',
    requestId: responseRequestId,
    command: responseCommand,
    ok: false,
    data: null,
    error: {
      code: String(fault.code || 'INTERNAL_ERROR'),
      message: String(fault.message || 'Unexpected CLI failure.'),
      retryable: Boolean(fault.retryable),
      violations: Array.isArray(fault.violations) ? fault.violations : [],
    },
    meta: {
      envelopeVersion: CLI_ENVELOPE_VERSION,
      dataSchemaVersion:
        fault.dataSchemaVersion ?? responseDataSchemaVersion ?? null,
      generatedAt: new Date().toISOString(),
      warnings: [],
    },
  };
};

/** Shared cost validation pipeline used by validate/calculate/export. */
const readValidCostSnapshot = async (options) => {
  const snapshot = await readCommandRequest(
    options,
    'CostSnapshotRequest',
    'cost-export',
    COST_EXPORT_SCHEMA_VERSION,
  );
  const issues = validateCostExportSnapshot(snapshot);
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new CliFault(
      'BUSINESS_VALIDATION_FAILED',
      'Cost snapshot violates one or more business rules.',
      EXIT.BUSINESS_RULE,
      {
        violations: errors.map((issue) => ({
          path: `/data${issue.path}`,
          rule: issue.code,
          message: issue.message,
        })),
        dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION,
      },
    );
  }
  return {
    snapshot,
    warnings: issues.filter((issue) => issue.severity === 'warning'),
  };
};

/** Removes domain-only row objects from the serializable HQ travel result. */
const serializeTravel = (travel) => ({
  triggeredCostLineIds: travel.hqRows.map((row) => row.id),
  hqMandays: travel.hqMandays,
  yearMandays: travel.yearMandays,
  months: travel.months,
  required: travel.required,
  allowanceCost: travel.allowanceCost,
  airfareCost: travel.airfareCost,
  totalCost: travel.totalCost,
});

/** Reads sheet names back from generated bytes so the response cannot drift. */
const readWorkbookSheetNames = async (bytes) => {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  return workbook.worksheets.map((sheet) => sheet.name);
};

const defaultDatabasePath = () =>
  path.join(ROOT_DIR, 'data', 'workbench.sqlite');

const resolveDatabasePath = (options) =>
  options.db === ':memory:'
    ? ':memory:'
    : path.resolve(String(options.db || defaultDatabasePath()));

const parseExpectedRevision = (value) => {
  if (value === 'none') return null;
  if (!/^[1-9][0-9]*$/.test(String(value))) {
    throw new CliFault(
      'INVALID_EXPECTED_REVISION',
      '--expected-revision must be a positive integer or none.',
      EXIT.USAGE,
    );
  }
  return Number(value);
};

/** Runs a repository action and guarantees the SQLite handle is closed. */
const withWorkspaceRepository = async (options, action) => {
  const { RepositoryConflictError, openWorkspaceRepository } =
    await import('../server/workspace-repository.mjs');
  const repository = openWorkspaceRepository(resolveDatabasePath(options));
  try {
    return await action(repository);
  } catch (error) {
    if (error instanceof RepositoryConflictError) {
      throw new CliFault('REVISION_CONFLICT', error.message, EXIT.CONFLICT, {
        violations: [
          {
            path: '/expectedRevision',
            rule: 'optimisticConcurrency',
            message: `Current revision is ${String(error.currentRevision)}.`,
          },
        ],
        dataSchemaVersion: '1.0.0',
      });
    }
    throw error;
  } finally {
    repository.close();
  }
};

/** Runs one resolved command and returns an unprinted response object. */
const execute = async () => {
  const resolved = resolveCommand(argv);
  responseCommand = resolved.command;
  const options = parseOptions(resolved.command, resolved.optionTokens);

  if (resolved.command === 'version') {
    return success('VersionResult', {
      version: CLI_VERSION,
      apiVersion: API_VERSION,
      envelopeVersion: CLI_ENVELOPE_VERSION,
    });
  }
  if (resolved.command === 'help') {
    return success('HelpResult', {
      version: CLI_VERSION,
      usage: 'cost-cli <group> <action> [--name value] [--pretty]',
      commands: IMPLEMENTED_COMMANDS,
    });
  }
  if (resolved.command === 'system.capabilities') {
    const schemas = await Promise.all(
      Object.keys(SCHEMA_FILES).map(
        async (name) => (await loadSchemaRecord(name)).descriptor,
      ),
    );
    return success('CapabilitiesResult', {
      cliVersion: CLI_VERSION,
      apiVersion: API_VERSION,
      envelopeVersion: CLI_ENVELOPE_VERSION,
      calculationEngineVersion: COST_CALCULATION_ENGINE_VERSION,
      workbookContractVersion: COST_WORKBOOK_CONTRACT_VERSION,
      yearBuckets: [...YEAR_BUCKETS],
      rounding: ROUNDING_CONTRACT,
      schemas,
      implementedCommands: IMPLEMENTED_COMMANDS,
      storage: 'local-sqlite',
      restrictions: [
        'Workspace writes require an exact expected revision to prevent lost updates.',
        'Company quotation systems are outside this CLI boundary.',
        'Cost v2 accepts exactly Y1 through Y5 and never infers a replacement for legacy Y0 data.',
        'Workbook export never replaces an existing file without --overwrite.',
      ],
    });
  }
  if (resolved.command === 'system.doctor') {
    const checks = [];
    for (const name of Object.keys(SCHEMA_FILES)) {
      await getValidator(name);
      checks.push({ name: `schema:${name}`, ok: true });
    }
    checks.push({ name: 'shared-domain-import', ok: true });
    const exporter = await import('../features/cost/export-workbook.ts');
    if (typeof exporter.buildCostWorkbookBytes !== 'function') {
      throw new CliFault(
        'DOCTOR_CHECK_FAILED',
        'Workbook export module does not expose buildCostWorkbookBytes.',
        EXIT.INTERNAL,
      );
    }
    checks.push({ name: 'workbook-export-import', ok: true });
    await withWorkspaceRepository({ db: ':memory:' }, async (repository) => {
      if (repository.schemaVersion !== 1) {
        throw new Error('Unexpected local database schema version.');
      }
    });
    checks.push({ name: 'local-sqlite-repository', ok: true });
    return success('DoctorResult', {
      healthy: true,
      nodeVersion: process.version,
      repositoryRoot: ROOT_DIR,
      schemaCount: Object.keys(SCHEMA_FILES).length,
      checks,
    });
  }
  if (resolved.command === 'schema.list') {
    const items = await Promise.all(
      Object.keys(SCHEMA_FILES).map(
        async (name) => (await loadSchemaRecord(name)).descriptor,
      ),
    );
    return success('SchemaListResult', { items });
  }
  if (resolved.command === 'schema.show') {
    const record = await loadSchemaRecord(String(options.name));
    if (
      options['schema-version'] &&
      options['schema-version'] !== record.descriptor.schemaVersion
    ) {
      throw new CliFault(
        'SCHEMA_VERSION_NOT_FOUND',
        `Schema ${options.name} has version ${record.descriptor.schemaVersion}, not ${options['schema-version']}.`,
        EXIT.NOT_FOUND,
      );
    }
    return success(
      'SchemaResult',
      {
        name: record.descriptor.name,
        schemaVersion: record.descriptor.schemaVersion,
        $id: record.descriptor.$id,
        sha256: record.descriptor.sha256,
        schema: record.schema,
      },
      [],
      record.descriptor.schemaVersion,
    );
  }
  if (resolved.command === 'maintenance.validate') {
    const input = await readCommandRequest(
      options,
      'MaintenancePriceRequest',
      'maintenance-price',
      '1.0.0',
    );
    return success(
      'MaintenanceValidationResult',
      { valid: true, recordCount: input.records.length },
      [],
      '1.0.0',
    );
  }
  if (resolved.command === 'digest.generate') {
    let asOf;
    try {
      asOf = normalizeDigestDate(
        options['as-of'] === undefined ? undefined : String(options['as-of']),
      );
    } catch (error) {
      throw new CliFault(
        'INVALID_AS_OF_DATE',
        error instanceof Error ? error.message : '--as-of must use YYYY-MM-DD.',
        EXIT.USAGE,
        { dataSchemaVersion: '1.0.0' },
      );
    }
    const digest = await withWorkspaceRepository(options, (repository) => {
      const projects = repository.list();
      const reviews = projects.flatMap((project) => project.reviewGates || []);
      return buildDailyDigest(projects, reviews, asOf);
    });
    return success('DigestResult', digest, [], '1.0.0');
  }
  if (resolved.command === 'workspace.list') {
    const items = await withWorkspaceRepository(options, (repository) =>
      repository.list(),
    );
    return success(
      'WorkspaceListResult',
      { databasePath: resolveDatabasePath(options), items },
      [],
      '1.0.0',
    );
  }
  if (resolved.command === 'workspace.get') {
    const projectId = String(options['project-id']);
    const record = await withWorkspaceRepository(options, (repository) =>
      repository.get(projectId),
    );
    if (!record) {
      throw new CliFault(
        'WORKSPACE_NOT_FOUND',
        `No workspace exists for project ${projectId}.`,
        EXIT.NOT_FOUND,
        { dataSchemaVersion: '1.0.0' },
      );
    }
    return success('WorkspaceRecordResult', record, [], '1.0.0');
  }
  if (resolved.command === 'workspace.save') {
    const workspace = await readCommandRequest(
      options,
      'WorkspaceSaveRequest',
      'workspace-state',
      '1.0.0',
    );
    const expectedRevision = parseExpectedRevision(
      options['expected-revision'],
    );
    const record = await withWorkspaceRepository(options, (repository) =>
      repository.save(workspace.project.id, workspace, expectedRevision),
    );
    return success('WorkspaceRecordResult', record, [], '1.0.0');
  }
  if (
    ['cost.validate', 'cost.calculate', 'cost.export'].includes(
      resolved.command,
    )
  ) {
    const { snapshot, warnings } = await readValidCostSnapshot(options);
    if (resolved.command === 'cost.validate') {
      return success(
        'CostValidationResult',
        { valid: true, errorCount: 0, warningCount: warnings.length },
        warnings,
        COST_EXPORT_SCHEMA_VERSION,
      );
    }

    const travel = getHQTravelSummary(
      snapshot.costRows,
      snapshot.resourceTypes,
      snapshot.travelSettings,
    );
    const totals = getCostStatementValues(
      snapshot.costRows,
      snapshot.resourceTypes,
      travel.totalCost,
      snapshot.manualCosts,
    );
    if (resolved.command === 'cost.calculate') {
      const summary = (dimension) =>
        buildReconciledCostDimensionSummary(
          snapshot.costRows,
          dimension,
          snapshot.resourceTypes,
          travel.totalCost,
          snapshot.manualCosts,
        );
      return success(
        'CostCalculationResult',
        {
          projectId: snapshot.project.id,
          costVersion: snapshot.costVersion.code,
          currency: snapshot.project.currency,
          yearBuckets: [...YEAR_BUCKETS],
          rounding: ROUNDING_CONTRACT,
          totals,
          hqTravel: serializeTravel(travel),
          summaries: {
            scope: summary('scope'),
            bu: summary('bu'),
            resourceType: summary('resourceType'),
            statement: buildCostStatementRows(
              snapshot.costRows,
              snapshot.resourceTypes,
              travel.totalCost,
              snapshot.manualCosts,
            ),
          },
        },
        warnings,
        COST_EXPORT_SCHEMA_VERSION,
      );
    }

    const outputPath = path.resolve(String(options.output));
    if (path.extname(outputPath).toLowerCase() !== '.xlsx') {
      throw new CliFault(
        'XLSX_OUTPUT_REQUIRED',
        '--output must end with .xlsx.',
        EXIT.USAGE,
        { dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION },
      );
    }
    if (!options.overwrite) {
      try {
        await access(outputPath);
        throw new CliFault(
          'OUTPUT_ALREADY_EXISTS',
          'Output exists; pass --overwrite to replace it.',
          EXIT.CONFLICT,
          { dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION },
        );
      } catch (error) {
        if (error instanceof CliFault) throw error;
        if (error?.code !== 'ENOENT') {
          throw new CliFault(
            'FILE_IO_ERROR',
            `Unable to inspect output path: ${error instanceof Error ? error.message : 'file error'}.`,
            EXIT.FILE_IO,
            { dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION },
          );
        }
      }
    }
    let bytes;
    let sheets;
    try {
      // ExcelJS and the exporter stay off the startup path for non-export calls.
      const { buildCostWorkbookBytes } =
        await import('../features/cost/export-workbook.ts');
      bytes = await buildCostWorkbookBytes(snapshot);
      sheets = await readWorkbookSheetNames(bytes);
    } catch (error) {
      throw new CliFault(
        'EXPORT_FAILED',
        `Workbook generation failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
        EXIT.EXPORT_FAILED,
        { dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION },
      );
    }
    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);
    } catch (error) {
      throw new CliFault(
        'FILE_IO_ERROR',
        `Unable to write workbook: ${error instanceof Error ? error.message : 'file error'}.`,
        EXIT.FILE_IO,
        { dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION },
      );
    }
    return success(
      'CostExportResult',
      {
        artifact: {
          path: outputPath,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          sizeBytes: bytes.byteLength,
          mimeType:
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        sheets,
      },
      warnings,
      COST_EXPORT_SCHEMA_VERSION,
    );
  }
  throw new CliFault(
    'UNKNOWN_COMMAND',
    `Unknown command: ${resolved.command}.`,
    EXIT.USAGE,
  );
};

/**
 * Validates the final response. A contract bug is replaced by a minimal typed
 * error so Agent callers never receive a partially shaped success payload.
 */
const enforceOutputContract = async (response) => {
  try {
    const validation = await validateWithSchema('command-envelope', response);
    if (validation.valid) return response;
    process.exitCode = EXIT.INTERNAL;
    return failure(
      new CliFault(
        'OUTPUT_CONTRACT_VIOLATION',
        'CLI produced a response that violates command-envelope/2.0.0.',
        EXIT.INTERNAL,
        { violations: validation.violations },
      ),
    );
  } catch (error) {
    process.exitCode = EXIT.INTERNAL;
    return failure(
      new CliFault(
        'OUTPUT_CONTRACT_VIOLATION',
        `CLI could not verify its response contract: ${error instanceof Error ? error.message : 'unknown error'}.`,
        EXIT.INTERNAL,
      ),
    );
  }
};

let response;
try {
  response = await execute();
} catch (error) {
  response = failure(
    error instanceof CliFault
      ? error
      : new CliFault(
          'INTERNAL_ERROR',
          error instanceof Error ? error.message : 'Unexpected CLI failure.',
          EXIT.INTERNAL,
        ),
  );
}

const validatedResponse = await enforceOutputContract(response);
process.stdout.write(
  `${JSON.stringify(validatedResponse, null, prettyRequested ? 2 : 0)}\n`,
);
