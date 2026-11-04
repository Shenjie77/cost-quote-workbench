import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { useWorkbenchLanguage } from '../workbench/workbench-language';
import { Badge } from '@/components/ui/badge';
import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
/** Today workspace derived entirely from persisted portfolio and review data. */

import { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
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
  const { label } = useWorkbenchLanguage();
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
    <Surface variant="page">
      <SectionHeading
        variant="page"
        title="Today"
        titleZh="今日工作"
        description="Handle what needs your attention, then open a project."
        descriptionZh="先处理需要你行动的事项，再进入项目。"
        action={
          <Text tone="muted" textRole="body-small">
            {digest.asOf}
          </Text>
        }
      />
      <Surface variant="sheet">
        <Surface
          variant="toolbar"
          className="flex flex-wrap items-center gap-6"
        >
          <span>
            {label('To follow up', '待跟进')}{' '}
            <strong>{digest.items.length}</strong>
          </span>
          <span>
            {label('Projects to follow up', '待跟进项目')}{' '}
            <strong>{followUpProjects.length}</strong>
          </span>
          <span>
            {label('Cost base', '当前成本')}{' '}
            <strong>{formatSgd(portfolioCost)}</strong>
          </span>
          <span className="flex-1" />
          <Button variant="link" onClick={() => setView('project')}>
            {label('All projects', '全部项目')} →
          </Button>
        </Surface>
        <Table aria-label="Today follow-ups" className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>{label('Needs attention', '需要处理')}</TableHead>
              <TableHead>{label('Project', '项目')}</TableHead>
              <TableHead>{label('Due', '截止')}</TableHead>
              <TableHead>{label('Priority', '优先级')}</TableHead>
              <TableHead>{label('Action', '操作')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {digest.items.map((item) => {
              const project = projects.find((p) => p.id === item.projectId);
              const step = project?.workflowSteps?.find(
                (n) => n.code === item.workflowNodeId,
              );
              return (
                <TableRow key={item.id} data-follow-up-project={item.projectId}>
                  <TableCell>
                    <Text title={label(item.detail, item.detailZh)}>
                      {label(item.title, item.titleZh)}
                    </Text>
                  </TableCell>
                  <TableCell>{project?.name || item.projectId}</TableCell>
                  <TableCell>
                    {step?.followUpDate || step?.dueAt?.slice(0, 10) || '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        item.severity === 'red'
                          ? 'danger'
                          : item.severity === 'amber'
                            ? 'warning'
                            : 'neutral'
                      }
                    >
                      {item.severity === 'red'
                        ? label('Urgent', '紧急')
                        : item.severity === 'amber'
                          ? label('Soon', '优先')
                          : label('Routine', '常规')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
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
                    >
                      {label('Open task', '去处理')} →
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!digest.items.length && (
              <TableRow>
                <TableCell colSpan={5}>
                  {label('No follow-ups due', '当前没有需要跟进的事项')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Surface>
      <div className="grid gap-3 lg:grid-cols-2">
        <Surface variant="sheet">
          <SectionHeading title="Project shortcuts" titleZh="项目快捷入口" />
          {projects.slice(0, 4).map((project) => (
            <Surface
              key={project.id}
              variant="item"
              className="flex items-center gap-2"
            >
              <Text className="min-w-0 flex-1 truncate">{project.name}</Text>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenCost(project)}
              >
                {label('HR Cost', '人力成本')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onOpenQuote(project)}
              >
                {label('Quotation', '报价')}
              </Button>
            </Surface>
          ))}
        </Surface>
        <Surface variant="sheet">
          <SectionHeading title="Delivery checks" titleZh="交付检查" />
          <Surface variant="item" className="flex items-center justify-between">
            <span>{label('Pending workflow tasks', '待处理流程节点')}</span>
            <strong>{pendingTaskCount}</strong>
          </Surface>
          <Surface variant="item" className="flex items-center justify-between">
            <span>{label('Cost versions to confirm', '待确认成本版本')}</span>
            <strong>
              {
                projects.filter(
                  (p) =>
                    p.versionState !== 'Confirmed' &&
                    !isDigestProjectCompleted({ ...p, projectId: p.id }),
                ).length
              }
            </strong>
          </Surface>
          <Surface variant="item">
            <Button variant="link" onClick={() => setView('agent')}>
              {label('Open full digest', '查看完整跟进摘要')} →
            </Button>
          </Surface>
        </Surface>
      </div>
      <Disclosure>
        <DisclosureSummary>
          {label('Workflow distribution', '全站流程分布')}
        </DisclosureSummary>{' '}
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
      </Disclosure>
      <Disclosure>
        <DisclosureSummary>
          {label('Portfolio by workflow', '按流程筛选项目')}
        </DisclosureSummary>
        <Surface variant="toolbar">
          <Select
            value={activeWorkflowFilter}
            onValueChange={(value) => setWorkflowFilter(value || 'all')}
          >
            <SelectTrigger aria-label="Filter portfolio by workflow">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All workflows / 全部流程</SelectItem>
              {workflowOptions.map(({ step, legacy }) => (
                <SelectItem key={step.code} value={step.code}>
                  {step.name || step.nameZh}
                  {legacy ? ' (recorded node)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Surface>
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
      </Disclosure>
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
