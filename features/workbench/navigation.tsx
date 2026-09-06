/** Bilingual navigation and page-title metadata for the application shell. */

import {
  BarChart3,
  Bot,
  ClipboardCheck,
  Database,
  FolderKanban,
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
    description: 'Portfolio & status',
    descriptionZh: '项目组合与状态',
    icon: FolderKanban,
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
    key: 'ssr',
    label: 'SSR Workflow',
    labelZh: 'SSR 流程',
    description: 'Submissions and results',
    descriptionZh: '送审、结果与条件关闭',
    icon: ClipboardCheck,
  },
  {
    key: 'reviews',
    label: 'Reviews',
    labelZh: '评审与跟进',
    description: 'Gates & owners',
    descriptionZh: '节点与责任人',
    icon: ClipboardCheck,
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
    subtitle:
      'Resolve blockers and due reviews before moving cost versions forward.',
    subtitleZh: '先处理阻塞和临期评审，再推进成本版本。',
  },
  project: {
    eyebrow: 'PORTFOLIO / LOCAL PROJECTS',
    title: 'Project List',
    titleZh: '项目列表',
    subtitle: 'Edit project status and open cost or quote workspaces.',
    subtitleZh: '集中维护项目状态，并进入成本或报价工作区。',
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
    eyebrow: 'DATA / PROJECT LIBRARIES',
    title: 'Master Data',
    titleZh: '基础数据管理',
    subtitle:
      'Maintain this project’s reference data, assumptions and customer templates in one place.',
    subtitleZh: '统一维护当前项目的基础数据、假设库与客户模板。',
  },
};
