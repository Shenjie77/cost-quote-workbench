# BU Profit Share 与 Sales GP

## 操作

1. 在 **Master Data → Profit Share** 添加 BU、可选 **BU Code**、分成百分比和 Active 状态，保存该页签。20% 输入为 `20`。
2. 新项目自动捕获当前比例。已有项目在 **Pricing Parameters → Apply Latest Master Data** 明确采用最新比例，立即保存到该项目；成本已 Confirmed 也可以操作。
3. 在报价明细中逐行设置 **Target GP %** 或 **Price / Unit**；新生成行默认 GP 为 50%。系统合计行金额，上方 **Actual Sales GP** 只读显示折扣后的实际毛利，并展示各 BU 的成本、占比、比例及分成金额。**Manage Rates** 可跳转到主数据维护。

全局维护不重算已有项目。报价历史保留当次 BU 分摊、分成比例和金额，之后采用新主数据也不会更改原记录。

**BU Code**（数据字段 `buCode`）用于人工对照公司编码，可留空或重复，最多 200 个字符。它不作为记录 ID、成本归属或分成匹配键；系统仍通过稳定记录 ID 维护主数据，通过 BU 名称匹配成本。旧数据没有该字段时无需迁移。

成本录入的 BU 下拉框引用此页签已保存且启用的 BU，并显示公司编码帮助选择；成本实际保存 BU 名称。主数据停用或删除后，已有成本的历史 BU 保留显示，不会被自动清空或重新分配。修改目录仅更新可选项，项目已捕获的分成率仍须明确应用。

## 计算口径

按最终 Cost Statement 的含风险总成本计算，包括人力成本中已计入的 Allowance、启用的 HQ Travel 和结构化分包。已有 BU 的成本保持归属；EHS、Risk、物流等没有 BU 的成本全部归入直接成本最大的 BU，再计算各 BU 权重。直接成本并列时按规范化 BU 名稳定选择。

```text
BU 权重 = 该 BU 最终归属成本 / 项目总成本
加权分成率 = Σ(BU 权重 × BU 分成率)
Quote Total = 明细金额合计 − Discount
分成金额 = Quote Total × 加权分成率
Actual Sales GP = (Quote Total − 总成本 − 分成金额) / Quote Total
行基础目标金额 = 行分摊成本 / (1 − 行 Target GP − 加权分成率)
```

行目标金额向上取到分，并在必要时补足分成金额进位差额，结合数量和四位小数单价保证该行未折扣 GP 达到目标。直接设置单价的行保留该单价，并计算其实际 GP。各 BU 的显示分摊会分配分位差额，合计与总价、总分成金额一致。Discount 是明细合计之后扣减的绝对金额，会降低整体实际 GP。当前报价不再计算或显示 GST/税；原历史记录不追溯更改。

明细 Cost 分摊含风险总成本，Weight 为成本占比。独立的 Quote share 默认随成本占比，可按当前明细总额调整报价分配；该操作不改变成本权重。详细规则见[报价明细逐行定价](manual-quote-target-pricing.md)。

例如单行成本 50，其中 Network 45、无 BU 的 Risk 5，Network 分成率 20%，行目标 GP 30%，没有折扣。Risk 归入 Network，总成本仍为 50：

```text
目标价格 = 50 / (1 − 30% − 20%) = 100
分成金额 = 100 × 20% = 20
Sales GP = (100 − 50 − 20) / 100 = 30%
```

BU 匹配忽略大小写及重复空格。不允许重复 BU 或超出 0–100% 的比例。未配置或未启用比例的 BU 明确显示按 0% 计算；全部成本都没有 BU 时保留 Unassigned 并提示，不擅自选择主数据中的 BU。按 GP 定价的每行目标 GP 与加权分成率之和必须小于 100%，否则不生成报价。

## CLI 与独立 Skill

以下 `cost-cli` 指 `npm run --silent cost-cli --`：

```sh
cost-cli masterdata get --tab profit-share
cost-cli masterdata update --tab profit-share --input changes.json --expected-revision GLOBAL_R
cost-cli quote get --project-id ID --section settings
cost-cli project apply-masterdata --project-id ID --tab profit-share --expected-revision PROJECT_R
```

主数据条目为 `{id, bu, ratePercent, active}`；更新使用标准 `OperationRequest`，`operation` 为 `masterdata.update`，`changes` 使用 `upsert/remove`。项目报价设置里的 `pricing.profitShareRates` 和 `profitShareMasterDataRevision` 是已采用的快照。

使用 `$ssr-profit-share-maintain` 独立维护比例，不读取项目。使用 `$ssr-quote-prepare` 在指定项目应用比例及编制定价。项目列表、报价页面、标准 Excel 和公司模板导出共用计算引擎；客户文件只显示报价和商务条款，内部成本、分成及 GP 不写入客户 Excel。
