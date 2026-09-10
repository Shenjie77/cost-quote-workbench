# Cost & Quote Workbench

Local-first personal workbench for project delivery review, cost construction,
pricing, quote output, review follow-up, reusable master data, and maintenance
price history.

Current release: [v0.10.0 · Saved cost views, MD table entry and account summaries](docs/releases/v0.10.0.md).

The product UI is English-first with compact Chinese helper labels. It runs on
the company computer and is designed to give both the user and an internal
Agent a stable, auditable data source.

Project progress and reminders use [one configurable Project Workflow](docs/project-workflow.md).
Nodes support parallel work, required confirmation and information, SLA, pause/resume,
and per-node reminders. Today groups open tasks by project and highest urgency;
completing the configured finish node stops reminders. Earlier SSR reviews remain
read-only history; no independent Project Status needs maintenance. Global workflow
changes are previewed and published to eligible open projects with revision checks,
while active deadlines and completed history are preserved by default.
The dedicated Project Workflow page shares the cost page's project selection and
keeps Proposal Number, iSales and CPQ links in a compact project header.
Its **Project On Hold** switch pauses all workflow monitoring and reminders;
Project List marks held projects **On Hold**. Resuming retains progress and
adjusts active SLA deadlines for the pause. Workflow templates support more than
10 steps, with the actual count and Add Step controls at both ends of the list.
The [Skill operations reference](skills/cost-workbench/references/operations.md)
includes column mappings, templates and CLI commands.

Project List includes recoverable deletion. Deleted projects stay out of the UI,
including after restart; snapshots can be recovered with `project restore`.
Both new-project forms accept an optional Project ID (up to 80 characters).
Leave it blank to generate one automatically; existing or deleted IDs cannot be
reused, and the ID is immutable after creation.
New projects create a folder under the configurable archive root, containing only
**workflow**, **cost**, and **quotation**. Workflow subfolders use node names.
Select a workflow node and drop files onto its **Documents** card to upload;
**Project Files & Archive** lists all project files, including earlier rounds. Cost, quote, CPQ and maintenance
exports and applied source imports are archived automatically. File uploads do
not change workflow progress or locked costs. See [project file archives](docs/project-files.md).
Project List **Edit** updates project name, client, Proposal Number, iSales/CPQ
links and scope references. Its **Project Folder → Apply Folder** moves the
project's documents to an unused absolute folder path while preserving downloads.
Costs must be explicitly confirmed by the user before their version can enter,
submit or complete DRB. `Confirmed` makes that version's inputs immutable; it
is cost finalization, not DRB approval. Draft costs remain editable and cannot
be locked merely by marking DRB complete. Locked versions remain available for
summary, comparison and export. Create a new blank Draft or clone a locked
version to revise effort, captured rates or the optional 3% allowance; creation
selects the new version and starts its configured round-start node (DTRB by default). Masterdata Resources
remains editable, and rates apply only to an explicitly selected unlocked version.

Each new cost estimate starts an independent workflow round. The platform tracks
the current round with `workflowVersion`; selecting an older `activeVersion`
only views history. Existing submissions and approvals remain bound to their
original versions. Company approvals are recorded as actual progress in the
project workflow; quote export checks confirmed cost and valid quotation inputs
without requiring a duplicate local SSR approval chain.

**Master Data → Profit Share** maintains each BU's share of selling revenue.
Pricing Parameters uses the project's captured rates and BU cost weights to
calculate net **Sales GP** and solve the target price. Costs without a BU,
including EHS and Risk, go to the largest direct-cost BU. Existing projects use
**Apply Latest Master Data** to adopt new rates; locked costs and quotation
history stay unchanged. See [BU profit share and pricing](docs/profit-share.md).

Cost Input is a compact editable grid with All/Y1–Y5 views and a toolbar
Mode selector for Sites or Direct MD; it has no separate search bar. The
**Groups** toggle beside Mode displays custom group headings, independent of
Scope. Edit the Group column or rename a group heading; move rows with the
Action arrows or drag handle, including between groups. Group names and row
order are stored with the cost version and can also be updated through CLI.
**Columns** controls visibility and left/right order. Use **Save** to retain the
year, group visibility and columns in this browser for the current project and
cost version; the same action flushes cost inputs, allowance and travel settings.
**Simple Export** follows those columns plus the selected grouping and year view
in Cost Detail; its summaries retain full five-year totals. **Full Export** keeps
the standard workbook layout. **Cost Statement** opens first in Summary; named
statement accounts replace the generic unassigned cost bucket, and **Subcon**
reconciles its breakdown to 2.3.2. UI and Simple Export summaries include Risk.
**Bulk Entry** opens a local table-paste preview: recognize
Chinese/English columns, resolve RE Types and annual quantities, then confirm
to append rows. Fixed **Scope + MD** and **Group + Scope + MD** formats support
short tables without headers, with BU, RE Type and year selected as defaults.
Costs use the selected version's captured rates and allowance;
pasted prices are not imported. See the [personnel entry guide](docs/personnel-entry.md).
An optional
3% allowance applies to all internal personnel in selected **LOCAL, ARP, HQ or
OTHER Pools**. HQ Travel has its own opt-in. Both default off in new blank cost
versions; copied and historical versions retain their original settings. Each
annual personnel Cost includes the selected 3% once, and summaries, history,
quotations and Excel use that result directly. Master rates and mandays stay unchanged.

Cost Workspace's **Subcon** tab calculates structured subcontract costs into
Cost Statement **2.3.2**. Small projects enter annual item quantities; larger
projects define site-type BOQs and Y1–Y5 deployment counts, with shared project
items kept separate. Select catalogue items in batches or save a manual item,
then adjust the version's captured price and quantities. Catalogue price updates
do not reprice existing BOQs. See the [subcontract cost guide](docs/subcontract-cost-design.md).

Use the [19 business Skills](docs/business-skills.md) directly for project setup, master data, costing, CPQ, maintenance, quotation and workflow updates. `cost-workbench` is the lightweight cross-business router.

For routine Skill work, use [narrow resource commands](skills/cost-workbench/references/resources.md):
project metadata, individual cost versions/rows, ten global Master Data tabs,
project CPQ drafts/selections, workflow plan/actions/history, quotations and BOQ. General catalogue maintenance needs
no project ID or workspace read and has an independent revision per tab. Workflow
publication is the exception: it previews affected projects and checks their revisions. Paginated reads and compact
mutation receipts avoid sending a full workspace through the agent context.
Project operations save a validated, atomic project document internally; global
catalogue maintenance saves only its own tab. Workflow publication synchronizes
definitions without altering captured cost rates or amounts. Each new cost Draft adopts the latest global workflow template, whether the prior round is open or completed, and preserves prior costs and workflow snapshots. Database
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
features/projects/           Project List, unified workflow tracking, and project navigation
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

For a page-shaped cost report, use **Simple Export** or
`cost export --project-id ID --version Vn --format simple --output Cost.xlsx`.
The five-sheet simple and nine-sheet full layouts remain available; versions
with structured BOQs also include Subcon Detail and, when applicable, Subcon
Site Types. New blank costs default
account 2.3.4.2 to 1% of account 2.3.1 Labour Cost; enter a manual amount to override
it, or use the 1% button to restore automatic calculation. Historical saved values
and cloned calculation modes remain intact.
