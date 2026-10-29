# SSR · 维护假设库

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。Master Data 是独立全局库，为未来项目提供数据；无需项目号，不执行 `project list/get` 或读取 workspace 作为维护前置。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用本页签最新 `--expected-revision R`，不使用项目 revision；冲突后重读。局部 upsert 保留未传字段，新增须完整。核对回执 scope/tab/revision、changedIds/removedIds 和 unresolvedKeys。

只操作 Master Data 的 `assumptions` 页签：

```sh
cost-cli masterdata get --tab assumptions --id RECORD-ID
cost-cli masterdata update --tab assumptions --input change.json --expected-revision R
```

字段依据：assumptionDefinition（schemas/workspace-state.schema.json）。
写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"masterdata.update","changes":CHANGES}}
```

全局页签是集合，只用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；不支持 set。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。

字段为 `id/name/category/clientPattern/text/textZh/active`。保留法务及业务原文，不擅自删改责任界面或翻译法律含义。客户匹配是规范化精确匹配，不是正则表达式。

这是可复用库，不是当前报价的 included 假设列表。维护库不代表用户已将新文案纳入报价；当前报价假设另用 quote update --section assumptions。删除库条目前保持报价模板 defaultAssumptionIds 有效，不修改历史报价快照。

全局更新不改变已有项目或历史快照。来源冲突须按用户提供的完整正确条目解决，不能仅传局部字段或猜值覆盖。

页面 Bulk Entry 打开当前目录记录及 ID，Validate → Apply changes 更新同一记录，新记录新增、未列出的记录保留；不恢复已应用旧批次。可选文本/列表可直接清空。独立 Import XLSX 的空白字段仍保留原值；CLI 继续按稳定 ID upsert，省略字段表示保留，不能混用这三种输入语义。
