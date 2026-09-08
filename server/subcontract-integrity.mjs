import { contentKey } from '../features/cpq/domain.ts';
import { WorkspaceValidationError } from './workspace-document.mjs';

/** Legacy RE rows remain evidence, but all new subcontract work uses a BOQ. */
export function assertLegacySubcontractTransition(previous, next) {
  // The create-only workspace import remains a compatibility path for archived
  // documents. Normal project creation starts with no cost rows.
  if (!previous) return;
  for (const version of next.costVersions) {
    const before = previous.costVersions.find((v) => v.code === version.code);
    const baseline =
      before ||
      previous.costVersions.find((v) => v.code === version.sourceVersion);
    const originalRows = new Map(
      (baseline?.costRows || []).map((row) => [row.id, row]),
    );
    const resources = new Map(
      (version.resourceTypes || next.resourceTypes).map((row) => [row.id, row]),
    );
    const originalResources = new Map(
      (baseline?.resourceTypes || previous.resourceTypes).map((row) => [
        row.id,
        row,
      ]),
    );
    for (const row of version.costRows) {
      const original = originalRows.get(row.id);
      const wasSubcontract =
        originalResources.get(original?.reTypeId)?.category === 'subcontract';
      const isSubcontract =
        resources.get(row.reTypeId)?.category === 'subcontract';
      if (
        (isSubcontract || wasSubcontract) &&
        (!original ||
          !wasSubcontract ||
          !isSubcontract ||
          contentKey(row) !== contentKey(original))
      )
        throw new WorkspaceValidationError(
          'Subcontract RE rows are legacy read-only costs. Enter new subcontract costs in the Subcon BOQ (cost --section subcontract); remove a legacy row explicitly when replacing it.',
          `/costVersions/${version.code}/costRows/${row.id}`,
        );
    }
  }
}

/** An older client omitting the extension cannot erase a captured BOQ. */
export function preserveSubcontractSnapshots(previous, next, submitted) {
  for (const version of next.costVersions) {
    const old = previous?.costVersions.find((v) => v.code === version.code);
    if (!Object.hasOwn(version, 'subcontractCost') && old?.subcontractCost)
      version.subcontractCost = structuredClone(old.subcontractCost);
  }
  const active = next.costVersions.find((v) => v.code === next.activeVersion);
  if (!Object.hasOwn(submitted, 'subcontractCost') && active?.subcontractCost)
    next.subcontractCost = structuredClone(active.subcontractCost);
}
