/** Suspended drafts can leave the working list without losing their provenance. */
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
import type { CostVersionSnapshot } from './domain.ts';
import type { VersionWorkflowSnapshot } from './version-workflow.ts';
import { migrateVersionWorkflows } from './version-workflow.ts';
import { costLockReason } from './cost-lock.ts';
import { contentKey } from '../cpq/domain.ts';

export type DeletedCostVersion = {
  version: CostVersionSnapshot;
  workflow: VersionWorkflowSnapshot;
  removedAt: string;
};
export type DeletedCostVersions = Record<string, DeletedCostVersion>;
type VersionCollection = Pick<
  WorkbenchWorkspace,
  'costVersions' | 'deletedCostVersions'
>;
const rank = (code: string) => BigInt(code.slice(1));
const topSnapshot = (w: WorkbenchWorkspace): VersionWorkflowSnapshot => ({
  currentWorkflowStepCode: w.currentWorkflowStepCode,
  processSteps: structuredClone(w.processSteps),
  projectStatus: w.projectStatus,
});

export function nextCostVersionCode(workspace: VersionCollection): string {
  const highest = [
    ...workspace.costVersions.map((v) => v.code),
    ...Object.keys(workspace.deletedCostVersions || {}),
  ].reduce((max, code) => (rank(code) > max ? rank(code) : max), BigInt(0));
  if (highest >= BigInt(Number.MAX_SAFE_INTEGER))
    throw new TypeError('Cost version number is too large.');
  return `V${highest + BigInt(1)}`;
}

export function costVersionDeletionReason(
  workspace: WorkbenchWorkspace,
  code: string,
): string | null {
  const version = workspace.costVersions.find((v) => v.code === code);
  if (!version) return '成本版本不存在或已删除。';
  const locked = costLockReason(workspace, code);
  if (locked) return locked;
  if (version.state !== 'Suspended')
    return '只有 Suspended（已暂停）的成本版本可以删除。';
  if (workspace.costVersions.length <= 1)
    return '项目至少需要保留一个成本版本。';
  return null;
}

/** Returns a detached canonical projection; no costs or review evidence are recalculated. */
export function deleteSuspendedCostVersion(
  workspace: WorkbenchWorkspace,
  code: string,
  removedAt = new Date().toISOString(),
): WorkbenchWorkspace {
  const reason = costVersionDeletionReason(workspace, code);
  if (reason) throw new TypeError(reason);
  const w = migrateVersionWorkflows(workspace);
  const version = w.costVersions.find((v) => v.code === code)!;
  w.deletedCostVersions = {
    ...w.deletedCostVersions,
    [code]: {
      version: structuredClone(version),
      workflow: structuredClone(
        w.workflowVersion === code ? topSnapshot(w) : w.versionWorkflows![code],
      ),
      removedAt,
    },
  };
  w.costVersions = w.costVersions.filter((v) => v.code !== code);
  const highest = w.costVersions.reduce((a, b) =>
    rank(a.code) > rank(b.code) ? a : b,
  );
  if (w.activeVersion === code) {
    w.activeVersion = highest.code;
    for (const field of [
      'costRows',
      'rateSettings',
      'travelSettings',
      'travelRows',
      'travelUplift',
      'manualCosts',
    ] as const)
      Object.assign(w, { [field]: structuredClone(highest[field]) });
  }
  if (w.workflowVersion === code) {
    w.versionWorkflows![code] = structuredClone(
      w.deletedCostVersions[code].workflow,
    );
    w.workflowVersion = highest.code;
    Object.assign(w, structuredClone(w.versionWorkflows![highest.code]));
    w.selectedStep = Math.max(
      0,
      w.processSteps.findIndex((s) => s.code === w.currentWorkflowStepCode),
    );
  }
  return w;
}

/** Repository boundary: an arbitrary workspace save cannot erase or fabricate history. */
export function assertCostVersionDeletionTransition(
  previous: WorkbenchWorkspace | null,
  next: WorkbenchWorkspace,
): boolean {
  const oldArchive = previous?.deletedCostVersions || {};
  const archive = next.deletedCostVersions || {};
  for (const [code, entry] of Object.entries(oldArchive)) {
    if (contentKey(archive[code]) !== contentKey(entry))
      throw new TypeError(`已删除成本 ${code} 的历史快照不能修改或移除。`);
    if (next.costVersions.some((v) => v.code === code))
      throw new TypeError(`成本编号 ${code} 已归档，不能重复使用。`);
  }
  const removed =
    previous?.costVersions.filter(
      (v) => !next.costVersions.some((n) => n.code === v.code),
    ) || [];
  for (const code of Object.keys(archive)) {
    if (!oldArchive[code] && !removed.some((v) => v.code === code))
      throw new TypeError('删除归档必须对应本次移除的既有成本版本。');
  }
  if (!removed.length) return false;
  let expected = previous!;
  for (const version of removed) {
    const entry = archive[version.code];
    if (!entry) throw new TypeError('删除成本版本必须保留完整历史快照。');
    expected = deleteSuspendedCostVersion(
      expected,
      version.code,
      entry.removedAt,
    );
  }
  for (const field of [
    'costVersions',
    'deletedCostVersions',
    'activeVersion',
    'costRows',
    'rateSettings',
    'travelSettings',
    'travelRows',
    'travelUplift',
    'manualCosts',
    'workflowVersion',
    'processSteps',
    'currentWorkflowStepCode',
    'selectedStep',
    'projectStatus',
    'versionWorkflows',
    'legacyWorkflowArchive',
    'reviewGates',
    'ssr',
    'cpq',
    'quoteHistory',
    'maintenanceBoq',
    'costVersionLocks',
  ] as const) {
    if (contentKey(next[field]) !== contentKey(expected[field]))
      throw new TypeError(
        `删除成本版本时必须保留其余成本与历史记录（${field}）。`,
      );
  }
  return true;
}
