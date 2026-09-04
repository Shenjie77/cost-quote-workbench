/** Today workspace derived entirely from persisted portfolio and review data. */

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  ChevronRight,
  ClipboardCheck,
  FolderKanban,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { KpiCard } from '@/components/workbench/kpi-card';
import { SectionHeading } from '@/components/workbench/section-heading';
import {
  buildDailyDigest,
  normalizeDigestDate,
} from '@/features/agent/digest-domain';
import { ProjectTable } from '@/features/projects/project-table';
import type { Project, ProjectStatus } from '@/features/projects/types';
import { getReviewTiming, type ReviewGate } from '@/features/reviews/types';
import type { PanelState, ViewKey } from '@/features/workbench/types';
import { formatSgd } from '@/lib/formatters';

export function OverviewView({
  projects,
  reviews,
  setView,
  setPanel,
  onSelectProject,
  onOpenCost,
  onOpenQuote,
  onStatusChange,
  onWorkflowChange,
}: {
  projects: Project[];
  reviews: ReviewGate[];
  setView: (view: ViewKey) => void;
  setPanel: (panel: PanelState) => void;
  onSelectProject: (project: Project) => void;
  onOpenCost: (project: Project) => void;
  onOpenQuote: (project: Project) => void;
  onStatusChange: (project: Project, status: ProjectStatus) => void;
  onWorkflowChange: (project: Project, workflowCode: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const visibleProjects =
    statusFilter === 'all'
      ? projects
      : projects.filter((project) => project.projectStatus === statusFilter);
  const statusOptions = Array.from(
    new Map(
      projects
        .flatMap((project) => project.statusDefinitions || [])
        .map((status) => [status.code, status]),
    ).values(),
  );
  const openReviews = reviews.filter(
    (review) => review.status !== 'completed' && review.status !== 'cancelled',
  );
  const urgentReviews = openReviews
    .filter((review) => {
      const timing = getReviewTiming(review);
      return timing.overdue || timing.dueSoon || review.status === 'blocked';
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
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
        })),
        reviews,
        normalizeDigestDate(),
      ),
    [projects, reviews],
  );
  const portfolioCost = projects.reduce(
    (sum, project) => sum + Number(project.totalCost || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard
          label="Active Projects"
          labelZh="进行中项目"
          value={String(
            projects.filter(
              (project) =>
                !['completed', 'on_hold'].includes(project.projectStatus || ''),
            ).length,
          )}
          note={`${projects.length} local projects in total`}
          noteZh={`共 ${projects.length} 个本地项目`}
          icon={FolderKanban}
        />
        <KpiCard
          label="Current Cost Base"
          labelZh="当前成本规模"
          value={formatSgd(portfolioCost)}
          note="Current selected version of each project"
          noteZh="按各项目当前选中版本汇总"
          icon={BarChart3}
          tone="blue"
        />
        <KpiCard
          label="Review Gates"
          labelZh="待评审节点"
          value={String(openReviews.length)}
          note={`${urgentReviews.length} overdue, blocked, or due soon`}
          noteZh={`${urgentReviews.length} 项逾期、阻塞或临期`}
          icon={ClipboardCheck}
          tone="amber"
        />
        <KpiCard
          label="High-Risk Projects"
          labelZh="高风险项目"
          value={String(
            projects.filter((project) => project.risk === 'high').length,
          )}
          note="Manual project risk classification"
          noteZh="按项目风险标记统计"
          icon={AlertTriangle}
          tone="red"
        />
      </div>
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.72fr)_390px]">
        <section className="overflow-hidden border border-border bg-card">
          <SectionHeading
            index="01"
            title="Project Portfolio"
            titleZh="项目组合"
            description="Current SQLite values with direct status and workflow control."
            descriptionZh="展示 SQLite 当前值，并可直接控制状态与流程。"
            action={
              <div className="flex items-center gap-2">
                <Select
                  value={statusFilter}
                  onValueChange={(value) => setStatusFilter(value ?? 'all')}
                >
                  <SelectTrigger size="sm" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses / 全部状态</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status.code} value={status.code}>
                        {status.name} / {status.nameZh}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('project')}
                >
                  Open list <ChevronRight />
                </Button>
              </div>
            }
          />
          <ProjectTable
            projects={visibleProjects}
            onProject={(project) => {
              onSelectProject(project);
              setView('project');
            }}
            onCost={onOpenCost}
            onQuote={onOpenQuote}
            onStatusChange={onStatusChange}
            onWorkflowChange={onWorkflowChange}
          />
          <div className="border-t border-border bg-[#f7f5f0] px-4 py-3 text-xs text-muted-foreground">
            Showing {visibleProjects.length} of {projects.length} local projects
            / 显示 {visibleProjects.length} 个项目
          </div>
        </section>
        <div className="space-y-4">
          <section className="border border-border bg-card">
            <SectionHeading
              index="02"
              title="Urgent Reviews"
              titleZh="紧急评审"
              description="Overdue, blocked, and due within three days."
              descriptionZh="逾期、阻塞及三天内到期节点。"
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('reviews')}
                >
                  View all <ChevronRight />
                </Button>
              }
            />
            <div className="divide-y divide-border">
              {urgentReviews.length ? (
                urgentReviews.slice(0, 4).map((review) => {
                  const project = projects.find(
                    (item) => item.id === review.projectId,
                  );
                  const timing = getReviewTiming(review);
                  return (
                    <button
                      key={review.id}
                      onClick={() =>
                        setPanel({
                          type: 'review',
                          review,
                          projectId: review.projectId,
                        })
                      }
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f5f4ef]"
                    >
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${timing.tone === 'red' ? 'bg-[#ad4643]' : 'bg-[#a36b18]'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold">
                            {review.gate}
                          </span>
                          <span
                            className={`financial-numeral shrink-0 text-[10px] ${timing.overdue ? 'text-[#ad4643]' : 'text-muted-foreground'}`}
                          >
                            {review.dueDate}
                          </span>
                        </span>
                        <span className="mt-1 block truncate text-[9px] text-muted-foreground">
                          {review.gateZh} · {project?.name || review.projectId}
                        </span>
                        <span className="mt-1.5 block text-[10px] text-muted-foreground">
                          {timing.en} · Owner {review.owner}
                        </span>
                      </span>
                      <ChevronRight className="mt-0.5 size-3.5 text-muted-foreground" />
                    </button>
                  );
                })
              ) : (
                <div className="px-4 py-10 text-center text-[10px] text-muted-foreground">
                  No urgent review gates / 暂无紧急评审
                </div>
              )}
            </div>
            <button
              onClick={() => setView('reviews')}
              className="flex w-full items-center justify-center gap-1 border-t border-border px-4 py-3 text-xs font-medium text-[#2e6f77] hover:bg-[#f5f4ef]"
            >
              Open review queue <span className="text-[9px]">查看评审队列</span>
              <ArrowRight className="size-3.5" />
            </button>
          </section>
          <section className="border border-[#b9cece] bg-[#edf4f3]">
            <div className="flex items-center justify-between border-b border-[#c7d9d8] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#225860]">
                <Sparkles className="size-4" />
                Daily Agent Digest{' '}
                <span className="text-[9px] font-normal">每日摘要</span>
              </div>
              <span className="financial-numeral text-[10px] text-[#557276]">
                {digest.asOf}
              </span>
            </div>
            <div className="space-y-3 p-4">
              {digest.items.length ? (
                digest.items.slice(0, 3).map((item) => (
                  <div key={item.id} className="flex gap-2.5">
                    <AlertTriangle
                      className={`mt-0.5 size-4 shrink-0 ${item.severity === 'red' ? 'text-[#ad4643]' : item.severity === 'amber' ? 'text-[#a36b18]' : 'text-[#376b8a]'}`}
                    />
                    <div>
                      <p className="text-xs font-semibold leading-5">
                        {item.title}
                      </p>
                      <p className="text-[9px] text-muted-foreground">
                        {item.detailZh}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-[#355e62]">
                  No exceptions found / 当前没有异常事项
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full border-[#aac4c4] bg-[#f7fbfa] text-[#225860]"
                onClick={() => setView('agent')}
              >
                Open full digest{' '}
                <span className="text-[9px] opacity-60">完整摘要</span>
                <ArrowRight />
              </Button>
            </div>
          </section>
        </div>
      </div>
      <section className="border border-border bg-card">
        <SectionHeading
          index="03"
          title="Project Status Distribution"
          titleZh="项目状态分布"
          description="Counts use the editable Status definitions, independent of workflow nodes."
          descriptionZh="按可编辑的项目状态统计，与流程节点独立。"
        />
        <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-5">
          {statusOptions.slice(0, 10).map((status) => {
            const count = projects.filter(
              (project) => project.projectStatus === status.code,
            ).length;
            return (
              <button
                key={status.code}
                onClick={() => setStatusFilter(status.code)}
                className="group relative px-5 py-4 text-left hover:bg-[#f5f4ef]"
              >
                <span className="financial-numeral text-xl font-semibold text-[#173a52]">
                  {count}
                </span>
                <span className="mt-1 block text-xs font-semibold">
                  {status.name}
                </span>
                <span className="mt-1 block text-[9px] text-muted-foreground">
                  {status.nameZh}
                </span>
                <ChevronRight className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#b4b0a6]" />
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
