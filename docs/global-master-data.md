# 全局 Master Data 与项目数据快照

Master Data 是未来项目的数据来源，维护时不需要选择或读取项目。项目采用的数据另存为快照；修改全局库不会改变任何已有项目，包括仍为 Draft 的成本版本。

| 操作 | 数据结果 |
| --- | --- |
| 维护全局 RE 费率、CPQ、维保、模板等 | 只更新目标全局页签及其 revision |
| 新建项目 | 捕获当时全局主数据，建立独立项目及空白 V1 |
| 新建空白成本版本 | 捕获当时全局资源费率，成本输入为空 |
| 复制成本版本 | 保留源版本的费率、成本输入及设置，新版为 Draft |
| 查看或导出旧成本版本 | 使用该版本原始费率和成本设置 |
| 明确应用最新全局数据 | 只更改指定项目或未锁定成本版本，历史归档保留 |

例如，2025 年项目保存了当时采用的人天费率，2026 年维护全局费率不会使该项目在回看、重算或导出时改用 2026 年费率。新一轮估算可以新建版本，再明确决定保留原费率或采用最新费率。成本锁仍只保护对应版本，主数据无需等待项目解锁。

当前 `mandayRate` 是 **SGD/人天费率**，另有工时/月人天换算参数和有效期。平台没有独立的货币汇率表或自动换汇引擎；不会把汇率数据写入人天费率字段，也不会按当前年份自动替换历史值。

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
    "changes": {"upsert": [{"id": "ACTUAL-RE-ID", "mandayRate": 650}]}
  }
}
```

流程和状态页签维护未来项目的默认模板。实际项目进度仍使用 `project update --section workflow`、项目当前节点/状态和 SSR 评审命令；模板维护不登记已完成状态或公司审批证据。

## 项目如何使用已采用的数据

| 已捕获的数据 | 窄读命令（加实际项目号） |
| --- | --- |
| 成本版本 RE/费率 | `cost get --version Vn --section resources` |
| 分包、补充成本参考 | `project get --section subcontract|supplemental` |
| 当前项目流程、状态和评审检查点 | `project get --section workflow|status|reviews` |
| 客户模板、可复用假设 | `quote get --section templates|library` |
| 维保参考 | `boq get --section references` |
| CPQ 目录 | `cpq get --section catalog` |

全局 CPQ 目录只用 `masterdata update --tab cpq-catalog` 维护；旧的项目 `cpq update --section catalog` 已拒绝写入。项目配置匹配、条目确认、数量求解和归档仍由项目 CPQ 命令处理。

用户明确要求采用最新全局数据时，使用：

```sh
cost-cli cost apply-rates --project-id ID --version Vn --expected-revision PROJECT-R
cost-cli project apply-masterdata --project-id ID --tab maintenance --expected-revision PROJECT-R
```

第一条只捕获指定未锁定成本版本的最新全局资源费率。第二条支持 `subcontract`、`supplemental`、`maintenance`、`assumptions`、`quote-templates`、`cpq-catalog`；它要求当前 activeVersion 为未锁定 Draft，是独立项目写操作，使用项目 revision。应用模板前保持项目假设引用有效，必要时先应用假设库，再使用新的项目 revision 应用模板。全局 workflow/status 默认模板不覆盖已有项目实际进度。

应用后的当前商业依据、维保选择或 CPQ 条目需要重新核对，适用评审可能需要重新提交。历史成本、报价、维保和 CPQ 归档保留原始快照。单纯“更新 Master Data”不表示授权执行这些项目应用命令。

## 旧数据迁移与业务 skills

升级时从旧项目目录建立全局数据来源，同时保留项目原始快照。同一编码/ID 存在不同价格或内容时，保留差异与来源，不能默认为最后一个项目正确。用户提供明确的完整记录后，通过该页签的 upsert 解决冲突；日常维护不重复扫描旧项目。

8 个全局维护 skills 无需项目：RE Type、分包、补充成本、维保参考、风险假设、报价模板、CPQ 目录、流程配置。其他业务技能读取目标项目/版本已采用的数据；完整调用示例见[业务 Skill 清单](business-skills.md)，字段及分页规则见[CLI 细分资源契约](../skills/cost-workbench/references/resources.md)。
