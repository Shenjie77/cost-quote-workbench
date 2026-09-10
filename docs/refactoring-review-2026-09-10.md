# 项目整洁代码重构与验证记录

日期：2026-09-10

## 交付与范围

完整重构代码已写入项目。`outputs/refactor-2026-09-10/project-source.zip` 提供可安装依赖和构建的项目源码快照，包含完整文件而非代码片段；`refactor.patch` 只记录本次相对于开始时工作区的修改。源码包排除本地业务数据库、归档文件、环境凭据、依赖目录和构建缓存。

本次检查了项目结构、主要超长模块、测试组织及构建配置，实施重构的范围是成本计算、工作流引擎、后端资源访问和工作台编排四条核心链路。开始时工作区已有大量未提交变更，本次以这些变更为基线；实际只修改了 4 个原有生产文件，新增 5 个生产模块和 4 个回归测试文件。

## 修改清单

| 模块 | 发现的问题 | 完成的修改 |
| --- | --- | --- |
| `features/cost/domain.ts` | 人员补贴兼容规则与计算混合；分类求和、分组及排序重复 | 提取 `personnel-allowance.ts`；复用分类求和、维度标识、分组初始化和占比排序；保持原导出 API |
| `features/projects/workflow-engine.ts` | 日历计算与状态机混合；动作入口包含多种职责 | 提取 `workflow-calendar.ts`；将请求校验、字段更新、时间修正和状态转换拆成具名函数；统一保留审计及执行快照更新位置 |
| `server/workspace-resources.mjs` | 资源定位和更新入口过长；字段选择、分页及兼容处理混杂 | 按 project、cost、CPQ、quote、SSR、BOQ 拆分资源定位；提取过滤分页、对象补丁、写回、工作流更新和版本检查 |
| `features/workbench/workbench-app.tsx` | 会话编排承载展示标记及纯计算，难以独立验证 | 提取 `workbench-sidebar.tsx`、`workspace-toolbar.tsx`、`workspace-projections.ts`；会话继续负责异步操作和编辑状态 |

命名使用业务意图替代模糊缩写，例如 `isTerminalNode`、`parseWorkflowTimestamp`、`assertAllowedFields`、`mergeWorkflowProjection`。使用 TypeScript 的类型导入、`Pick`、联合类型和显式组件参数建立边界，没有为函数式业务代码引入额外类层次或依赖。

本次涉及的生产模块中，具名函数均补有职责说明；对舍入位置、兼容优先级、原地写入、时间边界、审计顺序和并发保护等关键代码块补充了原因与作用注释。注释审计覆盖具名函数及以变量绑定的函数、`useCallback` 和 `useMemo`。

## 长方法拆分结果

以下行数来自 TypeScript AST 定位的函数范围，包含注释；这是规模指标，不冒充精确的圈复杂度统计。

| 函数 | 重构前 | 重构后 |
| --- | ---: | ---: |
| 工作流 `applyWorkflowAction` | 248 | 69 |
| 后端 `locate` → `locateResource` | 282 | 24 |
| 后端 `updateResource` | 250 | 146 |
| 成本 `buildCostDimensionSummary` | 70 | 49 |
| 成本 `getCostStatementValues` | 58 | 47 |

工作台入口已拆出两个展示组件和一个纯计算模块，但会话函数仍然较大。项目中的 CLI 和 Excel 导出长模块也仍有进一步拆分空间。本次不将上述范围描述为全仓所有代码异味均已消除。

## 功能等价约束

- 成本：保持金额向上取整的位置、逐行累加顺序、重复 RE ID 首项匹配、人员 Pool/旧 ID/旧开关的优先级，以及分包 BOQ 不计人员人天的行为。
- 工作流：保持时区、工作日和假日边界，暂停补偿、并行节点审计顺序、错误优先级、失败原子性和历史版本快照。
- 后端：保持响应内容、异常类型与文字、过滤分页规则、延迟初始化、对象引用及写入副作用，以及乐观锁检查顺序。
- 工作台：保持显示内容、按钮回调和禁用条件，选中版本的费率与利润分成计算，过期响应保护及原有 Hook 生命周期。

## 自检、修正、复测闭环

1. 修改前保存源码基线；原有 614 项测试、lint 和类型检查全部通过。
2. 各模块独立拆分，新增针对实际业务边界的回归测试；未删除或放宽现有测试断言。
3. 后端提取过程中自查发现工作流 lookup ID 可能偏离原行为，已恢复原语义并加入回归覆盖。
4. UI 组件拆出后 lint 检出残留的无用图标导入，已清理；新增测试中一处未命中实际 RE 的夹具也已修正并重新验证。
5. 执行原版/新版差分；另由独立审查者复核工作台及资源层的返回、引用和副作用。
6. 汇总后执行全量测试、静态检查和生产构建。后续仅补充注释和交付文档，并对最终文件检查格式与注释覆盖。

## 测试结果

| 验证项 | 结果 |
| --- | --- |
| 修改前 `npm test` | 614/614 通过 |
| 重构后 `npm test` | **644/644 通过**，无失败、跳过或取消 |
| `npm run lint` | 通过 |
| `npx tsc --noEmit --incremental false` | 通过 |
| `npm run build` | 通过 |
| 本次修改文件 `oxfmt --check` | 通过 |
| 成本原版/新版差分 | 1,000 组场景、107,820 次 API 比较一致 |
| 工作流原版/新版差分 | 24,750 次比较一致 |
| 资源层原版/新版差分 | 27,840 组读取/更新比较一致 |
| 资源层独立交叉复核 | 11,220 组返回、异常、副作用及仓库调用顺序比较一致 |
| 侧栏和工具栏原版/新版渲染 | 275 组 HTML 对照完全相同 |

新增 30 项测试分布：成本 7 项、工作流 7 项、资源层 10 项、工作台投影 6 项。测试以独立期望值覆盖金额、利润分成、遗留兼容、时间边界、并发和异常场景。

构建输出包含 vinext 对路由静态分类能力的提示及插件耗时提示，进程正常退出；这些提示不代表构建失败。现有测试和差分场景未发现业务行为变化，但有限测试不能构成所有可能输入的形式化等价证明；本次没有执行真实浏览器的端到端人工验收。

## 复现与证据

常规验证命令：

```sh
npm ci
npm test
npm run lint
npx tsc --noEmit --incremental false
npm run build
```

完整日志位于 `outputs/refactor-2026-09-10/validation/`，文件清单位于 `outputs/refactor-2026-09-10/manifest.json`。

本机修改前源码备份：`/tmp/cost-workbench-refactor-baseline/source.tar`。本次一次性差分脚本保留在以下路径，依赖同次基线备份：

- `/tmp/cost-workbench-refactor-baseline/cost-differential.mjs`
- `/tmp/cost-workbench-refactor-baseline/workflow-differential.mjs`
- `/tmp/check-workspace-resource-equivalence.mjs`
- `/tmp/cost-workbench-refactor-baseline/resource-cross-review.mjs`
- `/tmp/check-workbench-shell-equivalence.mjs`

新增回归测试随项目源码长期保留，并由 `npm test` 自动发现。
