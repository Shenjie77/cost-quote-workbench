import type { CostInputRow, ResourceType } from './domain.ts';
import { isLegacySubcontractRow } from './personnel-cost-rows.ts';

export type PersonnelRowMove = {
  rowId: string;
  targetRowId?: string;
  position: 'before' | 'after' | 'group-end';
  groupName?: string;
};

export type PersonnelGroupRename = {
  groupName: string;
  nextGroupName: string;
  rowIds: string[];
};

const groupOf = (row: CostInputRow) => row.groupName?.trim() || '';
const validGroup = (groupName: string) =>
  Array.from(groupName.trim()).length <= 200;

/** Reorder personnel slots without moving or rewriting legacy Subcon entries. */
function replacePersonnelSlots(
  current: CostInputRow[],
  personnel: CostInputRow[],
  resources: ResourceType[],
) {
  let index = 0;
  return current.map((row) =>
    isLegacySubcontractRow(row, resources) ? row : personnel[index++],
  );
}

/** Uses the latest rows so a drag never replaces newer amounts or import provenance. */
export function movePersonnelRow(
  current: CostInputRow[],
  resources: ResourceType[],
  move: PersonnelRowMove,
  locked = false,
): CostInputRow[] | null {
  if (locked || (move.groupName !== undefined && !validGroup(move.groupName)))
    return null;
  const personnel = current.filter(
    (row) => !isLegacySubcontractRow(row, resources),
  );
  const row = personnel.find((entry) => entry.id === move.rowId);
  if (!row) return null;
  const groupName = move.groupName?.trim();
  const rest = personnel.filter((entry) => entry.id !== row.id);
  let insertion: number;
  if (move.position === 'group-end') {
    if (groupName === undefined) return null;
    const members = personnel.filter((entry) => groupOf(entry) === groupName);
    if (!members.length) return null;
    const last = rest.findLastIndex((entry) => groupOf(entry) === groupName);
    if (last < 0) return current;
    insertion = last + 1;
  } else {
    if (move.targetRowId === row.id) return current;
    const target = rest.findIndex((entry) => entry.id === move.targetRowId);
    if (target < 0) return null;
    // A target that changed groups since rendering must be reviewed again.
    if (groupName !== undefined && groupOf(rest[target]) !== groupName)
      return null;
    insertion = target + (move.position === 'after' ? 1 : 0);
  }
  const moved =
    groupName === undefined || groupOf(row) === groupName
      ? row
      : { ...row, groupName };
  rest.splice(insertion, 0, moved);
  return replacePersonnelSlots(current, rest, resources);
}

/** Rename only the confirmed group membership; concurrent cell edits remain intact. */
export function renamePersonnelGroup(
  current: CostInputRow[],
  resources: ResourceType[],
  request: PersonnelGroupRename,
  locked = false,
): CostInputRow[] | null {
  if (locked || !validGroup(request.nextGroupName) || !request.rowIds.length)
    return null;
  const groupName = request.groupName.trim();
  const nextGroupName = request.nextGroupName.trim();
  const ids = new Set(request.rowIds);
  const members = current.filter(
    (row) =>
      !isLegacySubcontractRow(row, resources) && groupOf(row) === groupName,
  );
  if (
    ids.size !== request.rowIds.length ||
    members.length !== ids.size ||
    members.some((row) => !ids.has(row.id))
  )
    return null;
  if (groupName === nextGroupName) return current;
  return current.map((row) =>
    ids.has(row.id) ? { ...row, groupName: nextGroupName } : row,
  );
}
