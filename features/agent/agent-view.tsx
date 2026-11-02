import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
import { Button } from '@/components/ui/button';
/** Live, deterministic daily digest generated from persisted project data. */

import { AiOutputPanel } from '@/features/ai-output/ai-output-panel';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Database,
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

/** Present actionable digest groups first and keep monitoring rules available on demand. */
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
    <Surface as="div" variant="page">
      <Surface as="section" variant="panel">
        <Surface as="div" variant="toolbar" className="justify-between">
          <div className="flex items-center gap-3">
            <div>
              <Text as="p" tone="primary" textRole="body-main">
                Agent Digest · Project Follow-up
              </Text>
              <Text as="p" tone="muted" textRole="body-small" className="mt-1">
                按 Project Workflow 按节点 SLA
                和负责人跟进并行待办；节点关闭提醒或项目完成后停止提示。
              </Text>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="green">
              <BiInline en="Live governed data" zh="实时受控数据" />
            </StatusBadge>
            <Text
              as="span"
              tone="muted"
              textRole="body-small"
              className="financial-numeral"
            >
              As of {digest.asOf}
            </Text>
          </div>
        </Surface>
      </Surface>
      <AiOutputPanel digest={digest} openItem={openItem} />
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group, index) => {
          const Icon = group.icon;
          const items = group.items;
          return (
            <Surface key={group.id} as="section" variant="panel">
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
              <Surface as="div" variant="list">
                {items.length ? (
                  items.map((item) => (
                    <Button
                      variant="ghost"
                      key={item.id}
                      onClick={() => openItem(item)}
                      type="button"
                      className="flex w-full items-start gap-2 text-left focus-visible:-outline-offset-2"
                    >
                      <Icon
                        aria-hidden="true"
                        className="mt-1 size-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <BiText en={item.title} zh={item.titleZh} />
                        <BiText
                          en={item.detail}
                          zh={item.detailZh}
                          className="mt-1"
                        />
                      </span>
                      <Text as={ChevronRight} tone="muted" className="size-4" />
                    </Button>
                  ))
                ) : (
                  <Surface as="div" variant="empty">
                    No follow-ups in this category / 本分类暂无跟进事项
                  </Surface>
                )}
              </Surface>
            </Surface>
          );
        })}
      </div>
      <Disclosure>
        {/* Stable help stays accessible without pushing the task list below another large card. */}
        <DisclosureSummary className="min-h-8 cursor-pointer">
          Follow-up Rules · 跟进规则
        </DisclosureSummary>
        <SectionHeading
          index="03"
          title="Follow-up Rules"
          titleZh="跟进规则"
          description="Open an item to update the project workflow after checking the company platform."
          descriptionZh="查看公司系统后，点击提醒回到项目流程更新记录。"
        />
        <Surface
          as="div"
          variant="inset"
          className="grid gap-px sm:grid-cols-2 xl:grid-cols-4"
        >
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
            <Surface key={name} as="div" variant="panel" padded>
              <Surface
                as="code"
                tone="primary"
                textRole="body-small"
                className="financial-numeral"
              >
                {name}
              </Surface>
              <Text as="p" tone="muted" textRole="body-small" className="mt-1">
                {detail}
              </Text>
              <Text as="p" tone="muted" textRole="body-small" className="mt-1">
                {detailZh}
              </Text>
            </Surface>
          ))}
        </Surface>
      </Disclosure>
    </Surface>
  );
}
