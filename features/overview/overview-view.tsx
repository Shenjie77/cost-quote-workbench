/** Today workspace derived entirely from persisted portfolio and review data. */

import { useEffect, useMemo, useState } from 'react';
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
  groupDigestItemsByProject,
  normalizeDigestDate,
  isDigestProjectCompleted,
} from '@/features/agent/digest-domain';
import { ProjectTable } from '@/features/projects/project-table';
import {
  buildWorkflowDistribution,
  currentProjectWorkflowNodeCodes,
} from './workflow-distribution';
import type {
  Project,
  ProjectStatus,
  WorkflowStep,
} from '@/features/projects/types';
import type { ReviewGate } from '@/features/reviews/types';
import type { PanelState, ViewKey } from '@/features/workbench/types';
import { formatSgd } from '@/lib/formatters';

/** Prioritize current workflow tasks, followed by portfolio totals and project details. */
export function OverviewView({
  projects,
  reviews,
  setView,
  onSelectProject,
  onOpenCost,
  onOpenQuote,
  onTrackWorkflow,
  workflowDefinitions,
  workflowDefinitionRevision,
  workflowDefinitionError,
}: {
  workflowDefinitions?: WorkflowStep[];
  workflowDefinitionRevision?: number;
  workflowDefinitionError?: string;
  projects: Project[];
  reviews: ReviewGate[];
  setView: (view: ViewKey) => void;
  setPanel: (panel: PanelState) => void;
  onSelectProject: (project: Project) => void;
  onOpenCost: (project: Project) => void;
  onOpenQuote: (project: Project) => void;
  onStatusChange?: (project: Project, status: ProjectStatus) => void;
  onWorkflowChange?: (project: Project, workflowCode: string) => void;
  onTrackWorkflow?: (project: Project, nodeCode?: string) => void;
}) {
  const [workflowFilter, setWorkflowFilter] = useState('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 60000);
    return () => clearInterval(timer);
  }, []);
  const distribution = buildWorkflowDistribution(projects, workflowDefinitions);
  const workflowOptions = [...distribution.nodes, ...distribution.retained];
  const activeWorkflowFilter = workflowOptions.some(
    (entry) => entry.step.code === workflowFilter,
  )
    ? workflowFilter
    : 'all';
  // Pending tiles and the portfolio share the same recorded task membership.
  const selectedWorkflow = workflowOptions.find(
    (entry) => entry.step.code === activeWorkflowFilter,
  );
  const pendingTaskCount = workflowOptions.reduce(
    (total, entry) => total + entry.pendingCount,
    0,
  );
  const visibleProjects =
    activeWorkflowFilter === 'all'
      ? projects
      : projects.filter((project) =>
          pendingOnly
            ? selectedWorkflow?.pendingProjectIds.includes(project.id)
            : currentProjectWorkflowNodeCodes(project).includes(
                activeWorkflowFilter,
              ),
        );
  const digest = useMemo(
    () =>
      buildDailyDigest(
        projects.map((project) => ({
          projectId: project.id,
          name: project.name,
          client: project.client,
          projectStatus: project.projectStatus,
          workflowMode: project.workflowMode,
          workflowHold: project.workflowHold,
          workflowEngineVersion: project.workflowEngineVersion,
          workflowTemplateRevision: project.workflowTemplateRevision,
          workflowVersion: project.workflowVersion,
          currentWorkflowStepCode: project.currentWorkflowStepCode,
          workflowSteps: project.workflowSteps,
          activeVersion: project.version,
          versionState: project.versionState,
          totalCost: project.totalCost,
          totalQuote: project.totalQuote,
          incompleteCostRows: project.incompleteCostRows,
        })),
        reviews,
        normalizeDigestDate(undefined, new Date(now)),
        now,
      ),
    [now, projects, reviews],
  );
  const followUpProjects = groupDigestItemsByProject(digest.items);
  const portfolioCost = projects.reduce(
    (sum, project) => sum + Number(project.totalCost || 0),
    0,
  );

  return (
    <div className="wb-page-stack">
      {/* Keep pending counts above the KPI cards and preserve published workflow order. */}
      <section
        className="wb-panel overflow-hidden"
        aria-label="Project Workflow Distribution"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              Project Workflow Distribution
            </h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              当前待办 · 含待启动，点击流程查看项目
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-800"
              title="Current unresolved tasks and the next ready phase; completed rounds and projects on hold are excluded."
            >
              {pendingTaskCount} Pending
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setWorkflowFilter('all');
                setPendingOnly(false);
              }}
            >
              All projects
            </Button>
            {workflowDefinitionRevision !== undefined && (
              <span className="text-[10px] text-muted-foreground">
                Published workflow · Revision {workflowDefinitionRevision}
              </span>
            )}
          </div>
        </div>
        {workflowDefinitionError && (
          <output className="block border-b px-4 py-2 text-xs text-amber-800">
            {workflowDefinitionError}
          </output>
        )}
        <WorkflowDistributionNodes
          entries={distribution.nodes}
          selectedCode={pendingOnly ? activeWorkflowFilter : undefined}
          onSelect={(code) => {
            setWorkflowFilter(code);
            setPendingOnly(true);
          }}
        />
        {distribution.retained.length > 0 && (
          <div className="border-t border-border">
            <p className="px-4 pt-2 text-[10px] text-muted-foreground">
              Other recorded nodes · Retained progress from earlier workflow
              definitions
            </p>
            <WorkflowDistributionNodes
              entries={distribution.retained}
              selectedCode={pendingOnly ? activeWorkflowFilter : undefined}
              onSelect={(code) => {
                setWorkflowFilter(code);
                setPendingOnly(true);
              }}
            />
          </div>
        )}
      </section>
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Active Projects"
          labelZh="进行中项目"
          value={String(
            projects.filter(
              (project) =>
                !project.workflowHold &&
                !isDigestProjectCompleted({
                  ...project,
                  projectId: project.id,
                }),
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
          label="Projects to Follow Up"
          labelZh="待跟进项目"
          value={String(followUpProjects.length)}
          note="Based on workflow tasks, upcoming starts and their SLA"
          noteZh="按项目待办、待启动节点及 SLA 提醒配置判断"
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
      <div className="grid min-w-0 gap-6">
        <section className="wb-panel overflow-hidden">
          <SectionHeading
            index="01"
            title="Project Portfolio"
            titleZh="项目组合"
            description="One workflow record for each project."
            descriptionZh="统一登记项目流程、负责人和跟进日期。"
            action={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Select
                  value={activeWorkflowFilter}
                  onValueChange={(value) => {
                    setWorkflowFilter(value ?? 'all');
                    setPendingOnly(false);
                  }}
                >
                  <SelectTrigger size="sm" className="w-full min-w-44 sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      All workflows / 全部流程
                    </SelectItem>
                    {workflowOptions.map(({ step, legacy }) => (
                      <SelectItem key={step.code} value={step.code}>
                        {step.name || step.nameZh}
                        {legacy ? ' (recorded node)' : ''}
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
            onTrackWorkflow={onTrackWorkflow}
          />
          <div className="border-t border-border bg-[#f6f8fa] px-4 py-3 text-xs text-muted-foreground">
            {pendingOnly && activeWorkflowFilter !== 'all' ? 'Pending · ' : ''}
            Showing {visibleProjects.length} of {projects.length} local projects
            / 显示 {visibleProjects.length} 个项目
          </div>
        </section>
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          <section className="wb-panel overflow-hidden">
            <SectionHeading
              index="02"
              title="Project Follow-ups"
              titleZh="项目跟进"
              description="Projects grouped by their most urgent active task."
              descriptionZh="查看公司平台后，在同一项目流程中登记更新。"
            />
            <div className="divide-y divide-border">
              {followUpProjects.length ? (
                followUpProjects.slice(0, 4).map((group) => {
                  const project = projects.find(
                    (entry) => entry.id === group.projectId,
                  );
                  return (
                    <details
                      key={group.projectId}
                      data-workflow-project-group={group.projectId}
                      className="group px-5 py-4 transition-colors open:bg-muted/25"
                      open={group.severity === 'red'}
                    >
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
                        <span
                          className={`size-2 shrink-0 rounded-full ${group.severity === 'red' ? 'bg-[#ad4643]' : group.severity === 'amber' ? 'bg-[#a36b18]' : 'bg-[#376b8a]'}`}
                        />
                        <span className="min-w-0 flex-1 font-semibold">
                          {project?.name || group.projectId}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {group.severity === 'red'
                            ? '紧急'
                            : group.severity === 'amber'
                              ? '马上处理'
                              : '普通跟进'}{' '}
                          · {group.items.length} 个待办节点
                        </span>
                        <ChevronRight className="size-3.5 group-open:rotate-90" />
                      </summary>
                      <div className="mt-3 space-y-1 pl-5">
                        {group.items.map((item) => (
                          <button
                            key={item.id}
                            aria-label={`更新流程节点 ${item.titleZh}`}
                            onClick={() => {
                              if (!project) return;
                              if (onTrackWorkflow)
                                onTrackWorkflow(project, item.workflowNodeId);
                              else {
                                onSelectProject(project);
                                setView('project');
                              }
                            }}
                            className="block w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[#f0f5f7] focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="block text-xs font-medium">
                              {item.titleZh}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                              {item.detailZh}
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  );
                })
              ) : (
                <div className="wb-empty-state">
                  No projects need follow-up / 当前没有需要跟进的项目
                </div>
              )}
            </div>
            <button
              onClick={() => setView('project')}
              className="flex w-full items-center justify-center gap-1 border-t border-border px-4 py-3 text-xs font-medium text-[#177c80] hover:bg-[#f0f5f7]"
            >
              Open project list{' '}
              <span className="text-[11px]">查看项目列表</span>
              <ArrowRight className="size-3.5" />
            </button>
          </section>
          <section className="overflow-hidden rounded-xl border border-[#cce2e1] bg-[#eff8f7] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d6e8e7] px-5 py-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#225860]">
                <Sparkles className="size-4" />
                Daily Agent Digest{' '}
                <span className="text-[11px] font-normal">每日摘要</span>
              </div>
              <span className="financial-numeral text-[11px] text-[#557276]">
                {digest.asOf}
              </span>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm leading-6 text-[#355e62]">
                {followUpProjects.length} 个项目、{digest.items.length}{' '}
                个节点需要跟进。Agent 按各并行节点的 SLA
                和跟进安排提醒，阶段衔接时提示待启动；项目完成后停止提醒。
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-1 w-full border-[#aac4c4] bg-[#f7fbfa] text-[#225860]"
                onClick={() => setView('agent')}
              >
                Open full digest{' '}
                <span className="text-[11px] opacity-60">完整摘要</span>
                <ArrowRight />
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** Render compact task-count filters without changing the configured node order. */
export function WorkflowDistributionNodes({
  entries,
  onSelect,
  selectedCode,
}: {
  entries: ReturnType<typeof buildWorkflowDistribution>['nodes'];
  onSelect: (code: string) => void;
  selectedCode?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 xl:grid-cols-5">
      {entries.map(({ step, pendingCount, legacy }) => (
        <button
          key={step.code}
          type="button"
          data-workflow-distribution-node={step.code}
          data-recorded-node={legacy || undefined}
          aria-label={`${step.name || step.nameZh}: ${pendingCount} pending tasks`}
          aria-pressed={selectedCode === step.code}
          title={`${step.name || step.nameZh} · ${pendingCount} Pending${step.parallelGroup ? ` · Parallel · ${step.parallelGroup}` : ''}`}
          onClick={() => onSelect(step.code)}
          className={`grid min-h-16 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${
            selectedCode === step.code
              ? 'border-primary bg-accent ring-1 ring-primary/20'
              : pendingCount > 0
                ? 'border-amber-200 bg-amber-50/70 hover:border-amber-400'
                : 'border-border bg-muted/20 hover:border-ring/40 hover:bg-accent/50'
          }`}
        >
          <span
            className={`row-span-2 text-xl font-semibold tabular-nums ${pendingCount > 0 ? 'text-amber-800' : 'text-muted-foreground/70'}`}
          >
            {pendingCount}
          </span>
          <span className="text-[11px] font-semibold leading-4 [overflow-wrap:anywhere]">
            {step.name || step.nameZh}
          </span>
          {step.name && step.nameZh && (
            <span className="col-start-2 text-[10px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
              {step.nameZh}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
