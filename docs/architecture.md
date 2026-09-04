# Architecture and handoff

## Product boundary

The workbench is a local personal productivity tool. It does not replace the
company quotation platform. It records working assumptions, calculates cost,
creates internal output, and gives an Agent a controlled interface. Approved
results can then be entered into the company system.

## Layers

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

- manually controlled project status and quote-pricing parameters;
- persisted review gates, due dates, owners, evidence, and follow-up history;
- independent cost-version input snapshots plus the active version;
- cost lines and manual statement inputs;
- labour-rate and HQ-travel assumptions;
- consolidated RE Type/rate, supplier, and subcontract master data;
- quotation templates, assumptions, and generated/manual quotation history;
- supplemental-cost and maintenance-price reference records;
- schema and calculation-engine versions;
- source file references and hashes.

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

- Cost versions are full editable snapshots with manual `Draft`, `Suspended`,
  and `Confirmed` lifecycle states. `Confirmed` is a workflow state, not a
  cryptographic lock or electronic signature.
- RE Type consolidates personnel family, level, MD rate, conversion factors,
  and effective dates. Cost rows preserve the selected RE Type ID.
- Manual statement costs and HQ travel are project-level. Until allocation keys
  exist, they appear under `UNALLOCATED` in dimensional exports.
- Open-project tabs are session UI state. Project data remains durable even
  after its tab is closed.
- Company-system entry remains outside the boundary because the company has
  not exposed an API; governed XLSX/JSON are the handoff formats.
