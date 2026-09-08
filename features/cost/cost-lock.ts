/** Cost finality belongs to a version; workflow progress never locks a project. */
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import { costBaselineKey } from '../cpq/domain.ts';
import { isApproved, openConditions } from '../ssr/domain.ts';

export type CostLock = { reason: string; lockedAt: string };
export type CostVersionLocks = Record<string, CostLock>;
type LockWorkspace = Pick<
  WorkbenchWorkspace,
  'costVersions' | 'processSteps' | 'reviewGates'
> &
  Partial<
    Pick<
      WorkbenchWorkspace,
      | 'activeVersion'
      | 'workflowVersion'
      | 'ssr'
      | 'costLock'
      | 'costVersionLocks'
    >
  >;

const isDrb = (code: string, name: string) =>
  /(^|[^A-Z])DRB([^A-Z]|$)/i.test(`${code} ${name}`);

/** Stable identities, used only to detect an actual completion transition. */
export function completedCostLockSteps(workspace: LockWorkspace): string[] {
  return [
    ...(workspace.reviewGates || [])
      .filter(
        (g) => g.status === 'completed' && isDrb(g.workflowStepCode, g.gate),
      )
      .map((g) => `review:${g.id}`),
    ...(workspace.processSteps || [])
      .filter(
        (s) =>
          s.state === 'completed' &&
          (isDrb(s.code, s.name) || s.code === 'COST_BASELINE_APPROVAL'),
      )
      .map((s) => `step:${s.code}`),
  ];
}

/** An existing map, including {}, marks the end of legacy project-lock inference. */
export function getCostVersionLocks(
  workspace: LockWorkspace,
): CostVersionLocks {
  const locks = { ...workspace.costVersionLocks };
  const versions = new Set(workspace.costVersions.map((v) => v.code));
  const add = (code: string | undefined, reason: string, lockedAt?: string) => {
    if (code && versions.has(code) && !locks[code])
      locks[code] = {
        reason,
        lockedAt:
          lockedAt ||
          workspace.costVersions.find((v) => v.code === code)?.createdAt ||
          '1970-01-01T00:00:00.000Z',
      };
  };
  for (const version of workspace.costVersions) {
    if (version.state === 'Confirmed')
      add(version.code, `成本已定稿（${version.code}），该版本成本已锁定。`);
  }
  for (const submission of workspace.ssr?.submissions || []) {
    if (
      submission.kind === 'DRB' &&
      isApproved(submission) &&
      openConditions(submission).length === 0
    ) {
      const code = submission.costBaseline.code;
      const current = workspace.costVersions.find((v) => v.code === code);
      // A late result for superseded inputs is still recorded, but does not
      // finalize a different set of costs under the same version number.
      if (
        !current ||
        current.state !== 'Confirmed' ||
        submission.costKey !== costBaselineKey(current)
      )
        continue;
      add(
        code,
        `DRB 已完成（${submission.applicationNumber}，${code}），该版本成本已锁定。`,
        [...submission.results, ...submission.closures]
          .map((r) => r.recordedAt)
          .sort()
          .at(-1),
      );
    }
  }
  if (workspace.costVersionLocks === undefined) {
    const legacy = workspace.costLock;
    const explicitCodes = legacy?.reason.match(/\bV[1-9][0-9]*\b/g) || [];
    // Old project locks may name only the application number. Preserve their
    // submitted version even when its current inputs have since diverged.
    for (const submission of workspace.ssr?.submissions || []) {
      if (
        submission.kind === 'DRB' &&
        isApproved(submission) &&
        openConditions(submission).length === 0
      ) {
        const code = submission.costBaseline.code;
        add(
          code,
          `历史 DRB 成本锁定（${code}），该版本成本已锁定。`,
          legacy?.lockedAt,
        );
      }
    }
    for (const code of explicitCodes)
      add(
        code,
        `历史成本锁定（${code}），该版本成本已锁定。`,
        legacy?.lockedAt,
      );
    if (legacy && Object.keys(locks).length === 1) {
      const code = Object.keys(locks)[0];
      locks[code] = { ...locks[code], lockedAt: legacy.lockedAt };
    }
    // Prefer explicit version evidence over a leftover completed project node.
    if (
      !Object.keys(locks).length &&
      (legacy || completedCostLockSteps(workspace).length)
    ) {
      const code = workspace.activeVersion || workspace.costVersions[0]?.code;
      add(
        code,
        `DRB / 成本基线已确认（${code}），该版本成本已锁定。`,
        legacy?.lockedAt,
      );
    }
  }
  return locks;
}

/** Server reconciliation preserves locks and binds new generic completion events once. */
export function reconcileCostVersionLocks(
  previous: LockWorkspace | null,
  next: LockWorkspace,
  timestamp: string,
): CostVersionLocks {
  const retained = previous
    ? getCostVersionLocks(previous)
    : getCostVersionLocks(next);
  const locks = getCostVersionLocks({ ...next, costVersionLocks: retained });
  // A completed DRB never converts or freezes a Draft. Explicit confirmation
  // creates the version lock; repository workflow guards enforce the prerequisite.
  for (const [code, lock] of Object.entries(locks)) {
    if (!retained[code]) locks[code] = { ...lock, lockedAt: timestamp };
  }
  return locks;
}

export function costLockReason(
  workspace: LockWorkspace,
  versionCode = workspace.activeVersion || workspace.costVersions[0]?.code,
): string | null {
  return getCostVersionLocks(workspace)[versionCode]?.reason || null;
}
