# 简洁工作台：设计页面直接接入真实数据

正式入口 `/` 直接打开 `/design-review/index.html`，本机 3002 使用相同静态文件。页面采用已认可的简洁预览 HTML、导航和样式，不挂载旧 React 业务页面。默认连接本机 SQLite API；只有显式 `?demo=1` 才使用隔离的示例数据。

## 四层单一来源

- 地基：`public/design-review/tokens.css`，语义颜色、字体、间距、圆角、阴影。
- 骨架：`design.css`，侧栏、紧凑项目栏、工作表、工具栏和辅助展开区。
- 组件：`ui.js`，按钮、输入、标签、标题、表格；页面只组合这些结构。
- 反馈：同一套焦点、悬停、禁用、保存状态和冲突提示。

## 数据连接

`business/live-model.js` 将完整工作区投影成页面数据，保存时仅更新发生变化的字段，保留历史版本、流程记录、报价历史、原始 ID 和未知扩展字段。`live-client.js` 使用原本地 API 和 expectedRevision；冲突时保留编辑内容，不强制覆盖。`live-workbench.js` 处理保存、工作流、目录、真实归档及导出。

计算与 XLSX 输出通过 `features/design-review` 引入原领域函数，不复制另一套计价公式。`npm run build:design-review` 生成浏览器模块，`npm run dev`、测试和正式构建会自动执行。生成目录不提交 Git。

公式草稿在简洁页面内直接挂载原 Univer 引擎，保存到原 calculation-drafts API，支持本机恢复备份。当前采用显式保存。主数据与项目快照独立保存。

报价仍保留已存的逐行价格、分组和模板；默认主表沿用简洁版的 Section、Category、成本、GP、折前价、折扣比例、折扣、净价、分类说明九列。逐行数量、价格和条款按需展开；同分类多行不擅自合并或覆盖其独立定价。

验证范围与尚未验证部分见 [全业务验收](compact-business-acceptance.md)。本机 Git 更新步骤见 [升级说明](local-upgrade.md)。
