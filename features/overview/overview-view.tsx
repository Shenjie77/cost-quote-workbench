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
  const visibleProjects =
    activeWorkflowFilter === 'all'
      ? projects
      : projects.filter((project) =>
          currentProjectWorkflowNodeCodes(project).includes(
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <KpiCard
          label="Active Projects"
          labelZh="进行中项目"
          value={String(
            projects.filter(
              (project) =>
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
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.72fr)_390px]">
        <section className="overflow-hidden border border-border bg-card">
          <SectionHeading
            index="01"
            title="Project Portfolio"
            titleZh="项目组合"
            description="One workflow record for each project."
            descriptionZh="统一登记项目流程、负责人和跟进日期。"
            action={
              <div className="flex items-center gap-2">
                <Select
                  value={activeWorkflowFilter}
                  onValueChange={(value) => setWorkflowFilter(value ?? 'all')}
                >
                  <SelectTrigger size="sm" className="w-44">
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
          <div className="border-t border-border bg-[#f7f5f0] px-4 py-3 text-xs text-muted-foreground">
            Showing {visibleProjects.length} of {projects.length} local projects
            / 显示 {visibleProjects.length} 个项目
          </div>
        </section>
        <div className="space-y-4">
          <section className="border border-border bg-card">
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
                      className="group px-4 py-3"
                      open={group.severity === 'red'}
                    >
                      <summary className="flex cursor-pointer list-none items-center gap-3 text-xs">
                        <span
                          className={`size-2 shrink-0 rounded-full ${group.severity === 'red' ? 'bg-[#ad4643]' : group.severity === 'amber' ? 'bg-[#a36b18]' : 'bg-[#376b8a]'}`}
                        />
                        <span className="min-w-0 flex-1 font-semibold">
                          {project?.name || group.projectId}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
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
                            className="block w-full rounded px-2 py-2 text-left hover:bg-[#f5f4ef]"
                          >
                            <span className="block text-xs font-medium">
                              {item.titleZh}
                            </span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              {item.detailZh}
                            </span>
                          </button>
                        ))}
                      </div>
                    </details>
                  );
                })
              ) : (
                <div className="px-4 py-10 text-center text-[10px] text-muted-foreground">
                  No projects need follow-up / 当前没有需要跟进的项目
                </div>
              )}
            </div>
            <button
              onClick={() => setView('project')}
              className="flex w-full items-center justify-center gap-1 border-t border-border px-4 py-3 text-xs font-medium text-[#2e6f77] hover:bg-[#f5f4ef]"
            >
              Open project list <span className="text-[9px]">查看项目列表</span>
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
          title="Project Workflow Distribution"
          titleZh="项目流程分布"
          description="Published node names and order, with counts from actual project progress. Parallel tasks can appear under multiple nodes."
          descriptionZh="节点名称和顺序跟随已发布配置；数量按项目实际进度统计，含待启动及已完成轮次。"
        />
        {workflowDefinitionError && (
          <output className="block border-b px-5 py-2 text-xs text-amber-800">
            {workflowDefinitionError}
          </output>
        )}
        {workflowDefinitionRevision !== undefined && (
          <p className="border-b px-5 py-2 text-[10px] text-muted-foreground">
            Published workflow · Revision {workflowDefinitionRevision}
          </p>
        )}
        <WorkflowDistributionNodes
          entries={distribution.nodes}
          onSelect={setWorkflowFilter}
        />
        {distribution.retained.length > 0 && (
          <div className="border-t">
            <p className="px-5 py-3 text-xs text-muted-foreground">
              Other recorded nodes · Retained progress from earlier workflow
              definitions
            </p>
            <WorkflowDistributionNodes
              entries={distribution.retained}
              onSelect={setWorkflowFilter}
            />
          </div>
        )}
      </section>
    </div>
  );
}

export function WorkflowDistributionNodes({
  entries,
  onSelect,
}: {
  entries: ReturnType<typeof buildWorkflowDistribution>['nodes'];
  onSelect: (code: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y divide-border md:grid-cols-5">
      {entries.map(({ step, count, legacy }) => (
        <button
          key={step.code}
          data-workflow-distribution-node={step.code}
          data-recorded-node={legacy || undefined}
          onClick={() => onSelect(step.code)}
          className="group relative px-5 py-4 text-left hover:bg-[#f5f4ef]"
        >
          <span className="financial-numeral text-xl font-semibold text-[#173a52]">
            {count}
          </span>
          <span className="mt-1 block text-xs font-semibold">
            {step.name || step.nameZh}
          </span>
          {step.name && step.nameZh && (
            <span className="mt-1 block text-[9px] text-muted-foreground">
              {step.nameZh}
            </span>
          )}
          {step.parallelGroup && (
            <span className="mt-2 block text-[9px] text-[#2e6f77]">
              Parallel · {step.parallelGroup}
            </span>
          )}
          <ChevronRight className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-[#b4b0a6]" />
        </button>
      ))}
    </div>
  );
}
