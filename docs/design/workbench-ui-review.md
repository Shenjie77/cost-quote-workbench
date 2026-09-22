# Workbench UI 独立审查记录

## 范围与依据

- 审查日期：2026-09-22。
- 比对基线：`056ed53`，审查该基线之后的当前界面工作区差异。
- 使用 `work/design-skills/web-design-guidelines/SKILL.md`；初审和最终复核均重新获取了[最新 Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md)。
- 范围：`app/globals.css`、共享 `components/ui` 和 `components/workbench`、工作台外壳及九个导航页面：Today、Project List、Project Workflow、Cost Workspace、Pricing & Quote、CPQ Configuration、Maintenance BOQ、Agent Digest、Master Data。
- 审查方式：阅读界面差异、检查共享组件与表格滚动祖先、扫描表单标签和图标按钮，并用 TypeScript AST 比较改动前后的交互属性。未操作真实项目数据。

代码审查与下方浏览器验收分别执行。浏览器验证使用本机浏览器的响应式视口；未声称覆盖所有实体设备或屏幕阅读器。

## 功能保留检查

现有 JSX 事件回调以及 `disabled`、`readOnly`、`inert`、`open`、`checked` 属性的表达式均保留。Maintenance 的两个回调只有格式变化；新增交互只有跳到正文入口。另人工检查了重排控件的条件渲染与父级禁用范围。

- 工作台 Save、保存失败恢复、New Version、项目搜索、项目切换和新建入口仍连接原回调；保存与切换期间的限制保留。
- Today 的流程分布、待办列表及项目组合继续使用原跳转与过滤处理。
- Workflow 的完成、启动、恢复、保存、重置移到字段上方；负责人、必填项、确认和忙碌状态限制保持原条件。
- 人员与 Subcon 的新增、批量导入、Excel 导入、年份、分组、列配置、单元格编辑、删除和导出入口保留；成本锁定规则未改。
- Quote 的保存、导出、GP 输入、明细编辑、固定比例与单价、假设和报价历史操作保留。
- Master Data 的页签、搜索、批量导入和保存入口仍可访问；CPQ 确认与计算，以及 Maintenance 的数量、历史参考、依据、移除和导出仍使用原处理函数。
- 原有数据表继续使用语义化网格。Maintenance 设备和历史记录改为共享表格，原字段、来源说明和操作均保留。

## 问题闭环

| 位置                                                 | 初审或复核发现                                              | 最终代码状态                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------- |
| `features/workbench/detail-sheet.tsx:49`             | 新项目表单的父级不能缩小，矮屏可能挤出底部按钮              | form 增加 `min-h-0`；标题、底部不收缩，正文独立滚动           |
| `features/quote/quote-lines-editor.tsx:233`          | 双层滚动祖先使固定表头绑定到错误容器                        | 高度限制交给 `Table.containerClassName`，保留单一纵横滚动容器 |
| `components/ui/popover.tsx:40`                       | 列设置弹层缺少整体可用高度限制                              | 按可用高度限高，允许内部滚动，并限制滚动传递                  |
| `features/quote/quote-view.tsx:674`                  | 删除假设、删除历史的图标按钮，以及状态和备注没有可访问名称  | 添加与当前假设或报价记录对应的标签，原删除处理不变            |
| `features/workbench/workbench-app.tsx:2579`          | 没有跳过重复导航的键盘入口                                  | 新增聚焦可见的跳转链接和独立 main 目标；不改既有 hash 导航    |
| `features/cost/components/cost-import-panel.tsx:105` | Excel 文件输入没有标签                                      | 增加文件用途标签                                              |
| `features/maintenance/maintenance-view.tsx:185`      | BOQ 文件输入没有标签                                        | 增加文件用途标签                                              |
| `features/overview/overview-view.tsx:409`            | 项目组合流程过滤器没有可访问名称                            | 增加过滤用途标签；过滤状态与处理不变                          |
| `features/projects/project-table.tsx:94`             | 重构时冻结首列的 hover 背景变为半透明，横向滚动会透出后方列 | 恢复不透明 hover 背景                                         |
| `components/ui/table.tsx:17`                         | 新增滚动区键盘入口的外描边可能被父级裁切                    | 焦点描边向内偏移，保留可见边界                                |

上述位置以审查时版本为准，后续格式化可能移动行号。

## 最终代码结论

本次改动范围内没有尚未关闭的高影响问题。共享焦点样式、减少动画偏好、数字对齐和原有搜索键盘/输入法处理保留；表格保留滚动能力与网格边界，Dialog/Sheet/Popover 继续使用原 Base UI 交互基础。

未为遵循指南而更换路由、改动删除或保存业务规则、增加数据变更，也未将长表格替换为卡片。未启用的旧 SSR/Reviews 独立组件不属于九个导航页面的此次重构；当前入口仍按既有规则显示 Project List。

## 浏览器与自动化验证

主任务已执行以下验收：

- 全套现有测试 **940 / 940 通过**；另外对重排后的主数据导航断言修正了测试的 DOM 边界，继续断言九个页签在加载错误时可用、数据修改仍被禁用；人员与分包表的冻结列断言同步为较宽视口冻结。
- TypeScript、lint、生产构建通过。最后的响应式及焦点样式调整后再次运行全套测试，仍为 940 / 940；最终生产构建通过。
- 浏览器逐页覆盖九个主要页面；375 px 与 768 px 宽度逐页检查页面边界，没有整页横向溢出。宽表在自身容器中滚动并保留网格。桌面 1440 px 检查主要布局，1024 px 验证报价页、搜索和项目切换。
- Master Data 九个页签均保留 Excel 模板和批量入口；普通库保留 Save，Workflow 保留 Preview & Publish。
- Today 点击有待办的流程分布后显示项目清单，Open Task 能到达对应项目的 TD 节点；Follow-ups 仍在 Portfolio 前。
- 在报价页搜索并切换项目，页面仍为 Pricing & Quote；刷新后同一页面和项目被保留。通过已打开项目标签返回原项目。
- Skip to Content 正确聚焦 main，未改动工作流 hash；成本表键盘右移滚动 40 px，并显示 2 px 内侧焦点边框。
- 客户 Preview 的成本关联报价、折扣、0% 税率和总额与重构前一致；Escape 可关闭弹窗。
- 375 × 600 px 下新建项目抽屉正文独立滚动，Create 与 Cancel 均在可视区域，抽屉宽度适配屏幕。
- 隔离演示夹具使用实际 MaintenanceView，包含三种设备、每种两个历史参考、长型号/依据和一条历史记录。首行改选参考后仅该行年价从 600 变 840，再把数量从 2 改 3，24 个月报价为 **13,200**；其它两行数量/年价不变。只读模式的表单控件均禁用，375 px 下 BOQ 仍为 1020 px 网格在 334 px 容器中独立滚动。夹具禁止 API、归档和导出请求，没有写真实项目数据。

浏览器验收期间补充关闭的问题：

- `features/master-data/workflow-template-editor.tsx`：小屏节点文字被操作按钮挤窄；设置文字区换行基准，按钮转到下一行。
- `features/cost/components/personnel-input-controls.tsx` 与 `subcontract-lines-table.tsx`：小屏冻结列占满可视区域；仅在较宽视口冻结列，手机完整保留横向滚动能力。
- `components/ui/sheet.tsx`：小屏抽屉原默认宽度为 75%，输入过窄；改为留 16 px 外边距，桌面仍遵循调用方最大宽度。
- `features/workbench/workbench-app.tsx`：小屏主导航由单行横滚改为可见网格，保存操作独立换行，避免挤压标题。
- `components/ui/button.tsx`、`input.tsx`、`select.tsx`、`tabs.tsx`：共用控件的焦点环统一为实色；正常文字、次要文字、焦点颜色对比值分别约 13.3:1、5.26:1、4.96:1。

现有数据、计算模块、服务端和导出实现没有修改。
