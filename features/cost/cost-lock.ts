/** Project cost finality shared by UI and repository; ordinary workflow edits cannot unlock it. */
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import { isApproved, openConditions } from '../ssr/domain.ts';

export type CostLock = { reason: string; lockedAt: string };
export function costLockReason(
  workspace: Pick<
    WorkbenchWorkspace,
    'costVersions' | 'processSteps' | 'reviewGates'
  > & { ssr?: WorkbenchWorkspace['ssr']; costLock?: CostLock },
): string | null {
  // v0.4.0 persisted wording incorrectly included the editable RE catalogue.
  if (workspace.costLock)
    return workspace.costLock.reason.replace(
      '项目成本及 RE 费率已锁定',
      '项目成本已锁定',
    );
  const finalized = workspace.costVersions.find((v) => v.state === 'Confirmed');
  if (finalized) return `成本已定稿（${finalized.code}），项目成本已锁定。`;
  const drb = workspace.ssr?.submissions.find(
    (s) => s.kind === 'DRB' && isApproved(s) && openConditions(s).length === 0,
  );
  if (drb) return `DRB 已完成（${drb.applicationNumber}），项目成本已锁定。`;
  const isDrb = (code: string, name: string) =>
    /(^|[^A-Z])DRB([^A-Z]|$)/i.test(`${code} ${name}`);
  if (
    workspace.reviewGates?.some(
      (g) => g.status === 'completed' && isDrb(g.workflowStepCode, g.gate),
    )
  )
    return 'DRB 评审节点已完成，项目成本已锁定。';
  if (
    workspace.processSteps.some(
      (s) =>
        s.state === 'completed' &&
        (isDrb(s.code, s.name) || s.code === 'COST_BASELINE_APPROVAL'),
    )
  )
    return 'DRB / 成本基线确认节点已完成，项目成本已锁定。';
  return null;
}
