# Data contracts

Canonical machine-readable contracts are Draft 2020-12 JSON Schemas in
`schemas/`. The CLI compiles them with Ajv before running business validation.

## General rules

- Every document carries `schemaVersion`.
- Requests reject unknown fields with `additionalProperties: false`.
- IDs are stable integration keys; display names may change.
- User-entered Scope text is stored exactly as entered and is not translated.
- Money, sites, mandays, percentages, and rates are numeric values. Currency is
  a separate ISO 4217 code. Never send formatted values such as
  `"S$ 1,804,000"`.
- `0` means a confirmed zero. Missing optional data uses an omitted field or
  documented `null`; it must not be converted silently to zero.
- Dates use `YYYY-MM-DD`; timestamps use RFC 3339 UTC.

## Cost snapshot

`schemas/cost-export.schema.json` is the browser/CLI workbook input. Its
`costRows[].years` contains exactly five items. Every item carries a mandatory
`bucket` discriminator, and the array order must be Y1, Y2, Y3, Y4, Y5. Each
item has `{bucket, sites, cost}`; mandays and totals are calculated outputs and
are not accepted as inputs. Y0 is not part of v2.

There is no independent Grade field. `reTypeId` points to the consolidated RE
Type master: LOCAL, ARP, HQ or OTHER, with levels L0–L4. OTHER is for internal
resources such as remote support; they can be selected for 3% personnel allowance,
but do not contribute HQ travel effort. Each internal RE Type stores
its SGD/MD rate plus MD/month and hours/MD conversion factors. Subcontract rows
point to the `SUBCON` RE Type.

Version-owned `rateSettings.allowancePools` is an optional array of unique
`LOCAL`, `ARP`, `HQ` or `OTHER` values; `[]` explicitly disables the allowance.
It applies to internal RE Types whose Pool is selected. When absent, the previous
`allowanceResourceTypeIds` unique internal-ID selection remains exact; when both
arrays are absent, `localArpAllowanceEnabled` supplies the legacy LOCAL/ARP rule.
New Pool selections take precedence and no read operation migrates old settings.
`travelSettings.enabled` is optional for historical compatibility; new blank
versions store `false`. Both settings follow version locks, rate snapshots and
cost export validation.

CLI file/stdin input wraps this snapshot in
`schemas/command-request.schema.json`; raw snapshots are not CLI requests.

## Maintenance history

`schemas/maintenance-price.schema.json` accepts:

```json
{
  "schemaVersion": "1.0.0",
  "records": [
    {
      "id": "mh-001",
      "client": "Xinglan Retail",
      "service": "Storage hardware maintenance",
      "productModel": "Storage X9000",
      "serviceLevel": "24x7 · 4-hour onsite",
      "site": "Singapore DC1",
      "coverageMonths": 12,
      "quantity": 2,
      "costAmount": 16400,
      "quotedAmount": 22000,
      "currency": "SGD",
      "quoteDate": "2026-05-16",
      "outcome": "Won",
      "source": "QT-2026-006"
    }
  ]
}
```

Annualized quote is calculated as `quotedAmount / coverageMonths × 12` and
must not be supplied by callers.

## Global reference data

`masterdata get/update --tab TAB` manages nine independent global tabs without
a project ID or workspace read. Each tab has its own revision and record schema;
project revisions are not valid CAS tokens for global writes. New projects capture
these defaults, while ordinary catalogue updates leave all project snapshots intact.
Workflow publication separately previews and synchronizes eligible open project definitions.
Migration retains conflicting same-key values with their source rather than
silently replacing them. See [global data contract](global-master-data.md).

## Local project workspace extensions

`schemas/workspace-state.schema.json` is the atomic browser/CLI document. The
local repository expands older compatible documents with these fields:

- `workflowMode: "project"`: one project workflow is the progress source;
- `workflowEngineVersion: 1`: configurable parallel-node execution and SLA model;
- `workflowTemplateRevision`: adopted global workflow revision;
- `projectStatus`: compatibility projection derived from the current workflow,
  not a separately editable progress record;
- `projectStatusDefinitions[]`: retained compatibility dictionary;
- `currentWorkflowStepCode`: compatibility projection of the leading active or completed finish node, referencing `processSteps[]`; parallel work is represented by all node states;
- `processSteps[]`: stable code/name/owner plus definition fields `parallelGroup`, `required`, `requiredFields`, `autoSkip`, `slaDays`, `slaCalendar`, `slaHolidays`, `reminderEnabled`, `roundStart`, `requiresConfirmedCost`, `finishesWorkflow`; execution stores state, startedAt/dueAt/completedAt/pausedAt, fieldValues, skippedBy, followUpDate, note and updatedAt;
- `workflowUpdates[]`: append-only registration records with
  `id/costVersion/fromStepCode/toStepCode/owner/followUpDate/note/updatedAt`;
- `activeVersion`: the viewed cost version, such as `V1` or `V12`;
- `workflowVersion`: the version whose workflow round is currently being handled;
- `versionWorkflows`: per-version workflow progress retained by the platform;
- `costVersions[]`: complete independent cost-input snapshots;
- `pricing`: project quotation parameters.
- `reviewGates[]`: read-only historical checkpoints and their follow-up log;
- `quoteTemplates[]`, `selectedQuoteTemplateId`, and `quoteAssumptions[]`:
  governed customer-output configuration;
- `quoteHistory[]`: generated or manually entered quotation snapshots.

`assumptionLibrary[]` stores the project's captured reusable assumption library.
The global source is maintained independently through masterdata tabs. Customer templates
also contain `termsAndConditions` and `defaultAssumptionIds`. Quotation copies
may retain a `sourceAssumptionId`, while generated history stores detached
`templateSnapshot` and `assumptionSnapshots`. See [quote catalog contract](quote-catalog.md)
for matching, migration, field limits and safe deletion/copy behavior.

Project Workflow is one plan with potentially parallel active nodes. `project get --section workflow-plan` returns steps/phases/blockers/completed/templateRevision; `project workflow-action` applies a stable nodeCode and a validated action. A completed finishesWorkflow node stops all round reminders. Critical completion requires configured fields and explicit confirmation; optional automatic bypass is recorded as Skipped, never fabricated Completed. Status dictionaries and old review evidence remain compatible history. See [workflow contract](project-workflow.md).

Every `costVersions[]` item stores `code`, `state`, `createdAt`,
`sourceVersion`, `costRows`, `rateSettings`, `travelSettings`, `travelRows`,
`travelUplift`, `manualCosts`, and `resourceTypes` (independent rate snapshot).
Legacy inputs may omit the last field; migration captures the available project
catalogue and may add `calculationNote` when correcting stale labour values.
A cloned new version retains these source fields; a blank version captures
current global resources. Both create a Draft, select it as activeVersion and
workflowVersion, adopt the latest global workflow template regardless of whether the previous round is completed, and start its roundStart node (DTRB by default). The prior round snapshot and cost inputs remain unchanged. The roundStart node and every node in its parallel group must have requiresConfirmedCost=false so a new Draft can begin. Viewing a historical
activeVersion does not move the current workflow round. workflowVersion and
versionWorkflows are platform-managed metadata, not fields for agent workspace
patches. Cost must be explicitly confirmed by the user before that version can
enter, submit or complete DRB; Confirmed finalizes cost but is not DRB approval.
Old SSR submissions retain their original cost baseline and are read-only.
They are not a second editable approval chain for project-mode quote export.
Project references remain in `ssr`: `proposalNumber`, `scopeBrief`,
`technicalBasis`, `companyUrl` (iSales/company link), and optional `cpqUrl`.
The latter is a string of at most 10,000 characters; older documents omit it,
and an empty string clears the link. Both links are project metadata and never
enter the cost calculation. The UI only activates HTTP/HTTPS links.
Other catalog arrays are detached project reference
snapshots. Global updates never mutate these arrays or any existing version,
including Draft. Explicit adoption uses project apply-masterdata for supported
reference tabs, or cost apply-rates for the named unlocked version. Global
workflow definitions publish through preview plus global/project CAS, preserving active deadlines unless explicitly migrated and retaining completed history; actual progress uses `project workflow-action`. The status dictionary remains compatibility data.

`pricing` contains numeric `targetGrossMargin`, `discount`, and `gstPercent`.
The pre-tax quote is calculated as:

```text
listPrice = totalCostWithRisk / (1 - targetGrossMargin / 100)
quoteBeforeTax = max(0, listPrice - discount)
actualGrossMargin = (quoteBeforeTax - totalCostWithRisk) / quoteBeforeTax
```

All money results still use ceiling-to-cent normalization.

`reviewGates[].status` is one of `not_started`, `awaiting_material`,
`in_review`, `blocked`, `completed`, or `cancelled`. The linked
`workflowStepCode` is optional, but when present it must reference one project
workflow code. These legacy records are now read-only; active progress and
follow-up reminders use the single project workflow.

`digest generate` returns a `DigestResult` described in
`command-envelope.schema.json`. It accepts no JSON input and derives every item
from current workspace-list workflow projections. Engine-version 1 emits one item per enabled active node, with optional workflowNodeId/workflowVersion/urgency. If no active or paused nodes remain and the round is unfinished, enabled pending nodes in the first pending phase receive normal ready-to-start/register items without starting SLA or acquiring overdue status. Future pending phases stay quiet; muted first phases do not expose later phases, and cost-confirmation blockers do not hide ready work. Normal SLA tasks map to decisions_due/blue; final-day or early follow-up tasks map to immediate_follow_up/amber; exceeding dueAt maps to immediate_follow_up/red. Existing four count keys remain compatible. Paused nodes only remind when a resume check is due; a completed configured finish node suppresses everything. Reminder IDs include project/version/node, and stable source fingerprints preserve acknowledgement across scans. Today groups these items by project and highest urgency.

Project List projections use these definitions:

- `serviceCost = service statement subtotal - subcontractCost` so the service
  and subcontract columns do not double-count one another;
- `totalCost = sales cost + risk contingency`;
- `totalMandays = sum(sites × MD/site)` across all cost rows and years;
- `totalQuote = quoteBeforeTax`;
- `grossMarginPercent` is the actual margin after discount.

## Suspended cost deletion and percentage inputs

`deletedCostVersions` is optional, keyed by version code, with immutable `{version, workflow, removedAt}` snapshots. Only unlocked Suspended versions may leave `costVersions`; one visible version must remain. Deleting the active or workflow version selects the highest remaining version and restores its existing workflow. Review/CPQ/quote provenance remains intact, and deleted codes cannot be reused. Repository validation rejects bare removals, tampered archives and unrelated edits bundled into deletion. `cost get --section archive --version Vn` provides read-only tracing.

`manualCosts.otherServiceRate` is optional, numeric 0–1. Presence computes 2.3.4.2 from the 2.3.1 subtotal; absence preserves manual `otherService`. Narrow cost settings patches that supply only `otherService` clear the rate, while an explicit rate keeps automatic mode. No migration changes historical amounts.
