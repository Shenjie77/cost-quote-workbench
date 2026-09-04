# Cost & Quote Workbench

Local-first personal workbench for project delivery review, cost construction,
pricing, quote output, review follow-up, reusable master data, and maintenance
price history.

The product UI is English-first with compact Chinese helper labels. It runs on
the company computer and is designed to give both the user and an internal
Agent a stable, auditable data source.

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
npm run build
```

## cost-cli

```bash
npm run --silent cost-cli -- system capabilities --pretty
npm run --silent cost-cli -- schema list --pretty
npm run --silent cost-cli -- workspace list --pretty
npm run --silent cost-cli -- digest generate --pretty
npm run --silent cost-cli -- cost validate --input tests/fixtures/cost-request.valid.json --pretty
npm run --silent cost-cli -- cost calculate --input tests/fixtures/cost-request.valid.json --pretty
npm run --silent cost-cli -- cost export --input tests/fixtures/cost-request.valid.json --output ./Cost.xlsx --pretty
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
features/workbench/          Client composition, navigation, and detail panels
features/projects/           Project List, status control, and project navigation
features/cost/               Cost input, calculation, summary, and XLSX export
features/master-data/        RE Type/rate, subcontract, supplemental cost,
                             and maintenance-history maintenance pages
features/{overview,quote,reviews,agent}/
                             Independent business views
db/                          Versioned local SQLite schema
server/                      Same-device API and repository adapter
cli/cost-cli.mjs             Machine-first local CLI
schemas/                     Versioned JSON request/response contracts
docs/                        Architecture, calculation, CLI, and export guides
skills/cost-workbench/       Deferred draft; not an active platform dependency
```

Business rules and public functions use module comments/JSDoc. Comments explain
responsibility, calculation intent, and invariants rather than repeating each
line of JSX; this keeps documentation useful when the implementation changes.

All money is normalized upward at the cent before roll-up. For example,
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
