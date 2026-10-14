# SSR 独立业务技能

2026-10-14：原仓库有 19 个单项技能和 1 个总入口。现改为 **22 个独立技能**，统一 `ssr-动作-对象` 命名；移除总路由入口，新增成本查询、流程查询、归档文件管理。

普通单项请求只加载命中的一个 SKILL.md；其正文给出命令和必要约束。仅任务涉及明确的进阶操作时才读取对应 references。多项请求按实际依赖加载，不预读全部技能。自动选择保持开启，无需先调用总入口。

## 新名称与职责

| 技能 | 独立作用 |
| --- | --- |
| [$ssr-query-cost](../skills/ssr-query-cost/SKILL.md) | 查询项目成本：总额、科目及按需明细 |
| [$ssr-query-workflow](../skills/ssr-query-workflow/SKILL.md) | 查询流程进度、阻塞和待办 |
| [$ssr-manage-files](../skills/ssr-manage-files/SKILL.md) | 归档文件查询、上传、下载和全局根目录设置 |
| [$ssr-manage-project](../skills/ssr-manage-project/SKILL.md) | 管理项目 |
| [$ssr-create-cost](../skills/ssr-create-cost/SKILL.md) | 新建成本 |
| [$ssr-update-cost](../skills/ssr-update-cost/SKILL.md) | 修改成本 |
| [$ssr-export-cost](../skills/ssr-export-cost/SKILL.md) | 导出成本 |
| [$ssr-maintain-retypes](../skills/ssr-maintain-retypes/SKILL.md) | 维护人员费率 |
| [$ssr-maintain-subcontracts](../skills/ssr-maintain-subcontracts/SKILL.md) | 维护分包目录 |
| [$ssr-maintain-supplemental](../skills/ssr-maintain-supplemental/SKILL.md) | 维护补充成本目录 |
| [$ssr-maintain-maintenance-prices](../skills/ssr-maintain-maintenance-prices/SKILL.md) | 维护维保价格库 |
| [$ssr-maintain-assumptions](../skills/ssr-maintain-assumptions/SKILL.md) | 维护假设库 |
| [$ssr-maintain-quote-templates](../skills/ssr-maintain-quote-templates/SKILL.md) | 维护报价模板 |
| [$ssr-maintain-profit-share](../skills/ssr-maintain-profit-share/SKILL.md) | 维护 BU 分成 |
| [$ssr-maintain-cpq-catalog](../skills/ssr-maintain-cpq-catalog/SKILL.md) | 维护 CPQ 目录 |
| [$ssr-configure-cpq](../skills/ssr-configure-cpq/SKILL.md) | 配置项目 CPQ |
| [$ssr-price-maintenance](../skills/ssr-price-maintenance/SKILL.md) | 编制维保报价 |
| [$ssr-price-quote](../skills/ssr-price-quote/SKILL.md) | 编制服务报价 |
| [$ssr-export-quote](../skills/ssr-export-quote/SKILL.md) | 导出客户报价 |
| [$ssr-update-workflow](../skills/ssr-update-workflow/SKILL.md) | 更新流程节点 |
| [$ssr-configure-workflow](../skills/ssr-configure-workflow/SKILL.md) | 配置流程模板 |
| [$ssr-search-history](../skills/ssr-search-history/SKILL.md) | 查历史参考 |

## 常用请求

- `查询 xx 项目成本` → `$ssr-query-cost`：项目 ID 已知直接查 summary；仅有名称时先匹配项目，再查 summary。普通查询不运行 validate/calculate/export。
- `修改 xx 项目 V2 的人天` → `$ssr-update-cost`：检查指定版本锁与 revision，再局部修改。
- `把 xx 项目成本导出 Excel` → `$ssr-export-cost`：使用明确版本导出，失败时才定位具体输入问题。
- `xx 项目现在到哪一步了` → `$ssr-query-workflow`：读取 workflow-plan。
- `把 xx 节点登记为完成` → `$ssr-update-workflow`：使用真实节点 code、必填字段和已有用户授权。
- `上传这份评审附件` → `$ssr-manage-files`：核对节点和轮次后归档，不自动完成节点。

技能中的 `cost-cli` 是 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs` 的简写；在仓库根目录运行。保留原 CLI API、revision、版本锁和确认规则，重命名不改变业务数据。

## 旧名称迁移

旧发现入口已移除，不保留重复别名。更新保存的提示词和外部安装副本：

| 原名称 | 新名称 |
| --- | --- |
| `ssr-project-manage` | `ssr-manage-project` |
| `ssr-cost-create` | `ssr-create-cost` |
| `ssr-cost-update` | `ssr-update-cost` |
| `ssr-cost-export` | `ssr-export-cost` |
| `ssr-retype-maintain` | `ssr-maintain-retypes` |
| `ssr-subcontract-maintain` | `ssr-maintain-subcontracts` |
| `ssr-supplemental-maintain` | `ssr-maintain-supplemental` |
| `ssr-maintenance-data` | `ssr-maintain-maintenance-prices` |
| `ssr-assumptions-maintain` | `ssr-maintain-assumptions` |
| `ssr-quote-template` | `ssr-maintain-quote-templates` |
| `ssr-profit-share-maintain` | `ssr-maintain-profit-share` |
| `ssr-cpq-catalog` | `ssr-maintain-cpq-catalog` |
| `ssr-cpq-configure` | `ssr-configure-cpq` |
| `ssr-maintenance-quote` | `ssr-price-maintenance` |
| `ssr-quote-prepare` | `ssr-price-quote` |
| `ssr-quote-export` | `ssr-export-quote` |
| `ssr-workflow-update` | `ssr-update-workflow` |
| `ssr-workflow-configure` | `ssr-configure-workflow` |
| `ssr-history-reference` | `ssr-search-history` |
| `cost-workbench` | 已移除；直接按任务选择单项技能 |

## 发现与验证

源文件在 `skills/ssr-*/SKILL.md`，`.agents/skills/` 使用同名相对链接，中文名称及默认提示词在 `agents/openai.yaml`。通用参考资料移到 `skills/references/`，该目录没有 SKILL.md，不是第 23 个入口，也不是必读前置。

修改后运行 `node scripts/check-business-skills.mjs`，检查发现链接、名称、默认提示词及相对文档引用。新技能名若未出现在当前任务列表，可在新开项目任务中选择，或直接指定新 SKILL.md 路径；当前对话已注入的旧目录不能靠改文件撤回。

性能验收需记录真实任务的技能读取次数、CLI 调用次数与总时间；本次减少路由与无关说明读取，不承诺模型端加载固定秒数。以“已知项目 ID 查成本”验证：正常路径只加载 ssr-query-cost，并调用一次 cost get summary；名称不明确时增加一次 project list，重名需要澄清。

CLI 与页面覆盖边界见 [平台覆盖表](cli-platform-coverage.md)，完整命令见 [CLI 清单](cli-command-reference.md)。
