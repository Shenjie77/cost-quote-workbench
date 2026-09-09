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

import {
  readResource,
  updateResource,
  applyMasterRates,
  applyProjectMasterData,
  createProject,
  createCostDraft,
  deleteCostVersion,
  syncVersion,
  mutationReceipt,
} from '../server/workspace-resources.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { LOCAL_DATABASE_SCHEMA_VERSION } from '../db/schema.ts';

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
import { costLockReason } from '../features/cost/cost-lock.ts';
import { WORKFLOW_ACTIONS } from '../features/projects/workflow-engine.ts';
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
  operations: path.join(ROOT_DIR, 'schemas/operations.schema.json'),
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
  'project workflow-action --project-id ID --input REQUEST --expected-revision REVISION [--db FILE]',
  'workflow preview --input REQUEST --expected-revision REVISION [--db FILE]',
  'workflow publish --input REQUEST --expected-revision REVISION [--db FILE]',
  'project create --input REQUEST [--db FILE]',
  'cost create --project-id ID --mode blank|clone [--source-version V1] --expected-revision REVISION [--db FILE]',
  'cost delete --project-id ID --version V1 --expected-revision REVISION [--db FILE]',
  'project get --project-id ID [--section settings|metadata|workflow-tracking|workflow-history|workflow|reviews] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'project update --project-id ID [--section settings|metadata|workflow-tracking] --input REQUEST --expected-revision REVISION [--db FILE]',
  'cost get --project-id ID [--section rows|subcontract|settings|resources|travel|summary|versions] [--version V1] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'cost update --project-id ID [--section rows|subcontract|settings|travel] [--version V1] --input REQUEST --expected-revision REVISION [--db FILE]',
  'masterdata get --tab TAB [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'masterdata update --tab TAB --input REQUEST --expected-revision REVISION [--db FILE]',
  'cpq get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'cpq update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]',
  'quote get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'quote update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]',
  'ssr get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'ssr update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]',
  'boq get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]',
  'boq update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]',
  'project delete --project-id ID --expected-revision REVISION [--db FILE]',
  'project restore --project-id ID --expected-revision REVISION [--db FILE]',
  'project apply-masterdata --project-id ID --tab TAB --expected-revision REVISION [--db FILE]',
  'cost apply-rates --project-id ID --expected-revision REVISION --version V1 [--db FILE]',
  'project list [--deleted] [--db FILE]',

  'boq import --project-id ID --file FILE --input REQUEST [--apply --expected-revision REVISION] [--compact] [--db FILE]',
  'maintenance archive --project-id ID --expected-revision REVISION [--compact] [--db FILE]',
  'maintenance export --project-id ID --archive-id ID --output FILE.xlsx [--db FILE]',
  'workbook inspect --file FILE.xlsx [--header-row N]',
  'cost import --project-id ID [--version V1] --file FILE.xlsx --input REQUEST [--apply --expected-revision REVISION] [--compact] [--db FILE]',
  'ssr submit --project-id ID [--version Vn] --input REQUEST --expected-revision REVISION [--compact] [--db FILE]',
  'ssr result --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]',
  'ssr close --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]',
  'ssr followup --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]',
  'workbook fill-template --project-id ID --file TEMPLATE.xlsx --input MAPPING --output FILE.xlsx [--db FILE]',
  'reminders scan [--as-of YYYY-MM-DD] [--db FILE]',
  'reminders list [--db FILE]',
  'reminders ack --id ID --fingerprint FINGERPRINT [--db FILE]',
  'history search --scope TEXT [--client CUSTOMER] [--db FILE]',
  'version',
  'help',
  'system capabilities',
  'system doctor',
  'schema list',
  'schema show --name NAME [--schema-version VERSION]',
  'cost validate (--input FILE|- | --project-id ID [--version V1]) [--db FILE]',
  'cost calculate (--input FILE|- | --project-id ID [--version V1]) [--db FILE]',
  'cost export (--input FILE|- | --project-id ID [--version V1]) --output FILE.xlsx [--format full|simple] [--db FILE] [--overwrite]',
  'maintenance validate --input FILE|-',
  'digest generate [--as-of YYYY-MM-DD] [--db FILE]',
  'workspace list [--db FILE]',
  'workspace get --project-id ID [--db FILE]',
  'workspace save --input FILE|- --expected-revision REVISION|none [--db FILE]',
  'cpq match --project-id ID --scope TEXT [--db FILE]',
  'cpq confirm --project-id ID --confirmed-by NAME --expected-revision REVISION [--compact] [--db FILE]',
  'cpq solve --project-id ID --expected-revision REVISION [--compact] [--db FILE]',
  'cpq archive --project-id ID --expected-revision REVISION [--compact] [--db FILE]',
  'cpq export --project-id ID --archive-id ID --output FILE.xlsx [--db FILE]',
  'quote export --project-id ID --output FILE.xlsx [--db FILE]',
]);

const readWorkbookFile = async (file) => {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    throw new CliFault(
      error.code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'FILE_IO_ERROR',
      `Unable to read workbook: ${error.message}`,
      EXIT.FILE_IO,
    );
  }
};

/**
 * Per-command option specification. Value options consume the next token;
 * boolean options never do. Keeping this explicit prevents silent typos.
 */
const COMMAND_SPECS = Object.freeze({
  'cost.delete': {
    values: ['project-id', 'version', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'version', 'expected-revision'],
  },
  'project.create': {
    values: ['input', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['input'],
  },
  'cost.create': {
    values: [
      'project-id',
      'mode',
      'source-version',
      'expected-revision',
      'db',
      'request-id',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'mode', 'expected-revision'],
  },
  'project.get': {
    values: [
      'project-id',
      'section',
      'db',
      'request-id',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'project.workflow-action': {
    values: ['project-id', 'input', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'workflow.preview': {
    values: ['input', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['input', 'expected-revision'],
  },
  'workflow.publish': {
    values: ['input', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['input', 'expected-revision'],
  },
  'project.update': {
    values: [
      'project-id',
      'section',
      'db',
      'request-id',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'cost.get': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'version',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'cost.update': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'version',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'masterdata.get': {
    values: ['db', 'request-id', 'tab', 'id', 'query', 'offset', 'limit'],
    booleans: ['pretty'],
    required: ['tab'],
  },
  'masterdata.update': {
    values: ['db', 'request-id', 'tab', 'input', 'expected-revision'],
    booleans: ['pretty'],
    required: ['tab', 'input', 'expected-revision'],
  },
  'cpq.get': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'cpq.update': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'quote.get': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'quote.update': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'ssr.get': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'ssr.update': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'boq.get': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'id',
      'query',
      'offset',
      'limit',
    ],
    booleans: ['pretty'],
    required: ['project-id'],
  },
  'boq.update': {
    values: [
      'project-id',
      'db',
      'request-id',
      'section',
      'input',
      'expected-revision',
    ],
    booleans: ['pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'project.delete': {
    values: ['project-id', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'expected-revision'],
  },
  'project.restore': {
    values: ['project-id', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'expected-revision'],
  },
  'project.apply-masterdata': {
    values: ['project-id', 'tab', 'expected-revision', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'tab', 'expected-revision'],
  },
  'cost.apply-rates': {
    values: ['project-id', 'expected-revision', 'version', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'expected-revision', 'version'],
  },
  'project.list': {
    values: ['db', 'request-id'],
    booleans: ['pretty', 'deleted'],
    required: [],
  },

  'maintenance.archive': {
    values: ['project-id', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'expected-revision'],
  },
  'maintenance.export': {
    values: ['project-id', 'archive-id', 'output', 'db', 'request-id'],
    booleans: ['pretty', 'overwrite'],
    required: ['project-id', 'archive-id', 'output'],
  },
  'boq.import': {
    values: [
      'project-id',
      'input',
      'file',
      'expected-revision',
      'db',
      'request-id',
    ],
    booleans: ['compact', 'pretty', 'apply'],
    required: ['project-id', 'input', 'file'],
  },
  'workbook.inspect': {
    values: ['file', 'header-row', 'request-id'],
    booleans: ['pretty'],
    required: ['file'],
  },
  'cost.import': {
    values: [
      'project-id',
      'version',
      'file',
      'input',
      'expected-revision',
      'db',
      'request-id',
    ],
    booleans: ['compact', 'apply', 'pretty'],
    required: ['project-id', 'file', 'input'],
  },
  'workbook.fill-template': {
    values: ['project-id', 'file', 'input', 'output', 'db', 'request-id'],
    booleans: ['overwrite', 'pretty'],
    required: ['project-id', 'file', 'input', 'output'],
  },
  'reminders.scan': {
    values: ['as-of', 'db', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'reminders.list': {
    values: ['db', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'reminders.ack': {
    values: ['id', 'fingerprint', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['id', 'fingerprint'],
  },
  'history.search': {
    values: ['scope', 'client', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['scope'],
  },
  'ssr.submit': {
    values: [
      'version',
      'project-id',
      'input',
      'expected-revision',
      'db',
      'request-id',
    ],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'ssr.result': {
    values: ['project-id', 'input', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'ssr.close': {
    values: ['project-id', 'input', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'ssr.followup': {
    values: ['project-id', 'input', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'input', 'expected-revision'],
  },
  'cpq.match': {
    values: ['project-id', 'scope', 'db', 'request-id'],
    booleans: ['pretty'],
    required: ['project-id', 'scope'],
  },
  'cpq.confirm': {
    values: [
      'project-id',
      'confirmed-by',
      'expected-revision',
      'db',
      'request-id',
    ],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'confirmed-by', 'expected-revision'],
  },
  'cpq.solve': {
    values: ['project-id', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'expected-revision'],
  },
  'cpq.archive': {
    values: ['project-id', 'expected-revision', 'db', 'request-id'],
    booleans: ['compact', 'pretty'],
    required: ['project-id', 'expected-revision'],
  },
  'cpq.export': {
    values: ['project-id', 'archive-id', 'output', 'db', 'request-id'],
    booleans: ['pretty', 'overwrite'],
    required: ['project-id', 'archive-id', 'output'],
  },
  'quote.export': {
    values: ['project-id', 'output', 'db', 'request-id'],
    booleans: ['pretty', 'overwrite'],
    required: ['project-id', 'output'],
  },
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
    values: ['project-id', 'version', 'db', 'input', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'cost.calculate': {
    values: ['project-id', 'version', 'db', 'input', 'request-id'],
    booleans: ['pretty'],
    required: [],
  },
  'cost.export': {
    values: [
      'project-id',
      'version',
      'db',
      'input',
      'output',
      'format',
      'request-id',
    ],
    booleans: ['overwrite', 'pretty'],
    required: ['output'],
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
let compactRequested = false;
let compactSubjectId;
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
const success = (kind, data, warnings = [], dataSchemaVersion = null) => {
  if (compactRequested && kind === 'WorkspaceRecordResult') {
    kind = 'MutationResult';
    data = mutationReceipt(data, responseCommand, compactSubjectId);
  }
  return {
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
  };
};

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
  if (
    Boolean(options.input) === Boolean(options['project-id']) ||
    (options.version && !options['project-id'])
  )
    throw new CliFault(
      'INVALID_INPUT_SOURCE',
      'Use either --input REQUEST or --project-id ID [--version V1].',
      EXIT.USAGE,
    );
  const snapshot = options.input
    ? await readCommandRequest(
        options,
        'CostSnapshotRequest',
        'cost-export',
        COST_EXPORT_SCHEMA_VERSION,
      )
    : await withWorkspaceRepository(options, (repository) => {
        const record = repository.get(String(options['project-id']));
        if (!record)
          throw new CliFault(
            'WORKSPACE_NOT_FOUND',
            'Project not found.',
            EXIT.NOT_FOUND,
          );
        const w = record.workspace,
          version = options.version || w.activeVersion;
        const v = w.costVersions.find((v) => v.code === version);
        if (!v)
          throw new CliFault(
            'VERSION_NOT_FOUND',
            'Cost version not found.',
            EXIT.NOT_FOUND,
          );
        return {
          schemaVersion: COST_EXPORT_SCHEMA_VERSION,
          exportedAt: new Date().toISOString(),
          project: w.project,
          costVersion: { code: v.code, status: v.state },
          rateSettings: v.rateSettings,
          travelSettings: v.travelSettings,
          resourceTypes: v.resourceTypes,
          costRows: v.costRows,
          manualCosts: v.manualCosts,
          ...(v.subcontractCost ? { subcontractCost: v.subcontractCost } : {}),
        };
      });
  const validated = await validateWithSchema('cost-export', snapshot);
  if (!validated.valid)
    throw new CliFault(
      'SCHEMA_VALIDATION_FAILED',
      'Invalid cost export snapshot.',
      EXIT.VALIDATION,
      { violations: validated.violations },
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
  enabled: travel.enabled,
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
  const {
    RepositoryConflictError,
    RepositoryNotFoundError,
    WorkspaceValidationError,
    openWorkspaceRepository,
  } = await import('../server/workspace-repository.mjs');
  const repository = openWorkspaceRepository(resolveDatabasePath(options));
  try {
    return await action(repository);
  } catch (error) {
    if (error instanceof RepositoryNotFoundError)
      throw new CliFault(
        error.deleted ? 'PROJECT_DELETED' : 'NOT_FOUND',
        error.message,
        EXIT.NOT_FOUND,
      );
    if (
      error instanceof WorkspaceValidationError ||
      error.name === 'GlobalMasterDataValidationError'
    ) {
      throw new CliFault(
        'BUSINESS_VALIDATION_FAILED',
        error.message,
        EXIT.BUSINESS_RULE,
        {
          violations: error.violations,
          dataSchemaVersion: '1.0.0',
        },
      );
    }
    if (
      error instanceof RepositoryConflictError ||
      error.name === 'GlobalMasterDataConflictError'
    ) {
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
  compactRequested = Boolean(options.compact);
  if (
    [
      'project.workflow-action',
      'workflow.preview',
      'workflow.publish',
    ].includes(resolved.command)
  ) {
    const input = await readCommandRequest(
      options,
      'OperationRequest',
      'operations',
      '1.0.0',
    );
    if (input.operation !== resolved.command)
      throw new CliFault(
        'OPERATION_MISMATCH',
        'Request operation must match command.',
        EXIT.VALIDATION,
      );
    return withWorkspaceRepository(options, (repository) => {
      const revision = parseExpectedRevision(options['expected-revision']);
      let data;
      if (resolved.command === 'project.workflow-action') {
        const record = repository.applyWorkflowAction(
          String(options['project-id']),
          input.action,
          revision,
        );
        data = {
          projectId: record.workspace.project.id,
          revision: record.revision,
          updatedAt: record.updatedAt,
          workflowVersion: record.workspace.workflowVersion,
          ...(record.workspace.workflowHold
            ? { workflowHold: record.workspace.workflowHold }
            : {}),
          nodeCode: input.action.nodeCode,
          action: input.action.action,
        };
      } else {
        const settings = {
          migrateActiveProjectIds: input.migrateActiveProjectIds || [],
        };
        data =
          resolved.command === 'workflow.preview'
            ? repository.previewWorkflowPublication(
                input.steps,
                revision,
                settings,
              )
            : repository.publishWorkflow(
                input.steps,
                revision,
                input.projectRevisions,
                settings,
              );
      }
      return success('OperationResult', data, [], '1.0.0');
    });
  }

  if (
    resolved.command === 'masterdata.get' ||
    resolved.command === 'masterdata.update'
  ) {
    const update = resolved.command === 'masterdata.update';
    const input = update
      ? await readCommandRequest(
          options,
          'OperationRequest',
          'operations',
          '1.0.0',
        )
      : null;
    if (input && input.operation !== 'masterdata.update')
      throw new CliFault(
        'OPERATION_MISMATCH',
        'Request operation must match command.',
        EXIT.VALIDATION,
      );
    return withWorkspaceRepository(options, (repository) => {
      const record = update
        ? repository.globalMasterData.update(
            options.tab,
            input.changes,
            parseExpectedRevision(options['expected-revision']),
          )
        : repository.globalMasterData.get(options.tab, options);
      return success(
        update ? 'GlobalMasterDataMutationResult' : 'GlobalMasterDataResult',
        update
          ? {
              scope: 'global',
              tab: record.tab,
              revision: record.revision,
              updatedAt: record.updatedAt,
              changedIds: (input.changes.upsert || []).map(
                (item) => item[record.keyField],
              ),
              removedIds: input.changes.remove || [],
              unresolvedKeys: record.conflicts.map((c) => c.key),
            }
          : record,
        [],
        '1.0.0',
      );
    });
  }
  if (resolved.command === 'project.apply-masterdata') {
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        applyProjectMasterData(
          repository,
          options['project-id'],
          options.tab,
          parseExpectedRevision(options['expected-revision']),
        ),
        [],
        '1.0.0',
      ),
    );
  }
  if (resolved.command === 'project.create') {
    const input = await readCommandRequest(
      options,
      'OperationRequest',
      'operations',
      '1.0.0',
    );
    if (input.operation !== 'project.create')
      throw new CliFault(
        'OPERATION_MISMATCH',
        'Request operation must match command.',
        EXIT.VALIDATION,
      );
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        createProject(repository, input.project),
        [],
        '1.0.0',
      ),
    );
  }
  if (resolved.command === 'cost.create')
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        createCostDraft(
          repository,
          String(options['project-id']),
          { mode: options.mode, sourceVersion: options['source-version'] },
          parseExpectedRevision(options['expected-revision']),
        ),
        [],
        '1.0.0',
      ),
    );

  if (resolved.command === 'cost.delete')
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        deleteCostVersion(
          repository,
          String(options['project-id']),
          String(options.version),
          parseExpectedRevision(options['expected-revision']),
        ),
        [],
        '1.0.0',
      ),
    );

  if (resolved.command === 'project.list')
    return withWorkspaceRepository(options, (repository) =>
      success(
        'ProjectListResult',
        { items: repository.headers(Boolean(options.deleted)) },
        [],
        '1.0.0',
      ),
    );
  if (['project.delete', 'project.restore'].includes(resolved.command))
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        repository.setDeleted(
          String(options['project-id']),
          parseExpectedRevision(options['expected-revision']),
          resolved.command === 'project.delete',
        ),
        [],
        '1.0.0',
      ),
    );
  if (resolved.command === 'cost.apply-rates')
    return withWorkspaceRepository(options, (repository) =>
      success(
        'MutationResult',
        applyMasterRates(
          repository,
          String(options['project-id']),
          String(options.version),
          parseExpectedRevision(options['expected-revision']),
        ),
        [],
        '1.0.0',
      ),
    );
  if (
    [
      'project.get',
      'project.update',
      'cost.get',
      'cost.update',
      'cpq.get',
      'cpq.update',
      'quote.get',
      'quote.update',
      'ssr.get',
      'ssr.update',
      'boq.get',
      'boq.update',
    ].includes(resolved.command)
  ) {
    const [module, action] = resolved.command.split('.');
    const input =
      action === 'update'
        ? await readCommandRequest(
            options,
            'OperationRequest',
            'operations',
            '1.0.0',
          )
        : null;
    if (input && input.operation !== resolved.command)
      throw new CliFault(
        'OPERATION_MISMATCH',
        'Request operation must match command.',
        EXIT.VALIDATION,
      );
    return withWorkspaceRepository(options, (repository) =>
      success(
        action === 'get' ? 'ResourceResult' : 'MutationResult',
        action === 'get'
          ? readResource(
              repository,
              String(options['project-id']),
              module,
              options,
            )
          : updateResource(
              repository,
              String(options['project-id']),
              module,
              options,
              input.changes,
              parseExpectedRevision(options['expected-revision']),
            ),
        [],
        '1.0.0',
      ),
    );
  }

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
      workflowActions: [...WORKFLOW_ACTIONS],
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
      workflowActions: [...WORKFLOW_ACTIONS],
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
      if (repository.schemaVersion !== LOCAL_DATABASE_SCHEMA_VERSION) {
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
    const { assertMaintenanceImport } =
      await import('../features/master-data/maintenance-import.ts');
    try {
      assertMaintenanceImport(input);
    } catch (error) {
      throw new CliFault(
        'BUSINESS_VALIDATION_FAILED',
        error.message,
        EXIT.BUSINESS_RULE,
        {
          violations: [
            {
              path: '/records',
              rule: 'maintenanceIntegrity',
              message: error.message,
            },
          ],
          dataSchemaVersion: '1.0.0',
        },
      );
    }
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
      const projects = repository.list(asOf);
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
  if (['maintenance.archive', 'maintenance.export'].includes(resolved.command))
    return withWorkspaceRepository(options, async (repository) => {
      const record = repository.get(String(options['project-id']));
      if (!record)
        throw new CliFault(
          'WORKSPACE_NOT_FOUND',
          'Workspace not found',
          EXIT.NOT_FOUND,
        );
      const w = record.workspace;
      const { archiveMaintenance, buildMaintenanceWorkbook, emptyMaintenance } =
        await import('../features/maintenance/domain.ts');
      const data = w.maintenanceBoq || emptyMaintenance();
      try {
        if (resolved.command === 'maintenance.archive')
          return success(
            'WorkspaceRecordResult',
            repository.save(
              w.project.id,
              {
                ...w,
                maintenanceBoq: archiveMaintenance(
                  data,
                  w.maintenancePriceRecords,
                  w.project.client,
                ),
              },
              parseExpectedRevision(options['expected-revision']),
            ),
            [],
            '1.0.0',
          );
        const archive = data.archives.find(
          (a) => a.id === options['archive-id'],
        );
        if (!archive) throw new TypeError('Archive not found');
        const bytes = await buildMaintenanceWorkbook(archive);
        const { writeXlsxArtifact } = await import('../server/artifact-io.mjs');
        return success(
          'WorkbookExportResult',
          {
            artifact: await writeXlsxArtifact(
              String(options.output),
              bytes,
              Boolean(options.overwrite),
            ),
            sheets: await readWorkbookSheetNames(bytes),
          },
          [],
          '1.0.0',
        );
      } catch (error) {
        if (error.name === 'RepositoryConflictError') throw error;
        throw new CliFault(
          'MAINTENANCE_FAILED',
          error.message,
          EXIT.BUSINESS_RULE,
        );
      }
    });
  if (resolved.command === 'workbook.inspect') {
    const { inspectCostWorkbook } =
      await import('../features/cost/import-workbook.ts');
    return success(
      'OperationResult',
      await inspectCostWorkbook(
        await readWorkbookFile(String(options.file)),
        Number(options['header-row'] || 1),
      ),
      [],
      '1.0.0',
    );
  }
  if (resolved.command.startsWith('reminders.'))
    return withWorkspaceRepository(options, (repository) => {
      return import('../server/reminder-service.mjs').then(
        ({ openReminderService }) => {
          const service = openReminderService(
            resolveDatabasePath(options),
            repository,
          );
          try {
            const data =
              resolved.command === 'reminders.scan'
                ? service.scan(options['as-of'])
                : resolved.command === 'reminders.ack'
                  ? {
                      items: service.acknowledge(
                        String(options.id),
                        String(options.fingerprint),
                      ),
                    }
                  : { items: service.list() };
            return success('OperationResult', data, [], '1.0.0');
          } finally {
            service.close();
          }
        },
      );
    });
  if (resolved.command === 'history.search')
    return withWorkspaceRepository(options, async (repository) => {
      const { searchScopeHistory } =
        await import('../features/history/domain.ts');
      const workspaces = repository
        .list()
        .map((p) => repository.get(p.projectId).workspace);
      return success(
        'OperationResult',
        {
          items: searchScopeHistory(
            workspaces,
            String(options.scope),
            options.client ? String(options.client) : undefined,
          ),
        },
        [],
        '1.0.0',
      );
    });
  if (
    [
      'boq.import',
      'cost.import',
      'ssr.submit',
      'ssr.result',
      'ssr.close',
      'ssr.followup',
      'workbook.fill-template',
    ].includes(resolved.command)
  ) {
    const input = await readCommandRequest(
      options,
      'OperationRequest',
      'operations',
      '1.0.0',
    );
    if (input.operation !== resolved.command)
      throw new CliFault(
        'OPERATION_MISMATCH',
        'Request operation must match command',
        EXIT.VALIDATION,
      );
    compactSubjectId = input.submissionId;
    return withWorkspaceRepository(options, async (repository) => {
      const record = repository.get(String(options['project-id']));
      if (!record)
        throw new CliFault(
          'WORKSPACE_NOT_FOUND',
          'Workspace not found',
          EXIT.NOT_FOUND,
        );
      const w = record.workspace;
      try {
        if (resolved.command === 'boq.import') {
          const { importBoq, appendBoq, emptyMaintenance } =
            await import('../features/maintenance/domain.ts');
          const rows = await importBoq(
            await readWorkbookFile(String(options.file)),
            path.basename(String(options.file)),
            input.mapping,
          );
          if (!options.apply)
            return success('OperationResult', { rows }, [], '1.0.0');
          if (options['expected-revision'] === undefined)
            throw new TypeError('--apply requires --expected-revision');
          const current = w.maintenanceBoq || emptyMaintenance();
          if (
            rows.some((r) =>
              current.boq.some(
                (old) => old.id === r.id || old.source === r.source,
              ),
            )
          )
            throw new TypeError('BOQ rows already imported');
          return success(
            'WorkspaceRecordResult',
            repository.save(
              w.project.id,
              {
                ...w,
                maintenanceBoq: {
                  ...current,
                  boq: appendBoq(current.boq, rows),
                },
              },
              parseExpectedRevision(options['expected-revision']),
            ),
            [],
            '1.0.0',
          );
        }
        if (resolved.command === 'cost.import') {
          const { previewCostImport, applyCostImport } =
            await import('../features/cost/import-workbook.ts');
          const version = options.version || w.activeVersion;
          const target = w.costVersions.find((v) => v.code === version);
          if (!target)
            throw new CliFault(
              'NOT_FOUND',
              'Cost version not found.',
              EXIT.NOT_FOUND,
            );
          if (options.apply && costLockReason(w, version))
            throw new TypeError(costLockReason(w, version));
          const resources = target.resourceTypes || w.resourceTypes;
          const preview = await previewCostImport(
            await readWorkbookFile(String(options.file)),
            path.basename(String(options.file)),
            input.mapping,
            resources,
            target.rateSettings,
          );
          if (!options.apply)
            return success(
              'OperationResult',
              {
                ...preview,
                projectId: record.projectId,
                revision: record.revision,
                version,
              },
              [],
              '1.0.0',
            );
          if (options['expected-revision'] === undefined)
            throw new TypeError('--apply requires --expected-revision');
          target.costRows = applyCostImport(target.costRows, preview, {
            resources,
            rates: target.rateSettings,
          });
          syncVersion(w, version);
          const saved = repository.save(
            w.project.id,
            w,
            parseExpectedRevision(options['expected-revision']),
          );
          if (!options.compact)
            return success('WorkspaceRecordResult', saved, [], '1.0.0');
          return success(
            'MutationResult',
            {
              ...mutationReceipt(saved, '', undefined, version),
              resource: 'cost',
              section: 'rows',
              version,
              changedIds: preview.rows.map((row) => row.id),
            },
            [],
            '1.0.0',
          );
        }
        if (resolved.command === 'workbook.fill-template') {
          const { fillTemplateWorkbook } =
            await import('../features/excel/template-workbook.ts');
          const { writeXlsxArtifact } =
            await import('../server/artifact-io.mjs');
          if (path.extname(String(options.file)).toLowerCase() !== '.xlsx')
            throw new TypeError('Only .xlsx templates are supported');
          if (
            path.resolve(String(options.file)) ===
            path.resolve(String(options.output))
          )
            throw new TypeError(
              'Export to a different file to preserve the original template',
            );
          const inputStat = await stat(String(options.file));
          const outputStat = await stat(String(options.output)).catch((e) => {
            if (e.code === 'ENOENT') return null;
            throw e;
          });
          if (
            outputStat &&
            inputStat.dev === outputStat.dev &&
            inputStat.ino === outputStat.ino
          )
            throw new TypeError(
              'Output refers to the original template; choose a different file',
            );
          const quoteNumber = `QT-${w.project.id}-${Date.now()}`;
          const result = await fillTemplateWorkbook(
            await readWorkbookFile(String(options.file)),
            input,
            w,
            quoteNumber,
          );
          const artifact = await writeXlsxArtifact(
            String(options.output),
            result.bytes,
            Boolean(options.overwrite),
          );
          if (input.purpose === 'quote') {
            const { validatedQuoteInput } =
              await import('../features/quote/validated-input.ts');
            const q = validatedQuoteInput(w, quoteNumber);
            // History construction is shared with the standard exporter below.
            const { quoteHistoryRecord } =
              await import('../features/quote/history-record.ts');
            try {
              repository.save(
                w.project.id,
                {
                  ...w,
                  quoteHistory: [
                    ...w.quoteHistory,
                    quoteHistoryRecord(
                      q,
                      artifact,
                      `Template ${result.templateSha256}; mapping ${input.version};`,
                    ),
                  ],
                },
                record.revision,
              );
            } catch (error) {
              throw new TypeError(
                `Artifact exists at ${artifact.path}; quotation history save failed: ${error.message}`,
              );
            }
          }
          return success(
            'WorkbookExportResult',
            { artifact, sheets: await readWorkbookSheetNames(result.bytes) },
            [],
            '1.0.0',
          );
        }
        const domain = await import('../features/ssr/domain.ts');
        if (w.workflowMode === 'project')
          throw new TypeError(
            'Historical SSR reviews are read-only. Use project update --section workflow-tracking.',
          );
        let next = w.ssr || domain.emptySsr();
        if (resolved.command === 'ssr.submit') {
          const versionCode =
            options.version || w.workflowVersion || w.activeVersion;
          const reviewBaseline = w.costVersions.find(
            (v) => v.code === versionCode,
          );
          if (!reviewBaseline) throw new TypeError('Cost version not found.');
          next = domain.recordSubmission(next, reviewBaseline, {
            kind: input.kind,
            domain: input.domain,
            owner: input.owner,
            dueDate: input.dueDate,
            applicationNumber: input.applicationNumber,
            evidence: input.evidence,
          });
        }
        if (resolved.command === 'ssr.result')
          next = domain.recordReviewResult(next, input.submissionId, {
            outcome: input.outcome,
            evidence: input.evidence,
            conditions: input.conditions,
          });
        if (resolved.command === 'ssr.close')
          next = domain.closeCondition(
            next,
            input.submissionId,
            input.condition,
            input.evidence,
          );
        if (resolved.command === 'ssr.followup')
          next = domain.followUpSubmission(
            next,
            input.submissionId,
            input.note,
            input.nextDate,
          );
        return success(
          'WorkspaceRecordResult',
          repository.save(
            w.project.id,
            { ...w, ssr: next },
            parseExpectedRevision(options['expected-revision']),
          ),
          [],
          '1.0.0',
        );
      } catch (error) {
        if (error.name === 'RepositoryConflictError') throw error;
        if (error instanceof CliFault) throw error;
        throw new CliFault(
          'OPERATION_FAILED',
          error.message,
          EXIT.BUSINESS_RULE,
        );
      }
    });
  }
  if (
    resolved.command.startsWith('cpq.') ||
    resolved.command === 'quote.export'
  ) {
    return withWorkspaceRepository(options, async (repository) => {
      const record = repository.get(String(options['project-id']));
      if (!record)
        throw new CliFault(
          'WORKSPACE_NOT_FOUND',
          'Workspace not found.',
          EXIT.NOT_FOUND,
        );
      const workspace = record.workspace;
      const { emptyCpq, matchCatalog, confirmMapping, solveCpq, archiveCpq } =
        await import('../features/cpq/domain.ts');
      const cpq = workspace.cpq || emptyCpq();
      const baseline = workspace.costVersions.find(
        (version) =>
          version.code === (cpq.draft.costVersion || workspace.activeVersion),
      );
      try {
        if (resolved.command === 'cpq.match')
          return success(
            'CpqMatchResult',
            {
              projectId: record.projectId,
              revision: record.revision,
              brief: String(options.scope),
              candidates: matchCatalog(cpq.catalog, String(options.scope)).map(
                ({ item, score, reason }) => ({
                  code: item.code,
                  scope: item.scope,
                  unit: item.unit,
                  unitCost: item.unitCost,
                  kind: item.kind,
                  adjustable: item.adjustable,
                  step: item.step,
                  minQty: item.minQty,
                  maxQty: item.maxQty,
                  referenceQty: item.referenceQty,
                  score,
                  reason,
                }),
              ),
            },
            [],
            '1.0.0',
          );
        if (
          ['cpq.confirm', 'cpq.solve', 'cpq.archive'].includes(resolved.command)
        ) {
          const expected = parseExpectedRevision(options['expected-revision']);
          let next;
          if (resolved.command === 'cpq.confirm')
            next = confirmMapping(cpq, String(options['confirmed-by']));
          else if (resolved.command === 'cpq.solve')
            next = {
              ...cpq,
              draft: { ...cpq.draft, result: solveCpq(cpq, baseline) },
            };
          else
            next = archiveCpq(
              cpq,
              baseline,
              workspace.ssr?.proposalNumber || '',
            );
          const saved = repository.save(
            workspace.project.id,
            { ...workspace, cpq: next },
            expected,
          );
          return success('WorkspaceRecordResult', saved, [], '1.0.0');
        }
        let bytes, quoteInput;
        if (resolved.command === 'cpq.export') {
          const archived = cpq.archives.find(
            (entry) => entry.id === options['archive-id'],
          );
          if (!archived)
            throw new CliFault(
              'ARCHIVE_NOT_FOUND',
              'CPQ archive not found.',
              EXIT.NOT_FOUND,
            );
          const { buildCpqWorkbook } =
            await import('../features/cpq/export-workbook.ts');
          bytes = await buildCpqWorkbook(archived);
        } else {
          const { validatedQuoteInput } =
            await import('../features/quote/validated-input.ts');
          const { buildQuoteWorkbookBuffer } =
            await import('../features/quote/export-quote-workbook.ts');
          quoteInput = validatedQuoteInput(
            workspace,
            `QT-${workspace.project.id}-${workspace.activeVersion}-${Date.now()}`,
          );
          bytes = await buildQuoteWorkbookBuffer(quoteInput);
        }
        const { writeXlsxArtifact } = await import('../server/artifact-io.mjs');
        const artifact = await writeXlsxArtifact(
          String(options.output),
          bytes,
          Boolean(options.overwrite),
        );
        if (quoteInput) {
          const { quoteHistoryRecord } =
            await import('../features/quote/history-record.ts');
          const history = quoteHistoryRecord(quoteInput, artifact);
          try {
            repository.save(
              workspace.project.id,
              {
                ...workspace,
                quoteHistory: [history, ...workspace.quoteHistory],
              },
              record.revision,
            );
          } catch (error) {
            throw new CliFault(
              'QUOTE_HISTORY_SAVE_FAILED',
              `Workbook exists at ${artifact.path}, but history was not saved: ${error.message}`,
              EXIT.CONFLICT,
            );
          }
        }
        return success(
          'WorkbookExportResult',
          { artifact, sheets: await readWorkbookSheetNames(bytes) },
          [],
          '1.0.0',
        );
      } catch (error) {
        if (
          error instanceof CliFault ||
          error?.name === 'RepositoryConflictError' ||
          error?.name === 'WorkspaceValidationError'
        )
          throw error;
        if (error?.code === 'EEXIST')
          throw new CliFault(
            'OUTPUT_ALREADY_EXISTS',
            'Output already exists.',
            EXIT.CONFLICT,
          );
        throw new CliFault(
          'BUSINESS_VALIDATION_FAILED',
          error.message,
          EXIT.BUSINESS_RULE,
        );
      }
    });
  }
  if (
    ['cost.validate', 'cost.calculate', 'cost.export'].includes(
      resolved.command,
    )
  ) {
    if (
      resolved.command === 'cost.export' &&
      options.format &&
      !['full', 'simple'].includes(options.format)
    )
      throw new CliFault(
        'INVALID_EXPORT_FORMAT',
        '--format must be full or simple.',
        EXIT.USAGE,
      );
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
      snapshot.subcontractCost,
    );
    if (resolved.command === 'cost.calculate') {
      const summary = (dimension) =>
        buildReconciledCostDimensionSummary(
          snapshot.costRows,
          dimension,
          snapshot.resourceTypes,
          travel.totalCost,
          snapshot.manualCosts,
          snapshot.subcontractCost,
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
              snapshot.subcontractCost,
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
        {
          dataSchemaVersion: COST_EXPORT_SCHEMA_VERSION,
        },
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
      if (options.format === 'simple') {
        const { buildSimpleCostWorkbookBytes } =
          await import('../features/cost/export-simple-workbook.ts');
        bytes = await buildSimpleCostWorkbookBytes(snapshot);
      } else {
        const { buildCostWorkbookBytes } =
          await import('../features/cost/export-workbook.ts');
        bytes = await buildCostWorkbookBytes(snapshot);
      }
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
      await writeFile(outputPath, bytes, {
        flag: options.overwrite ? 'w' : 'wx',
      });
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw new CliFault(
          'OUTPUT_ALREADY_EXISTS',
          'Output exists; pass --overwrite to replace it.',
          EXIT.CONFLICT,
        );
      }
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
