# Narrow business resources

Use `npm run --silent cost-cli -- ...` from the project root. Every read returns the project revision; retain it for the next write. All master data is project-scoped. Never fetch or rewrite a whole workspace just to update one row.

## Read only what is needed

| Command | Sections / selectors |
| --- | --- |
| `project list` | Compact persisted metadata, no workspace payload. `--deleted` lists recoverable removals. |
| `project get --project-id ID` | Identity, status, workflow, active version and `costLockReason`. |
| `cost get --project-id ID --version V1` | Default `rows`; `--section settings`, `resources`, `travel`, `summary`, `versions`. |
| `masterdata get --project-id ID --tab TAB` | The eight tabs below. |
| `cpq get --project-id ID` | Default `draft`; `--section catalog`, `selections`, `archives`. |
| `quote get --project-id ID` | Default `settings`; `--section assumptions`, `history`. |
| `ssr get --project-id ID` | Default `settings`; `--section bid-responses`, `submissions`. |
| `boq get --project-id ID` | Default `rows`; `--section settings`, `archives`. |

Collections accept `--id ID`, `--query TEXT` (literal case-insensitive text), `--limit N` (default 50, maximum 200), `--offset N`. Follow `nextOffset`, stop at null. If revision changes between pages, restart the read. Queries return matching records only; do not infer missing records outside the current page. Settings objects do not accept collection filters.

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

Cost updates recalculate the selected version. Inactive versions stay separate from the active editor. RE master edits do not update captured rates until `cost apply-rates --project-id ID --version V1 --expected-revision R`. Both are blocked on DRB-completed or cost-finalized projects. `costLockReason` describes the reason; there is no routine unlock command. Do not bypass the lock with full workspace saves.

`cost resources/versions`, quote history, SSR submissions and all archive sections are read-only. Use dedicated submit/result/close/followup/archive commands to append evidence. New narrow updates return only revision, changed IDs/fields and lock reason. Verify the changed section if needed, never the complete workspace.

## CPQ sequence without a workspace round trip

1. Read `project get`, `cost get --section summary` and `cpq match --scope TEXT`. Matching includes revision, unit cost, step, bounds and reference quantity. Read additional catalog pages only when needed.
2. Use `cpq update --section catalog` to import supplied company codes. Use `cpq update --section draft` to record brief, costVersion, target, tolerance and allocation basis.
3. Show candidates to the user. After selection is actually confirmed, use `cpq update --section selections` with `{code,quantity,locked,weight,reason}`. Fixed/device quantities must be actual quantities.
4. `cpq confirm --project-id ID --confirmed-by USER --expected-revision R --compact`.
5. `cpq solve --project-id ID --expected-revision NEXT_R --compact`. Inspect quantities, difference, tolerance and bounded-search result.
6. `cpq archive --project-id ID --expected-revision NEXT_R --compact`, then `cpq export --project-id ID --archive-id RETURNED_ID --output outputs/CPQ.xlsx`.

Narrow CPQ edits clear the previous result; confirmation is cleared only when the selected mapping changes. Obtain renewed item confirmation when selected catalog terms, scope, selection or fixed quantities change. Target-cost-only or allocation-weight edits retain the existing item confirmation when the selected mapping is unchanged. Archives remain immutable.

Existing mutators (`cpq confirm/solve/archive`, `cost import --apply`, `boq import --apply`, `ssr submit/result/close/followup`, `maintenance archive`) accept `--compact`. Their historical full response remains available for older clients; Skills should use compact mode.

## Delete and recover

Only when the user actually requests removal:

```sh
cost-cli project delete --project-id ID --expected-revision R
cost-cli project list --deleted
cost-cli project restore --project-id ID --expected-revision DELETED_REVISION
```

Deletion is recoverable: the full snapshot, archives and cost lock stay in local SQLite. Deleted IDs cannot be recreated by old autosaves or seeding. Restoration increments revision and preserves locks. Deleted projects stop producing reminders; API scans catch CLI removals within one minute, or run `reminders scan` immediately. This does not remove exported files or backups.

After DRB locks the cost inputs, an unchanged Draft/Suspended cost version may still be marked `Confirmed` through `cost update --section settings` with only `set.state="Confirmed"`. This completes quotation readiness without changing any cost input. Downgrading finalized versions or creating new cost inputs is blocked.
