---
name: cost-workbench
description: SSR 工作台跨业务任务入口与业务 skill 路由；用于整套报价流程或未明确模块的请求，单项操作优先调用对应 ssr-* skill。
---

# SSR 工作台业务入口

这是跨业务协调入口。根据用户当前目标，只读取需要的业务 skill；不要一次加载全部说明。已经指定项目和模块时不先读取整个 workspace 或全部项目。各业务 skill 可直接用 $名称 调用，无需先调用本入口。

| 工作模块 | 独立 skill |
| --- | --- |
| 项目管理 · 项目管理 | [ssr-project-manage](../ssr-project-manage/SKILL.md) |
| 成本编制 · 成本新建 | [ssr-cost-create](../ssr-cost-create/SKILL.md) |
| 成本编制 · 成本更新 | [ssr-cost-update](../ssr-cost-update/SKILL.md) |
| 成本编制 · 成本核验与导出 | [ssr-cost-export](../ssr-cost-export/SKILL.md) |
| 主数据维护 · RE Type 维护 | [ssr-retype-maintain](../ssr-retype-maintain/SKILL.md) |
| 主数据维护 · 分包主数据维护 | [ssr-subcontract-maintain](../ssr-subcontract-maintain/SKILL.md) |
| 主数据维护 · 补充成本主数据维护 | [ssr-supplemental-maintain](../ssr-supplemental-maintain/SKILL.md) |
| 主数据维护 · 维保数据维护 | [ssr-maintenance-data](../ssr-maintenance-data/SKILL.md) |
| 主数据维护 · 风险假设库维护 | [ssr-assumptions-maintain](../ssr-assumptions-maintain/SKILL.md) |
| 主数据维护 · 报价模板更新 | [ssr-quote-template](../ssr-quote-template/SKILL.md) |
| CPQ · CPQ 数据维护 | [ssr-cpq-catalog](../ssr-cpq-catalog/SKILL.md) |
| CPQ · CPQ 配置匹配 | [ssr-cpq-configure](../ssr-cpq-configure/SKILL.md) |
| 维保 · 维保配置与报价 | [ssr-maintenance-quote](../ssr-maintenance-quote/SKILL.md) |
| 商业报价 · 商业报价编制 | [ssr-quote-prepare](../ssr-quote-prepare/SKILL.md) |
| 商业报价 · 报价导出 | [ssr-quote-export](../ssr-quote-export/SKILL.md) |
| 流程评审 · 流程与评审更新 | [ssr-workflow-update](../ssr-workflow-update/SKILL.md) |
| 流程评审 · 流程配置维护 | [ssr-workflow-configure](../ssr-workflow-configure/SKILL.md) |
| 历史参考 · 历史成本参考 | [ssr-history-reference](../ssr-history-reference/SKILL.md) |

跨模块任务按真实依赖推进：项目建档 → 成本编制 → CPQ 配置/维保 → 公司评审证据 → 商业报价。单项主数据更新只操作该目录。公司平台仍是正式审批系统，本地登记不能替代审批或代表已联系 PM。

所有日常操作通过目标项目/版本/页签的细分 CLI，写入使用最新 revision。已完成 DRB/成本定稿保护项目成本，主数据 RE 费率目录仍可维护；不通过换版本、清锁或改证据绕过。归档保持不可变。

使用者说明见 [业务 skill 清单](../../docs/business-skills.md)。仅排查旧版接口、手工备份或模板兼容时，按需查 [旧操作参考](references/operations.md) 或 [细分资源契约](references/resources.md)，不是每次调用的前置。
