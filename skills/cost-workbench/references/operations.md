# Operations

## Cost workbook

```bash
npm run --silent cost-cli -- system capabilities
npm run --silent cost-cli -- schema show --name cost-export
npm run --silent cost-cli -- cost validate --input /absolute/path/snapshot.json
npm run --silent cost-cli -- cost calculate --input /absolute/path/snapshot.json
npm run --silent cost-cli -- cost export \
  --input /absolute/path/snapshot.json \
  --output /absolute/path/Cost_Project_V3.xlsx
```

Do not add `--overwrite` unless the user explicitly wants to replace that exact
file. A validation exit code of 3 means the JSON shape is wrong; code 6 means a
business rule failed.

## Maintenance history

```bash
npm run --silent cost-cli -- schema show --name maintenance-price
npm run --silent cost-cli -- maintenance validate --input /absolute/path/history.json
```

The current CLI validates maintenance history but does not persist it. Do not
claim that a successful validation updated the browser dataset.

## Data interpretation

- Y0 is unscheduled and has no uplift.
- Sites × MD/Site produces mandays.
- HQ travel is internal HQ resources only.
- Non-house time-and-material labour and packaged subcontract cost must not
  post the same commercial scope twice.
- `UNALLOCATED` is an explicit project-level cost, not missing data.
