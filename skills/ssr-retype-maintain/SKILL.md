---
name: ssr-retype-maintain
description: 维护指定项目 Master Data 的人员 RE Type、LOCAL/ARP/HQ 人天费率、等级和换算参数；不更新成本版本。
---

# SSR · RE Type 维护

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `npm run --silent cost-cli -- ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。主数据也是项目级，不能默认更新全部项目。

集合读取按需用 `--id`、`--query`、`--limit`、`--offset`，跟随 `nextOffset`，分页期间 revision 变化须重读。只返回需要的字段和条目，不用 `workspace get/save` 做常规操作。字段不明时查本文指定的本地 schema 定义；接口不符时再查 `system capabilities`。

写入使用最新返回的 `--expected-revision R`，冲突后重读目标资源再重施原意。局部修改仅发送变更字段；新增记录必须字段完整；不把缺失记录视为删除。核对返回 revision 和变更条目，不把预览或校验当成已保存。

只操作 Master Data 的 `resources` 页签：
```sh
cost-cli masterdata get --project-id ID --tab resources --id RECORD-ID
cost-cli masterdata update --project-id ID --tab resources --input change.json --expected-revision R
```
字段依据：resourceType（schemas/cost-export.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

按已有 `id` 更新，可先用 `--query LOCAL-L1` 找到准确 ID。字段包括 `code/name/category/pool/level/mandayRate/mandaysPerMonth/hoursPerManday/hqTravel/effectiveFrom/effectiveTo/active`。人天费率字段是 `mandayRate`，不要把它误写成货币换汇参数。

示例 changes：`{"upsert":[{"id":"ACTUAL-RE-ID","mandayRate":650}]}`，650 仅为示例，使用用户给定费率。保留其他等级、有效期和换算参数。新增 RE 使用完整 schema 字段。

任何成本版本经用户确认定稿并锁定后，仍可维护该目录。该操作不会更改任何成本版本捕获的费率和金额。用户另外要求把新费率应用到某个未锁定版本时，转成本更新 skill 并明确版本；不要自动执行 `cost apply-rates`，也不通过增加费率实现 Local/ARP 3% allowance。
