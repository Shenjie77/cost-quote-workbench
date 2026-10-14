---
name: ssr-maintain-subcontracts
description: 维护全局分包目录的条目、单位和参考单价；不录入项目分包数量。
---

# SSR · 维护分包目录

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

只操作 Master Data 的 `subcontract` 页签：
```sh
cost-cli masterdata get --tab subcontract --id RECORD-ID
cost-cli masterdata update --tab subcontract --input change.json --expected-revision R
```
字段依据：subcontractItem（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：
```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```
全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

按稳定 `id` 合并用户提供的分包目录记录。新记录依 subcontractItem 定义完整填写。相似名称不能视为同一合同/编码；需要用户给出匹配依据才合并。

目录价格填写 `unit/unitPrice/currency`。Supplier 和 Pricing Basis 不再显示或必填，已有兼容字段无需补写。单价留空为未定价，0 为明确零成本；局部更新省略字段表示保留原值，显式 `null` 可清空 unit 或 unitPrice。

这里只维护目录参考，不直接插入项目成本。实际 PM 分包使用 `ssr-update-cost` 的版本内 `--section subcontract`，按条目数量或站型年度计划汇入 2.3.2。费用包含范围和币种按原始文件保留，供应安装打包金额不能再次拆成重复设备或安装费用。

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。
