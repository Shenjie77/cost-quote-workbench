# Cost workbook export

The Cost Workspace export button creates one `.xlsx` file for internal sharing.
Workbook contract version is `2.0.0`.

## Simple export

**Simple Export** opens a worksheet picker with all available sheets selected.
Choose any non-empty subset, then select **Export**. **Select all**, **Clear** and
**Cancel** only affect the picker; they do not change cost inputs. An export
failure leaves the selection open for retry.

The standard sheets are `Cost Detail`, `Summary Scope`, `Summary BU`,
`Summary RE Type`, `Summary Group`, `Summary Subcon`, and `Cost Statement`. Depending on the
captured data, the picker also offers `Legacy Subcon`, `Subcon Rates`,
`Subcon Detail`, and `Subcon Site Types`. Only selected report sheets are written and archived. When Cost Detail is included,
a hidden `Cost Calculations` sheet supports the formula chain without adding a visible report tab.

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

The formula chain is **editable effort / quantities and captured rates → annual costs →
detail and dimension totals → Cost Statement → allocated quotation Cost → Price / Unit →
Amount → final total and actual GP**. Custom cost weights and all commercial inputs are captured together.
Cost allocation uses largest-remainder cents, keeping the row costs equal to the
complete statement including risk. EHS uses labour + subcontract + settlement.

Blue inputs include quantity, cost weight, target GP and saved price. `Target GP`
rows use formulas with the application's upward-cent rounding and four-decimal
unit prices. `Saved price` rows retain explicit or historical prices; change the
price-basis dropdown to use GP pricing. The BU share is the captured weighted
rate, and discount applies after summing the lines. Zero or invalid denominators
remain visible as spreadsheet errors rather than silently producing a price.

Simple and combined cost workbooks use formulas for personnel effort × captured
loaded rates, HQ travel allocation, Subcon quantities × unit prices × uplifts,
dimension summaries and Cost Statement. Editable inputs are blue. The hidden
`Cost Calculations` sheet preserves exact cent allocation for HQ travel;
`Pricing Calculations` supports the combined quotation allocation and GP rounding.
Formula outputs include cached results and the workbook requests recalculation on open.
There are no external workbook links or macros.

If a source sheet or annual input is omitted, its original input remains captured
in the corresponding formula or statement; omitted sheets never cause broken references.
Editing an existing exported quantity updates the linked totals. Adding new source rows
or changing category/group membership should be done in the platform before re-exporting.
Excel edits do not write back into the platform.

Category is exported on personnel, Subcon and combined quotation detail. Summary Group
has one section per Category with its Group rows, classified Subcontract costs and a
formula subtotal. Blank personnel categories use `Uncategorized`. Unclassified
Subcontract and project-wide EHS, risk and other accounts have a separate
`Project Accounts` subtotal. The grand total sums only the section subtotals; it never
adds the underlying detail twice. Same-name groups in different categories remain separate.
Category is commercial classification, separate
from RE Category and Mandatory/Optional inclusion. Automatic quotation layouts inherit
Cost Category; existing generated quotation lines can use **Refresh from Cost**.
Existing exported files are snapshots: re-export to receive the corrected layout and formulas.
Category labels come from saved costs or explicit quotation overrides; the exporter does
not infer missing categories from Group names or earlier hand-edited workbooks.

Full Export retains its audit layout and formulas. Annual internal cost links to
mandays and the visible captured MD rate in `08_Assumptions`; existing HQ Travel
cost links to current exported HQ effort and travel assumptions, including enabled HQ
travel initially at zero. Percentage-based EHS follows the recalculated labour,
Subcon and settlement base. Subcon detail formulas
feed its audit detail and summary sheets. Annual personnel uplift and allowance factors
remain the version's captured inputs.
Full summary keys match exact labels, including literal `*` / `?` and case differences.
HQ travel uses bounded helper calculations so its formulas stay within Excel's length limit.

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
selling-price proportion. New line GP defaults to 45%. Line GP or price edits
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

Company original-template filling, standard quotation CLI, CPQ and maintenance draft exports are documented in [SSR implementation](ssr-implementation-2026-09-07.md) and the [Skill command reference](../skills/references/operations.md).

Quotation descriptions accept line breaks. The grid shows up to three lines;
the expand button opens the complete description for viewing or editing. Exports
retain the full text. Generated By Scope and By Cost Item lines consolidate
project-level and legacy subcontract costs as `Subcon scope` or `Subcon item`;
site-type costs retain one line per site type. Saved custom lines remain unchanged.

## Export filenames

Browser-generated cost, combined quotation, customer quotation, CPQ, maintenance and Master Data exports include Singapore time down to milliseconds (`YYYYMMDD_HHmmss_SSS`). Project exports use readable project names instead of internal IDs; full and simple costs retain their version code. For example: `Cost_Simple_Test Project_V1_20260925_143012_123.xlsx`. Workspace backup downloads use the same clock and short naming convention. Explicit CLI `--output` paths remain controlled by the caller.

### 自定义报价明细与 Scope 分配

Custom lines 的草稿独立保存，切换 Single / Scope / Item 后再切回仍保留。点击明细行的 Cost 可多选 Scope 并设置每个来源的百分比，同一 Scope 可由多行共同承担。系统保存来源及比例，成本更新后自动重新计算，无需重新勾选。提高某行比例导致来源超额时，其他行对该来源的比例按比例缩减。

弹窗每条 Scope 都有 Cost Share（默认 100%）和 Risk Share。Risk Share 不受勾选限制，是整个项目共用的 Scope 风险分配：默认按最新 Scope 成本 Weight，手动设置某项后，其余自动项按成本 Weight 分摊剩余风险；留空或 Reset Risk to Weight 恢复自动。全部手动设置时合计必须为 100%。成本和分给 Scope 的风险一起按 Cost Share 进入引用它的报价行。旧的逐报价行 Risk 设置在首次应用此弹窗后由 Scope 分配替代。

未绑定行按原成本比例分摊剩余来源；没有承接行时新增 Other scopes。删除一行保留其他来源绑定；手动修改 Weight 解除各行来源绑定，恢复按 Weight 分摊。来源配置仅用于内部计算，不进入客户报价文件。

Quotation + Simple Cost 的 Cost Detail 复用 Simple Cost Export 生成器，采用该项目成本版本已保存的 Cost Input 列顺序、显示列、年度与分组。Cost Statement 按实际单元格建立公式引用；未显示年度与未选择明细保留已捕获的输入；可见输入修改后通过公式更新相关汇总。

所有百分比输入使用手动文本输入，失焦或 Enter 时提交，显示两位小数；未主动编辑时不截断内部计算精度。
