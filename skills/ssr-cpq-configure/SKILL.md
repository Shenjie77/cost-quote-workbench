---
name: ssr-cpq-configure
description: 根据简短 TD Scope 推荐已有 CPQ 条目，经用户选定后计算服务数量匹配目标成本并归档；设备数量保持实际值。
---

# SSR · CPQ 配置匹配

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

先读 `cpq get --project-id ID`，按需 `cost get --project-id ID --version Vn --section summary`。保留原始短 Scope，不要求 TD 编造详细分解。用 `cpq match --project-id ID --scope "简短描述"` 与按 query 的 catalog 读取，依真实目录解释候选，词面分数不等于匹配置信度。

先列候选编码、Scope、匹配理由和待确认条件。用户已有选择授权时继续；否则等待用户选择再保存/确认，不替用户作 confirmer。缺真实设备数量不能倒推金额凑数。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"cpq.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`cpq update --section draft` 使用 set：`brief/costVersion/targetCost/targetBasis/tolerance/rounding/allocationBasis`。`--section selections` 使用 upsert：`code/quantity/locked/weight/reason`。每次带项目号、input 和最新 expected-revision。目标成本以明确版本总成本或用户指定口径记录；允许只提供短描述。

用户确认后依次：
```sh
cost-cli cpq confirm --project-id ID --confirmed-by USER --expected-revision R --compact
cost-cli cpq solve --project-id ID --expected-revision NEXT-R --compact
cost-cli cpq archive --project-id ID --expected-revision NEXT-R --compact
cost-cli cpq export --project-id ID --archive-id ARCHIVE-ID --output outputs/CPQ-new.xlsx
```
只调已确认的可调服务。固定设备/固定服务数量必须真实。分配优先使用已知参考数量或目录默认值；缺预算比例时记录所用假设。选定条目、目录条款或固定数量变化需重新确认；仅目标金额变化可保留有效选项确认。

报告数量、总额、差额和 tolerance。`searchComplete=false` 不能证明无解。只有当前可接受结果才归档；未解决差额保留草稿。归档与成本版本一起保存，不能修改旧归档。这里只记录自建平台，不声称已提交公司 CPQ。
