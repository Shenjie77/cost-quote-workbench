# 全局 Master Data 与项目数据快照

RE、分包、CPQ、维保、报价模板等 Master Data 是未来项目的数据来源，维护时不选择或读取项目，既有成本和商业参考快照保持不变。流程模板有独立的预览发布路径，会检查并同步未完成项目的流程定义，不能和费率维护混为一谈。

| 操作                                | 数据结果                                       |
| ----------------------------------- | ---------------------------------------------- |
| 维护全局 RE 费率、CPQ、维保、模板等 | 只更新目标全局页签及其 revision                |
| 新建项目                            | 捕获当时全局主数据，建立独立项目及空白 V1      |
| 新建空白成本版本                    | 捕获当时全局资源费率，成本输入为空             |
| 复制成本版本                        | 保留源版本的费率、成本输入及设置，新版为 Draft |
| 查看或导出旧成本版本                | 使用该版本原始费率和成本设置                   |
| 明确应用最新全局数据                | 只更改指定项目或未锁定成本版本，历史归档保留   |

例如，2025 年项目保存了当时采用的人天费率，2026 年维护全局费率不会使该项目在回看、重算或导出时改用 2026 年费率。新一轮估算可以新建版本，再明确决定保留原费率或采用最新费率。成本锁仍只保护对应版本，主数据无需等待项目解锁。

当前 `mandayRate` 是 **SGD/人天费率**，另有工时/月人天换算参数和有效期。平台没有独立的货币汇率表或自动换汇引擎；不会把汇率数据写入人天费率字段，也不会按当前年份自动替换历史值。

Subcontract 目录通过 **Unit / Unit Price / Currency** 维护分包参考单价，Supplier、Pricing Basis 不再显示或必填。价格留空为未定价，0 为明确零成本；局部更新传 `null` 可清空价格，省略则保留原值。从 Cost Workspace 的 Subcon 页签选择条目并填写数量后，按成本版本独立计算并汇入 2.3.2；使用方式见[分包成本设计](subcontract-cost-design.md)。

## 全局维护入口

在仓库根目录运行；`cost-cli` 是 `npm run --silent cost-cli --` 的简称：

```sh
cost-cli masterdata get --tab resources --query LOCAL-L1
cost-cli masterdata update --tab resources --input rates.json --expected-revision R
```

没有 `--project-id`。每个页签有自己的 revision，resources 的 revision 不能用于 maintenance，更不能使用项目 revision。`--id`、`--query` 和分页用于窄读；默认 limit 为 100，上限 10000，跟随 nextOffset。冲突时只重读本页签，不获取全部 workspace。

读取返回 `GlobalMasterDataResult`；更新返回 `GlobalMasterDataMutationResult`，包含 scope/tab/revision/updatedAt/changedIds/removedIds/unresolvedKeys。普通已有条目可只提交变更字段；新条目和迁移冲突的解决必须提交完整记录。

支持页签：`resources`、`subcontract`、`supplemental`、`maintenance`、`assumptions`、`quote-templates`、`workflow`、`status`、`cpq-catalog`。

示例文件中的费率仅示意，实际使用用户提供的数据：

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "unique-masterdata-change",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "masterdata.update",
    "changes": { "upsert": [{ "id": "ACTUAL-RE-ID", "mandayRate": 650 }] }
  }
}
```

workflow 配置节点顺序、并行组、默认负责人、关键信息、SLA 和提醒。使用 `workflow preview/publish` 预览变化和受影响项目，再用全局 revision 与预览项目 revision 原子发布；不要求用户先选一个项目。Today 与 Project 使用同步后的同一流程数据。活跃节点默认保留 startedAt/dueAt，明确列入 migrateActiveProjectIds 才重算；完成/跳过节点历史及完成轮次保留，成本/费率不变化。旧 `masterdata update --tab workflow` 也经过同一安全路径。新建或复制成本 Draft 无论旧轮次是否完成，都采用最新全局流程模板，从 roundStart 开始，原成本及轮次快照不变；起点及同并行组不能要求成本 Confirmed。status 字典仅兼容保留。详见[配置流程与发布契约](project-workflow.md)。

## 项目如何使用已采用的数据

| 已捕获的数据         | 窄读命令（加实际项目号）                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------- |
| 成本版本 RE/费率     | `cost get --version Vn --section resources`                                              |
| 分包、补充成本参考   | `project get --section subcontract                                                       | supplemental` |
| 当前项目流程与历史   | `project get --section workflow-plan`；历史用 `workflow-history`，旧评审用只读 `reviews` |
| 客户模板、可复用假设 | `quote get --section templates                                                           | library`      |
| 维保参考             | `boq get --section references`                                                           |
| CPQ 目录             | `cpq get --section catalog`                                                              |

全局 CPQ 目录只用 `masterdata update --tab cpq-catalog` 维护；旧的项目 `cpq update --section catalog` 已拒绝写入。项目配置匹配、条目确认、数量求解和归档仍由项目 CPQ 命令处理。

用户明确要求采用最新全局数据时，使用：

```sh
cost-cli cost apply-rates --project-id ID --version Vn --expected-revision PROJECT-R
cost-cli project apply-masterdata --project-id ID --tab maintenance --expected-revision PROJECT-R
```

第一条只捕获指定未锁定成本版本的最新全局资源费率。第二条支持 `subcontract`、`supplemental`、`maintenance`、`assumptions`、`quote-templates`、`cpq-catalog`；它要求当前 activeVersion 为未锁定 Draft，是独立项目写操作，使用项目 revision。应用模板前保持项目假设引用有效，必要时先应用假设库，再使用新的项目 revision 应用模板。workflow 定义同步走独立预览发布流程，不使用 project apply-masterdata；状态和执行证据不会被全局模板伪造。

应用后的当前商业依据、维保选择或 CPQ 条目需要重新核对，适用评审可能需要重新提交。历史成本、报价、维保和 CPQ 归档保留原始快照。单纯“更新 Master Data”不表示授权执行这些项目应用命令。

## 旧数据迁移与业务 skills

升级时从旧项目目录建立全局数据来源，同时保留项目原始快照。同一编码/ID 存在不同价格或内容时，保留差异与来源，不能默认为最后一个项目正确。用户提供明确的完整记录后，通过该页签的 upsert 解决冲突；日常维护不重复扫描旧项目。

RE Type、分包、补充成本、维保参考、风险假设、报价模板和 CPQ 目录这 7 个全局维护 skills 不读取项目。流程配置 skill 同样不要求预先选项目，但发布必须预览受影响项目并校验项目 revision。其他业务技能读取目标项目/版本已采用的数据；完整调用示例见[业务 Skill 清单](business-skills.md)，字段及分页规则见[CLI 细分资源契约](../skills/cost-workbench/references/resources.md)。
