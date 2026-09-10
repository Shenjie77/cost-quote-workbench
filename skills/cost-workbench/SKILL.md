---
name: cost-workbench
description: SSR 工作台跨业务任务入口与业务 skill 路由；用于整套报价流程或未明确模块的请求，单项操作优先调用对应 ssr-* skill。
---

# SSR 工作台业务入口

这是跨业务协调入口。根据用户当前目标，只读取需要的业务 skill；不要一次加载全部说明。全局主数据维护无需项目，不读取项目列表或 workspace；项目业务已经指定项目和模块时也不读取整个 workspace 或全部项目。各业务 skill 可直接用 $名称 调用，无需先调用本入口。

| 工作模块                        | 独立 skill                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| 项目管理 · 项目管理             | [ssr-project-manage](../ssr-project-manage/SKILL.md)               |
| 成本编制 · 成本新建             | [ssr-cost-create](../ssr-cost-create/SKILL.md)                     |
| 成本编制 · 成本更新             | [ssr-cost-update](../ssr-cost-update/SKILL.md)                     |
| 成本编制 · 成本核验与导出       | [ssr-cost-export](../ssr-cost-export/SKILL.md)                     |
| 主数据维护 · RE Type 维护       | [ssr-retype-maintain](../ssr-retype-maintain/SKILL.md)             |
| 主数据维护 · 分包主数据维护     | [ssr-subcontract-maintain](../ssr-subcontract-maintain/SKILL.md)   |
| 主数据维护 · 补充成本主数据维护 | [ssr-supplemental-maintain](../ssr-supplemental-maintain/SKILL.md) |
| 主数据维护 · 维保数据维护       | [ssr-maintenance-data](../ssr-maintenance-data/SKILL.md)           |
| 主数据维护 · 风险假设库维护     | [ssr-assumptions-maintain](../ssr-assumptions-maintain/SKILL.md)   |
| 主数据维护 · 报价模板更新       | [ssr-quote-template](../ssr-quote-template/SKILL.md)               |
| 主数据维护 · BU 分成比例维护    | [ssr-profit-share-maintain](../ssr-profit-share-maintain/SKILL.md) |
| CPQ · CPQ 数据维护              | [ssr-cpq-catalog](../ssr-cpq-catalog/SKILL.md)                     |
| CPQ · CPQ 配置匹配              | [ssr-cpq-configure](../ssr-cpq-configure/SKILL.md)                 |
| 维保 · 维保配置与报价           | [ssr-maintenance-quote](../ssr-maintenance-quote/SKILL.md)         |
| 商业报价 · 商业报价编制         | [ssr-quote-prepare](../ssr-quote-prepare/SKILL.md)                 |
| 商业报价 · 报价导出             | [ssr-quote-export](../ssr-quote-export/SKILL.md)                   |
| 项目流程 · 项目流程更新         | [ssr-workflow-update](../ssr-workflow-update/SKILL.md)             |
| 主数据维护 · 流程模板维护       | [ssr-workflow-configure](../ssr-workflow-configure/SKILL.md)       |
| 历史参考 · 历史成本参考         | [ssr-history-reference](../ssr-history-reference/SKILL.md)         |

跨模块任务按实际依赖推进：项目建档 → 成本编制 → CPQ/维保 → 公司评审 → 商业报价。进展只登记在 Project Workflow；可配置并行节点、关键确认、必填信息、SLA 和暂停恢复，配置的结束节点完成后停止本轮提醒。单项 RE、分包、CPQ、维保等全局维护只读取目标页签，不选择项目；新项目/空白成本捕获最新数据，克隆成本保留源快照。后续全局费率维护不重算已有成本或报价。只有 workflow 配置发布需要预览受影响项目并原子同步，Today 与 Project 使用同一结果。

全局数据使用页签 revision，项目动作使用项目 revision；不能混用。流程更新先 `project get --section workflow-plan`，再 `project workflow-action`，采用实际返回 nodeCode；名称和旧固定编码不决定行为。关键完成需真实用户确认和配置必填信息，requiresConfirmedCost 节点还须本轮成本 Confirmed。成本定稿不等于公司批准，关闭提醒不解除门禁。详情按需读取 [流程更新](../ssr-workflow-update/SKILL.md) 或 [流程配置发布](../ssr-workflow-configure/SKILL.md)。

仅用户明确要求采用新费率时，使用目标未锁定版本的 `cost apply-rates`；其他支持页签使用 `project apply-masterdata`。锁版输入不可改，但汇总/导出可查看，并可复制或新建 Draft，无论旧轮次是否完成，都采用最新全局流程模板，从其 roundStart（默认 DTRB）开始新轮次，原成本和轮次快照不变。旧 SSR/Reviews 与历史成本保留，workflowVersion/versionWorkflows 由平台管理。公司平台仍是正式审批来源；本地记录不能代表已申请、获批或已联系 PM。
