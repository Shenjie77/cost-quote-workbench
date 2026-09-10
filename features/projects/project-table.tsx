/** Project portfolio with one workflow record and direct cost/quote navigation. */

import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BiText } from '@/components/workbench/bilingual-text';
import type { Project, ProjectStatus } from '@/features/projects/types';
import { formatSgd } from '@/lib/formatters';
import { workflowComplete } from './workflow-engine';

export function ProjectTable({
  projects,
  onProject,
  onCost,
  onQuote,
  onTrackWorkflow,
  onDeleteProject,
  onEditProject,
}: {
  projects: Project[];
  onProject: (project: Project) => void;
  onCost: (project: Project) => void;
  onQuote: (project: Project) => void;
  /** Compatibility only; workflow is the sole editable progress record. */
  onStatusChange?: (project: Project, status: ProjectStatus) => void;
  onWorkflowChange?: (project: Project, workflowCode: string) => void;
  onTrackWorkflow?: (project: Project) => void;
  onDeleteProject?: (project: Project) => void;
  onEditProject?: (project: Project) => void;
}) {
  const hasActions = Boolean(onEditProject || onDeleteProject);
  return (
    <Table className="min-w-[1280px]">
      <TableHeader>
        <TableRow className="bg-[#f4f6f8] hover:bg-[#f4f6f8]">
          <TableHead className="sm:sticky sm:left-0 z-10 w-[265px] bg-[#f4f6f8] px-5">
            <BiText en="Project" zh="项目名称" />
          </TableHead>
          <TableHead className="w-[295px] px-4">
            <BiText en="Project Workflow" zh="项目流程" />
          </TableHead>
          <TableHead className="text-right">
            <BiText en="Service Cost" zh="服务成本" className="items-end" />
          </TableHead>
          <TableHead className="text-right">
            <BiText en="Subcontract" zh="分包成本" className="items-end" />
          </TableHead>
          <TableHead className="text-right">
            <BiText en="Total Cost" zh="项目总成本" className="items-end" />
          </TableHead>
          <TableHead className="text-right">
            <BiText en="Mandays" zh="项目总人天" className="items-end" />
          </TableHead>
          <TableHead className="text-right">
            <BiText en="Total Quote" zh="项目总报价" className="items-end" />
          </TableHead>
          <TableHead className="pr-3 text-right">
            <BiText en="Sales GP" zh="项目销毛" className="items-end" />
          </TableHead>
          {hasActions && (
            <TableHead className="w-[140px] pr-3 text-right">
              <BiText en="Action" zh="操作" className="items-end" />
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {!projects.length && (
          <TableRow>
            <TableCell colSpan={hasActions ? 9 : 8} className="wb-empty-state">
              No projects to display / 暂无项目
            </TableCell>
          </TableRow>
        )}
        {projects.map((project) => {
          const currentStep = project.workflowSteps?.find(
            (step) => step.code === project.currentWorkflowStepCode,
          );
          const completed = workflowComplete(project);
          const onHold = Boolean(project.workflowHold);
          return (
            <TableRow
              key={project.id}
              className="group h-20 bg-card hover:bg-[#f6f8fa]"
            >
              <TableCell className="sm:sticky sm:left-0 z-10 bg-card px-5 py-4 group-hover:bg-[#f6f8fa]">
                <button
                  className="block w-full max-w-[245px] rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onClick={() => onProject(project)}
                  title="Open project cost workspace / 打开项目成本工作区"
                >
                  <span
                    className="block truncate text-sm font-semibold text-[#183c51] hover:underline"
                    title={project.name}
                  >
                    {project.name}
                  </span>
                  {onHold && (
                    <span className="mt-1 inline-flex rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">
                      On Hold / 已挂起
                    </span>
                  )}
                  <span className="financial-numeral mt-1.5 block truncate text-[11px] text-muted-foreground">
                    {project.id} · {project.client}
                  </span>
                </button>
              </TableCell>
              <TableCell className="px-4 py-4 whitespace-normal">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold leading-5 text-[#183c51]">
                      {currentStep
                        ? `${currentStep.name} · ${currentStep.nameZh}`
                        : project.stage || '待登记流程'}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {onHold
                        ? 'On Hold · Workflow monitoring paused'
                        : completed
                          ? '报价完成 · 停止提醒'
                          : `${currentStep?.owner || '待填写负责人'} · ${currentStep?.followUpDate || '待填写跟进日期'}`}
                    </p>
                    {currentStep?.note && (
                      <p
                        className="mt-1 max-w-[220px] truncate text-[11px] text-muted-foreground"
                        title={currentStep.note}
                      >
                        {currentStep.note}
                      </p>
                    )}
                  </div>
                  {onTrackWorkflow && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 px-2.5 text-xs"
                      onClick={() => onTrackWorkflow(project)}
                      aria-label={`更新项目流程 ${project.name}`}
                    >
                      更新流程
                    </Button>
                  )}
                </div>
              </TableCell>
              <TableCell className="financial-numeral py-4 text-right text-xs">
                {formatSgd(Number(project.serviceCost || 0))}
              </TableCell>
              <TableCell className="financial-numeral py-4 text-right text-xs">
                {formatSgd(Number(project.subcontractCost || 0))}
              </TableCell>
              <TableCell className="py-4 text-right">
                <button
                  className="financial-numeral rounded-sm text-xs font-semibold text-[#177c80] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onCost(project)}
                  title="Open Cost Workspace / 打开成本界面"
                >
                  {formatSgd(Number(project.totalCost || 0))}
                </button>
                <span className="financial-numeral mt-0.5 block text-[11px] text-muted-foreground">
                  {project.version}
                </span>
              </TableCell>
              <TableCell className="financial-numeral py-4 text-right text-xs">
                {Number(project.totalMandays || 0).toLocaleString('en-SG', {
                  maximumFractionDigits: 4,
                })}
              </TableCell>
              <TableCell className="py-4 text-right">
                <button
                  className="financial-numeral rounded-sm text-xs font-semibold text-[#177c80] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() => onQuote(project)}
                  title="Open Pricing & Quote / 打开报价界面"
                >
                  {formatSgd(Number(project.totalQuote || 0))}
                </button>
              </TableCell>
              <TableCell className="financial-numeral py-4 pr-4 text-right text-xs font-semibold">
                {Number(project.grossMarginPercent || 0).toFixed(2)}%
              </TableCell>
              {hasActions && (
                <TableCell className="py-4 pr-4">
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    {onEditProject && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 px-2.5 text-xs"
                        onClick={() => onEditProject(project)}
                        aria-label={`编辑项目 ${project.name}`}
                      >
                        <Pencil className="size-3" />
                        Edit
                      </Button>
                    )}
                    {onDeleteProject && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 px-2.5 text-xs text-destructive hover:bg-destructive/5"
                        onClick={() => onDeleteProject(project)}
                        aria-label={`删除项目 ${project.name}`}
                      >
                        <Trash2 className="size-3" />
                        Del
                      </Button>
                    )}
                  </div>
                </TableCell>
              )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
