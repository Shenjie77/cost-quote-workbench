/** Shared personnel presentation rules for the inline grid and Excel export. */
import type { CostInputRow } from './domain.ts';
import type { PersonnelColumnId } from './personnel-columns.ts';

export type PersonnelTableLayout = {
  grouped: boolean;
  columns: PersonnelColumnId[];
  yearIndex: 0 | 1 | 2 | 3 | 4 | 'all';
};
export type PersonnelAnnualColumn = {
  index: number;
  field: 'sites' | 'mandays' | 'cost';
};
export type PersonnelHeaderSegment = {
  ids: PersonnelColumnId[];
  index?: number;
};
export const UNASSIGNED_PERSONNEL_GROUP = 'Unassigned Group';

export function getPersonnelAnnualColumn(
  id: PersonnelColumnId,
): PersonnelAnnualColumn | null {
  const match = /^Y([1-5]):(sites|mandays|cost)$/.exec(id);
  return match
    ? {
        index: Number(match[1]) - 1,
        field: match[2] as PersonnelAnnualColumn['field'],
      }
    : null;
}

export const getPersonnelAnnualColumnLabel = (
  field: PersonnelAnnualColumn['field'],
) =>
  field === 'sites' ? 'Sites' : field === 'mandays' ? 'Mandays' : 'Cost (SGD)';

/** Preserve visible order; year focus never silently reveals a hidden column. */
export function resolvePersonnelTableColumns(
  columns: PersonnelColumnId[],
  yearIndex: PersonnelTableLayout['yearIndex'],
): PersonnelColumnId[] {
  const visible = [...new Set(columns)].filter((id) => {
    const annual = getPersonnelAnnualColumn(id);
    return (
      id !== 'action' &&
      (yearIndex === 'all' || !annual || annual.index === yearIndex)
    );
  });
  return [...visible, 'action'];
}

/** Merge only adjacent annual columns from the same year; split segments repeat the year. */
export function getPersonnelHeaderSegments(
  columns: PersonnelColumnId[],
): PersonnelHeaderSegment[] {
  const segments: PersonnelHeaderSegment[] = [];
  for (const id of columns) {
    const annual = getPersonnelAnnualColumn(id);
    const previous = segments.at(-1);
    if (annual && previous?.index === annual.index) previous.ids.push(id);
    else
      segments.push({ ids: [id], ...(annual ? { index: annual.index } : {}) });
  }
  return segments;
}

/** Group names are independent of Scope; first-seen groups and their row order are retained. */
export function groupPersonnelRows(
  rows: CostInputRow[],
): { groupName: string; rows: CostInputRow[] }[] {
  const groups = new Map<string, { groupName: string; rows: CostInputRow[] }>();
  for (const row of rows) {
    const groupName = (row.groupName || '').trim();
    const group = groups.get(groupName);
    if (group) group.rows.push(row);
    else groups.set(groupName, { groupName, rows: [row] });
  }
  return [...groups.values()];
}
