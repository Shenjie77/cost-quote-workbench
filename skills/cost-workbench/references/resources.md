# Narrow business resources

Use `npm run --silent cost-cli -- ...` from the project root. Project reads return the project revision. Global Master Data reads return the selected tab's independent revision; retain the correct revision for the next write. Global maintenance requires no project lookup or project ID. Never fetch or rewrite a whole workspace just to update one row.

## Read only what is needed

| Command | Sections / selectors |
| --- | --- |
| `project list` | Compact persisted metadata, no workspace payload. `--deleted` lists recoverable removals. |
| `project create --input REQUEST` | Create-only project with empty V1 and detached snapshots of current global defaults; never overwrites existing/deleted IDs. |
| `cost create --project-id ID --mode blank\|clone [--source-version V1] --expected-revision R` | Adds a Draft, returns and selects it as activeVersion/workflowVersion, starts its DTRB round. |
| `project get --project-id ID` | Identity, status, workflow, activeVersion, workflowVersion and active-version `costLockReason`; `--section workflow`, `status`, `reviews`, `subcontract`, `supplemental` for project records/snapshots. |
| `cost get --project-id ID --version V1` | Default `rows`; `--section settings`, `resources`, `travel`, `summary`, `versions`, `workflow` (read-only progress for the named version). |
| `masterdata get --tab TAB` | The nine global tabs below; no project ID. |
| `project apply-masterdata --project-id ID --tab TAB --expected-revision R` | Explicitly capture a supported global tab for this project; use the project revision. |
| `cpq get --project-id ID` | Default `draft`; `--section catalog`, `selections`, `archives`. |
| `quote get --project-id ID` | Default `settings`; `--section assumptions`, `history`, `templates`, `library`; the latter two read project snapshots. |
| `ssr get --project-id ID` | Default `settings`; `--section bid-responses`, `submissions`. |
| `boq get --project-id ID` | Default `rows`; `--section settings`, `archives`, `references` (project maintenance snapshot). |

Collections accept `--id ID`, `--query TEXT` (literal case-insensitive text), `--limit N`, `--offset N`. Project collections default to 50, maximum 200; global Master Data defaults to 100, maximum 10000. Follow `nextOffset`, stop at null. If revision changes between pages, restart the read. Queries return matching records only; do not infer missing records outside the current page. Settings objects do not accept collection filters.

Masterdata tab names and record identity:

| Tab | Record key |
| --- | --- |
| `resources` | RE Type `id` |
| `subcontract` | `id` |
| `supplemental` | `id` |
| `maintenance` | Historical device/customer record `id` |
| `assumptions` | `id` |
| `quote-templates` | `id` |
| `workflow` | `code` |
| `status` | `code` |
| `cpq-catalog` | Company catalog `code` |

CPQ catalog and selections use `code`; cost versions use `code`; other collections use `id`. Archive lists are summaries. SSR reads omit full cost snapshots and canonical keys. CPQ drafts expose `confirmationValid` / `resultCurrent`; removed keys are internal consistency data. Use explicit exports for complete archived workbooks, or a deliberate workspace backup for original archive JSON.

## Update a section

Use the same module, `update`, the same section/tab/version selector, plus `--input FILE|- --expected-revision R`. Example to edit a single cost row:

```sh
npm run --silent cost-cli -- cost update --project-id ID --version V1 --section rows --input change.json --expected-revision 12
```

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "cost-row-change-1",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "cost.update",
    "changes": { "upsert": [{ "id": "EXISTING-ROW-ID", "mdPerSite": 2.5 }] }
  }
}
```

- `upsert`: existing records merge only provided top-level fields; new records require their complete business fields. Cost `years` replaces the entire Y1–Y5 array when present; do not send a one-year array. `source` evidence on cost rows is read-only; original Excel evidence comes only from imports.
- `remove`: explicitly named IDs/codes; unknown, duplicate, or contradictory IDs fail atomically. Omission never deletes records. Keep current status/workflow and referenced quote defaults valid.
- `set`: object settings only. For example cost settings `{ "set": {"manualCosts":{"riskContingency":1200}} }`; nested settings merge one level, and arrays replace. No arbitrary workspace paths are accepted.
- Arrays use `upsert/remove`, objects use `set`; do not mix them on a section. Unknown fields fail validation.

Object input fields:

| Section | `set` fields |
| --- | --- |
| Project | `name`, `client`, `projectStatus`, `currentWorkflowStepCode` |
| Cost settings | `state`, `rateSettings`, `travelSettings`, `travelUplift`, `manualCosts` |
| CPQ draft | `brief`, `costVersion`, `targetCost`, `targetBasis`, `tolerance`, `rounding`, `allocationBasis` |
| Quote settings | `pricing`, `selectedQuoteTemplateId` |
| SSR settings | `enabled`, `proposalNumber`, `companyUrl`, `scopeBrief`, `technicalBasis`, `mode`, `requiredDomains` |
| BOQ settings | `coverageMonths` |

Cost updates recalculate the selected version. Inactive versions stay separate from the active editor. `masterdata update --tab resources` updates only the RE catalogue (including the SGD/MD `mandayRate`; this is not a currency exchange rate) and remains available after DRB completion or cost finalization. It never changes the resource definitions, rates or amounts captured in any cost version.

A new project and a blank cost version capture current global defaults/rates. A cloned version retains the source version's resource/rate snapshot. No global update reprices an existing version, including Draft. Applying current global catalogue rates to a cost version requires `cost apply-rates --project-id ID --version V1 --expected-revision R`. That command requires an explicit `--version` and checks only that target. Cost updates and imports also check the named version, defaulting to activeVersion when omitted. Read the target cost resource's `costLockReason`; `cost get --section versions` also returns each version's reason. Project-level receipts describe the active version, not all versions. User-confirmed finalization locks the affected version's inputs, captured rates and `rateSettings`; it must precede any DRB entry, submission or completion. Confirmed is not approval, and Draft cannot be locked by DRB progress. Masterdata remains editable. There is no routine unlock command. Create a new blank or cloned Draft for a new estimate, including from a locked source; never rewrite the locked original with full workspace saves.

For global rate maintenance, read `masterdata get --tab resources --id RESOURCE-ID`, then submit an `OperationRequest` with `operation: "masterdata.update"` and `changes: {"upsert":[{"id":"RESOURCE-ID","mandayRate":1800}]}` using `masterdata update --tab resources --input rates.json --expected-revision R` with that global tab's revision. Use the actual requested rate, not the example value. Verify the catalogue row; do not automatically follow with `cost apply-rates`. A separately authorized application to an unlocked target version is allowed even when another version is locked.

`cost resources/versions/workflow`, `quote templates/library/history`, `boq references`, `cpq catalog`, project subcontract/supplemental snapshots, SSR submissions and all archive sections are read-only. Actual project workflow/status/reviews use `project update --section workflow|status|reviews`, with `operation: "project.update"` and collection upsert/remove. Global workflow/status tabs are defaults for new projects; their updates never change actual project progress. Read `cost get --project-id ID --version Vn --section workflow` for that version's retained workflow without loading the whole workspace; do not edit versionWorkflows directly. Use dedicated submit/result/close/followup/archive commands to append evidence. New narrow updates return only revision, changed IDs/fields and lock reason. Verify the changed section if needed, never the complete workspace.

## Explicit adoption and migration conflicts

`project apply-masterdata` supports `subcontract`, `supplemental`, `maintenance`, `assumptions`, `quote-templates`, and `cpq-catalog`. It requires the active version to be an unlocked Draft. It is a separate project mutation using the project revision, not a follow-up automatically implied by global maintenance. Read the relevant global tab and project snapshot first. Apply assumptions before templates when required by default references. Existing archived quotation, maintenance and CPQ results retain their original snapshots; changed current business inputs may require a new review. Resources must use `cost apply-rates --version`; global workflow/status templates cannot replace an existing project's actual progress.

Global tab revisions are independent: updating resources does not change maintenance or any project revision. Global reads return `GlobalMasterDataResult`; updates return `GlobalMasterDataMutationResult` with scope/tab/revision/updatedAt/changedIds/removedIds/unresolvedKeys. On a revision conflict reload only that tab. Legacy same-key records with different values are retained with their sources for explicit resolution; do not silently select a project's prices. Use the user's supplied complete values in an upsert to resolve the record; partial fields are accepted for ordinary existing keys, but not for new or unresolved conflict keys. No exchange-rate service or automatic currency conversion is implemented; resource rates are SGD/MD and effective dates are stored as given.

## Optional Local / ARP personnel allowance

Use `cost update --section settings --version V1` with `changes: {"set":{"rateSettings":{"localArpAllowanceEnabled":true}}}` to enable the fixed 3% allowance; set it to `false` to disable. It belongs to the named cost version and defaults to off when absent in older data. It is a cost input and cannot change once that specific version is finalized and locked. A new cloned Draft may change the allowance independently.

The checkbox is in Cost Input. When enabled, each internal LOCAL/ARP Y1–Y5 Cost is calculated as actual mandays × captured MD rate × annual uplift factor × 1.03, then rounded upward to cents. HQ, subcontract, travel and manual costs are unaffected. Recalculation starts from effort and rates, never from a previously calculated Cost, so repeated saves/imports do not compound the allowance. Turning it off recalculates the normal annual Cost.

Summary, `history search`, quotations, template scalars and Excel sum the final annual Cost values directly. They neither expose a separate allowance cost layer nor add 3% again. The standard workbook retains only the original cost detail and statement hierarchy, and records the checkbox in its assumptions sheet. If a TD import maps a cost column, that value must match the calculated Cost including the enabled 3%; for a source showing only base labour, leave cost unmapped and import the actual effort instead.

## CPQ sequence without a workspace round trip

1. Read `project get`, `cost get --section summary` and `cpq match --scope TEXT`. Matching includes revision, unit cost, step, bounds and reference quantity. Read additional catalog pages only when needed.
2. Maintain supplied company codes independently with `masterdata update --tab cpq-catalog`. Existing projects keep their captured catalog; `cpq update --section catalog` is rejected. Only when adopting the new catalog is requested, run `project apply-masterdata --project-id ID --tab cpq-catalog --expected-revision R`, then recheck selections. Use `cpq update --section draft` to record brief, costVersion, target, tolerance and allocation basis.
3. Show candidates to the user. After selection is actually confirmed, use `cpq update --section selections` with `{code,quantity,locked,weight,reason}`. Fixed/device quantities must be actual quantities.
4. `cpq confirm --project-id ID --confirmed-by USER --expected-revision R --compact`.
5. `cpq solve --project-id ID --expected-revision NEXT_R --compact`. Inspect quantities, difference, tolerance and bounded-search result.
6. `cpq archive --project-id ID --expected-revision NEXT_R --compact`, then `cpq export --project-id ID --archive-id RETURNED_ID --output outputs/CPQ.xlsx`.

Narrow CPQ edits clear the previous result; confirmation is cleared only when the selected mapping changes. Obtain renewed item confirmation when explicitly applying new catalog terms changes selected items, or when scope, selection or fixed quantities change. A global catalog edit by itself leaves project drafts unchanged. Target-cost-only or allocation-weight edits retain the existing item confirmation when the selected mapping is unchanged. Archives remain immutable.

Existing mutators (`cpq confirm/solve/archive`, `cost import --apply`, `boq import --apply`, `ssr submit/result/close/followup`, `maintenance archive`) accept `--compact`. Their historical full response remains available for older clients; Skills should use compact mode.

## Delete and recover

Only when the user actually requests removal:

```sh
cost-cli project delete --project-id ID --expected-revision R
cost-cli project list --deleted
cost-cli project restore --project-id ID --expected-revision DELETED_REVISION
```

Deletion is recoverable: the full snapshot, archives and cost lock stay in local SQLite. Deleted IDs cannot be recreated by old autosaves or seeding. Restoration increments revision and preserves locks. Deleted projects stop producing reminders; API scans catch CLI removals within one minute, or run `reminders scan` immediately. This does not remove exported files or backups.

Before any DRB entry, submission or completion, read the target version's settings/summary and validate its cost. Only the user's explicit confirmation authorizes `cost update --version Vn --section settings` with `set.state="Confirmed"`; do not ask again when that version's finalization was already authorized. Confirmed makes cost inputs immutable but does not approve DRB. Draft costs must not be locked by workflow updates or review results. Creating a separate new Draft is allowed and automatically selects it as activeVersion/workflowVersion with a new DTRB round; the platform retains old progress and submissions. Every version independently satisfies DTRB → DRB dependencies. `ssr submit --version Vn` targets a version explicitly; omission uses workflowVersion, with activeVersion only as a legacy fallback. Viewing an old activeVersion does not move the current workflow round. workflowVersion/versionWorkflows are platform-managed metadata, not fields to edit through workspace saves.
