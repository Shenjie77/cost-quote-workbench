# cost-cli quick reference

`cost-cli` 0.3.0 is the stable local machine interface. The complete Agent and
handoff contract is in `docs/cli-control-manual.md`.

## Discovery

```bash
npm run --silent cost-cli -- system doctor
npm run --silent cost-cli -- system capabilities --pretty
npm run --silent cost-cli -- schema list --pretty
npm run --silent cost-cli -- schema show \
  --name cost-export \
  --schema-version 2.0.0 \
  --pretty
```

Schema names are `cost-export`, `maintenance-price`, `command-request`,
`command-envelope`, and `workspace-state`.

## Cost commands

JSON input must be a `cost-workbench/v2` request envelope, such as
`tests/fixtures/cost-request.valid.json`.

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

Use `--input -` for stdin. Export requires explicit `--overwrite` when the
destination already exists.

## Global data and project snapshots

```sh
npm run --silent cost-cli -- masterdata get --tab resources --query LOCAL-L1
npm run --silent cost-cli -- masterdata update --tab resources --input rates.json --expected-revision R
```

Master Data has no project ID and uses the selected tab's independent revision.
Existing projects, including Drafts, retain captured data. New projects and blank
cost versions capture current global defaults/rates; cloned versions retain source
rates. Explicit adoption uses `cost apply-rates --project-id ID --version Vn`, or
`project apply-masterdata --project-id ID --tab TAB`, with the project revision.
See [the supported tabs and snapshot read commands](global-master-data.md).

## Daily Agent digest

```bash
npm run --silent cost-cli -- digest generate \
  --as-of 2026-09-05 \
  --pretty
```

The digest reads all local projects and returns source-grounded exceptions:
overdue, blocked, or stale reviews; due decisions; draft cost baselines; and
incomplete cost rows. Omit `--as-of` to use the workspace's Singapore date.

## Protocol

- API: `cost-workbench/v2`.
- Response envelope: `2.0.0`.
- Cost schema/calculation/workbook: `2.0.0`.
- Years: exact ordered `Y1`–`Y5`; no Y0.
- stdout: exactly one schema-validated JSON envelope.
- Money: numeric, upward to cents; `.00` is a UI/Excel format.

Run `npm test` before handoff. See `docs/cli-control-manual.md` for request and
response examples, errors, exit statuses, Agent workflow, and v1 migration.

## Simple export and suspended cleanup

`cost export --project-id ID --version Vn --format simple --output FILE.xlsx` exports five business sheets matching the page; omit format (or use full) for the existing nine-sheet workbook. Invalid formats are rejected before file or project access.

`cost delete --project-id ID --version Vn --expected-revision R` removes an unlocked Suspended version from the working list, preserving immutable history and at least one visible version. List archives with `cost get --project-id ID --section deleted-versions`; retrieve one using `--section archive --version Vn`. Codes are never reused.

`cost update --section settings` supports `manualCosts.otherServiceRate:0.01` for 2.3.4.2 = 1% × 2.3.1. Setting only `manualCosts.otherService` switches to manual amount. Master Data resource classifications are explicit; custom RE codes are accepted with valid category/pool/level fields.
