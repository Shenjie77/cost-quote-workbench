# cost-cli v2 Agent control manual

This is the handoff contract for people, scripts, and Agent Skills that control
the local Cost & Quote Workbench. The CLI is intentionally non-interactive.
It validates supplied snapshots, calculates cost, creates an internal Excel
workbook, and safely reads/writes the local SQLite workspace. It does not
connect to the company quotation platform.

## 1. Runtime and entry point

- Node.js: `>=22.18.0` (required for default TypeScript type stripping).
- Repository command: `npm run --silent cost-cli -- <command>`.
- Direct command: `node /absolute/repository/path/cli/cost-cli.mjs <command>`.
- Installed package binary: `cost-cli <command>`.

An Agent should use absolute input and output paths. Relative paths are resolved
from the caller's current working directory and are therefore easy to misuse.

## 2. Discovery before work

Run discovery at the start of a session and after any application upgrade:

```bash
npm run --silent cost-cli -- version
npm run --silent cost-cli -- system doctor
npm run --silent cost-cli -- system capabilities
npm run --silent cost-cli -- schema list
npm run --silent cost-cli -- schema show \
  --name cost-export \
  --schema-version 2.0.0
```

`system capabilities` is authoritative for API, input schema, calculation,
workbook, year-bucket, and rounding versions. Schema descriptors contain the
absolute file path and SHA-256 so an Agent can detect a changed contract.

## 3. Commands

| Command                | Required options                 | Optional options                               | Result kind                   | Writes files             |
| ---------------------- | -------------------------------- | ---------------------------------------------- | ----------------------------- | ------------------------ |
| `version`              | —                                | `--request-id`, `--pretty`                     | `VersionResult`               | No                       |
| `help`                 | —                                | `--request-id`, `--pretty`                     | `HelpResult`                  | No                       |
| `system capabilities`  | —                                | `--request-id`, `--pretty`                     | `CapabilitiesResult`          | No                       |
| `system doctor`        | —                                | `--request-id`, `--pretty`                     | `DoctorResult`                | No                       |
| `schema list`          | —                                | `--request-id`, `--pretty`                     | `SchemaListResult`            | No                       |
| `schema show`          | `--name`                         | `--schema-version`, `--request-id`, `--pretty` | `SchemaResult`                | No                       |
| `cost validate`        | `--input`                        | `--request-id`, `--pretty`                     | `CostValidationResult`        | No                       |
| `cost calculate`       | `--input`                        | `--request-id`, `--pretty`                     | `CostCalculationResult`       | No                       |
| `cost export`          | `--input`, `--output`            | `--overwrite`, `--request-id`, `--pretty`      | `CostExportResult`            | One `.xlsx`              |
| `maintenance validate` | `--input`                        | `--request-id`, `--pretty`                     | `MaintenanceValidationResult` | No                       |
| `digest generate`      | —                                | `--as-of`, `--db`, `--request-id`, `--pretty`  | `DigestResult`                | Initializes/reads SQLite |
| `workspace list`       | —                                | `--db`, `--request-id`, `--pretty`             | `WorkspaceListResult`         | Initializes/reads SQLite |
| `workspace get`        | `--project-id`                   | `--db`, `--request-id`, `--pretty`             | `WorkspaceRecordResult`       | Initializes/reads SQLite |
| `workspace save`       | `--input`, `--expected-revision` | `--db`, `--request-id`, `--pretty`             | `WorkspaceRecordResult`       | SQLite                   |

`--input -` reads UTF-8 JSON from stdin. Options use only `--name value`;
`--name=value` is rejected. Unknown, duplicate, missing-value, and positional
arguments are errors. Export refuses to replace a file unless `--overwrite` is
present.

## 4. Input request envelope

Every command that consumes JSON requires this transport wrapper:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "CostSnapshotRequest",
  "requestId": "req_20260904_001",
  "actor": {
    "type": "agent",
    "id": "cost-workbench-skill"
  },
  "data": {
    "schemaVersion": "2.0.0"
  }
}
```

The abbreviated `data` above is explanatory only. A real request must satisfy
the complete cost schema. Use
`tests/fixtures/cost-request.valid.json` as the executable cost example and
`tests/fixtures/maintenance-request.valid.json` as the maintenance example.

Request kinds are fixed:

- `CostSnapshotRequest` for `cost validate`, `cost calculate`, and
  `cost export`;
- `MaintenancePriceRequest` for `maintenance validate`.
- `WorkspaceSaveRequest` for `workspace save`; its `data` must satisfy
  `workspace-state/1.0.0`.

If `--request-id` is also supplied, it must exactly match the envelope
`requestId`. Raw snapshots are rejected with `REQUEST_ENVELOPE_REQUIRED`.

Validation runs in this order:

1. JSON syntax;
2. `command-request/2.0.0` envelope;
3. expected request kind and correlation ID;
4. command-specific `data.schemaVersion`;
5. command-specific JSON Schema;
6. shared cross-record business validation.

## 5. Response envelope and stdout rule

stdout always contains exactly one JSON object followed by a newline. The CLI
does not mix logs, prompts, tables, or progress with stdout. A non-zero process
status still returns an `ErrorResult` on stdout.

Success shape:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "CostValidationResult",
  "requestId": "req_20260904_001",
  "command": "cost.validate",
  "ok": true,
  "data": {
    "valid": true,
    "errorCount": 0,
    "warningCount": 0
  },
  "meta": {
    "envelopeVersion": "2.0.0",
    "dataSchemaVersion": "2.0.0",
    "generatedAt": "2026-09-04T10:00:00.000Z",
    "warnings": []
  }
}
```

Failure shape:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "ErrorResult",
  "requestId": "req_20260904_001",
  "command": "cost.validate",
  "ok": false,
  "data": null,
  "error": {
    "code": "SCHEMA_VALIDATION_FAILED",
    "message": "cost-export data does not match schema 2.0.0.",
    "retryable": false,
    "violations": [
      {
        "path": "/data/costRows/0/years/0/bucket",
        "rule": "const",
        "message": "must be equal to constant"
      }
    ]
  },
  "meta": {
    "envelopeVersion": "2.0.0",
    "dataSchemaVersion": "2.0.0",
    "generatedAt": "2026-09-04T10:00:00.000Z",
    "warnings": []
  }
}
```

Before printing, the CLI validates its own response against
`command-envelope/2.0.0`. A programming mismatch is replaced by
`OUTPUT_CONTRACT_VIOLATION` with exit status 70. Error responses may echo an
unknown attempted command; successful responses allow only implemented names.

Warnings never make `ok` false. An Agent must still show them to the user before
the final workbook is accepted.

## 6. Cost data contract

The authoritative contract is `schemas/cost-export.schema.json` version 2.0.0.
Important rules are:

- `project.currency` is currently `SGD`;
- user Scope is stored exactly as entered and has no separate translated name;
- every cost line has one stable `reTypeId`;
- RE Type already contains personnel family and level; cost rows do not carry a
  second Grade field;
- each line contains exactly five ordered allocations with explicit
  discriminators: `Y1`, `Y2`, `Y3`, `Y4`, `Y5`;
- each allocation accepts only `{bucket, sites, cost}`;
- `sites` is a non-negative integer;
- mandays are calculated as `sites × mdPerSite` and are never submitted;
- annual allocation requires a real TD delivery start date.

`workspace-state/1.0.0` is deliberately more permissive than cost export:
`scope`, `bu`, and `reTypeId` may be empty while a draft row is being edited.
Before `cost validate`, `cost calculate`, or `cost export`, the Agent must fill
those fields because the cost snapshot contract remains strict.

The workspace also carries the fields used by Project List and project tabs:

- `projectStatus` is a manual status code and must reference one
  `projectStatusDefinitions[].code`; an Agent may change it only when the user
  requested that project-state update.
- `projectStatusDefinitions[]` is the project-specific status dictionary used
  by the Project List selector. Keep `code` stable for automation; `name` and
  `nameZh` are editable display labels, and `active: false` hides an option from
  new selections while preserving historical/current references.
- `currentWorkflowStepCode` is the Project List workflow selection. It must be
  empty only when `processSteps[]` is empty; otherwise it references one stable
  `processSteps[].code`. Agents must update this code instead of relying on an
  array position.
- `selectedStep` is retained for v1 compatibility. Keep it equal to the array
  index of `currentWorkflowStepCode`; the browser and repository migration
  synchronize it automatically.
- `activeVersion` identifies the cost snapshot loaded by the UI.
- `costVersions[]` contains complete independent cost inputs. To create a
  version, read the latest workspace revision, clone the active snapshot,
  assign the next `V<number>` code, set `sourceVersion`, append it, set
  `activeVersion`, mirror the new snapshot into the top-level live cost fields,
  and save with the exact revision.
- `costVersions[].state` is a user-controlled enum: `Draft`, `Suspended`, or
  `Confirmed`. Creating or selecting a version must never change the state of
  any other version. An Agent may change a state only when the user explicitly
  requests that lifecycle update.
- `processSteps[]` contains the project's workflow nodes. Keep `code` stable for
  machine operations; the user-editable fields are `name`, `nameZh`, `owner`,
  `state`, and `required`. Workflow state is one of `completed`, `in_progress`,
  `awaiting_review`, `blocked`, or `not_started`; `tone` must match the canonical
  presentation mapping used by the UI.
- `pricing` contains `targetGrossMargin`, `discount`, and `gstPercent`.
- `reviewGates[]` contains user-created review checkpoints. Each record belongs
  to the same `project.id`, has an explicit owner, due date, status, evidence,
  optional workflow-code reference, and append-only `followUps[]` entries.
- `quoteTemplates[]` contains client-output labels and commercial terms;
  `selectedQuoteTemplateId` must reference one of them.
- `quoteAssumptions[]` contains includable bilingual output assumptions.
- `quoteHistory[]` records the exact cost version, template, pricing results,
  status, timestamp, and note for generated or manually entered quotations.

Do not create a version by changing only `activeVersion`; that produces a label
without an auditable input snapshot. Do not reuse one snapshot object for two
versions, and do not automatically demote the source version to `Draft` or
`Suspended`.

`workspace list` returns calculated Project List fields when a snapshot exists:
`projectStatus`, `statusDefinitions`, `currentWorkflowStepCode`,
`reviewGates`, `workflowSteps`, `activeVersion`, `versionState`,
`serviceCost`, `subcontractCost`, `totalCost`, `totalMandays`, `totalQuote`,
`grossMarginPercent`, and `incompleteCostRows`. Cost and quotation values are
numeric, read-only projections. Update their source workspace fields instead
of trying to write the projections.

There is no Y0 in v2. The array position never substitutes for a missing or
incorrect `bucket` value.

### Resource Type and rate

Resource Type (`resourceTypes`) is the single personnel and rate master:

- supported canonical internal codes are `HQ-L1..L4`, `LOCAL-L1..L4`, and
  `ARP-L0..L4`; unused canonical rows may be removed and later restored;
- internal `code` equals `${pool}-${level}` and stores `mandayRate`;
- `mandaysPerMonth` controls MD↔MM conversion and `hoursPerManday` controls
  MD↔Hour conversion;
- monthly rate = `mandayRate × mandaysPerMonth`;
- hourly rate = `mandayRate ÷ hoursPerManday`;
- only HQ RE Types have `hqTravel: true`;
- subcontract uses `pool: null`, `level: null`, `mandayRate: 0`, and does not
  trigger HQ travel.

The Master Data arrays `processSteps`, `projectStatusDefinitions`,
`resourceTypes`, `subcontractItems`, `supplementalCostItems`, and
`maintenancePriceRecords`, plus `quoteTemplates`, support create and delete
through an atomic `workspace save`. Codes/IDs must be unique within their
array. Deleting the
current status requires assigning another status in the same atomic save, and
at least one status must remain. Never delete a `resourceTypes` row while any
current or historical cost version references its `id`, and keep at least one
RE Type because the workspace and cost-export schemas require a non-empty rate
master. The web UI enforces these protections before deletion.

## 7. Calculation and money rules

All monetary JSON fields and results are numbers, not formatted strings. The
public money rule is ceiling to the next SGD cent:

```text
18848.282 -> 18848.29
```

The CLI may serialize an exact amount as `100`, not `100.00`; JSON numbers do
not preserve display scale. `.00`, thousands separators, and `S$` belong only
to the UI and Excel number format.

Every annual cost and every manually entered statement amount is normalized
with `roundMoney` before roll-up. Parent totals sum those normalized leaves and
are normalized again. The CLI never performs a separate raw sum. This makes
visible two-decimal detail reconcile with visible totals.

Operational quantities use half-up normalization to four decimals. The
`CostCalculationResult.rounding` object declares both rules.

## 8. Required Agent workflow

For a cost workbook, an Agent should:

1. Run `system doctor`; stop on failure.
2. Run `system capabilities` and compare supported versions/buckets.
3. Read `schema show --name cost-export --schema-version 2.0.0` when the
   cached schema hash differs.
4. Construct a request envelope with a unique, stable `requestId`.
5. Run `cost validate`; correct all errors and surface warnings.
6. Run `cost calculate`; show totals and Scope/BU/RE Type summaries for
   user confirmation.
7. Run `cost export` to a new absolute `.xlsx` path.
8. Record the returned path, SHA-256, size, sheet manifest, versions, and
   request ID in the Agent's work log.

Do not use `--overwrite` by default. Do not retry validation or business errors
unchanged. File I/O can be retried only after checking the path/permission;
`retryable` remains the machine authority.

For the daily exception queue, run:

```bash
npm run --silent cost-cli -- digest generate \
  --as-of 2026-09-05 \
  --pretty
```

`--as-of` is optional and must be a real `YYYY-MM-DD` calendar date; omission
uses the workspace's Singapore date. The result
uses the same deterministic rules as the Agent Digest page: blocked, overdue,
or stale open reviews require immediate follow-up; due-soon reviews are
decisions due; non-zero draft cost versions require cost attention; incomplete
cost rows are data-quality items. The command reads SQLite only and never
changes review or project state.

Example:

```bash
npm run --silent cost-cli -- cost validate \
  --input /absolute/path/cost-request.json

npm run --silent cost-cli -- cost calculate \
  --input /absolute/path/cost-request.json \
  --pretty

npm run --silent cost-cli -- cost export \
  --input /absolute/path/cost-request.json \
  --output /absolute/path/PRJ-2026-018_Cost_V3.xlsx
```

For a safe Agent workspace edit:

1. Run `workspace get --project-id ID` and retain `data.revision`.
2. Change only fields authorized by the user inside `data.workspace`.
3. Wrap that workspace in a `WorkspaceSaveRequest` envelope.
4. Run `workspace save --expected-revision REVISION --input FILE`.
5. On `REVISION_CONFLICT`, stop, fetch again, compare changes, and ask before
   replacing any user edits.

`--expected-revision none` is creation-only. `--db` defaults to
`data/workbench.sqlite`; an Agent should normally omit it so the UI and CLI use
the same source of truth.

## 9. Exit statuses

| Status | Meaning                            | Typical codes                                                                                        |
| -----: | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
|      0 | Success                            | —                                                                                                    |
|      2 | Command or option usage error      | `UNKNOWN_COMMAND`, `UNKNOWN_OPTION`, `DUPLICATE_OPTION`, `OPTION_REQUIRED`                           |
|      3 | JSON/request/schema validation     | `MALFORMED_JSON`, `REQUEST_ENVELOPE_REQUIRED`, `UNSUPPORTED_API_VERSION`, `SCHEMA_VALIDATION_FAILED` |
|      4 | Named resource not found           | `SCHEMA_NOT_FOUND`, `SCHEMA_VERSION_NOT_FOUND`, `WORKSPACE_NOT_FOUND`                                |
|      5 | Safe-write conflict                | `OUTPUT_ALREADY_EXISTS`, `REVISION_CONFLICT`                                                         |
|      6 | Cross-record business rule failure | `BUSINESS_VALIDATION_FAILED`                                                                         |
|      8 | Input/output file failure          | `FILE_NOT_FOUND`, `FILE_IO_ERROR`                                                                    |
|     10 | Workbook generation failure        | `EXPORT_FAILED`                                                                                      |
|     70 | CLI/schema programming fault       | `INTERNAL_ERROR`, `OUTPUT_CONTRACT_VIOLATION`                                                        |

Always inspect `ok` and `error.code`; do not infer success from missing stderr.

## 10. v1 to v2 migration

v1 cost snapshots are not accepted by v2 commands and are never transformed
implicitly.

1. Add the v2 request envelope and preserve a stable request ID.
2. Change `data.schemaVersion` to `2.0.0` only after transforming the data.
3. Add explicit `bucket` to every annual item.
4. Remove legacy Y0 only when its sites and cost are both zero.
5. If legacy Y0 contains sites or cost, require the user/TD to choose a real
   Y1–Y5 destination; otherwise stop with the migration condition
   `Y0_DATA_REQUIRES_TARGET` in the migration tool or work log.
6. Never drop the first element and shift the remaining positional array.
7. Map each legacy Grade to one consolidated RE Type ID: HQ L1–L4, Local
   L1–L4, or ARP L0–L4. Remove `gradeId` and the `resourceGrades` collection.
8. Populate each RE Type's MD rate, MD/month, hours/MD, and effective dates.
9. Validate, calculate, and compare reconciled totals before export.

There is deliberately no automatic v1 migration command in CLI 0.3.0.

## 11. Current limitations and trust boundary

- Storage is local SQLite. Cost validate/calculate/export remain read-only with
  respect to the database; only `workspace save` mutates workspace state.
- Workspace writes are revision-checked and hashed. Review follow-ups, cost
  versions, and quote history are durable, but there is no separate row-level
  event ledger or electronic signature.
- Customer quotation templates, assumptions, quote-history snapshots, and XLSX
  output are implemented. Company-system entry remains outside the boundary
  because no company API is available.
- The CLI does not call external models or network services.
- Maintenance supports JSON/XLSX import, manual maintenance, persistence,
  validation, annualized reference comparison, and search. It does not infer a
  recommended customer price without an explicit pricing rule.
- A successful calculation is a cost result, not authorization to send a quote
  or enter company systems.

## 12. Contract files and tests

- `schemas/command-request.schema.json`: stdin/file transport wrapper.
- `schemas/command-envelope.schema.json`: sole stdout response format.
- `schemas/cost-export.schema.json`: cost snapshot v2.
- `schemas/maintenance-price.schema.json`: maintenance history import v1.
- `schemas/workspace-state.schema.json`: atomic local workspace v1.
- `tests/fixtures/*.json`: executable examples.
- `tests/cli-contract.test.mjs`: command, envelope, schema, rounding, RE Type,
  year-order, and workbook-manifest checks.

Run `npm test` before handoff. `npm run test:cli` runs only the CLI contract
suite.
