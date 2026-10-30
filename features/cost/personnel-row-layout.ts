import type { CostInputRow, ResourceType } from './domain.ts';
import { isLegacySubcontractRow } from './personnel-cost-rows.ts';
import { groupPersonnelRows } from './personnel-table-layout.ts';

export type PersonnelGroupMove = {
  groupName: string;
  targetGroupName: string;
  direction: 'up' | 'down';
  rowIds: string[];
};

/** Move complete adjacent groups, retaining member order, latest values and legacy Subcon slots. */
export function movePersonnelGroup(
  current: CostInputRow[],
  resources: ResourceType[],
  request: PersonnelGroupMove,
  locked = false,
): CostInputRow[] | null {
  if (locked) return null;
  const groups = groupPersonnelRows(
    current.filter((row) => !isLegacySubcontractRow(row, resources)),
  );
  const index = groups.findIndex(
    (group) => group.groupName === request.groupName.trim(),
  );
  if (index < 0) return null;
  const ids = new Set(request.rowIds);
  if (
    ids.size !== request.rowIds.length ||
    groups[index].rows.length !== ids.size ||
    groups[index].rows.some((row) => !ids.has(row.id))
  )
    return null;
  const target = index + (request.direction === 'up' ? -1 : 1);
  if (
    !groups[target] ||
    groups[target].groupName !== request.targetGroupName.trim()
  )
    return null;
  [groups[index], groups[target]] = [groups[target], groups[index]];
  return replacePersonnelSlots(
    current,
    groups.flatMap((group) => group.rows),
    resources,
  );
}

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

export type PersonnelGroupCategoryChange = {
  groupName: string;
  rowIds: string[];
  category: string;
};

/** Apply a category to the rendered group membership, preserving newer cost inputs. */
export function setPersonnelGroupCategory(
  current: CostInputRow[],
  resources: ResourceType[],
  request: PersonnelGroupCategoryChange,
  locked = false,
): CostInputRow[] | null {
  const category = request.category.trim();
  if (locked || Array.from(category).length > 120 || !request.rowIds.length)
    return null;
  const ids = new Set(request.rowIds);
  const members = current.filter(
    (row) =>
      !isLegacySubcontractRow(row, resources) &&
      (row.groupName?.trim() || '') === request.groupName.trim(),
  );
  if (
    ids.size !== request.rowIds.length ||
    members.length !== ids.size ||
    members.some((row) => !ids.has(row.id))
  )
    return null;
  return current.map((row) => (ids.has(row.id) ? { ...row, category } : row));
}

const groupOf = (row: CostInputRow) => row.groupName?.trim() || '';
const validGroup = (groupName: string) =>
  Array.from(groupName.trim()).length <= 200;

export type PersonnelGroupCopy = {
  groupName: string;
  nextGroupName: string;
  rowIds: string[];
  newRowIds: string[];
};

export function nextPersonnelGroupCopyName(
  rows: CostInputRow[],
  groupName: string,
): string {
  const names = new Set(rows.map(groupOf));
  const base = groupName.trim() || 'Unassigned Group';
  for (let index = 1; ; index += 1) {
    const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
    const name = `${Array.from(base)
      .slice(0, 200 - suffix.length)
      .join('')}${suffix}`;
    if (!names.has(name)) return name;
  }
}

/** Copy current raw inputs, never displayed travel allocations or imported-row identity. */
export function copyPersonnelGroup(
  current: CostInputRow[],
  resources: ResourceType[],
  request: PersonnelGroupCopy,
  locked = false,
): CostInputRow[] | null {
  const name = request.nextGroupName.trim();
  if (locked || !name || !validGroup(name) || !request.rowIds.length)
    return null;
  const personnel = current.filter(
    (row) => !isLegacySubcontractRow(row, resources),
  );
  const members = personnel.filter(
    (row) => groupOf(row) === request.groupName.trim(),
  );
  const ids = new Set(request.rowIds);
  const newIds = new Set(request.newRowIds);
  if (
    personnel.some((row) => groupOf(row) === name) ||
    ids.size !== request.rowIds.length ||
    members.length !== ids.size ||
    members.some((row) => !ids.has(row.id)) ||
    newIds.size !== members.length ||
    request.newRowIds.length !== members.length ||
    request.newRowIds.some((id) => !id.trim()) ||
    current.some((row) => newIds.has(row.id))
  )
    return null;
  const copies = members.map((row, index) => {
    const copy = structuredClone(row);
    copy.id = request.newRowIds[index];
    copy.groupName = name;
    // Duplicates are independent manual inputs; re-import must only match the original.
    delete copy.source;
    return copy;
  });
  const insertion = current.findLastIndex((row) => ids.has(row.id)) + 1;
  return [
    ...current.slice(0, insertion),
    ...copies,
    ...current.slice(insertion),
  ];
}

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
