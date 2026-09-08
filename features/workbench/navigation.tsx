/** Bilingual navigation and page-title metadata for the application shell. */

import {
  BarChart3,
  Bot,
  Database,
  FolderKanban,
  ListChecks,
  LayoutDashboard,
  WalletCards,
} from 'lucide-react';
import type { ViewKey } from '@/features/workbench/types';

export const navItems: Array<{
  key: ViewKey;
  label: string;
  labelZh: string;
  description: string;
  descriptionZh: string;
  icon: typeof LayoutDashboard;
}> = [
  {
    key: 'overview',
    label: 'Today',
    labelZh: '今日工作台',
    description: 'Projects & exceptions',
    descriptionZh: '项目与异常',
    icon: LayoutDashboard,
  },
  {
    key: 'project',
    label: 'Project List',
    labelZh: '项目列表',
    description: 'Project workflow & follow-up',
    descriptionZh: '项目流程与跟进',
    icon: FolderKanban,
  },
  {
    key: 'workflow',
    label: 'Project Workflow',
    labelZh: '',
    description: 'Current tasks & progress',
    descriptionZh: '',
    icon: ListChecks,
  },
  {
    key: 'cost',
    label: 'Cost Workspace',
    labelZh: '成本工作区',
    description: 'Input, versions & views',
    descriptionZh: '录入、版本与汇总',
    icon: BarChart3,
  },
  {
    key: 'quote',
    label: 'Pricing & Quote',
    labelZh: '定价与报价',
    description: 'Confirm then output',
    descriptionZh: '确认后输出',
    icon: WalletCards,
  },
  {
    key: 'cpq',
    label: 'CPQ Configuration',
    labelZh: 'CPQ 配置',
    description: 'Match, confirm, calculate',
    descriptionZh: '筛选、确认与配量',
    icon: WalletCards,
  },
  {
    key: 'maintenance',
    label: 'Maintenance BOQ',
    labelZh: '维保 BOQ',
    description: 'Equipment and references',
    descriptionZh: '设备、客户参考与报价草稿',
    icon: Database,
  },
  {
    key: 'agent',
    label: 'Agent Digest',
    labelZh: 'Agent 摘要',
    description: 'Daily consolidated view',
    descriptionZh: '每日统一提醒',
    icon: Bot,
  },
  {
    key: 'master-data',
    label: 'Master Data',
    labelZh: '基础数据',
    description: 'Rates, assumptions & templates',
    descriptionZh: '资源、参考价格、假设与客户模板',
    icon: Database,
  },
];

export const viewTitles: Record<
  ViewKey,
  {
    eyebrow: string;
    title: string;
    titleZh: string;
    subtitle: string;
    subtitleZh: string;
  }
> = {
  maintenance: {
    eyebrow: 'BOQ / MAINTENANCE',
    title: 'Maintenance BOQ',
    titleZh: '维保设备配置',
    subtitle: 'Compare the same model per device and year.',
    subtitleZh: '按同型号、每台每年对比客户参考，并记录配置依据。',
  },
  ssr: {
    eyebrow: 'SSR / WORKFLOW',
    title: 'SSR Workflow',
    titleZh: 'SSR 送审与结果',
    subtitle: 'Track evidence, conditions and follow-ups.',
    subtitleZh: '登记公司评审记录、关闭条件并跟进责任人。',
  },
  cpq: {
    eyebrow: 'CPQ / CONFIGURATION',
    title: 'CPQ Configuration',
    titleZh: 'CPQ 条目配置',
    subtitle:
      'Select catalog items, lock equipment quantities and allocate service costs.',
    subtitleZh: '确认条目、锁定设备数量并匹配服务成本。',
  },
  overview: {
    eyebrow: 'WORKSPACE / TODAY',
    title: 'Today Workspace',
    titleZh: '今日工作台',
    subtitle: 'Follow up on project stages and record company-system progress.',
    subtitleZh: '跟进项目当前阶段，并登记公司平台的实际进展。',
  },
  project: {
    eyebrow: 'PORTFOLIO / LOCAL PROJECTS',
    title: 'Project List',
    titleZh: '项目列表',
    subtitle:
      'Record project workflow and follow-up, then open cost or quote workspaces.',
    subtitleZh: '统一登记项目流程和跟进记录，并进入成本或报价工作区。',
  },
  workflow: {
    eyebrow: 'PROJECT / WORKFLOW',
    title: 'Project Workflow',
    titleZh: '',
    subtitle: 'Work on one task at a time and keep the full process in view.',
    subtitleZh: '',
  },
  cost: {
    eyebrow: 'COST / PRJ-2026-018',
    title: 'Cost Workspace',
    titleZh: '成本工作区',
    subtitle:
      'Build a traceable and reviewable cost baseline from project inputs.',
    subtitleZh: '从项目输入形成可追溯、可评审的成本基线。',
  },
  quote: {
    eyebrow: 'PRICING / PRJ-2026-018',
    title: 'Pricing & Quote',
    titleZh: '定价与报价',
    subtitle: 'Create customer output only from a confirmed cost version.',
    subtitleZh: '仅使用已确认成本版本生成客户输出。',
  },
  reviews: {
    eyebrow: 'GOVERNANCE / ALL PROJECTS',
    title: 'Reviews & Follow-up',
    titleZh: '评审与跟进',
    subtitle: 'Track overdue, due soon, blocked, and stale workflow gates.',
    subtitleZh: '统一查看逾期、临期、阻塞和长期未更新节点。',
  },
  agent: {
    eyebrow: 'AGENT / DAILY DIGEST',
    title: 'Agent Daily Digest',
    titleZh: 'Agent 每日摘要',
    subtitle: 'Every recommendation is grounded in recorded project data.',
    subtitleZh: '所有判断均来自平台记录，并保留可查看的依据。',
  },
  'master-data': {
    eyebrow: 'DATA / GLOBAL LIBRARIES',
    title: 'Master Data',
    titleZh: '基础数据管理',
    subtitle:
      'Maintain global reference data, assumptions and customer templates for future projects.',
    subtitleZh: '统一维护供未来项目采用的全局基础数据、假设库与客户模板。',
  },
};
