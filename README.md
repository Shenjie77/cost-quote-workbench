# Cost & Quote Workbench

Local-first personal workbench for project delivery review, cost construction,
pricing, quote output, review follow-up, reusable master data, and maintenance
price history.

Current release: [v0.7.0 · Global Master Data and cost version tools](docs/releases/v0.7.0.md).

The product UI is English-first with compact Chinese helper labels. It runs on
the company computer and is designed to give both the user and an internal
Agent a stable, auditable data source.

SSR scope imports, review evidence, reminders, CPQ and maintenance BOQ are described in the
[SSR implementation guide](docs/ssr-implementation-2026-09-07.md). The
[Skill operations reference](skills/cost-workbench/references/operations.md) includes
column mappings, templates and all new CLI commands.

Project List includes recoverable deletion. Deleted projects stay out of the UI,
including after restart; snapshots can be recovered with `project restore`.
Costs must be explicitly confirmed by the user before their version can enter,
submit or complete DRB. `Confirmed` makes that version's inputs immutable; it
is cost finalization, not DRB approval. Draft costs remain editable and cannot
be locked merely by marking DRB complete. Locked versions remain available for
summary, comparison and export. Create a new blank Draft or clone a locked
version to revise effort, captured rates or the optional 3% allowance; creation
selects the new version and starts its own DTRB round. Masterdata Resources
remains editable, and rates apply only to an explicitly selected unlocked version.

Each version has an independent DTRB → DRB review sequence. The platform tracks
the current round with `workflowVersion`; selecting an older `activeVersion`
only views history and does not redirect the round. Existing submissions and
approvals remain bound to their original versions. A new estimate needs its own
applicable review evidence before quotation export.

Cost Input has an optional 3% allowance for Local and ARP internal labour,
off by default per cost version. When enabled, each Y1–Y5 Cost is calculated
with the 3% included. Summaries, history, quotations and Excel use those final
costs directly, without another allowance layer. Master rates and mandays stay unchanged.

Use the [18 business Skills](docs/business-skills.md) directly for project setup, master data, costing, CPQ, maintenance, quotation and workflow updates. `cost-workbench` is the lightweight cross-business router.

For routine Skill work, use [narrow resource commands](skills/cost-workbench/references/resources.md):
project metadata, individual cost versions/rows, nine global Master Data tabs,
project CPQ drafts/selections, SSR, quotations and BOQ. Global maintenance needs
no project ID or workspace read and has an independent revision per tab. Paginated reads and compact
mutation receipts avoid sending a full workspace through the agent context.
Project operations save a validated, atomic project document internally; global
maintenance saves only its own tab and never rewrites existing projects. Database
migration runs once per schema release instead of scanning every project on
each CLI call.

## Run locally

```bash
npm install
npm run seed:local
npm run dev
```

Open `http://localhost:3000/`.

For the built local application, run `npm run build` once and then `npm start`;
this also starts both processes on the same two loopback addresses.

## Clone from GitHub

```bash
git clone <private-repository-url>
cd cost-quote-workbench
npm ci
npm run seed:local
npm run dev
```

The repository contains source code, schemas, tests, and operating guides. It
does not contain the local `data/` directory, environment files, build output,
or dependency folders. Never add quotation records or company data to source
control; use an approved internal backup location for the SQLite database.

## Validate the project

```bash
npm run format
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## cost-cli

```bash
npm run --silent cost-cli -- system capabilities --pretty
npm run --silent cost-cli -- schema list --pretty
npm run --silent cost-cli -- project list --pretty
npm run --silent cost-cli -- cost get --project-id ID --version V1 --section summary
npm run --silent cost-cli -- masterdata get --tab resources --limit 20
npm run --silent cost-cli -- digest generate --pretty
npm run --silent cost-cli -- cost validate --input tests/fixtures/cost-request.valid.json --pretty
npm run --silent cost-cli -- cost calculate --input tests/fixtures/cost-request.valid.json --pretty
npm run --silent cost-cli -- cost export --input tests/fixtures/cost-request.valid.json --output ./outputs/Cost.xlsx --pretty
```

The CLI writes exactly one JSON response envelope to stdout. Start with the
[Agent-facing CLI control manual](docs/cli-control-manual.md), then use the
canonical machine contracts in [`schemas/`](schemas/). Cost commands accept the
versioned `cost-workbench/v2` request envelope shown in the fixture above; they
do not accept an unwrapped snapshot.

## Source layout

```text
app/page.tsx                 Minimal App Router entry point
components/ui/               shadcn interface primitives
components/workbench/        Shared compact workbench presentation components
features/workbench/          Composition, workspace factories/types, HTTP client,
                             project-scoped save queue and React lifecycle
features/projects/           Project List, status control, and project navigation
features/cost/               Cost input, calculation, summary, and XLSX export
features/master-data/        RE Type/rate, subcontract, supplemental cost,
                             and maintenance-history maintenance pages
features/{overview,quote,reviews,agent}/
                             Independent business views
db/                          Versioned local SQLite schema
server/                      Same-device API, pure document migration/validation,
                             and SQLite repository adapter
cli/cost-cli.mjs             Machine-first local CLI
schemas/                     Versioned JSON request/response contracts
docs/                        Architecture, calculation, CLI, and export guides
skills/ssr-*/                Independent SSR business Skills and focused references
skills/cost-workbench/       Lightweight cross-business router and legacy manuals
.agents/skills/              Project discovery links to the canonical Skills
```

Business rules and public functions use module comments/JSDoc. Comments explain
responsibility, calculation intent, and invariants rather than repeating each
line of JSX; this keeps documentation useful when the implementation changes.

Cost money is normalized upward at the cent before roll-up. CPQ additionally supports an explicit per-line half-up-cent setting. For example,
`18,848.282` becomes `18,848.29`; UI and Excel render exactly two decimal
places, while CLI JSON keeps amounts as numeric values.

## Local persistence

`seed:local` safely creates the bundled starter project only when it is absent.
`npm run dev` starts both the UI and the same-device API. Browser edits autosave
to `data/workbench.sqlite` and survive reloads or computer restarts. The CLI
reads and writes that same database through revision-checked `workspace`
commands. The profile action downloads the active project as a restore-ready
`WorkspaceSaveRequest` JSON backup. Initial starter data is stored only when a
project has no saved workspace. See [local storage and backup](docs/local-storage.md).

The database file is intentionally ignored by source control because it may
contain company working data. Back it up only to a company-approved location.

See the [structure audit and remediation record](docs/project-audit.md) for the
current module boundaries, corrected failure modes, and remaining limitations.

Master Data includes a reusable **Assumptions** library and customer-specific
**Quote Templates** with editable T&C. Quote output can reference matching
assumptions and preserves the exported clauses in history. Catalogs are
global defaults for future projects. Existing projects retain detached copies;
updating Master Data does not alter Drafts or historical costs/quotes. See the
[quote catalog guide and CLI field contract](docs/quote-catalog.md).

Each cost version keeps its own RE Type rates. Use **Apply Master Rates** in
the cost page’s Calculation Basis tile to explicitly capture current global rates
for a selected unlocked Draft. New projects and blank versions capture current defaults; cloned
versions keep their source rates. See [global data and project snapshots](docs/global-master-data.md).


RE Types expose editable Category, Pool and Level independently of their code.
The cost page has a Version Status tile, and unlocked Suspended versions can be
removed from the working list while retaining immutable history and at least one
remaining version. Deleted version numbers are never reused.

For a page-shaped five-sheet cost report, use **Simple Export** or
`cost export --project-id ID --version Vn --format simple --output Cost.xlsx`.
The existing full nine-sheet export remains available. New blank costs default
account 2.3.4.2 to 1% of account 2.3.1 Labour Cost; enter a manual amount to override
it, or use the 1% button to restore automatic calculation. Historical saved values
and cloned calculation modes remain intact.
