---
name: ssr-quote-prepare
description: 基于当前成本版本编制服务报价，选择客户模板及风险假设、维护并保存定价；单独导出用 ssr-quote-export，模板库更新用 ssr-quote-template。
---

# SSR · 商业报价编制

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

先读 `project get`（带项目号）、`cost get --section summary`、`quote get --section settings|assumptions`。当前标准报价与模板填充使用 activeVersion；用户指定其他版本时先核对。成本需由用户确认成为 Confirmed 后才能正式导出；Confirmed 不表示 DRB 已批准。统一项目流程按公司实际进展登记，不再维护本地 SSR 审批依赖链。新建或复制 Draft 无论旧轮次是否完成，都采用最新全局流程模板，从其 roundStart（默认 DTRB）开启新轮次，旧证据只读保留；不能自行批准或解除原版锁定。

客户模板与可复用假设读取项目捕获快照：`quote get --project-id ID --section templates|library`，按需用 `--id/--query`。不要用当前全局库替代旧项目采用的条款。客户名称规范化精确匹配，展示真实付款条款、有效期与法务 T&C。模板选中与默认假设拷贝是不同操作；仅设置 selectedQuoteTemplateId 不代表假设已自动应用。用户要求套用时按选定模板的 defaultAssumptionIds 读取库记录，再更新当前报价假设，保留用户手改内容与明确排除项。

`project apply-masterdata` 的成本相关目录仅允许当前 activeVersion 为未锁定 Draft；指定成本版本费率用 `cost apply-rates --version`。`--tab profit-share` 更新报价的分成快照，可用于成本已定稿的项目，不修改锁定成本。其他需要改动已定稿成本的需求，按用户的新一轮估算意图建立新 Draft。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"quote.update","changes":CHANGES}}
```

集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`quote update --project-id ID --section settings --input FILE --expected-revision R` 的 set 支持 `pricing/selectedQuoteTemplateId`。pricing 字段先查 `features/quote/domain.ts` PricingSettings。`--section assumptions` 用 upsert：`id/text/textZh/included/sourceAssumptionId?`。提供的 T&C 和 Scope/交付假设原文不能擅自扩展责任。计算交由平台；成本已经包含可选3%，不得二次增加。

全局模板/假设维护由对应 skill 处理，维护本身不会应用到本项目。用户明确要求采用最新全局条款时，先核对 `masterdata get --tab assumptions|quote-templates`，再分别 `project apply-masterdata --project-id ID --tab assumptions|quote-templates --expected-revision R`；这是项目写操作，使用项目 revision。按需先应用假设库以保持模板引用有效，每步读回新 revision。项目当前商业依据会改变，须重新核对适用的评审；历史报价归档不变。

编制完成后窄读定价、已选模板和当前报价假设，报告保存结果与仍缺的前置。用户同时要求生成文件时，再使用 [报价导出](../ssr-quote-export/SKILL.md) 完成；仅修改报价参数时不加载导出说明、不生成文件。

Profit Share Rate 按项目捕获的 `pricing.profitShareRates` 计算，比例为百分数（20 表示 20%）。平台按最终成本中各 BU 占比分摊未税报价；EHS、Risk 等无 BU 成本归入直接成本最大的 BU。Sales GP = (未税报价 − 成本 − 分成金额) / 未税报价；目标折扣前价格 = 总成本 / (1 − 目标 GP − 加权分成率)，之后的折扣仍会降低实际 GP。目标 GP 与加权分成率之和必须小于 100%；无匹配比例的 BU 会明确显示按 0% 计算，不能猜测实际比例。

全局比例维护单独使用 [BU 分成维护](../ssr-profit-share-maintain/SKILL.md)，无需项目。只有用户要求应用最新比例时，读取目标报价设置与项目 revision 后执行 `project apply-masterdata --project-id ID --tab profit-share --expected-revision R`，再读回报价设置。新项目自动捕获，旧项目不自动采用，历史报价保存各 BU 分成快照。
