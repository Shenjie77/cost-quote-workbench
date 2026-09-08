---
name: ssr-quote-prepare
description: 基于当前成本版本编制服务报价，选择客户模板及风险假设、维护并保存定价；单独导出用 ssr-quote-export，模板库更新用 ssr-quote-template。
---

# SSR · 商业报价编制

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

先读 `project get`（带项目号）、`cost get --section summary`、`quote get --section settings|assumptions`。当前标准报价与模板填充使用 activeVersion；用户指定其他版本时先核对，不能输出错版。成本要满足平台的定稿/评审前置；Confirmed 只表示用户确认成本，不表示 DRB approved。从已锁定版本创建的新 Draft 有独立 DTRB → DRB 轮次，不继承旧版审批，不能自行批准或解除原版锁定以便导出。

客户模板与假设仅按需读取 `masterdata get --tab quote-templates|assumptions`。客户名称规范化精确匹配，展示真实付款条款、有效期与法务 T&C。模板选中与默认假设拷贝是不同操作；仅设置 selectedQuoteTemplateId 不代表假设已自动应用。用户要求套用时按选定模板的 defaultAssumptionIds 读取库记录，再更新当前报价假设，保留用户手改内容与明确排除项。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"quote.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`quote update --project-id ID --section settings --input FILE --expected-revision R` 的 set 支持 `pricing/selectedQuoteTemplateId`。pricing 字段先查 `features/quote/domain.ts` PricingSettings。`--section assumptions` 用 upsert：`id/text/textZh/included/sourceAssumptionId?`。提供的 T&C 和 Scope/交付假设原文不能擅自扩展责任。计算交由平台；成本已经包含可选3%，不得二次增加。

编制完成后窄读定价、已选模板和当前报价假设，报告保存结果与仍缺的前置。用户同时要求生成文件时，再使用 [报价导出](../ssr-quote-export/SKILL.md) 完成；仅修改报价参数时不加载导出说明、不生成文件。
