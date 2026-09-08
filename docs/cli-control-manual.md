# cost-cli v2 Agent control manual

Unified project workflow is documented in [Project Workflow](project-workflow.md). The CPQ/import/template/BOQ/reminder operations are documented in the [Skill operations reference](../skills/cost-workbench/references/operations.md); request schema `operations` is version `1.0.0`.

This is the handoff contract for people, scripts, and Agent Skills that control
the local Cost & Quote Workbench. The CLI is intentionally non-interactive.
It validates supplied snapshots, calculates cost, creates an internal Excel
workbook, and safely reads/writes the local SQLite workspace. It does not
connect to the company quotation platform.

Reusable assumptions and customer T&C use revision-checked masterdata/quote
resource commands. See [Quote catalog control contract](quote-catalog.md) for fields,
customer matching, copying, deletion constraints and historical snapshot rules.

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

For normal edits, use the [narrow resource contract](../skills/cost-workbench/references/resources.md)
(`project`, `cost`, `masterdata`, `cpq`, `quote`, `ssr`, `boq` get/update).
Reads are filtered/paginated; updates merge named rows or fields with revision
checks. Global `masterdata get/update --tab TAB` needs no project ID and returns
a separate revision per tab. Use the global result kinds `GlobalMasterDataResult`
and `GlobalMasterDataMutationResult`; never supply a project revision for them.
Nine global tabs include CPQ catalog; legacy status remains compatibility data.
Actual progress uses `project get --section workflow-plan` plus `project workflow-action`.
The plan exposes parallel nodes and blockers; global changes use `workflow preview/publish`
with global and previewed project revisions. See [the complete workflow contract](project-workflow.md).
Use `project get --section workflow-history` for append-only history, and
`project get/update --section metadata` for project references: `proposalNumber`,
`scopeBrief`, `technicalBasis`, `companyUrl` (iSales/company link), and optional
`cpqUrl` (company CPQ configuration link). Set a link to `""` to clear it.
Reference-only updates do not change workflow progress or recalculate costs.
Legacy project workflow/status/reviews and SSR submissions are read-only.
See [the global data contract](global-master-data.md). Project delete/restore is recoverable. Explicit user cost confirmation
locks only that version. DRB entry, submission and completion require that cost
version to be Confirmed first; Confirmed is not DRB approval. Cost edits and imports check the named
`--version`, defaulting to activeVersion when omitted; `cost apply-rates` requires
an explicit version. Version listings include each version's `costLockReason`.
`cost get --project-id ID --version Vn --section workflow` reads that version's
workflow structure/progress; project and mutation receipts expose workflowVersion.
Locked versions remain readable, and
new blank or cloned Drafts may be created and edited independently.
`masterdata update --tab resources` refreshes only the global catalogue; every
existing project/version, including Draft, keeps its captured data. New projects
and blank versions capture current global defaults/rates; clones retain source
rates. Only explicit `cost apply-rates --version` replaces an unlocked target
version's rates. Supported project reference tabs use `project apply-masterdata`
with the project revision; historical archives remain unchanged. Existing mutators support `--compact`;
legacy workspace get/save remains for backups and deliberate bulk work.

Cost validate/calculate/export additionally accept `--project-id ID [--version V1] [--db FILE]`
instead of `--input`. The following table retains the original file-input forms.

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

- `workflowMode: "project"` selects the single Project Workflow register.
- `workflowEngineVersion:1` selects configurable execution; workflowTemplateRevision records the adopted definition revision.
- `projectStatus` is derived from the current workflow for compatibility.
  `projectStatusDefinitions[]` is retained, not an independent progress editor.
- `currentWorkflowStepCode` is a compatibility projection, not the only active task. Read workflow-plan steps/phases/blockers and use the returned nodeCode for actions; do not infer IDs or gates from display names.
- `selectedStep` is retained for v1 compatibility. Keep it equal to the array
  index of `currentWorkflowStepCode`; the browser and repository migration
  synchronize it automatically.
- `activeVersion` identifies the cost snapshot loaded by the UI. Selecting an
  older version is historical viewing, not a change to the current workflow round.
- `workflowVersion` identifies the current work round; `versionWorkflows` retains
  per-version progress. Both are platform-managed metadata, not writable agent
  inputs. Older documents without workflowVersion use activeVersion as fallback.
- `costVersions[]` contains complete independent cost inputs. Create a version
  with `cost create --mode blank|clone` and the exact revision. The platform
  selects the new Draft as activeVersion/workflowVersion and adopts the latest global workflow template, whether the previous round is open or completed. It starts the template roundStart
  (DTRB by default), retaining old version costs, progress and submissions. Do not manually
  append snapshots or write workflow metadata through workspace saves.
- Each version stores its own `resourceTypes` rate/conversion snapshot. Updating
  the global catalogue does not reprice any existing version, including Draft.
  To apply new rates, use `cost apply-rates --project-id ID --version Vn` with the
  project revision for the unlocked target; do not rewrite resourceTypes manually.
  Use the selected version's snapshot when building a `CostSnapshotRequest`.
- Top-level cost editors are authoritative for the active version on
  `workspace save`; the repository recalculates internal annual costs and mirrors
  those fields into the active snapshot before validating and writing. Other
  versions keep their captured inputs. A standalone cost export rejects stale
  labour values with `LABOUR_COST_MISMATCH` instead of silently correcting them.
- Version codes, row IDs, resource IDs/codes and workflow codes must be unique
  in their collection. Nonblank RE Type IDs must exist in the relevant version.
  `activeVersion` must exist; `sourceVersion` must name another stored version.
  `selectedStep` must agree with `currentWorkflowStepCode` when workflow nodes
  exist. Relation errors return exit 6 / `BUSINESS_VALIDATION_FAILED`.
- `costVersions[].state` is a user-controlled enum: `Draft`, `Suspended`, or
  `Confirmed`. Creating or selecting a version must never change the state of
  any other version. An Agent may change a state only when the user explicitly
  requests that lifecycle update. Before finalization, read that version's cost
  settings/summary, validate the inputs and obtain explicit user confirmation.
  Existing explicit authorization for this version is sufficient. `Confirmed`
  locks its cost inputs and captured rates; it must precede DRB entry, submission
  or completion and does not mean DRB approved. Draft cannot be locked by changing
  a DRB node or recording a result. New blank/cloned Drafts remain editable and
  start the configured round-start node; old approvals and completion states do not transfer.
  Project-mode export no longer requires a duplicate local SSR approval chain.
- `processSteps[]` stores definitions (parallelGroup, required/requiredFields, autoSkip, SLA, reminderEnabled, roundStart, requiresConfirmedCost, finishesWorkflow) and node execution (state, startedAt/dueAt/completedAt/pausedAt, fieldValues, skippedBy, owner/note/followUpDate). Actions start/complete/skip/update/pause/resume/reopen enforce the configured gates; do not write states directly. Template publication synchronizes eligible open projects, retains active deadlines by default and never reprices costs or rewrites completed evidence.
- `workflowUpdates[]` stores append-only version/stage/owner/date/note/timestamp
  records. Read with project --section workflow-history; do not patch the array.
- `pricing` contains `targetGrossMargin`, `discount`, and `gstPercent`.
- `reviewGates[]` and SSR submissions retain old review evidence read-only.
  Do not update them or issue new SSR submit/result/close/followup commands
  to advance the project. Record company progress once using project workflow-action.
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
`workflowEngineVersion`, `workflowTemplateRevision`, `reviewGates`, `workflowSteps`, `activeVersion`, `workflowVersion`, `versionState`,
`serviceCost`, `subcontractCost`, `totalCost`, `totalMandays`, `totalQuote`,
`grossMarginPercent`, and `incompleteCostRows`. Cost and quotation values are
numeric, read-only projections. Update their source workspace fields instead
of trying to write the projections.

There is no Y0 in v2. The array position never substitutes for a missing or
incorrect `bucket` value.

### Resource Type and rate

Personnel allowance and HQ travel are optional **cost-version settings**, not
global Master Data fields. Read `cost get --project-id ID --version Vn --section
settings`, then update only that version using Pool categories:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "personnel-options-001",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "cost.update",
    "changes": {
      "set": {
        "rateSettings": { "allowancePools": ["LOCAL", "ARP"] },
        "travelSettings": { "enabled": true }
      }
    }
  }
}
```

Use `cost update --project-id ID --version Vn --section settings --input REQUEST
--expected-revision REVISION`. `allowancePools` accepts any combination of
`LOCAL`, `ARP`, `HQ`, and `OTHER`; all internal personnel in selected Pools
receive 3% in their calculated Y1–Y5 costs. An explicit `[]` switches allowance
off; unknown or repeated Pool values are rejected atomically. Travel `enabled:false`
switches HQ travel off while preserving stored monthly/airfare/trip inputs;
`true` calculates travel only for internal HQ personnel. `cost calculate` returns
the effective switch in `hqTravel.enabled`. Both options are off in new blank
projects/versions; cloning preserves the source's settings and calculations.
Locked versions reject option changes.

The precedence is `allowancePools` → legacy `allowanceResourceTypeIds` →
legacy `localArpAllowanceEnabled`. Absent Pool selection preserves historical
per-ID selection exactly, even when it only covers some levels within a Pool.
Reading or cloning never expands those old selections. Legacy travel without
`enabled` retains its captured `hqTravel` eligibility.

For compatible narrow writes, an explicit legacy ID list without
`allowancePools` removes the saved Pool override and applies that exact list;
unknown, duplicate and subcontract IDs remain invalid in this mode. An old
flag-only patch selects `LOCAL` and `ARP` Pools (`false` selects `[]`), while
retaining translated IDs for old clients. Explicit Pools in the same patch
always take precedence. Other reads, full snapshots and catalogue maintenance
do not translate or reprice historical settings.

Global `masterdata --tab resources` is the personnel/rate source; each cost
version's `resourceTypes` is its detached snapshot. `mandayRate` is SGD/MD, not
a currency exchange rate; no independent FX engine is implemented. The fields are:

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

Global catalogs support create/update/delete through `masterdata update --tab TAB`
with that tab's independent revision. IDs/codes are stable unique keys; only
explicit removal deletes a record. Ordinary existing entries may use partial
upserts; new entries and unresolved migration conflicts require full records.
Keep global quote-template default assumption references valid.

Project catalog arrays remain captured reference data. Read them through narrow
project/quote/BOQ/CPQ sections; adopt newer global reference data only with an
explicit `project apply-masterdata` for a supported tab. An existing cost version
retains its own resource IDs/rates even if the global source changes. Project
workflow actions remain project-owned and revision checked; nodes configured with
requiresConfirmedCost require Confirmed cost. Legacy status/review evidence remains read-only.

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

There is deliberately no automatic v1 CLI-request migration command.

## 11. Current limitations and trust boundary

- Storage is local SQLite. Cost validate/calculate/export remain read-only with
  respect to the database. Repository-backed commands may run idempotent
  compatibility migrations on first open; these archive the pre-migration JSON.
  Normal business writes use the narrow module `update` commands; `workspace save` remains available for deliberate bulk work.
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

Configured reminders evaluate each enabled active node. Default business SLA is Singapore Monday–Friday 09:00–18:00, 9 hours per day, excluding configured holidays; calendar mode uses continuous 24-hour days. Normal SLA time means normal follow-up, the final local day means immediate handling, and after exact dueAt means urgent. Manual followUpDate can request earlier follow-up. When no node is active or paused, enabled pending nodes in the first pending phase receive normal ready-to-start/register reminders without SLA timing or overdue labels. Later pending phases remain quiet, including when the first phase is muted; cost-confirmation blockers do not hide ready work. Completed/skipped/disabled nodes stay quiet; paused nodes wait for a resume check. Completing the configured finish node stops all round reminders. Today groups tasks by project and highest urgency. Generating a digest does not install a scheduler or send messages.

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

## 业务 Skill 与成本新建

可直接使用 [业务 Skill 清单](business-skills.md) 中的独立入口，无需先读取完整 workspace。

- `project create --input REQUEST`：OperationRequest 的 data 为 `{schemaVersion:"1.0.0",operation:"project.create",project:{id,name,client}}`，仅创建新项目和空白 V1，已有或已删除同号项目均拒绝。
- `cost create --project-id ID --mode blank|clone [--source-version V1] --expected-revision R`：新增 Draft 并返回版本号，自动选为 activeVersion/workflowVersion 并采用最新全局流程模板，从其 roundStart（默认 DTRB）启动本版轮次，无论旧轮次是否已完成；clone 必须指定源版本，blank 禁止 source-version。允许从锁定源版本复制新版；原锁版输入及历史流程保留，新版不继承旧锁或旧审批。
- `cost import --project-id ID --version Vn ...`：预览和应用均可指定版本；未指定仍为 activeVersion。预览返回 revision/version；`--apply --compact` 返回窄收据，未加 compact 保留旧完整记录响应。
- `project get --project-id ID --section workflow-plan` 读取配置节点和并行阶段；`project workflow-action --project-id ID --input request.json --expected-revision R` 应用实际 nodeCode 的动作。OperationRequest 使用 operation=project.workflow-action、action={nodeCode,action,...}。关键节点确认/字段和requiresConfirmedCost门禁均由平台检查；历史用workflow-history。
- `workflow preview/publish --input request.json --expected-revision GLOBAL_R`：OperationRequest data.operation=workflow.preview或workflow.publish，steps为完整定义数组，migrateActiveProjectIds显式要求重算活跃SLA；publish额外传预览得到的projectRevisions。预览/发布响应及示例见[流程契约](project-workflow.md)。
