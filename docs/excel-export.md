# Cost workbook export

The Cost Workspace export button creates one `.xlsx` file for internal sharing.
Workbook contract version is `2.0.0`.

## Simple export

**Simple Export** opens a worksheet picker with all available sheets selected.
Choose any non-empty subset, then select **Export**. **Select all**, **Clear** and
**Cancel** only affect the picker; they do not change cost inputs. An export
failure leaves the selection open for retry.

The six standard sheets are `Cost Detail`, `Summary Scope`, `Summary BU`,
`Summary RE Type`, `Summary Subcon`, and `Cost Statement`. Depending on the
captured data, the picker also offers `Legacy Subcon`, `Subcon Rates`,
`Subcon Detail`, and `Subcon Site Types`. Only selected sheets are written and
archived; their original order, content and calculations are preserved.

The report follows the page's
annual inputs, calculated costs, dimension totals and statement hierarchy.
Report Item contains both English and Chinese in one cell, including its report
account number. Technical IDs, classification codes and Source columns are
omitted. Both automatic 2.3.4.2 percentages and manual overrides use the version's
shared calculated amounts.

```sh
npm run --silent cost-cli -- cost export --project-id ID --version Vn --format simple --output outputs/Cost-simple.xlsx
```

The CLI continues to export all available sheets with its standard detail layout.
The simple report is read-only and available for locked versions. The same
validation rules apply to both formats. Omit `--format` or use `--format full`
for the detailed audit workbook described below.

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

## Combined internal quotation and Simple Cost workbook

**Quotation + Simple Cost** in Pricing & Quote exports an internal workbook with
`Quotation Details` first and a picker for the desired Simple Cost sheets.
`Cost Statement` is mandatory; all other cost sheets can be selected or cleared. It is available
for valid draft costs without a customer template; it archives under project cost
files and does not create a customer quotation history entry.

The formula chain is **captured annual cost amounts → detail totals → Cost
Statement → allocated quotation Cost → Price / Unit → Amount → final total and
actual GP**. Custom cost weights and all commercial inputs are captured together.
Cost allocation uses largest-remainder cents, keeping the row costs equal to the
complete statement including risk. EHS uses labour + subcontract + settlement.

Blue inputs include quantity, cost weight, target GP and saved price. `Target GP`
rows use formulas with the application's upward-cent rounding and four-decimal
unit prices. `Saved price` rows retain explicit or historical prices; change the
price-basis dropdown to use GP pricing. The BU share is the captured weighted
rate, and discount applies after summing the lines. Zero or invalid denominators
remain visible as spreadsheet errors rather than silently producing a price.

Simple Cost annual amounts are snapshot inputs, not a duplicate personnel or
Subcon rate engine. Editing these annual amounts or manual Cost Statement
accounts updates the quote. If a detail sheet is omitted, its cost is retained as
a snapshot amount in Cost Statement (or the constant part of a partially linked
account formula), so omitted tabs never create broken references. Existing Summary tabs are explicitly labelled as
export snapshots and do not recalculate. A hidden `Pricing Calculations` sheet
contains the cost-allocation and GP rounding steps; no external workbook links
or macros are required. Ordinary Simple Export and customer exports are unchanged.

## Customer quotation workbook

The Pricing & Quote page creates a separate customer `.xlsx` using the selected
quotation template and included primary-language assumptions. The standard
`Quotation` sheet contains project/client metadata, service price, discount,
one **Quote Total**, validity, payment terms and customer-specific T&C. Detailed
modes also include a `Quotation Details` sheet with description, quantity, unit,
unit price and amount. Long terms flow into additional rows/pages; the worksheet
is fitted to one page wide, not one page tall.

Each line's internal Cost includes its allocation of the complete project cost
with Risk. Weight is the cost share; quotation share is a separate editable
selling-price proportion. New line GP defaults to 50%. Line GP or price edits
change the summed line total; quotation-share edits redistribute that current
total across unlocked lines. The page's overall GP is a read-only result based
on the final quotation after discount and BU profit share. See
[line pricing](manual-quote-target-pricing.md) for lock and rounding rules.

Internal costs, cost weights, quotation shares, line GP, locks and BU profit-share
values stay in the workbench and are excluded from customer detail columns.
Current calculations and standard customer output do not apply or show GST/tax.
Saved historical tax fields remain readable without rewriting their original
amounts. Customer Excel mappings expose one **Quote Total** destination. Existing
before/after-total mappings both receive the same final quotation amount; old
mapped tax-rate and tax-amount cells are cleared. Unmapped customer text and
formulas are preserved, including any static tax labels in the original template.

Every generated workbook appends a quote-history record with quote number,
timestamp, cost version, template ID, cost, quote totals, margin, and lifecycle
status. Customer output requires a Confirmed version plus valid cost and pricing
inputs; a Confirmed label alone does not bypass validation. Historical references
use a separate form for actual quote number, date, cost, one Quote Total, and source.

Generated history also stores the exact template and included assumption text.
Later master-data edits do not rewrite that snapshot. Template selection must
be active and match the customer (exact name or `*` for common templates).
See [quote catalog management](quote-catalog.md).

Company original-template filling, standard quotation CLI, CPQ and maintenance draft exports are documented in [SSR implementation](ssr-implementation-2026-09-07.md) and the [Skill command reference](../skills/cost-workbench/references/operations.md).

Quotation descriptions accept line breaks. The grid shows up to three lines;
the expand button opens the complete description for viewing or editing. Exports
retain the full text. Generated By Scope and By Cost Item lines consolidate
project-level and legacy subcontract costs as `Subcon scope` or `Subcon item`;
site-type costs retain one line per site type. Saved custom lines remain unchanged.
