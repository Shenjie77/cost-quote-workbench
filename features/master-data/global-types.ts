/** Shared catalogs are source data; project and cost snapshots remain detached. */
export const GLOBAL_MASTER_DATA_TABS = [
  'resources',
  'subcontract',
  'supplemental',
  'maintenance',
  'assumptions',
  'quote-templates',
  'profit-share',
  'workflow',
  'status',
  'cpq-catalog',
] as const;

export type GlobalMasterDataTab = (typeof GLOBAL_MASTER_DATA_TABS)[number];

export type GlobalMasterDataSource = {
  kind?: 'project' | 'defaults' | 'global-update';
  projectId?: string;
  projectName?: string;
  revision?: number;
  updatedAt?: string;
};

export type GlobalMasterDataConflict<T = Record<string, unknown>> = {
  key: string;
  reason?: string;
  variants: { item: T; sources: GlobalMasterDataSource[] }[];
};

export type GlobalMasterDataRecord<T = Record<string, unknown>> = {
  scope: 'global';
  tab: GlobalMasterDataTab;
  keyField: 'id' | 'code';
  revision: number;
  updatedAt: string;
  initializedFrom: 'projects' | 'defaults';
  initializedAt: string;
  items: T[];
  conflicts: GlobalMasterDataConflict<T>[];
  sources: { key: string; sources: GlobalMasterDataSource[] }[];
  total: number;
  conflictTotal: number;
  offset: number;
  limit: number;
  nextOffset: number | null;
};

export type GlobalMasterDataChanges<T = Record<string, unknown>> = {
  /** Existing keys accept field updates; new keys and conflict resolutions need complete rows. */
  upsert?: (Partial<T> & Record<string, unknown>)[];
  remove?: string[];
};
