/** Browser-only grid preferences. Simple Export captures them without changing cost inputs. */
import { useEffect, useState } from 'react';

type PersonnelYearId = 'Y1' | 'Y2' | 'Y3' | 'Y4' | 'Y5';
export type PersonnelColumnId =
  | 'groupName'
  | 'scope'
  | 'bu'
  | 'reType'
  | 'mdPerSite'
  | 'totalSites'
  | 'totalMd'
  | 'totalCost'
  | `${PersonnelYearId}:${'sites' | 'mandays' | 'cost'}`
  | 'check'
  | 'action';
export type PersonnelColumnSpec = {
  id: PersonnelColumnId;
  label: string;
  hideable: boolean;
  yearIndex?: number;
};
export type PersonnelColumnPreferences = {
  version: 1;
  order: PersonnelColumnId[];
  hidden: PersonnelColumnId[];
};
export const PERSONNEL_COLUMNS_STORAGE_KEY =
  'cost-workbench:personnel-columns:v1';
export const PERSONNEL_COLUMN_SPECS: readonly PersonnelColumnSpec[] = [
  { id: 'groupName', label: 'Group', hideable: true },
  { id: 'scope', label: 'Scope', hideable: true },
  { id: 'bu', label: 'BU', hideable: true },
  { id: 'reType', label: 'RE Type', hideable: true },
  { id: 'mdPerSite', label: 'MD/Site', hideable: true },
  { id: 'totalSites', label: 'Total Sites', hideable: true },
  { id: 'totalMd', label: 'Total MD', hideable: true },
  { id: 'totalCost', label: 'Total Cost', hideable: true },
  ...(['Y1', 'Y2', 'Y3', 'Y4', 'Y5'] as const).flatMap((year, yearIndex) => [
    {
      id: `${year}:sites` as const,
      label: `${year} · Sites`,
      hideable: true,
      yearIndex,
    },
    {
      id: `${year}:mandays` as const,
      label: `${year} · MD`,
      hideable: true,
      yearIndex,
    },
    {
      id: `${year}:cost` as const,
      label: `${year} · Cost`,
      hideable: true,
      yearIndex,
    },
  ]),
  { id: 'check', label: 'Check', hideable: true },
  { id: 'action', label: 'Action', hideable: false },
];
const ids = PERSONNEL_COLUMN_SPECS.map((column) => column.id);
const knownIds = new Set<string>(ids);
const isData = (id: PersonnelColumnId) => id !== 'check' && id !== 'action';
export const getPersonnelColumnSpec = (
  id: PersonnelColumnId,
): PersonnelColumnSpec =>
  PERSONNEL_COLUMN_SPECS.find((column) => column.id === id)!;

export function defaultPersonnelColumns(): PersonnelColumnPreferences {
  return { version: 1, order: [...ids], hidden: [] };
}

/** Salvage known column preferences; append newly added columns and keep utilities accessible. */
export function normalizePersonnelColumns(
  value: unknown,
): PersonnelColumnPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return defaultPersonnelColumns();
  const data = value as Partial<PersonnelColumnPreferences>;
  if (
    data.version !== 1 ||
    !Array.isArray(data.order) ||
    !Array.isArray(data.hidden) ||
    data.order.some((id) => typeof id !== 'string') ||
    data.hidden.some((id) => typeof id !== 'string')
  )
    return defaultPersonnelColumns();
  const order: PersonnelColumnId[] = [
    ...new Set([...data.order.filter((id) => knownIds.has(id)), ...ids]),
  ].filter((id) => id !== 'action');
  order.push('action');
  let hidden = [
    ...new Set(data.hidden.filter((id) => knownIds.has(id) && id !== 'action')),
  ];
  if (!order.some((id) => isData(id) && !hidden.includes(id)))
    hidden = hidden.filter((id) => id !== 'groupName');
  return { version: 1, order, hidden };
}

/** All years remain in preference order; the table applies its current Y1–Y5 focus. */
export function visiblePersonnelColumns(
  value: PersonnelColumnPreferences,
): PersonnelColumnId[] {
  const preferences = normalizePersonnelColumns(value);
  return preferences.order.filter((id) => !preferences.hidden.includes(id));
}

export function setPersonnelColumnVisible(
  value: PersonnelColumnPreferences,
  id: PersonnelColumnId,
  visible: boolean,
): PersonnelColumnPreferences {
  const preferences = normalizePersonnelColumns(value);
  if (!knownIds.has(id) || id === 'action') return preferences;
  if (
    !visible &&
    isData(id) &&
    !preferences.order.some(
      (candidate) =>
        candidate !== id &&
        isData(candidate) &&
        !preferences.hidden.includes(candidate),
    )
  )
    return preferences;
  return {
    ...preferences,
    hidden: visible
      ? preferences.hidden.filter((candidate) => candidate !== id)
      : [...new Set([...preferences.hidden, id])],
  };
}

export function movePersonnelColumn(
  value: PersonnelColumnPreferences,
  id: PersonnelColumnId,
  direction: 'left' | 'right',
): PersonnelColumnPreferences {
  const preferences = normalizePersonnelColumns(value);
  const from = preferences.order.indexOf(id);
  const to = from + (direction === 'left' ? -1 : 1);
  if (
    id === 'action' ||
    from < 0 ||
    to < 0 ||
    to >= preferences.order.length - 1
  )
    return preferences;
  const order = [...preferences.order];
  [order[from], order[to]] = [order[to], order[from]];
  return { ...preferences, order };
}

export function loadPersonnelColumns(
  storage: Pick<Storage, 'getItem'>,
): PersonnelColumnPreferences {
  try {
    const stored = storage.getItem(PERSONNEL_COLUMNS_STORAGE_KEY);
    return stored && stored.length <= 20000
      ? normalizePersonnelColumns(JSON.parse(stored))
      : defaultPersonnelColumns();
  } catch {
    return defaultPersonnelColumns();
  }
}
export function savePersonnelColumns(
  storage: Pick<Storage, 'setItem'>,
  value: PersonnelColumnPreferences,
): boolean {
  try {
    storage.setItem(
      PERSONNEL_COLUMNS_STORAGE_KEY,
      JSON.stringify(normalizePersonnelColumns(value)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Start with identical SSR/client markup; hydrate local preferences only after mounting. */
export function usePersonnelColumns() {
  const [preferences, setPreferences] = useState(defaultPersonnelColumns);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      try {
        setPreferences(loadPersonnelColumns(window.localStorage));
      } catch {
        setStorageAvailable(false);
      }
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    let available = false;
    let cancelled = false;
    try {
      available = savePersonnelColumns(window.localStorage, preferences);
    } catch {
      available = false;
    }
    queueMicrotask(() => {
      if (!cancelled) setStorageAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, [preferences, ready]);
  return {
    preferences,
    columns: visiblePersonnelColumns(preferences),
    ready,
    storageAvailable,
    setVisible: (id: PersonnelColumnId, visible: boolean) => {
      if (ready)
        setPreferences((current) =>
          setPersonnelColumnVisible(current, id, visible),
        );
    },
    move: (id: PersonnelColumnId, direction: 'left' | 'right') => {
      if (ready)
        setPreferences((current) =>
          movePersonnelColumn(current, id, direction),
        );
    },
    reset: () => {
      if (ready) setPreferences(defaultPersonnelColumns());
    },
  };
}
