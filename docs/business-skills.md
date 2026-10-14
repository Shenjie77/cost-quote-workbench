# SSR 独立业务技能

2026-10-14：原仓库有 19 个单项技能和 1 个总入口。现改为 **22 个独立技能**，统一 `ssr-模块-动作` 命名；移除总路由入口，新增成本查询、流程查询、归档文件管理。

普通单项请求只加载命中的一个 SKILL.md；每个 SKILL.md 连同名称、描述、空格和标点最多 300 个字符。简单查询直接执行；业务写入和导出先读取该技能自己的 references/guide.md，再按需要读取细则。多项请求按实际依赖加载，不预读全部技能。自动选择保持开启，无需先调用总入口。

## 新名称与职责

| 技能 | 独立作用 |
| --- | --- |
| [$ssr-cost-create](../skills/ssr-cost-create/SKILL.md) | 新建成本 |
| [$ssr-cost-export](../skills/ssr-cost-export/SKILL.md) | 导出成本 |
| [$ssr-cost-query](../skills/ssr-cost-query/SKILL.md) | 查询项目成本：总额、科目及按需明细 |
| [$ssr-cost-update](../skills/ssr-cost-update/SKILL.md) | 修改成本 |
| [$ssr-cpq-configure](../skills/ssr-cpq-configure/SKILL.md) | 配置项目 CPQ |
| [$ssr-files-manage](../skills/ssr-files-manage/SKILL.md) | 归档文件查询、上传、下载和全局根目录设置 |
| [$ssr-history-search](../skills/ssr-history-search/SKILL.md) | 查历史参考 |
| [$ssr-maintenance-price](../skills/ssr-maintenance-price/SKILL.md) | 编制维保报价 |
| [$ssr-masterdata-assumptions-maintain](../skills/ssr-masterdata-assumptions-maintain/SKILL.md) | 维护假设库 |
| [$ssr-masterdata-cpq-catalog-maintain](../skills/ssr-masterdata-cpq-catalog-maintain/SKILL.md) | 维护 CPQ 目录 |
| [$ssr-masterdata-maintenance-prices-maintain](../skills/ssr-masterdata-maintenance-prices-maintain/SKILL.md) | 维护维保价格库 |
| [$ssr-masterdata-profit-share-maintain](../skills/ssr-masterdata-profit-share-maintain/SKILL.md) | 维护 BU 分成 |
| [$ssr-masterdata-quote-templates-maintain](../skills/ssr-masterdata-quote-templates-maintain/SKILL.md) | 维护报价模板 |
| [$ssr-masterdata-retypes-maintain](../skills/ssr-masterdata-retypes-maintain/SKILL.md) | 维护人员费率 |
| [$ssr-masterdata-subcontracts-maintain](../skills/ssr-masterdata-subcontracts-maintain/SKILL.md) | 维护分包目录 |
| [$ssr-masterdata-supplemental-maintain](../skills/ssr-masterdata-supplemental-maintain/SKILL.md) | 维护补充成本目录 |
| [$ssr-project-manage](../skills/ssr-project-manage/SKILL.md) | 管理项目 |
| [$ssr-quote-export](../skills/ssr-quote-export/SKILL.md) | 导出客户报价 |
| [$ssr-quote-price](../skills/ssr-quote-price/SKILL.md) | 编制服务报价 |
| [$ssr-workflow-configure](../skills/ssr-workflow-configure/SKILL.md) | 配置流程模板 |
| [$ssr-workflow-query](../skills/ssr-workflow-query/SKILL.md) | 查询流程进度、阻塞和待办 |
| [$ssr-workflow-update](../skills/ssr-workflow-update/SKILL.md) | 更新流程节点 |

## 常用请求

- `查询 xx 项目成本` → `$ssr-cost-query`：项目 ID 已知直接查 summary；仅有名称时先匹配项目，再查 summary。普通查询不运行 validate/calculate/export。
- `修改 xx 项目 V2 的人天` → `$ssr-cost-update`：检查指定版本锁与 revision，再局部修改。
- `把 xx 项目成本导出 Excel` → `$ssr-cost-export`：使用明确版本导出，失败时才定位具体输入问题。
- `xx 项目现在到哪一步了` → `$ssr-workflow-query`：读取 workflow-plan。
- `把 xx 节点登记为完成` → `$ssr-workflow-update`：使用真实节点 code、必填字段和已有用户授权。
- `上传这份评审附件` → `$ssr-files-manage`：核对节点和轮次后归档，不自动完成节点。

技能中的 `cost-cli` 是 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs` 的简写；在仓库根目录运行。保留原 CLI API、revision、版本锁和确认规则，重命名不改变业务数据。

## 命名规则与迁移

- 统一前缀：`ssr-`。
- 业务操作：`ssr-模块-动作`；同模块在列表中相邻。
- 全局主数据：`ssr-masterdata-对象-maintain`，与项目内业务操作分开。
- 动作固定：query 查询、create 新建、update 修改、export 导出、price 定价、configure 配置、manage 管理、search 检索、maintain 维护目录。

本次重命名对照如下。旧发现入口已移除；外部副本及保存的提示词需同步更新。

| 上一版名称 | 统一名称 |
| --- | --- |
| `ssr-create-cost` | `ssr-cost-create` |
| `ssr-export-cost` | `ssr-cost-export` |
| `ssr-query-cost` | `ssr-cost-query` |
| `ssr-update-cost` | `ssr-cost-update` |
| `ssr-configure-cpq` | `ssr-cpq-configure` |
| `ssr-manage-files` | `ssr-files-manage` |
| `ssr-search-history` | `ssr-history-search` |
| `ssr-price-maintenance` | `ssr-maintenance-price` |
| `ssr-maintain-assumptions` | `ssr-masterdata-assumptions-maintain` |
| `ssr-maintain-cpq-catalog` | `ssr-masterdata-cpq-catalog-maintain` |
| `ssr-maintain-maintenance-prices` | `ssr-masterdata-maintenance-prices-maintain` |
| `ssr-maintain-profit-share` | `ssr-masterdata-profit-share-maintain` |
| `ssr-maintain-quote-templates` | `ssr-masterdata-quote-templates-maintain` |
| `ssr-maintain-retypes` | `ssr-masterdata-retypes-maintain` |
| `ssr-maintain-subcontracts` | `ssr-masterdata-subcontracts-maintain` |
| `ssr-maintain-supplemental` | `ssr-masterdata-supplemental-maintain` |
| `ssr-manage-project` | `ssr-project-manage` |
| `ssr-export-quote` | `ssr-quote-export` |
| `ssr-price-quote` | `ssr-quote-price` |
| `ssr-configure-workflow` | `ssr-workflow-configure` |
| `ssr-query-workflow` | `ssr-workflow-query` |
| `ssr-update-workflow` | `ssr-workflow-update` |

## 发现与验证

源文件在 `skills/ssr-*/SKILL.md`，`.agents/skills/` 使用同名相对链接，中文名称及默认提示词在 `agents/openai.yaml`。通用参考资料移到 `skills/references/`，该目录没有 SKILL.md，不是第 23 个入口，也不是必读前置。

修改后运行 `node scripts/check-business-skills.mjs`，检查 300 字符上限、轻量索引、发现链接、名称、默认提示词及相对文档引用。新技能名若未出现在当前任务列表，可在新开项目任务中选择，或直接指定新 SKILL.md 路径；当前对话已注入的旧目录不能靠改文件撤回。

性能验收需记录真实任务的技能读取次数、CLI 调用次数与总时间；本次减少路由与无关说明读取，不承诺模型端加载固定秒数。以“已知项目 ID 查成本”验证：正常路径只加载 ssr-cost-query，并调用一次 cost get summary；名称不明确时增加一次 project list，重名需要澄清。

CLI 与页面覆盖边界见 [平台覆盖表](cli-platform-coverage.md)，完整命令见 [CLI 清单](cli-command-reference.md)。

## 内部模型加载优化

内部模型可仅预置 [轻量索引](../skills/index.md)，按任务加载一个入口；不递归读取整个 skills 或 references 目录。具体集成和缓存策略见 [内部模型加载说明](internal-agent-skill-loading.md)。这需要修改内部模型宿主的加载配置，本仓库压缩文件不会自动改变远程宿主行为。
