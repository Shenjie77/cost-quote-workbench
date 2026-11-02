# 全站设计系统与验收规范

方向：简约、克制、信息密集，优先表格操作。业务页面只能选择公共语义组件并编排数据、事件和网格；不得定义组件颜色、字体、内边距、圆角或状态效果。

## 第 0 层：地基

唯一视觉数值源：`styles/design-tokens.css`。`app/globals.css` 将这些变量映射到 Tailwind 并关闭默认色板、字号、圆角、阴影、字重体系。

| 项目 | 全局约定 |
| --- | --- |
| 色彩 | 中性底色、白色工作面、深蓝主操作；info / success / warning / danger 表达业务状态 |
| H1 | 24 / 32，600，-0.02em |
| H2 | 20 / 28，600，-0.01em |
| H3 | 16 / 24，600，0em |
| Body-Main | 14 / 20，400，0em |
| Body-Small | 12 / 16，400，0em |
| 间距 | 4px 基数；模块内边距 16px，板块间距 16px，标题栏间距 12px |
| 圆角 | sm 4px、md 8px、lg 16px |
| 阴影 | card、dropdown 两级 |
| 交互 | 200ms ease-in-out；遵从 reduced-motion |

标题角色跟随 h1/h2/h3 语义，不能在业务页面改变同层标题的颜色与字号。用户调整的表格列宽、行高和图表比例属于数据几何，不作为新视觉规格。

## 第 1 层：骨架

所有工作区共用 `wb-page-container`：最大宽度 1600px，居中，桌面左右 24px，窄屏左右 12px。宽表只在表格容器中横向滚动。

`Surface` 提供有限的语义容器角色：page、panel、body、inset、header、toolbar、footer、empty、notice、field、inline-field、item、list，以及全局壳层 navigation、shell-header、tab。`padded` 只作用于 panel；plain 不会因为分支切换而继承卡片内边距。

顶层页面用 page；内容面板用 panel；标题用 `SectionHeading` 或 header；工具操作用 toolbar；汇总/辅助说明用 footer；普通表单标签用 field/inline-field。同一角色的背景、边框、圆角、内边距由 `styles/presentation.css` 管理。

## 第 2 层：原子与组合组件

- 按钮、输入、下拉、多行文本、复选框、标签、表格、页签、弹窗、侧栏弹层、菜单、尺寸调节柄使用 `components/ui`。
- `Text` 管理五级排版和语义颜色；`Badge` 管理状态与数量标签；`Disclosure` / `DisclosureSummary` 管理折叠区；`SectionHeading` 管理中英标题及操作区。
- `lib/ui-layout.ts` 只放行几何、对齐与可见性；公共控件拒绝页面传入的视觉覆盖。控件尺寸通过 size 选择。
- 样式定义归属：`styles/components.css` 是核心控件，`styles/presentation.css` 是组合与布局角色，`styles/feedback.css` 是反馈、菜单、页签和调节柄。它们只引用 Tokens，不按业务页面添加选择器。

### 表格编辑契约

`Table` 提供 `FieldSurfaceProvider`。表内 Input、SelectField、SelectTrigger、NativeSelect、Textarea 自动继承 grid；页面不需要逐个指定外观。静止时透明边框，编辑时统一焦点边框/背景/轮廓，桌面控件最小高度 32px，12px 文本，4px × 8px 内边距。

普通表单保留可见边界；Dialog/Sheet 会重置表格上下文，弹层中的独立表单不会误用 grid，弹层中的新 Table 会重新提供 grid。原位编辑保留各字段原有提交时机、数字精度、空值和锁定规则。

分包的预览与 Item details 合并成一张原位编辑表；Code、Description、Category、BU、Unit、Price 和 Qty 均在行内编辑。站点名称也原位编辑。报价长描述直接在单元格输入，不再通过“完整描述”弹窗保存。批量录入、目录选择、导入预览、导出配置属于独立操作流程，使用公共弹层。

## 第 3 层：反馈

统一 hover、active、focus-visible、disabled、aria-invalid、选中行和拖放选中态。标签通过 tone 表达含义，不再在页面拼接色值。菜单、选择列表、侧栏弹层与对话框共享弹出层边框、背景、阴影和焦点规范。

`ResizeHandle` 与原生表格列宽调节使用同一 `.ui-resize-handle`。Bulk Entry 使用共享 Dialog 管理焦点、遮罩和滚动锁；页面不直接设置 body overflow。原有删除/放弃修改的浏览器确认保留其业务保护，不用于普通单元格录入。

## 全站迁移范围

| 页面/区域 | 共用角色与交互 |
| --- | --- |
| Today、Project List | 页面骨架、标题、指标、状态、项目表、空状态 |
| Cost Input、Subcontract、Summary、Compare | 标题栏、工具栏、原位表格、计算汇总、年份页签、说明与风险提示 |
| Pricing & Quote | 模板选择、定价表、长描述、分类、预览/导出与历史 |
| Maintenance | 表格字段、历史选择、导入、尺寸调节、归档 |
| CPQ、SSR、Reviews | 面板、标题、表单、条目、流程状态与提示 |
| Project Workflow、Files | 任务导航、状态、表单、折叠区、文件列表、拖放区 |
| Master Data 各库 | 编辑表、搜索筛选、目录、流程模板、导入和保存反馈 |
| Agent、AI Output、Calculation、Bulk Entry | 摘要、消息、输出面板和编辑器外围操作区 |

内嵌 Univer 工作表画布由其编辑器实现管理；应用外围操作控件遵循本设计系统。客户 Excel/客户文档模板的导出版式仍由各自模板管理。

## 自动检查与验证

- `tests/design-system.test.mjs` 扫描全部 `features/**/*.tsx`，禁止页面定义视觉类、视觉内联样式或绕过基础控件；同时检查五级字体、三级圆角、两级阴影及滚动锁归属。
- `tests/table-editing-contract.test.mjs` 验证表格上下文、弹层表单边界、控件拒绝局部覆盖以及维保行/调节柄的真实渲染。
- 分包交互测试覆盖年度数量、PCS 校验、空价格与零值、类别/描述/单价原位修改、版本锁定和删除确认。报价测试覆盖多行描述原位编辑和锁定后的回调保护。
- 浏览器核对采用现有数据，只进行导航、展开、聚焦及关闭操作，不修改成本或报价数据。

每次修改一个角色，验证其多个页面的消费者；不能以单页截图或旧 DOM 类名通过作为全站完成依据。

### 2026-11-02 验收记录

全量回归 1,213 / 1,213 通过；最终公共组件契约与架构检查 11 / 11 通过；TypeScript、Oxlint、生产构建通过。浏览器已核对 Today、Cost Input、Subcontract、Pricing、Master Data、Maintenance、Workflow、CPQ；其中成本/分包/报价/主数据/维保表内字段的计算样式均为 12px 文本、透明默认边框，并继承 grid 编辑模式。390px 视口没有页面级横向溢出，宽表在自身容器滚动。

Bulk Entry 的 Back 和 Escape 两条退出路径均验证：对话框关闭后 body overflow 恢复 visible，PageDown 可继续移动页面。验收过程中未修改真实成本和报价数据。分包界面截图：`/tmp/workbench-unified-design.png`。
