# 公司评审证据

Set `ssr.enabled=true`, proposal number, brief, technical basis and requiredDomains. Leave `commercialBasis` to the platform to derive from project, pricing, assumptions and selected template. Do not construct submission snapshots manually; use commands.

Each command takes `--project-id ID --input operation.json --expected-revision REVISION --compact`. All use `OperationRequest`, data schema `1.0.0`, and an `operation` matching the command:

| Command / operation             | Additional data fields                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ssr submit` / `ssr.submit`     | `kind` (DTRB/DRB/BUDGET/SPECIALIST/QUOTE_DECISION/BID_REVIEW), `domain` (empty except specialist), `owner`, `dueDate`, `applicationNumber`, `evidence` |
| `ssr result` / `ssr.result`     | `submissionId`, `outcome` (approved/rejected/conditional/withdrawn), `evidence`, `conditions` (nonempty only when conditional)                         |
| `ssr close` / `ssr.close`       | `submissionId`, `condition`, `evidence`                                                                                                                |
| `ssr followup` / `ssr.followup` | `submissionId`, `note`, `nextDate`                                                                                                                     |

Use actual company evidence, not an inferred approval. Required professional domains must be configured before quote decision. Tender rows under `ssr.bidResponses` cover each required domain; edits invalidate the earlier bid review. Closing a condition binds to the specific result, even when later results repeat its wording.

每次写入使用返回的新 revision，窄读对应 submission 复核。不能用 ssr update 覆写 submissions。投标答复通过 ssr get/update --section bid-responses 维护，字段见 schemas/workspace-state.schema.json 的 $defs.ssrWorkspace.properties.bidResponses.items；不能伪造专业答复或审批。followup 不会发送 PM 消息；登记本地记录不等于已提交公司系统。
