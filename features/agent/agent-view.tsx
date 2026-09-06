/** Live, deterministic daily digest generated from persisted project data. */

import { useMemo } from 'react';
import {
  AlertTriangle,
  ChevronRight,
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
    title: 'Decisions Due',
    titleZh: '临期决策',
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
}: {
  projects: Project[];
  reviews: ReviewGate[];
  setView: (view: ViewKey) => void;
  setPanel: (panel: PanelState) => void;
  onSelectProject: (project: Project) => void;
}) {
  const asOf = normalizeDigestDate();
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
        })),
        reviews,
        asOf,
      ),
    [asOf, projects, reviews],
  );

  /** Routes each digest exception back to the exact source record. */
  const openItem = (item: (typeof digest.items)[number]) => {
    const project = projects.find((entry) => entry.id === item.projectId);
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
                Agent Digest · Daily Exception Summary
              </p>
              <p className="mt-1 text-[9px] text-[#557276]">
                从本地 SQLite 项目、评审、版本状态和成本完整度实时生成。
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
        {groupDefinitions.map((group, index) => {
          const Icon = group.icon;
          const items = digest.items.filter(
            (item) => item.category === group.category,
          );
          return (
            <section
              key={group.category}
              className="border border-border bg-card"
            >
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
                    No exceptions in this category / 本分类暂无异常
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <section className="border border-border bg-card">
        <SectionHeading
          index="05"
          title="Digest Evidence"
          titleZh="摘要依据"
          description="Every item links back to a persisted source; the same digest is available through CLI."
          descriptionZh="每条摘要均可回到持久化来源，同一摘要也可通过 CLI 查询。"
        />
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {[
            [
              'project_summary',
              `${projects.length} projects`,
              '项目状态、成本版本与金额',
            ],
            [
              'review_gates_due',
              `${reviews.length} review gates`,
              '评审期限、负责人和跟进历史',
            ],
            [
              'cost_version_state',
              `${projects.filter((project) => project.versionState === 'Draft').length} draft baselines`,
              '成本版本确认状态',
            ],
            [
              'data_quality_flags',
              `${projects.reduce((sum, project) => sum + Number(project.incompleteCostRows || 0), 0)} incomplete rows`,
              '成本输入完整度异常',
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
