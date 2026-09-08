# 历史流程与评审（只读）

统一 Project Workflow 后，按计划更新各执行节点的信息、负责人、跟进安排与动作。正式申请和审批仍在公司平台完成；本地不再要求重复提交 SSR 单或评审检查点。

```sh
cost-cli project get --project-id ID --section workflow-history --limit 20
cost-cli cost get --project-id ID --version Vn --section workflow
cost-cli ssr get --project-id ID --section submissions --id ACTUAL-SUBMISSION-ID
cost-cli project get --project-id ID --section reviews --id ACTUAL-REVIEW-ID
```

`workflow-history` 按最新在前返回 `id/costVersion/fromStepCode/toStepCode/owner/followUpDate/note/updatedAt`。只读需要的页，跟随 nextOffset，跨页 revision 变化时重读。`cost ... --section workflow` 用于旧版流程核查；不会把当前工作轮次切到该版。

原 SSR submissions/results/closures/followUps、投标答复及 reviewGates 保留为历史证据，只读查看；不再调用 `ssr submit/result/close/followup`，不通过 `ssr update` 或 `project update --section reviews` 写历史。结果、条件和原成本快照属于其保存版本，不能作为新版本已获审批的证明。

收到新的公司平台反馈，使用 `project workflow-action` 的 update 动作及 note/fields 记录原申请号、涉及版本和结果；只在用户确实要求更新当前轮次时调整当前节点。若反馈针对历史版本，备注明确版本，不把它描述成新轮次批准。
