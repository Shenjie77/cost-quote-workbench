/** Single maintenance surface: tab IDs are UI state, not persisted business data. */
export const masterDataTabs = [
  { value: 'cpq-catalog', label: 'CPQ Catalog', labelZh: 'CPQ 目录' },
  { value: 'resources', label: 'RE Types', labelZh: '资源与费率' },
  { value: 'subcontract', label: 'Subcontract', labelZh: '分包' },
  { value: 'supplemental', label: 'Supplemental', labelZh: '补充成本' },
  { value: 'maintenance', label: 'Maintenance', labelZh: '维保历史' },
  { value: 'assumptions', label: 'Assumptions', labelZh: '假设库' },
  { value: 'quote-templates', label: 'Quote Templates', labelZh: '报价模板' },
  { value: 'workflow', label: 'Workflow', labelZh: '流程节点' },
  { value: 'status', label: 'Status', labelZh: '状态节点' },
] as const;

export type MasterDataTab = (typeof masterDataTabs)[number]['value'];
export type QuoteMasterDataTab = Extract<
  MasterDataTab,
  'assumptions' | 'quote-templates'
>;

/** Guards values supplied by tab controls so unsupported destinations cannot open. */
export function isMasterDataTab(value: unknown): value is MasterDataTab {
  return masterDataTabs.some((tab) => tab.value === value);
}
