import type { CostInputRow, ResourceType } from './domain.ts';

/** Legacy package costs stay visible in Subcon while personnel editors use RE Types. */
export const isLegacySubcontractRow = (
  row: CostInputRow,
  resources: ResourceType[],
) =>
  resources.find((resource) => resource.id === row.reTypeId)?.category ===
  'subcontract';

export function updatePersonnelCostRows(
  current: CostInputRow[],
  resources: ResourceType[],
  change: CostInputRow[] | ((rows: CostInputRow[]) => CostInputRow[]),
): CostInputRow[] {
  const personnel = current.filter(
    (row) => !isLegacySubcontractRow(row, resources),
  );
  const next = typeof change === 'function' ? change(personnel) : change;
  if (next.some((row) => isLegacySubcontractRow(row, resources)))
    throw new Error('Enter subcontract costs in the Subcon tab.');
  const originals = new Set(current.map((row) => row.id));
  const updates = new Map(next.map((row) => [row.id, row]));
  if (
    current.some(
      (row) => isLegacySubcontractRow(row, resources) && updates.has(row.id),
    )
  )
    throw new Error('A personnel row cannot replace a saved subcontract line.');
  return [
    ...current.flatMap((row) =>
      isLegacySubcontractRow(row, resources)
        ? [row]
        : updates.has(row.id)
          ? [updates.get(row.id)!]
          : [],
    ),
    ...next.filter((row) => !originals.has(row.id)),
  ];
}
