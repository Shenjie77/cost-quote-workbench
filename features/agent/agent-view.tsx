/** Live, deterministic daily digest generated from persisted project data. */

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Database,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import {
  buildDailyDigest,
  isDigestProjectCompleted,
  normalizeDigestDate,
  type DigestCategory,
} from '@/features/agent/digest-domain';
import type { Project } from '@/features/projects/types';
import type { ReviewGate } from '@/features/reviews/types';
import type {
  PanelState,
  StatusTone,
  ViewKey,
} from '@/features/workbench/types';

const groupDefinitions: Array<{
  category: DigestCategory;
  title: string;
  titleZh: string;
  tone: StatusTone;
  icon: typeof AlertTriangle;
}> = [
  {
    category: 'immediate_follow_up',
    title: 'Immediate Follow-up',
    titleZh: '需要立即跟进',
    tone: 'red',
    icon: AlertTriangle,
  },
  {
    category: 'decisions_due',
    title: 'Upcoming Follow-up',
    titleZh: '即将跟进',
    tone: 'amber',
    icon: Clock3,
  },
  {
    category: 'cost_attention',
    title: 'Cost Attention',
    titleZh: '成本关注',
    tone: 'blue',
    icon: TrendingUp,
  },
  {
    category: 'data_quality',
    title: 'Data Quality',
    titleZh: '数据质量',
    tone: 'gray',
    icon: Database,
  },
];

export function AgentView({
  projects,
  reviews,
  setView,
  setPanel,
  onSelectProject,
  onTrackWorkflow,
}: {
  projects: Project[];
  reviews: ReviewGate[];
  setView: (view: ViewKey) => void;
  setPanel: (panel: PanelState) => void;
  onSelectProject: (project: Project) => void;
  onTrackWorkflow?: (project: Project, nodeCode?: string) => void;
}) {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => clearInterval(timer);
  }, []);
  const asOf = normalizeDigestDate(undefined, new Date(now));
  const digest = useMemo(
    () =>
      buildDailyDigest(
        projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          client: project.client,
          projectStatus: project.projectStatus,
          activeVersion: project.version,
          versionState: project.versionState,
          totalCost: project.totalCost,
          totalQuote: project.totalQuote,
          incompleteCostRows: project.incompleteCostRows,
          ssrAttention: project.ssrAttention,
          workflowMode: project.workflowMode,
          workflowEngineVersion: project.workflowEngineVersion,
          workflowTemplateRevision: project.workflowTemplateRevision,
          workflowVersion: project.workflowVersion,
          workflowHold: project.workflowHold,
          currentWorkflowStepCode: project.currentWorkflowStepCode,
          workflowSteps: project.workflowSteps,
        })),
        reviews,
        asOf,
        now,
      ),
    [asOf, now, projects, reviews],
  );

  const engineMode = projects.some(
    (project) => project.workflowEngineVersion === 1,
  );
  const groups = [
    ...(engineMode
      ? [
          {
            id: 'urgent',
            title: 'Urgent',
            titleZh: '紧急处理',
            tone: 'red' as const,
            icon: AlertTriangle,
            items: digest.items.filter((item) => item.urgency === 'urgent'),
          },
          {
            id: 'immediate',
            title: 'Handle Now',
            titleZh: '马上处理',
            tone: 'amber' as const,
            icon: Clock3,
            items: digest.items.filter((item) => item.urgency === 'immediate'),
          },
          {
            id: 'normal',
            title: 'Normal Follow-up',
            titleZh: '普通跟进',
            tone: 'blue' as const,
            icon: ClipboardCheck,
            items: digest.items.filter((item) => item.urgency === 'normal'),
          },
        ]
      : []),
    ...groupDefinitions
      .map((group) => ({
        ...group,
        id: group.category,
        items: digest.items.filter(
          (item) => !item.urgency && item.category === group.category,
        ),
      }))
      .filter(
        (group) =>
          group.items.length ||
          (!engineMode &&
            ['immediate_follow_up', 'decisions_due'].includes(group.category)),
      ),
  ];

  /** Routes each digest exception back to the exact source record. */
  const openItem = (item: (typeof digest.items)[number]) => {
    const project = projects.find((entry) => entry.id === item.projectId);
    if (
      project &&
      onTrackWorkflow &&
      (project.workflowMode === 'project' || item.action === 'project')
    ) {
      onTrackWorkflow(project, item.workflowNodeId);
      return;
    }
    if (item.action === 'review') {
      const review = reviews.find(
        (entry) =>
          entry.projectId === item.projectId && entry.id === item.reviewId,
      );
      if (review)
        setPanel({ type: 'review', review, projectId: review.projectId });
      return;
    }
    if (!project) return;
    onSelectProject(project);
    setView(
      item.action === 'ssr'
        ? 'ssr'
        : item.action === 'cost'
          ? 'cost'
          : 'project',
    );
  };

  return (
    <div className="space-y-4">
      <section className="border border-[#c7d9d8] bg-[#edf4f3]">
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-md bg-[#225860] text-white">
              <Sparkles className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold text-[#225860]">
                Agent Digest · Project Follow-up
              </p>
              <p className="mt-1 text-[9px] text-[#557276]">
                按 Project Workflow 按节点 SLA
                和负责人跟进并行待办；节点关闭提醒或项目完成后停止提示。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone="green">
              <BiInline en="Live governed data" zh="实时受控数据" />
            </StatusBadge>
            <span className="financial-numeral text-[9px] text-[#557276]">
              As of {digest.asOf}
            </span>
          </div>
        </div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group, index) => {
          const Icon = group.icon;
          const items = group.items;
          return (
            <section key={group.id} className="border border-border bg-card">
              <SectionHeading
                index={'0' + (index + 1)}
                title={group.title}
                titleZh={group.titleZh}
                action={
                  <StatusBadge tone={group.tone}>
                    <BiInline
                      en={`${items.length} item${items.length === 1 ? '' : 's'}`}
                      zh={`${items.length} 项`}
                    />
                  </StatusBadge>
                }
              />
              <div className="divide-y divide-border">
                {items.length ? (
                  items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => openItem(item)}
                      className="flex w-full items-center gap-3 px-5 py-4 text-left text-xs hover:bg-[#f5f4ef]"
                    >
                      <Icon
                        className={`size-4 shrink-0 ${group.tone === 'red' ? 'text-[#ad4643]' : group.tone === 'amber' ? 'text-[#a36b18]' : group.tone === 'blue' ? 'text-[#376b8a]' : 'text-[#68737c]'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <BiText
                          en={item.title}
                          zh={item.titleZh}
                          className="font-medium"
                        />
                        <BiText
                          en={item.detail}
                          zh={item.detailZh}
                          className="mt-1 text-[9px] text-muted-foreground"
                        />
                      </span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ))
                ) : (
                  <div className="px-5 py-8 text-center text-[10px] text-muted-foreground">
                    No follow-ups in this category / 本分类暂无跟进事项
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <section className="border border-border bg-card">
        <SectionHeading
          index="03"
          title="Follow-up Rules"
          titleZh="跟进规则"
          description="Open an item to update the project workflow after checking the company platform."
          descriptionZh="查看公司系统后，点击提醒回到项目流程更新记录。"
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'Project Workflow',
              `${projects.length} projects`,
              '各并行节点与负责人',
            ],
            [
              'SLA',
              'Normal · Handle now · Urgent',
              '期限内普通、最后一天马上处理、超期紧急',
            ],
            [
              'Project On Hold',
              'All project monitoring paused',
              '项目挂起期间不监控；单个节点暂停仍按恢复跟进日期提醒',
            ],
            [
              'Quote completed',
              `${projects.filter((project) => isDigestProjectCompleted({ ...project, projectId: project.id })).length} completed projects`,
              '报价完成后不再提醒',
            ],
          ].map(([name, detail, detailZh]) => (
            <div key={name} className="bg-card p-4">
              <code className="financial-numeral text-[11px] font-semibold text-[#2e6f77]">
                {name}
              </code>
              <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
                {detail}
              </p>
              <p className="mt-1 text-[9px] text-muted-foreground">
                {detailZh}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
