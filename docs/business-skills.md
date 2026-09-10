# SSR 业务 Skill

按 SSR 的项目、主数据、成本、CPQ、维保、商业报价、项目流程和历史参考模块拆分。每个入口可独立调用，只读本次业务需要的全局页签或项目/版本。一般全局主数据维护不选项目也不读取项目列表；流程模板发布需要预览受影响项目。`cost-workbench` 保留为跨业务协调入口，不会预先加载所有说明。

| 模块       | 工作事项           | 直接调用                     |
| ---------- | ------------------ | ---------------------------- |
| 项目管理   | 项目管理           | `$ssr-project-manage`        |
| 成本编制   | 成本新建           | `$ssr-cost-create`           |
| 成本编制   | 成本更新           | `$ssr-cost-update`           |
| 成本编制   | 成本核验与导出     | `$ssr-cost-export`           |
| 主数据维护 | RE Type 维护       | `$ssr-retype-maintain`       |
| 主数据维护 | 分包主数据维护     | `$ssr-subcontract-maintain`  |
| 主数据维护 | 补充成本主数据维护 | `$ssr-supplemental-maintain` |
| 主数据维护 | 维保数据维护       | `$ssr-maintenance-data`      |
| 主数据维护 | 风险假设库维护     | `$ssr-assumptions-maintain`  |
| 主数据维护 | 报价模板更新       | `$ssr-quote-template`        |
| 主数据维护 | BU 分成比例维护    | `$ssr-profit-share-maintain` |
| CPQ        | CPQ 数据维护       | `$ssr-cpq-catalog`           |
| CPQ        | CPQ 配置匹配       | `$ssr-cpq-configure`         |
| 维保       | 维保配置与报价     | `$ssr-maintenance-quote`     |
| 商业报价   | 商业报价编制       | `$ssr-quote-prepare`         |
| 商业报价   | 报价导出           | `$ssr-quote-export`          |
| 项目流程   | 项目流程更新       | `$ssr-workflow-update`       |
| 项目流程   | 流程模板维护       | `$ssr-workflow-configure`    |
| 历史参考   | 历史成本参考       | `$ssr-history-reference`     |

现有 19 个独立业务 skill，另有 1 个跨业务总入口。

## 调用示例

项目号和版本号换成实际值；无需先调用总入口。

- `使用 $ssr-cost-create，为项目 PRJ-XXXX 从 V2 复制一个新成本草稿。`
- `使用 $ssr-cost-update，根据附件更新项目 PRJ-XXXX 的 V3 人天成本。`
- `使用 $ssr-retype-maintain，把全局 LOCAL-L1 人天费率改为 650 SGD，仅更新主数据。`（金额为示例）
- `使用 $ssr-cpq-catalog，根据附件维护全局 CPQ 编码、Scope 和成本。`
- `使用 $ssr-cpq-configure，根据我的简短 Scope 推荐条目，待我确认后计算数量。`
- `使用 $ssr-maintenance-data，补充全局客户设备维保参考记录。`
- `使用 $ssr-quote-export，导出项目 PRJ-XXXX 当前版本的客户报价 Excel。`
- `使用 $ssr-quote-template，把全局库中指定客户模板有效期更新为 30 天，并采用我提供的 T&C。`
- `使用 $ssr-workflow-update，项目 PRJ-XXXX 的 V3 已由我确认定稿，请核对成本后将本版流程推进到 DRB，等待 PM 评审，并记录我提供的跟进日期。`
- `使用 $ssr-workflow-update，项目 PRJ-XXXX 报价已完成，按我提供的信息确认结束节点并停止跟进提醒。`
- `使用 $ssr-workflow-configure，把法务和交付配置为并行节点，SLA 为 3 工作日，预览后发布；当前正在处理的节点保留原期限。`

## 模块边界

- 主数据独立全局保存。RE、分包、补充成本、维保参考、假设、报价模板和 CPQ 用 `masterdata get/update --tab TAB`，不带项目号；每个页签有独立 revision。这些页签维护不会改动已有项目或 Draft；workflow 配置另经预览发布同步未完成项目。
- 新项目/空白成本版本捕获创建时的全局数据；复制版本保留源版本快照。历史查看与导出继续使用原费率及采用的条款。只有用户明确要求应用时，才用指定版本的 `cost apply-rates` 或支持页签的 `project apply-masterdata`；详见[全局主数据与项目快照](global-master-data.md)。
- 成本新建创建独立 Draft，版本号自动生成，并自动选为 activeVersion 与 workflowVersion，无论原轮次是否完成，都采用最新全局模板，从其 roundStart（默认 DTRB）开始本轮流程，原成本和轮次快照不变。后续成本修改、导入和标准成本导出显式指定返回版本。历史记录保留；切旧版查看不改变工作轮次。新项目需要真实项目号、名称、客户。
- 成本更新只改指定未锁定版本。用户明确确认本版为 Confirmed 才定稿并锁对应版本；原版汇总可查看，允许从锁版创建可编辑新 Draft。`cost get --section versions` 返回每个版本的锁原因，修改/导入/应用费率均显式指定目标版本。RE 主数据仍可更新。3% 在 Cost Input 按 LOCAL/ARP/HQ/OTHER Pool 多选，所选类别人员的年度 Cost 已含金额，其他汇总不重复加算。HQ Travel 在本版显式启用后按 HQ 人力计算；新建成本默认关闭。
- CPQ 数据维护只改目录；CPQ 配置负责推荐、用户选定、求解及归档。固定设备数量不得为凑金额调整。
- 维保数据维护负责历史参考库；维保报价负责真实 BOQ、选价和草稿输出。
- 流程更新 skill 用 `project get --section workflow-plan` 读取并行节点/阻塞项，`project workflow-action` 登记 start/complete/skip/update/pause/resume/reopen。关键节点必须填写配置字段并明确确认；requiresConfirmedCost 仍要求本轮成本 Confirmed。未办非关键节点可记 Skipped，不伪造 Completed。Reminder 依据节点 SLA；整轮无活跃/暂停节点时仅提示首个待开始阶段，显示普通待启动且不计时；结束节点完成停全部提醒，新 Draft 从配置起点重开。模板 skill 用 workflow preview/publish 原子同步全局和允许更新的未完成项目，活跃期限默认保留、显式 migrateActiveProjectIds 才重算；成本和完成历史不变。详见[可配置项目流程](project-workflow.md)。
- 报价编制负责定价及当前报价假设；报价模板更新负责 Master Data 的客户模板库；报价导出单独生成客户文件。
- 商业报价和公司模板当前使用 activeVersion；不能把模板映射版本当成本版本。报价文件不包含内部成本/费率/毛利。

## 本地发现与安装

正文位于 `skills/ssr-*/SKILL.md`，中文显示名称和示例位于各目录的 `agents/openai.yaml`；`.agents/skills/` 中的同名入口指向这些文件，随仓库一起维护。无需复制到每个项目或修改全局 skill 目录。

在本项目任务中输入 `$ssr-` 选择对应业务。当前已打开任务的技能列表若尚未刷新，重新打开项目任务后再选择。也可明确指定本仓库中的 `skills/具体名称/SKILL.md`。

单项 skill 不要求每次读取全量 workspace、全部项目、完整能力列表或所有 schema；已知项目就直接读取目标资源，只在字段/接口不明时查相关定义。项目业务内部按项目完整校验和原子保存；全局维护只校验并保存目标页签，不读取项目 workspace。Agent 只接收细分结果。
