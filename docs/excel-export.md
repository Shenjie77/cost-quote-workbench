# Cost workbook export

The Cost Workspace export button creates one `.xlsx` file for internal sharing.
Workbook contract version is `2.0.0`.

## Sheets

| Sheet                 | Purpose                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `00_Readme`           | Project/version metadata, reconciliation, and validation warnings                             |
| `01_Cost_Detail`      | Cost Input rows plus HQ travel and manual statement leaves                                    |
| `02_Summary_Scope`    | Sites, mandays, cost, cost/MD, and share by Scope                                             |
| `03_Summary_BU`       | Same measures by BU                                                                           |
| `04_Summary_RE_Type`  | Same measures by Resource Type                                                                |
| `05_Summary_RE_Level` | Internal sites, mandays, cost, cost/MD, and share by RE Type level                            |
| `06_Cost_Statement`   | Company statement hierarchy and source mode                                                   |
| `07_Reconciliation`   | Independent cross-checks for detail, dimensions, and statement totals                         |
| `09_Source_Trace`     | Included when imported rows exist: original/current values, file hash, sheet, row and mapping |
| `08_Assumptions`      | Delivery years, uplift, travel, and consolidated RE Type rate snapshot                        |

## Reconciliation

Scope and BU cannot invent an allocation for project-level costs. HQ travel and
manual statement inputs therefore export as `UNALLOCATED`. Risk uses
`Cost Layer=RISK` and is excluded from Sales Cost dimensional totals.

```text
Cost Input + HQ Travel + Manual Sales Cost = Sales Cost
Sales Cost + Risk Contingency               = Total Cost with Risk
```

## Export blocking rules

- missing or duplicate line ID;
- cost line with an invalid RE Type;
- annual allocation other than exactly ordered Y1–Y5;
- negative or non-finite numeric input;
- scheduled input without a TD delivery start year.
- internal labour amounts that differ from the version's sites, MD/site, rate,
  and uplift calculation (`LABOUR_COST_MISMATCH`).

Warnings do not block export. They are included in `00_Readme`, including
unallocated project cost and potential external-labour/subcontract overlap.

Any stored version can be opened from Version Comparison and exported. Its own
resource/rate snapshot is used. Change is measured against its source version.

## Customer quotation workbook

The Pricing & Quote page creates a separate one-sheet `.xlsx` using the
selected quotation template and included bilingual assumptions. It contains
the project/client metadata, service price, discount, pre-tax quote, GST, final
total, validity, payment terms and customer-specific T&C. Long terms flow into
additional rows/pages; the worksheet is fitted to one page wide, not one page tall.
Internal cost and gross-margin values are
kept in the workbench/quote-history snapshot and are deliberately excluded from
the customer workbook.

Every generated workbook appends a quote-history record with quote number,
timestamp, cost version, template ID, cost, quote totals, margin, and lifecycle
status. Customer output requires a Confirmed version plus valid cost and pricing
inputs; a Confirmed label alone does not bypass validation. Historical references
use a separate form for actual quote number, date, cost, price, tax, and source.

Generated history also stores the exact template and included assumption text.
Later master-data edits do not rewrite that snapshot. Template selection must
be active and match the customer (exact name or `*` for common templates).
See [quote catalog management](quote-catalog.md).

Company original-template filling, standard quotation CLI, CPQ and maintenance draft exports are documented in [SSR implementation](ssr-implementation-2026-09-07.md) and the [Skill command reference](../skills/cost-workbench/references/operations.md).
