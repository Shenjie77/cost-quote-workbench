import { HR_COST } from '../../lib/business-labels.ts';
import type { ViewKey } from './types.ts';
import type { CostViewKey } from '../cost/ui-types.ts';
/** The production shell and review-entry redirects share this complete navigation contract. */
export const workbenchDestinations: {
  id: string;
  view: ViewKey;
  costView?: CostViewKey;
  en: string;
  zh: string;
  group?: 'workspace' | 'project' | 'global';
}[] = [
  {
    id: 'today',
    view: 'overview',
    en: 'Today',
    zh: '今日工作',
    group: 'workspace',
  },
  { id: 'projects', view: 'project', en: 'Projects', zh: '项目列表' },
  {
    id: 'workflow',
    view: 'workflow',
    en: 'Workflow',
    zh: '项目流程',
    group: 'project',
  },
  {
    id: 'cost',
    view: 'cost',
    costView: 'input',
    en: HR_COST.en,
    zh: HR_COST.zh,
  },
  {
    id: 'subcon',
    view: 'cost',
    costView: 'subcontract',
    en: 'Subcontract',
    zh: '分包成本',
  },
  {
    id: 'summary',
    view: 'cost',
    costView: 'summary',
    en: 'Cost summary',
    zh: '成本汇总',
  },
  {
    id: 'compare',
    view: 'cost',
    costView: 'compare',
    en: 'Version comparison',
    zh: '版本对比',
  },
  { id: 'quote', view: 'quote', en: 'Pricing & quote', zh: '定价与报价' },
  { id: 'cpq', view: 'cpq', en: 'CPQ configuration', zh: 'CPQ 配置' },
  { id: 'maintenance', view: 'maintenance', en: 'Maintenance', zh: '维保报价' },
  {
    id: 'drafts',
    view: 'calculation',
    en: 'Calculation drafts',
    zh: '公式草稿',
  },
  { id: 'files', view: 'files', en: 'Project files', zh: '项目文件' },
  { id: 'agent', view: 'agent', en: 'Reminders', zh: '提醒与跟进' },
  {
    id: 'master',
    view: 'master-data',
    en: 'Master data',
    zh: '主数据',
    group: 'global',
  },
];
export function workbenchEntry(hash: string) {
  return workbenchDestinations.find((item) => `#${item.id}` === hash);
}
