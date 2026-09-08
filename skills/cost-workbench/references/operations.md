# Operations

Run from the repository root with `npm run --silent cost-cli -- ...`; this document abbreviates that prefix as `cost-cli`. Paths below are examples, not existing user files. The CLI prints exactly one v2 JSON envelope and never prompts interactively.

## Discovery and legacy workspace backups

Use [narrow resources](resources.md) for routine updates. Complete workspace reads/saves below are for backups, initial creation from a supplied complete record, and deliberate bulk migration. They are not prerequisites for imports or CPQ. Global master-data maintenance uses `masterdata get/update --tab TAB` without any project read. Each tab has its own revision; existing project/version snapshots remain unchanged.

```
cost-cli system capabilities
cost-cli system doctor
cost-cli schema show --name workspace-state
cost-cli schema show --name operations
cost-cli workspace list
cost-cli workspace get --project-id ID
cost-cli workspace save --input request.json --expected-revision REVISION
```

`workspace save` input:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "WorkspaceSaveRequest",
  "requestId": "unique-id",
  "data": { "schemaVersion": "1.0.0" }
}
```

Replace `data` with the complete workspace returned by `workspace get`, with intended fields edited. The abbreviated example is not itself a valid workspace. If the project does not exist, create it from the complete supplied workspace with `--expected-revision none`; do not treat a missing project as permission to seed company data. Existing local DB defaults to `data/workbench.sqlite`; every repository command accepts `--db FILE` for an isolated database. Use temporary databases for examples/tests.

## TD / PM and BOQ imports

```
cost-cli workbook inspect --file TD.xlsx --header-row 1
cost-cli cost import --project-id ID --version Vn --file TD.xlsx --input mapping.json
cost-cli cost import --project-id ID --version Vn --file TD.xlsx --input mapping.json --apply --expected-revision REVISION --compact
```

Example `mapping.json`:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "import-1",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "cost.import",
    "mapping": {
      "sheet": "TD",
      "headerRow": 1,
      "role": "TD",
      "mode": "mandays",
      "year": "Y1",
      "columns": {
        "scope": 1,
        "bu": 0,
        "resource": 0,
        "mandays": 2,
        "sites": 0,
        "mdPerSite": 0,
        "cost": 0
      },
      "defaultBu": "Delivery",
      "defaultResource": "RE-TYPE-ID-FROM-WORKSPACE",
      "excludeRows": []
    }
  }
}
```

Specify the same target cost version for preview and apply; omission uses activeVersion. Preview returns its revision and version. Select real sheet, columns, BU and a RE Type captured in that version. `0` means unmapped. `endRow` limits data; `excludeRows` removes known total/footer rows. For PM subcontract, choose its RE Type and cost column; direct mandays may be unmapped. `tdStart` must identify a real Y1. Import appends rows. For a revised TD/PM file, use a new working cost version or explicitly replace the intended previous rows; a changed file hash does not mean the old cost disappeared. Same source row can be imported for different years, but overlapping source years are rejected. Never count the same packaged service in two separate costs.

BOQ uses the same operation envelope, with `operation="boq.import"` and `mapping={sheet,headerRow,modelColumn,quantityColumn,excludeRows?}`. Run `boq import --project-id ID --file BOQ.xlsx --input mapping.json`; inspect rows, then repeat with `--apply --expected-revision`.

## Cost and quotation files

```
cost-cli cost validate --project-id ID --version V1
cost-cli cost calculate --project-id ID --version V1
cost-cli cost export --project-id ID --version V1 --output outputs/Cost.xlsx
cost-cli quote export --project-id ID --output outputs/Quote.xlsx
cost-cli workbook fill-template --project-id ID --file Company.xlsx --input layout.json --output outputs/Filled.xlsx
```

Cost snapshot requests use `CostSnapshotRequest`, cost schema `2.0.0`, exactly Y1–Y5. Build the snapshot from the chosen saved cost version and its rate/resource/travel/manual inputs. `inputMode=mandays` uses `years[].mandays` with sites and mdPerSite zero; the default site mode derives MD from Sites × MD/Site. HQ travel uses internal HQ resources only. Internal cost workbooks add source trace when imported rows exist.

`layout.json` is an `OperationRequest` with `operation="workbook.fill-template"`, `version` (mapping revision), `purpose="cost"|"quote"`, `cells=[{sheet,cell,field}]` and `tables=[{sheet,startRow,capacity,dataset,columns}]`. Columns map field names to numeric Excel columns. Existing table capacity is explicit; expand the original template when insufficient. Mapped table columns are cleared through that capacity. Templates cannot overwrite their source file, including aliases.

Cost scalars: `project.id/name/client/currency`, `proposalNumber`, `cost.version/total/service/subcontract/mandays`. `costRows` fields: `scope`, `bu`, `resource`, `inputMode`, `mandays`, `cost`, `source`, `Y1.sites/mandays/cost` through Y5.

Quote scalars: `project.*`, `proposalNumber`, `quote.number`, `quote.quoteBeforeTax`, `quote.gstAmount`, `quote.quoteAfterTax`, `quote.documentTitle`, `quote.documentTitleZh`, `quote.paymentTerms`, `quote.paymentTermsZh`, `quote.termsAndConditions`, `quote.validityDays`. Quote mappings must include number, all three amounts, payment terms, validity and nonempty T&C. Included assumptions require an `assumptions` table mapping `text`; other fields are `id` and `textZh`. `quoteLines` has one scope/amount summary row. Cost scalars and `costRows` are prohibited for quote purpose. Selected commercial settings and actual output hash are recorded in history. The original template's remaining content is retained and must be reviewed for suitability; existing formulas are marked for Excel recalculation and stale caches are removed.

Do not add `--overwrite` merely to suppress a conflict; choose a new output name unless replacing that exact output is authorized. File existence plus failed history save is a partial export, not complete success.

## CPQ

Maintain the global directory with `masterdata get/update --tab cpq-catalog`. Read a project's captured directory with `cpq get --project-id ID --section catalog`; it is read-only. Use `cpq get/update --section draft|selections` for that project's configuration; see [narrow resources](resources.md). Codes must come from company catalog input; do not invent company codes. Draft includes `brief`, `costVersion`, `targetCost`, `targetBasis`, `tolerance`, `rounding`, `allocationBasis`, and selections `{code,quantity,locked,weight,reason}`. Equipment is never adjustable. For unlocked services, quantity is a reference, not the final result. Positive weights express budget proportions.

```
cost-cli cpq match --project-id ID --scope "brief scope"
cost-cli cpq confirm --project-id ID --confirmed-by USER --expected-revision REVISION --compact
cost-cli cpq solve --project-id ID --expected-revision NEW_REVISION --compact
cost-cli cpq archive --project-id ID --expected-revision NEW_REVISION --compact
cost-cli cpq export --project-id ID --archive-id ARCHIVE_ID --output outputs/CPQ.xlsx
```

Confirm requires existing user selection. Equipment/fixed service quantities must be real positive quantities on the catalog grid. Money uses cents, quantity up to 4 decimal places; unitCost × maxQty must be ≤ 1e12. Service search is bounded, so explain `searchComplete`, actual difference and acceptable tolerance separately.

## Project Workflow

Read `project get --section workflow-plan` for the actual nodes, parallel phases and blockers. Apply a named node action with `project workflow-action --project-id ID --input request.json --expected-revision R`; the OperationRequest uses `operation:"project.workflow-action"` and `action:{nodeCode,action,...}`. Use returned internal IDs, never derive identity or behavior from names. See the [workflow skill](../../ssr-workflow-update/SKILL.md) for supported actions and confirmation rules.

Critical nodes require configured fields and explicit confirmation. Nodes with requiresConfirmedCost also need the current workflow version's user-confirmed cost. Earlier optional nodes can become Skipped after downstream completion; they are not silently approved. The configured finishesWorkflow node stops all project reminders when completed. A new Draft adopts the latest global workflow template, whether the prior round is open or finished, and starts its roundStart node (DTRB by default), preserving prior cost and round snapshots. The start node and its entire parallel group cannot require confirmed cost. Viewing older costs leaves the working round unchanged.

Global workflow definitions use `workflow preview/publish` with a complete steps array. Publication checks both the global revision and previewed project revisions, then updates eligible open projects atomically. Active deadlines are retained unless explicitly requested in migrateActiveProjectIds; completed history and every cost/rate snapshot stay unchanged. Ordinary master-data maintenance still reads no projects. See [configuration skill](../../ssr-workflow-configure/SKILL.md).

## Reminders and historical references

```
cost-cli digest generate --as-of YYYY-MM-DD
cost-cli reminders scan --as-of YYYY-MM-DD
cost-cli reminders list
cost-cli reminders ack --id ID --fingerprint RETURNED_FINGERPRINT
cost-cli history search --scope "deployment testing" [--client "Customer"]
```

New-engine reminders use each enabled active node's SLA. Default business time is Singapore Monday–Friday 09:00–18:00, 9 working hours per SLA day, excluding configured holidays; calendar days are 24 hours. Within SLA is normal, the final local day immediate, and after exact dueAt urgent. If no active or paused work remains in an unfinished round, enabled pending nodes in the first pending phase get normal ready-to-start/register reminders without starting SLA or becoming overdue. Future pending phases stay quiet; muting the first phase does not expose later phases, and cost-confirmation blockers do not hide ready tasks. Completed/skipped/disabled nodes stay quiet; paused nodes wait for a resume follow-up date. A completed finish node suppresses the entire round. Today groups parallel tasks by project and highest urgency. Scans update only the reminder inbox, not workspace revisions; unchanged sources stay read across scans/restarts. `history search` returns local lexical matches with project/version/source, matched/unmatched terms, original scope, cost and MD. Explain actual scope/SLA/scale/date differences; lexical overlap is not scope equivalence or automatic justification for a price.

## Maintenance

`maintenance validate --input history.json` only validates a `MaintenancePriceRequest`. Persist accepted records in the global library with `masterdata update --tab maintenance` and its tab revision; no project ID. BOQ pricing reads the project snapshot via `boq get --section references`. Explicit adoption of current global data uses `project apply-masterdata --tab maintenance` with a project ID and project revision. Compare exact normalized equipment model; inspect each customer's SLA, term, date, outcome and source. Formula: record amount × 12 / coverageMonths / quantity. Invalid denominator = unavailable.

Use `boq get/update --section rows|settings` or BOQ import for coverageMonths and rows with actual model/quantity, selected referenceId, SLA/site, unitAnnualQuote (cents), basis and source. Imported rows retain original model/quantity when later edited.

```
cost-cli maintenance archive --project-id ID --expected-revision REVISION --compact
cost-cli maintenance export --project-id ID --archive-id ID --output outputs/Maintenance_Draft.xlsx
```

Archive stores exact references and all current BOQ rows. Draft output excludes internal reference costs and does not include tax or final T&C. Use the confirmed-cost/quotation flow and actual company approvals before customer issue; track progress once in Project Workflow.

## Failures

Exit classes: 2 usage, 3 schema, 4 not found, 5 revision/file conflict, 6 business rule, 8 file I/O, 10 export, 70 internal. Inspect `error.code` and `error.violations` and do not retry the same rejected mutation blindly. Never report a validation or preview as a persisted change.
