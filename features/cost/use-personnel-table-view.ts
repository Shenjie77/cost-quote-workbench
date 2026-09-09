import { useState } from 'react';
import { usePersonnelColumns } from './personnel-columns';
import type { PersonnelTableLayout } from './personnel-table-layout';

/** One view model shared by the grid and Simple Export, retained across cost tabs. */
export function usePersonnelTableView() {
  const [grouped, setGrouped] = useState(false);
  const [yearIndex, setYearIndex] =
    useState<PersonnelTableLayout['yearIndex']>('all');
  const columnSettings = usePersonnelColumns();
  const layout: PersonnelTableLayout = {
    grouped,
    yearIndex,
    columns: columnSettings.columns,
  };
  return { layout, columnSettings, setGrouped, setYearIndex };
}

export type PersonnelTableView = ReturnType<typeof usePersonnelTableView>;
