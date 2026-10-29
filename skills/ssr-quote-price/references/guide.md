# SSR · 编制服务报价

在包含 `cli/cost-cli.mjs` 的仓库根目录运行 `node --disable-warning=ExperimentalWarning cli/cost-cli.mjs ...`；下文 `cost-cli` 是此前缀的简称。项目号已知时直接读取目标资源；未知才用 `project list`。项目成本和业务配置使用已捕获的数据快照；维护全局主数据不读取或更新项目。

按需用 `--id/--query/--limit/--offset` 窄读，跟随 nextOffset；跨页 revision 变化重读。字段不明才查指定 schema，不预读完整 workspace、能力表或其他技能。

写入用最新项目 `--expected-revision R`，冲突后重读。局部更新保留未传字段，新增须完整；核对成功回执和变更结果。

先读 `quote get --project-id ID --section settings`；仅重新定价需成本 summary，仅调整条款需 assumptions/已选模板，不为填写 remark 读取全部资料。当前标准报价与模板填充使用 activeVersion；用户指定其他版本时先核对。成本需由用户确认成为 Confirmed 后才能正式导出；Confirmed 不表示 DRB 已批准。统一项目流程按公司实际进展登记，不再维护本地 SSR 审批依赖链。新建或复制 Draft 无论旧轮次是否完成，都采用最新全局流程模板，从其 roundStart（默认 DTRB）开启新轮次，旧证据只读保留；不能自行批准或解除原版锁定。

客户模板与可复用假设读取项目捕获快照：`quote get --project-id ID --section templates|library`，按需用 `--id/--query`。不要用当前全局库替代旧项目采用的条款。客户名称规范化精确匹配，展示真实付款条款、有效期与法务 T&C。模板选中与默认假设拷贝是不同操作；仅设置 selectedQuoteTemplateId 不代表假设已自动应用。用户要求套用时按选定模板的 defaultAssumptionIds 读取库记录，再更新当前报价假设，保留用户手改内容与明确排除项。

`project apply-masterdata` 的成本相关目录仅允许当前 activeVersion 为未锁定 Draft；指定成本版本费率用 `cost apply-rates --version`。`--tab profit-share` 更新报价的分成快照，可用于成本已定稿的项目，不修改锁定成本。其他需要改动已定稿成本的需求，按用户的新一轮估算意图建立新 Draft。

写入文件使用以下信封，`CHANGES` 替换为本业务的变更对象，`requestId` 每次操作取唯一值：

```json
{"apiVersion":"cost-workbench/v2","kind":"OperationRequest","requestId":"unique-id","data":{"schemaVersion":"1.0.0","operation":"quote.update","changes":CHANGES}}
```

集合用 `{"upsert":[...],"remove":[...]}`（只提供需要的键）；对象设置用 `{"set":{...}}`。`upsert` 仅合并已有记录的顶层字段，数组字段整项替换。
`quote update --project-id ID --section settings --input FILE --expected-revision R` 的 set 支持 `pricing/selectedQuoteTemplateId`。pricing 字段先查 `features/quote/domain.ts` PricingSettings。`--section assumptions` 用 upsert：`id/text/textZh/included/sourceAssumptionId?`。提供的 T&C 和 Scope/交付假设原文不能擅自扩展责任。计算交由平台；成本已经包含可选3%，不得二次增加。

全局模板/假设维护由对应 skill 处理，维护本身不会应用到本项目。用户明确要求采用最新全局条款时，先核对 `masterdata get --tab assumptions|quote-templates`，再分别 `project apply-masterdata --project-id ID --tab assumptions|quote-templates --expected-revision R`；这是项目写操作，使用项目 revision。按需先应用假设库以保持模板引用有效，每步读回新 revision。项目当前商业依据会改变，须重新核对适用的评审；历史报价归档不变。

编制完成后窄读定价、已选模板和当前报价假设，报告保存结果与仍缺的前置。用户同时要求生成文件时，再使用 [报价导出](../../ssr-quote-export/SKILL.md) 完成；仅修改报价参数时不加载导出说明、不生成文件。

涉及 BU 分成或采用最新比例时读 [分成定价](../references/profit-share.md)；仅填 remark 无需读取。

新项目默认目标 GP 45%，历史值不自动改变。settings 的 `set.pricing` 支持 `lineRemarks:{报价行ID:内部理由}`（每项最多 4000 字符）及 `discountDescription`（最多 1000 字符，空字符串用模板默认）。pricing 合并一层，lineRemarks 映射需先保留其他行；内部 remark 不进入客户 Excel。仅改目标 GP 不覆盖独立行 GP 模式。

人员行和结构化分包条目的 `category`（最多 120 字符）直接作为生成报价的 Category，独立于 Group 和 RE Type 分类；同一 Scope/Group 跨 Category 时保留分类边界。修改成本分类走成本更新，不手改已锁成本或历史报价。Category 名为 Optional 只是标签，不自动排除金额；报价纳入、手工明细及组设置按用户选择维护。仅检查分类无需读取全部技能或重新导入成本。

成本 Category 传入新生成的报价明细；已保存的自动布局可在页面用 Refresh from Cost 刷新。该按钮会明确提示重建行数，保留可唯一匹配行的定价/备注/分组覆盖，新增或拆分行 GP 默认 45%，并处理已移除 Scope 的风险分配。CLI 没有同名刷新命令；不能以整体覆盖 pricing 模拟保留意图，应先读取并按明确需求更新。
