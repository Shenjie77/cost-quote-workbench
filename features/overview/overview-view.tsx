/** Today workspace derived entirely from persisted portfolio and review data. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { workflowStateLabels } from '@/features/projects/workflow-constants';
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
  const [pendingWorkflowCode, setPendingWorkflowCode] = useState<string | null>(
    null,
  );
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
  // The portfolio keeps its historical position filter; pending tiles open task operations.
  const pendingWorkflow = workflowOptions.find(
    (entry) => entry.step.code === pendingWorkflowCode,
  );
  const pendingTaskCount = workflowOptions.reduce(
    (total, entry) => total + entry.pendingCount,
    0,
  );
  const visibleProjects =
    activeWorkflowFilter === 'all'
      ? projects
      : projects.filter((project) =>
          currentProjectWorkflowNodeCodes(project).includes(
            activeWorkflowFilter,
          ),
        );

  /** Close the chooser before opening the existing project/node operation route. */
  const openWorkflowTask = (project: Project, nodeCode: string) => {
    setPendingWorkflowCode(null);
    if (onTrackWorkflow) onTrackWorkflow(project, nodeCode);
    else {
      onSelectProject(project);
      setView('project');
    }
  };

  /** Resolve the tile's recorded pending membership without changing project state. */
  const selectPendingWorkflow = (code: string) => {
    const entry = workflowOptions.find((option) => option.step.code === code);
    if (entry)
      openPendingWorkflowTasks(
        entry,
        projects,
        openWorkflowTask,
        setPendingWorkflowCode,
      );
  };
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
    <div className="wb-page-stack gap-3">
      {/* Put actionable pending counts first and preserve published workflow order. */}
      <section
        className="wb-panel overflow-hidden"
        aria-label="Project Workflow Distribution"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">
              Project Workflow Distribution
            </h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold tabular-nums text-amber-800"
              title="Current unresolved tasks and the next ready phase; completed rounds and projects on hold are excluded."
            >
              {pendingTaskCount} Pending
            </span>
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
          onSelect={selectPendingWorkflow}
        />
        {distribution.retained.length > 0 && (
          <div className="border-t border-border">
            <p className="px-4 pt-2 text-[10px] text-muted-foreground">
              Other recorded nodes · Retained progress from earlier workflow
              definitions
            </p>
            <WorkflowDistributionNodes
              entries={distribution.retained}
              onSelect={selectPendingWorkflow}
            />
          </div>
        )}
      </section>
      {/* Keep portfolio totals in one scan line instead of four tall decorative cards. */}
      <dl
        className="flex flex-wrap items-center gap-x-6 gap-y-2 px-1 py-1 text-xs"
        aria-label="Portfolio summary"
      >
        <div
          className="flex items-baseline gap-2"
          title={`${projects.length} local projects in total / 共 ${projects.length} 个本地项目`}
        >
          <dt className="text-muted-foreground">
            Active Projects <span className="sr-only">进行中项目</span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {
              projects.filter(
                (project) =>
                  !project.workflowHold &&
                  !isDigestProjectCompleted({
                    ...project,
                    projectId: project.id,
                  }),
              ).length
            }
          </dd>
        </div>
        <div
          className="flex items-baseline gap-2"
          title="Current selected version of each project / 按各项目当前选中版本汇总"
        >
          <dt className="text-muted-foreground">
            Current Cost Base <span className="sr-only">当前成本规模</span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {formatSgd(portfolioCost)}
          </dd>
        </div>
        <div
          className="flex items-baseline gap-2"
          title="Based on workflow tasks, upcoming starts and their SLA / 按待办、待启动节点及 SLA 提醒配置判断"
        >
          <dt className="text-muted-foreground">
            Projects to Follow Up <span className="sr-only">待跟进项目</span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {followUpProjects.length}
          </dd>
        </div>
        <div
          className="flex items-baseline gap-2"
          title="Manual project risk classification / 按项目风险标记统计"
        >
          <dt className="text-muted-foreground">
            High-Risk Projects <span className="sr-only">高风险项目</span>
          </dt>
          <dd className="font-semibold tabular-nums">
            {projects.filter((project) => project.risk === 'high').length}
          </dd>
        </div>
      </dl>
      {/* Multiple projects require a visible choice; each row opens its exact workflow node. */}
      <Dialog
        open={Boolean(pendingWorkflow)}
        onOpenChange={(open) => {
          if (!open) setPendingWorkflowCode(null);
        }}
      >
        <DialogContent className="gap-3 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {pendingWorkflow?.step.name || pendingWorkflow?.step.nameZh}
            </DialogTitle>
            <DialogDescription>
              Pending tasks · 选择项目直接处理当前节点
            </DialogDescription>
          </DialogHeader>
          {pendingWorkflow && (
            <WorkflowPendingTaskList
              entry={pendingWorkflow}
              projects={projects}
              onOpenTask={openWorkflowTask}
            />
          )}
        </DialogContent>
      </Dialog>
      <div className="grid min-w-0 gap-3">
        <section className="wb-panel overflow-hidden">
          <SectionHeading
            index="01"
            title="Project Portfolio"
            titleZh="项目组合"
            action={
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <Select
                  value={activeWorkflowFilter}
                  onValueChange={(value) => {
                    setWorkflowFilter(value ?? 'all');
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
          <div className="border-t border-border bg-[#f6f8fa] px-3 py-2 text-xs text-muted-foreground">
            Showing {visibleProjects.length} of {projects.length} local projects
            / 显示 {visibleProjects.length} 个项目
          </div>
        </section>
        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          <section className="wb-panel overflow-hidden">
            <SectionHeading
              index="02"
              title="Project Follow-ups"
              titleZh="项目跟进"
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
                      className="group px-3 py-2.5 transition-colors open:bg-muted/25"
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
                      <div className="mt-2 space-y-1 pl-5">
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
              className="flex w-full items-center justify-center gap-1 border-t border-border px-3 py-2 text-xs font-medium text-[#177c80] hover:bg-[#f0f5f7]"
            >
              Open project list{' '}
              <span className="text-[11px]">查看项目列表</span>
              <ArrowRight className="size-3.5" />
            </button>
          </section>
          <section className="overflow-hidden rounded-xl border border-[#cce2e1] bg-[#eff8f7] shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d6e8e7] px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#225860]">
                <Sparkles className="size-4" />
                Daily Agent Digest{' '}
                <span className="text-[11px] font-normal">每日摘要</span>
              </div>
              <span className="financial-numeral text-[11px] text-[#557276]">
                {digest.asOf}
              </span>
            </div>
            <div className="space-y-3 p-3">
              <p className="text-xs leading-5 text-[#355e62]">
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

/** Render compact task launchers; nodes with no pending work cannot open a task. */
export function WorkflowDistributionNodes({
  entries,
  onSelect,
}: {
  entries: ReturnType<typeof buildWorkflowDistribution>['nodes'];
  onSelect: (code: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3 xl:grid-cols-5">
      {entries.map(({ step, pendingCount, legacy }) => (
        <button
          key={step.code}
          type="button"
          data-workflow-distribution-node={step.code}
          data-recorded-node={legacy || undefined}
          aria-label={`${step.name || step.nameZh}: ${pendingCount} pending tasks`}
          disabled={pendingCount === 0}
          title={`${step.name || step.nameZh} · ${pendingCount} Pending · ${pendingCount ? 'Open task / 打开任务' : 'No pending tasks / 暂无待办'}${step.parallelGroup ? ` · Parallel · ${step.parallelGroup}` : ''}`}
          onClick={() => onSelect(step.code)}
          className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md border px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default ${
            pendingCount > 0
              ? 'border-amber-200 bg-amber-50/60 hover:border-amber-400 hover:bg-amber-50'
              : 'border-transparent bg-muted/30'
          }`}
        >
          <span
            className={`row-span-2 text-lg font-semibold tabular-nums ${pendingCount > 0 ? 'text-amber-800' : 'text-muted-foreground/70'}`}
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

/** Launch a single task immediately or ask which project to open when the node has several tasks. */
export function openPendingWorkflowTasks(
  entry: ReturnType<typeof buildWorkflowDistribution>['nodes'][number],
  projects: Project[],
  onOpenTask: (project: Project, nodeCode: string) => void,
  onChooseTasks: (nodeCode: string) => void,
) {
  const pendingProjects = pendingWorkflowProjects(entry, projects);
  if (pendingProjects.length === 1)
    onOpenTask(pendingProjects[0], entry.step.code);
  else if (pendingProjects.length > 1) onChooseTasks(entry.step.code);
}

/** Show only the selected node's pending projects with the recorded owner and state. */
export function WorkflowPendingTaskList({
  entry,
  projects,
  onOpenTask,
}: {
  entry: ReturnType<typeof buildWorkflowDistribution>['nodes'][number];
  projects: Project[];
  onOpenTask: (project: Project, nodeCode: string) => void;
}) {
  const pendingProjects = pendingWorkflowProjects(entry, projects);
  return (
    <div
      className="max-h-[60dvh] divide-y overflow-y-auto rounded-md border"
      aria-label="Pending workflow tasks"
    >
      {pendingProjects.length ? (
        pendingProjects.map((project) => {
          // Project snapshots own task details even when the published node was renamed.
          const step = project.workflowSteps?.find(
            (node) => node.code === entry.step.code,
          );
          const state = step && workflowStateLabels[step.state];
          return (
            <div
              key={project.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 basis-48">
                <p className="break-words text-sm font-medium">
                  {project.name}
                </p>
                <p className="mt-0.5 break-words text-[11px] text-muted-foreground">
                  {project.client} · {project.id}
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                <p>{step?.owner || project.workflowOwner || 'Unassigned'}</p>
                <p className="mt-0.5">
                  {state ? `${state.en} / ${state.zh}` : 'Pending / 待办'}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Open task ${project.name} · ${entry.step.name || entry.step.nameZh}`}
                onClick={() => onOpenTask(project, entry.step.code)}
              >
                Open task <ArrowRight className="size-3.5" />
              </Button>
            </div>
          );
        })
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          No pending tasks / 暂无待办
        </p>
      )}
    </div>
  );
}

/** Resolve stable pending project IDs without exposing held or completed portfolio entries. */
function pendingWorkflowProjects(
  entry: ReturnType<typeof buildWorkflowDistribution>['nodes'][number],
  projects: Project[],
) {
  return entry.pendingProjectIds
    .map((id) => projects.find((project) => project.id === id))
    .filter((project): project is Project => Boolean(project));
}
