# 客户本机 Git 更新与回退

适用：已部署旧平台，客户在原目录拉取源码并运行。不要重新初始化客户环境。

## 本次变更边界

正式入口 `/` 直接加载已认可的简洁页面 `/design-review/index.html`，默认连接原本地数据 API，不再嵌入旧业务页面。客户正常拉取、安装依赖并构建时会生成页面使用的计算、导出和公式模块。历史数据库与附件位置保持不变。`?demo=1` 才是隔离示例模式。

本次不修改 SQLite schema、项目/版本 ID、保存结构和历史快照。HR Cost / 人力成本为显示名称调整，保留 `personnel` 字段、工作表标识和导入兼容性。不能在升级时用审核样例初始化或覆盖客户工作区。

构建只读取源码，不打开客户数据库。备份与校验工具用于保全原数据库、实际附件目录及本地配置。

## 发布前提

维护者必须先将本次源码、`public/design-review/`、`features/design-review/` 及升级/构建脚本完整提交并推送到客户跟踪的分支。仅在开发机更新页面不会改变客户可拉取的版本。生成的 `public/design-review/generated/` 不入库，由 `npm run build` 的 prebuild 自动生成。

## 首次获取本次更新

1. 保存当前工作，关闭所有旧页面并停止本机平台进程（包括 API）。
2. 在原仓库目录执行 `git status --short`，确认没有未保存的源码改动；客户的 `data/`、`.env*` 与附件目录不应加入 Git。
3. 记录 `git rev-parse HEAD` 的完整结果，作为 OLD_COMMIT。运行旧版本已有的 `npm run backup:local`，并保存客户附件目录及 `.env*`。这份备份先于代码拉取。
4. 执行：

```bash
git pull --ff-only
npm ci
npm run upgrade:prepare -- --from OLD_COMMIT
```

将 OLD_COMMIT 替换为上一步记录的提交号。`upgrade:prepare` 输出 JSON，其中 `manifest` 是本次恢复清单的绝对路径。将其保存为下面的 MANIFEST_PATH。

```bash
npm run build
npm run upgrade:verify -- "MANIFEST_PATH"
npm start
```

仅在构建成功、校验返回 `ok: true` 时启动。开发模式客户最后一步可用 `npm run dev`。原业务地址仍为 `http://localhost:3000/`，会自动进入简洁版。开发机上的 `3002` 是独立静态预览服务，客户更新不需要部署此端口；默认简洁版连接真实本机数据，只有 `?demo=1` 使用示例数据。

更新不运行 `seed:local`，不清空 `data/`，不覆盖本地环境配置，也不要求重新导入项目。不要使用 `git reset --hard` 或 `git clean -fdx` 来解决拉取冲突。

## 后续升级

工具已在本机后，可先执行 `npm run upgrade:prepare`，保存 manifest，再进行 `git pull --ff-only`、`npm ci`、构建、校验与启动。按当前仓库配置使用 Node.js 22.18 或更新的受支持版本。

若使用自定义数据库，所有命令必须沿用相同的 `COST_WORKBENCH_DB`；使用自定义 API 端口时，同样保留 `COST_WORKBENCH_API_PORT`，并在构建/开发时沿用对应的 `VITE_WORKBENCH_API_ORIGIN`（例如 `http://127.0.0.1:3321`）。正式入口会将配置端口传给简洁工作台。命令沿用进程环境，不会自行替换或解析客户 `.env` 中的值。

## 备份与校验包含什么

`upgrade:prepare` 要求本机 API 已停止，然后：

- 使用 SQLite 备份 API 保存一致的数据库，包含已提交 WAL 内容；执行完整性检查。
- 对每张业务表建立内容指纹，覆盖项目、版本、报价历史、主数据、修订号及迁移档案。
- 按 `project_file_roots` 记录复制每个项目的实际归档文件夹，包括位于仓库外的自定义目录，并逐个核对文件 SHA-256。
- 备份仓库根目录 `.env*` 普通文件；配置值不会打印到终端。
- 记录更新前提交号、恢复路径、文件指纹和配置指纹。

缺少归档目录、符号链接、读取失败、复制失败或备份期间数据库发生变化都会使命令失败，不会生成成功 manifest。失败目录留在 backups 便于检查，不能当作完整备份。

备份位于数据库同级 `backups/upgrade-.../`，不进入 Git。它是本机升级恢复副本，不代替客户要求的异地/磁盘备份。工具不扫描未登记在项目归档中的任意外部文件；这类文件由客户原有备份流程覆盖。

`upgrade:verify` 只读比较数据库表、原附件和本地配置。返回变更的表名、项目 ID 或文件名，不输出实际业务内容。本次没有 schema 迁移，所有指纹应保持一致。若未来发布有明确迁移，必须按对应版本发布说明验收，不能把非空差异默认为成功。

## 回退

构建失败时不要启动新版。客户数据尚未被构建修改，可切回记录的 OLD_COMMIT：

```bash
git switch --detach OLD_COMMIT
npm ci
npm run build
npm start
```

若旧版本没有某个脚本，使用该版本既有启动步骤。回到更新分支时，先停止平台，再执行 `git switch 原分支名`。

本次没有数据库迁移，回退界面代码无需恢复数据库。若以后版本确需恢复数据，必须先停止前后端、保存当前数据副本，核对 manifest；数据库恢复不能与另一时刻的 WAL/SHM 混用，附件与配置按清单中的原路径恢复。上线后产生的新业务数据不能被旧备份直接覆盖。恢复后先检查项目数、确认版本、历史报价及附件，再恢复使用。

## 更新验收

- 客户旧工作区可加载；Confirmed 版本和历史报价保持原值与状态。
- 项目/版本切换仍先完成队列保存，修订冲突仍拒绝覆盖。
- 成本报表、Category、Group、BU 和资源汇总一致；Car Fee 仍属于 EHS。
- 原位编辑、年度增幅、补贴、HQ 差旅、分包 BOQ、手动成本和风险权重均可保存并重载。
- 原有报价模式、BU 分成、折扣、Section/Category、模板、Excel 导出和归档功能通过实际回归。
- 中英文仅影响界面，不翻译或改写客户数据。
- 真实旧数据副本完成升级/回退演练后，再切换正式入口。
