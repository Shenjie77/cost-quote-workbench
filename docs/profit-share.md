# BU Profit Share 与 Sales GP

## 操作

1. 在 **Master Data → Profit Share** 添加 BU、分成百分比和 Active 状态，保存该页签。20% 输入为 `20`。
2. 新项目自动捕获当前比例。已有项目在 **Pricing Parameters → Apply Latest Master Data** 明确采用最新比例，立即保存到该项目；成本已 Confirmed 也可以操作。
3. 填写 **Target Sales GP (%)**，系统反算 Target List Price，并展示各 BU 的成本、占比、比例及分成金额。**Manage Rates** 可跳转到主数据维护。

全局维护不重算已有项目。报价历史保留当次 BU 分摊、分成比例和金额，之后采用新主数据也不会更改原记录。

## 计算口径

按最终 Cost Statement 的含风险总成本计算，包括人力成本中已计入的 Allowance、启用的 HQ Travel 和结构化分包。已有 BU 的成本保持归属；EHS、Risk、物流等没有 BU 的成本全部归入直接成本最大的 BU，再计算各 BU 权重。直接成本并列时按规范化 BU 名稳定选择。

```text
BU 权重 = 该 BU 最终归属成本 / 项目总成本
加权分成率 = Σ(BU 权重 × BU 分成率)
分成金额 = 折后未税价格 × 加权分成率
Sales GP = (折后未税价格 − 总成本 − 分成金额) / 折后未税价格
基础目标价格 = 总成本 / (1 − Target Sales GP − 加权分成率)
```

目标价格向上取到分，并在必要时补足分成金额进位差额，保证未折扣时的 Sales GP 达到目标。各 BU 的显示分摊会分配分位差额，合计与总价、总分成金额一致。原有 Discount 是目标价格之后扣减的绝对金额，会降低实际 GP；GST 单独计算，不参与分成及 GP。

例如成本 50，其中 Network 45、无 BU 的 Risk 5，Network 分成率 20%，目标 GP 30%。Risk 归入 Network，总成本仍为 50：

```text
目标价格 = 50 / (1 − 30% − 20%) = 100
分成金额 = 100 × 20% = 20
Sales GP = (100 − 50 − 20) / 100 = 30%
```

BU 匹配忽略大小写及重复空格。不允许重复 BU 或超出 0–100% 的比例。未配置或未启用比例的 BU 明确显示按 0% 计算；全部成本都没有 BU 时保留 Unassigned 并提示，不擅自选择主数据中的 BU。目标 GP 与加权分成率之和必须小于 100%，否则不生成报价。

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
