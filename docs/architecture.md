# Architecture and handoff

## Product boundary

The workbench is a local personal productivity tool. It does not replace the
company quotation platform. It records working assumptions, calculates cost,
creates internal output, and gives an Agent a controlled interface. Approved
results can then be entered into the company system.

## Layers

### Functional page boundaries

- **Master Data** is the single maintenance entry point for RE Types/rates,
  subcontract references, supplemental costs, maintenance history, reusable
  assumptions, customer quotation templates, workflow defaults
  and CPQ catalog. A legacy status tab remains in the nine-tab storage contract
  for compatibility, not as another progress UI. Each tab has its own revision; no
  project must be read or selected to maintain them.
- **Pricing & Quote** selects/applies templates and assumptions, edits this
  project's current quotation copies, calculates pricing and creates output.
  Its Manage buttons open the corresponding global Master Data tab. Existing
  project templates and assumptions remain detached snapshots; adopting new global
  content is explicit. Generated quotation history retains its original text.
- The redundant **Templates & Settings** navigation alias was removed. There is
  no separate platform-settings page until actual platform configuration is added.
- Global maintenance saves only the target tab. New projects capture the global
  defaults; blank cost versions capture current global resources and clones keep
  source-version rates. Later global updates do not alter any existing Draft or
  historical cost/quote. Explicit adoption uses project apply-masterdata or
  cost apply-rates for the named unlocked version. See [data boundaries](global-master-data.md).
- `features/master-data/navigation.ts` owns supported tab IDs and labels. The
  composition root owns the selected tab as session-only UI state; it is not a
  new SQLite field or CLI command. Changing views never resets workspace data.

### Project Workflow and reminders

`features/projects/workflow-domain.ts` normalizes one register and applies revision-checked tracking updates. Project List and Overview share the workflow dialog. `project --section workflow-tracking` exposes only the current node and tracking fields; `workflow-history` exposes paginated records. Proposal/Scope metadata has a separate narrow `project metadata` section using the existing stored values.

`currentWorkflowStepCode` and the selected process step are the progress source. `projectStatus` is derived compatibility data. `QUOTE_COMPLETED` suppresses all reminders for that project; a new cost Draft opens DTRB and resumes date-based follow-up. SSR submissions and reviewGates are retained as read-only evidence instead of a second editable process. The Agent digest and reminder service consume the same compact workflow projection. See [workflow behavior](project-workflow.md).

### Technical layers

1. **Presentation** — `app/page.tsx` and `components/ui`. This layer renders
   tables, accepts user actions, and creates immutable command/export snapshots.
2. **Domain** — `features/cost/domain.ts`. Pure types and formulas for sites,
   mandays, uplift, HQ travel, statement roll-up, and dimensions.
3. **Export** — `features/cost/export-workbook.ts`. Validates one snapshot and
   creates the internal-team workbook. It does not read React state directly.
4. **CLI** — `cli/cost-cli.mjs`. Parses commands, validates JSON, calls the same
   domain/export functions, and returns a stable JSON envelope.
5. **Persistence** — `server/workspace-repository.mjs` and `db/schema.ts`.
   The UI and CLI share one local SQLite file, WAL mode, atomic snapshots,
   hashes, and optimistic revision checks.
6. **Local API** — `server/local-api.mjs`. A loopback-only JSON service lets
   the browser hydrate and autosave without exposing direct SQL.
7. **Contracts** — `schemas/*.schema.json`. Strict Draft 2020-12 request and
   response formats. Unknown input fields are rejected.

`server/workspace-document.mjs` owns document migration and reference
validation; it has no SQL connection. `workspace-repository.mjs` owns SQL,
transactions and durable writes. Derived monetary values are validated again
after calculation so individually valid inputs cannot create an invalid record.

The browser persistence boundary is split into `workspace-types.ts`,
`workspace-client.ts`, `save-queue.ts`, and `local-persistence.ts`.
`workspace-factories.ts` constructs detached project/version defaults. The
queue serializes writes per loaded project; project switching awaits its latest
write, and a failed write leaves the outgoing editor available.

The Web UI, CLI, and Excel must not implement separate calculation formulas.
New formulas belong in the domain layer and require regression checks through
both calculation and export commands.

## Version identifiers

- CLI version: executable compatibility (`0.3.0`).
- API version: request/response compatibility (`cost-workbench/v2`).
- Envelope version: stdout structure (`2.0.0`).
- Cost schema version: input data contract (`2.0.0`).
- Workbook contract: sheet names and meanings (`2.0.0`).
- Calculation engine version: business-formula meaning (`2.0.0`).

Removing/renaming fields or changing formula meaning requires a major API or
schema version. Adding optional fields is a minor change. Documentation-only
corrections are patches.

## State and persistence

The active project workspace persists to local SQLite with WAL mode, foreign
keys, SHA-256 payload hashes, and optimistic `revision` checks. Browser edits
autosave after 900 ms; CLI writes must present the exact expected revision.
The current atomic workspace document contains:

- one project workflow with current code, owner, follow-up date and note;
- append-only workflow updates, with legacy SSR/review gates retained read-only;
- derived compatibility projectStatus and quote-pricing parameters;
- independent cost-version input snapshots plus the active version;
- cost lines and manual statement inputs;
- labour-rate and HQ-travel assumptions;
- captured RE Type/rate, supplier, and subcontract reference snapshots;
- captured quotation templates/library, current assumptions and quotation history;
- supplemental-cost and maintenance-price reference records;
- schema and calculation-engine versions;
- source file references and hashes.

Global Master Data is stored separately, with one revision per tab and migration
provenance for same-key conflicts. Existing workspace catalog arrays are captured
project snapshots, not the global source of truth. A global update neither scans
projects nor writes their snapshots.

The repository layer is the only SQL adapter. UI and CLI call it through the
local API or repository service and never issue SQL directly. The project list
is a calculated projection of each workspace; its totals are never stored as a
second source of truth. Follow-ups and quotation snapshots are append-only from
their UI workflows, while general mutations use revision checks rather than a
separate event ledger.

## Comment standard

- Each module starts with its responsibility, boundaries, and main invariants.
- Every exported function/type used across modules has JSDoc describing its
  inputs, output, business meaning, and important failure behavior.
- Non-obvious formulas explain **why** the formula exists.
- JSX comments are used only for interaction or accessibility decisions that
  naming cannot convey. Line-by-line comments are avoided because they drift.

## Deliberate boundaries

- Cost versions are independent snapshots with manual `Draft`, `Suspended`,
  and `Confirmed` lifecycle states. Explicit user cost confirmation makes that
  version's inputs immutable through repository validation; this is not a
  cryptographic signature or DRB approval. DRB entry, submission and completion
  require Confirmed cost first. Locked versions remain readable and can be cloned
  into new Drafts, which become the active version and start independent DTRB
  rounds. workflowVersion identifies the working round and versionWorkflows
  retains per-version progress; these fields are platform-managed. Selecting an
  older activeVersion only views history. Company progress is registered in the
  one Project Workflow; old SSR records are read-only and no longer impose
  a duplicate local approval chain on project-mode quote export.
- RE Type consolidates personnel family, level, MD rate, conversion factors,
  and effective dates. Every cost version captures an independent RE Type
  catalogue. Cost rows reference that snapshot; current global resources are
  applied only through the explicit rate-refresh action for the named unlocked
  version. Rates are SGD/MD; no independent currency-conversion engine exists.
- Manual statement costs and HQ travel are project-level. Until allocation keys
  exist, they appear under `UNALLOCATED` in dimensional exports.
- Open-project tabs are session UI state. Project data remains durable even
  after its tab is closed.
- Company-system entry remains outside the boundary because the company has
  not exposed an API; governed XLSX/JSON are the handoff formats.
