# CLI 与当前平台覆盖核对

核对日期：2026-10-14。基线：平台 0.11.0，包含 `a94c0bf` 的报价与导出更新。
CLI **尚未覆盖全部界面操作**。本次按命令解析器、资源读写白名单、共享计算/导出入口及工作区 schema 核对；不代表正式环境已部署这些代码。

完整命令见[自动生成清单](cli-command-reference.md)，协议与错误见[控制手册](cli-control-manual.md)。

| 平台能力 | CLI 入口 | 覆盖范围及边界 |
| --- | --- | --- |
| 项目及成本版本 | `project list/create/get/update/delete/restore`；`cost create/get/update/delete` | 支持版本、回收档案和锁定检查。项目标签目录可维护，但项目标签分配没有独立窄接口。 |
| 人员、分包、其他成本 | `cost get/update`；`cost validate/calculate` | rows 支持 `groupName`、年度 `mandays`；settings 支持费率、差旅、manualCosts。浏览器列宽、排序和视图布局不属于 CLI 参数。 |
| Group Cost、HQ travel | `cost export --format simple`；`cost get --section travel` | 使用共享导出引擎，包含 Summary Group 及 HQ 差旅计算；按数据与配置决定工作表，不能假定固定五张/九张。CLI 不读取浏览器的工作表勾选与分组视图设置。 |
| 导入 | `workbook inspect`；`cost import`；`boq import`；`masterdata update` | 成本/BOQ 支持映射、预览、应用。页面通用批量粘贴窗口及其本地草稿没有同名 CLI；主数据用结构化 JSON 更新。code/description 必填规则按业务 schema 检查，不能把页面宽松输入等同于所有 CLI 请求。 |
| 报价定价 | `quote get/update --section settings` | 支持 `pricing.lineRemarks`、`discountDescription`、目标 GP、折扣及明细模式。新建默认目标 GP 为 45%，不改历史保存值；独立明细 GP 需按已有定价模式维护。 |
| 报价导出 | `quote export --project-id ID --output FILE.xlsx`；`workbook fill-template` | export 使用当前 activeVersion，要求 Confirmed，并保留旧流程适用的校验；没有 `--version`、combined review 或页面 Draft/Final 选择参数。新备注与折扣描述写入导出历史；内部备注不写入客户 Excel。 |
| Quotation + simple cost review | 无独立命令 | 页面归档前缀 `simple_cost_review_`，仅归档。不能用 `quote export` 声称生成相同的合并文件。CLI 报价入口也没有完整复刻页面合并维保报价的输入组合。 |
| XLSX 保存 | 各 `export --output` | CLI 按明确路径创建文件，仓库型导出还会归档；页面 Generate XLSX 不再自动下载，不等于 CLI 忽略 `--output`。已有文件需命令支持的 `--overwrite`。 |
| 全局主数据 | `masterdata get/update --tab TAB` | 12 个 tab，见下表；各自独立 revision。更新目录不自动改历史项目快照。 |
| CPQ | `cpq get/update/match/confirm/solve/archive/export` | 支持目录匹配、人工确认、求解与归档；不能跳过确认/过期结果校验。 |
| 维保 | `boq get/update/import`；`maintenance validate/archive/export` | 支持 BOQ 及归档导出；不能据此推断所有新页面控件均有窄接口。以资源允许字段为准。 |
| 工作流 | `project get --section workflow-plan`；`project workflow-action`；`workflow preview/publish` | 支持配置流程、并行节点及版本锁；旧 SSR 命令保留兼容用途，不用于替代当前项目流程推进。 |
| 文件归档与入口 | `files settings/list/upload/download` | 支持归档读写；没有打开 cost/quotation/workflow 文件夹、移动或删除归档文件的 CLI 命令。页眉图标属于 UI。 |
| 提醒与历史 | `digest generate`；`reminders scan/list/ack`；`history search` | 本地规则计算及检索；不会自动安装定时任务。 |
| 小模型实验/反馈 | 无独立命令 | `digest generate` 不是小模型调用命令；连接、调用及实验反馈没有 CLI 入口。 |
| 完整工作区 | `workspace list/get/save` | 用于明确需要的备份或整体操作；不是绕过窄接口、业务锁或 revision 的通用办法。 |

全局 tab：`resources`、`subcontract`、`supplemental`、`maintenance`、
`service-history`、`assumptions`、`quote-templates`、`profit-share`、
`project-tags`、`workflow`、`status`、`cpq-catalog`。
`status` 是旧版兼容数据；当前流程配置使用 workflow 发布流程。

## 最新报价字段操作示例

先读取目标项目及 revision（`ID`、`R`、文件路径均须替换）：

```sh
npm run --silent cost-cli -- quote get --project-id ID --section settings --pretty
```

将下列内容保存为 `quote-settings.json`：

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "quote-settings-update",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "quote.update",
    "changes": {
      "set": {
        "pricing": {
          "targetGrossMargin": 45,
          "discountDescription": "年度合作优惠",
          "lineRemarks": {
            "service:project": "按交付风险与资源投入采用 45% GP"
          }
        }
      }
    }
  }
}
```

```sh
npm run --silent cost-cli -- quote update --project-id ID --section settings --input quote-settings.json --expected-revision R
npm run --silent cost-cli -- quote get --project-id ID --section settings --pretty
```

`lineRemarks` 的 key 必须使用对应报价行的稳定 ID；`service:project` 是单行项目报价示例。
备注每项最多 4000 字符，折扣描述最多 1000 字符。`discountDescription: ""` 回退模板默认描述。
pricing 对象合并只到一层；提交 `lineRemarks` 会替换该映射，先读出并合并需要保留的其他行备注。
目标 GP 更新的效果受当前定价模式影响；不会强制覆盖独立行 GP。
导出历史保存独立备注副本及折扣描述，后续编辑不改旧历史。

## 防止再次不同步

修改 CLI 后运行 `node scripts/update-cli-reference.mjs`；命令清单过期会由自动测试拦截。
字段、业务规则或 UI 行为变化仍需人工更新本覆盖表及控制手册，自动清单不能替代功能核对。
发布核对要分别确认：代码提交、GitHub CI、正式环境部署版本；推送成功不代表正式环境已更新。
