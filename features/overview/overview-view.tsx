import { Badge } from '@/components/ui/badge';
import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
  StatusDot,
} from '@/components/ui/presentation';
/** Today workspace derived entirely from persisted portfolio and review data. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronRight } from 'lucide-react';
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

/** Prioritize current workflow tasks and follow-ups before the full project portfolio. */
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
    <Surface as="div" variant="page">
      {/* Put actionable pending counts first and preserve published workflow order. */}
      <Surface
        as="section"
        variant="panel"
        className="overflow-hidden"
        aria-label="Project Workflow Distribution"
      >
        <Surface as="div" variant="toolbar">
          <div className="min-w-0">
            <h2>Project Workflow Distribution</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone="warning"
              className="tabular-nums"
              title="Current unresolved tasks and the next ready phase; completed rounds and projects on hold are excluded."
            >
              {pendingTaskCount} Pending
            </Badge>
            {workflowDefinitionRevision !== undefined && (
              <Text as="span" tone="muted" textRole="body-small">
                Published workflow · Revision {workflowDefinitionRevision}
              </Text>
            )}
          </div>
        </Surface>
        {workflowDefinitionError && (
          <Surface
            as="output"
            variant="item"
            tone="warning"
            textRole="body-small"
            className="block"
          >
            {workflowDefinitionError}
          </Surface>
        )}
        <WorkflowDistributionNodes
          entries={distribution.nodes}
          onSelect={selectPendingWorkflow}
        />
        {distribution.retained.length > 0 && (
          <Surface as="div" variant="footer">
            <Surface as="p" variant="body" tone="muted" textRole="body-small">
              Other recorded nodes · Retained progress from earlier workflow
              definitions
            </Surface>
            <WorkflowDistributionNodes
              entries={distribution.retained}
              onSelect={selectPendingWorkflow}
            />
          </Surface>
        )}
      </Surface>
      {/* Keep portfolio totals in one scan line instead of four tall decorative cards. */}
      <Surface
        as="dl"
        variant="body"
        textRole="body-small"
        className="flex flex-wrap items-center gap-x-6 gap-y-2"
        aria-label="Portfolio summary"
      >
        <div
          className="flex items-baseline gap-2"
          title={`${projects.length} local projects in total / 共 ${projects.length} 个本地项目`}
        >
          <Text as="dt" tone="muted">
            Active Projects <span className="sr-only">进行中项目</span>
          </Text>
          <dd className="tabular-nums">
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
          <Text as="dt" tone="muted">
            Current Cost Base <span className="sr-only">当前成本规模</span>
          </Text>
          <dd className="tabular-nums">{formatSgd(portfolioCost)}</dd>
        </div>
        <div
          className="flex items-baseline gap-2"
          title="Based on workflow tasks, upcoming starts and their SLA / 按待办、待启动节点及 SLA 提醒配置判断"
        >
          <Text as="dt" tone="muted">
            Projects to Follow Up <span className="sr-only">待跟进项目</span>
          </Text>
          <dd className="tabular-nums">{followUpProjects.length}</dd>
        </div>
        <div
          className="flex items-baseline gap-2"
          title="Manual project risk classification / 按项目风险标记统计"
        >
          <Text as="dt" tone="muted">
            High-Risk Projects <span className="sr-only">高风险项目</span>
          </Text>
          <dd className="tabular-nums">
            {projects.filter((project) => project.risk === 'high').length}
          </dd>
        </div>
      </Surface>
      {/* Multiple projects require a visible choice; each row opens its exact workflow node. */}
      <Dialog
        open={Boolean(pendingWorkflow)}
        onOpenChange={(open) => {
          if (!open) setPendingWorkflowCode(null);
        }}
      >
        <DialogContent size="md" className="gap-3">
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
        {/* Keep follow-up actions above the full project list for immediate access. */}
        <div className="min-w-0">
          <Surface as="section" variant="panel" className="overflow-hidden">
            <SectionHeading
              index="01"
              title="Project Follow-ups"
              titleZh="项目跟进"
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setView('agent')}
                >
                  Open full digest{' '}
                  <Text as="span" textRole="body-small">
                    完整摘要
                  </Text>
                  <ArrowRight />
                </Button>
              }
            />
            {/* The digest stays beside the follow-ups it describes, without a competing sidebar card. */}
            <Surface
              as="div"
              variant="toolbar"
              tone="muted"
              textRole="body-small"
            >
              <Text as="span" tone="default">
                Daily Agent Digest · 每日摘要
              </Text>
              <span>
                {followUpProjects.length} 个项目、{digest.items.length}{' '}
                个节点需要跟进
              </span>
              <span className="ml-auto tabular-nums">{digest.asOf}</span>
            </Surface>
            <Surface as="div" variant="list">
              {followUpProjects.length ? (
                followUpProjects.slice(0, 4).map((group) => {
                  const project = projects.find(
                    (entry) => entry.id === group.projectId,
                  );
                  return (
                    <Disclosure
                      key={group.projectId}
                      data-workflow-project-group={group.projectId}
                      className="group"
                      open={group.severity === 'red'}
                    >
                      <DisclosureSummary className="flex cursor-pointer list-none flex-wrap items-center min-h-8 gap-2">
                        <StatusDot
                          tone={
                            group.severity === 'red'
                              ? 'danger'
                              : group.severity === 'amber'
                                ? 'warning'
                                : 'inherit'
                          }
                          className="size-2 shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          {project?.name || group.projectId}
                        </span>
                        <Text as="span" tone="muted" textRole="body-small">
                          {group.severity === 'red'
                            ? '紧急'
                            : group.severity === 'amber'
                              ? '马上处理'
                              : '普通跟进'}{' '}
                          · {group.items.length} 个待办节点
                        </Text>
                        <ChevronRight className="size-4 group-open:rotate-90" />
                      </DisclosureSummary>
                      <Surface
                        as="div"
                        variant="body"
                        className="mt-2 space-y-1"
                      >
                        {group.items.map((item) => (
                          <Button
                            variant="ghost"
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
                            className="block w-full text-left"
                          >
                            <Text
                              as="span"
                              textRole="body-small"
                              className="block"
                            >
                              {item.titleZh}
                            </Text>
                            <Text
                              as="span"
                              tone="muted"
                              textRole="body-small"
                              className="mt-1 block"
                            >
                              {item.detailZh}
                            </Text>
                          </Button>
                        ))}
                      </Surface>
                    </Disclosure>
                  );
                })
              ) : (
                <Surface as="div" variant="empty">
                  No projects need follow-up / 当前没有需要跟进的项目
                </Surface>
              )}
            </Surface>
            <Button
              variant="ghost"
              onClick={() => setView('project')}
              className="flex w-full items-center justify-center gap-1"
            >
              Open project list{' '}
              <Text as="span" textRole="body-small">
                查看项目列表
              </Text>
              <ArrowRight className="size-4" />
            </Button>
          </Surface>
        </div>
        <Surface as="section" variant="panel" className="overflow-hidden">
          <SectionHeading
            index="02"
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
                  <SelectTrigger
                    size="sm"
                    className="w-full min-w-44 sm:w-52"
                    aria-label="Filter portfolio by workflow"
                  >
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
          <Surface as="div" variant="footer" tone="muted" textRole="body-small">
            Showing {visibleProjects.length} of {projects.length} local projects
            / 显示 {visibleProjects.length} 个项目
          </Surface>
        </Surface>
      </div>
    </Surface>
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
    <Surface
      as="div"
      variant="body"
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
    >
      {entries.map(({ step, pendingCount, legacy }) => (
        <Button
          variant="ghost"
          key={step.code}
          type="button"
          data-workflow-distribution-node={step.code}
          data-recorded-node={legacy || undefined}
          aria-label={`${step.name || step.nameZh}: ${pendingCount} pending tasks`}
          disabled={pendingCount === 0}
          title={`${step.name || step.nameZh} · ${pendingCount} Pending · ${pendingCount ? 'Open task / 打开任务' : 'No pending tasks / 暂无待办'}${step.parallelGroup ? ` · Parallel · ${step.parallelGroup}` : ''}`}
          onClick={() => onSelect(step.code)}
          className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 text-left disabled:cursor-default"
        >
          <Text
            as="span"
            tone={pendingCount > 0 ? 'warning' : 'muted'}
            textRole="body-main"
            className="row-span-2 tabular-nums"
          >
            {pendingCount}
          </Text>
          <Text
            as="span"
            textRole="body-small"
            className="[overflow-wrap:anywhere]"
          >
            {step.name || step.nameZh}
          </Text>
          {step.name && step.nameZh && (
            <Text
              as="span"
              tone="muted"
              textRole="body-small"
              className="col-start-2 [overflow-wrap:anywhere]"
            >
              {step.nameZh}
            </Text>
          )}
        </Button>
      ))}
    </Surface>
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
    <Surface
      as="div"
      variant="list"
      className="max-h-[60dvh] overflow-y-auto"
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
            <Surface
              key={project.id}
              as="div"
              variant="body"
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <div className="min-w-0 flex-1 basis-48">
                <Text as="p" textRole="body-main" className="break-words">
                  {project.name}
                </Text>
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="mt-1 break-words"
                >
                  {project.client}
                </Text>
              </div>
              <Surface as="div" tone="muted" textRole="body-small">
                <p>{step?.owner || project.workflowOwner || 'Unassigned'}</p>
                <p className="mt-1">
                  {state ? `${state.en} / ${state.zh}` : 'Pending / 待办'}
                </p>
              </Surface>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Open task ${project.name} · ${entry.step.name || entry.step.nameZh}`}
                onClick={() => onOpenTask(project, entry.step.code)}
              >
                Open task <ArrowRight className="size-4" />
              </Button>
            </Surface>
          );
        })
      ) : (
        <Surface as="p" variant="body" tone="muted" textRole="body-main">
          No pending tasks / 暂无待办
        </Surface>
      )}
    </Surface>
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
