import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/presentation';
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

/** Keep project identity and all navigation actions available in a compact, readable grid. */
export function ProjectTable({
  projects,
  onProject,
  onCost,
  onQuote,
  onTrackWorkflow,
  onDeleteProject,
  onEditProject,
  onTagSelect,
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
  onTagSelect?: (tag: string) => void;
}) {
  const hasActions = Boolean(onEditProject || onDeleteProject);
  return (
    <Table className="min-w-[1120px]">
      <TableHeader>
        <TableRow tone="subtotal">
          <TableHead className="sm:sticky sm:left-0 z-10 w-[220px]">
            <BiText en="Project" zh="项目名称" />
          </TableHead>
          <TableHead className="w-[250px]">
            <BiText en="Project Workflow" zh="项目流程" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Service Cost" zh="服务成本" className="items-end" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Subcontract" zh="分包成本" className="items-end" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Total Cost" zh="项目总成本" className="items-end" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Mandays" zh="项目总人天" className="items-end" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Total Quote" zh="项目总报价" className="items-end" />
          </TableHead>
          <TableHead variant="numeric" className="text-right">
            <BiText en="Sales GP" zh="项目销毛" className="items-end" />
          </TableHead>
          {hasActions && (
            <TableHead variant="numeric" className="w-[128px] text-right">
              <BiText en="Action" zh="操作" className="items-end" />
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {!projects.length && (
          <TableRow>
            <TableCell colSpan={hasActions ? 9 : 8}>
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
            <TableRow tone="subtotal" key={project.id} className="group">
              <TableCell className="sm:sticky sm:left-0 z-10">
                <Button
                  variant="ghost"
                  aria-label={`Open project ${project.name}`}
                  className="block w-full max-w-[220px] text-left"
                  onClick={() => onProject(project)}
                  title="Open project cost workspace / 打开项目成本工作区"
                >
                  <Text
                    as="span"
                    tone="primary"
                    textRole="body-main"
                    className="block whitespace-normal break-words hover:underline"
                    title={project.name}
                  >
                    {project.name}
                  </Text>
                  {onHold && (
                    <Badge tone="warning" className="mt-1 inline-flex">
                      On Hold / 已挂起
                    </Badge>
                  )}
                  <Text
                    as="span"
                    tone="muted"
                    textRole="body-small"
                    className="financial-numeral mt-1 block whitespace-normal break-words"
                  >
                    {project.client}
                  </Text>
                </Button>
                {!!project.tags?.length && (
                  <div
                    aria-label={`Tags for ${project.name}`}
                    className="mt-1 flex max-h-16 flex-wrap gap-1 overflow-y-auto"
                  >
                    {project.tags.map((tag) =>
                      onTagSelect ? (
                        <Button
                          variant="ghost"
                          key={tag}
                          type="button"
                          onClick={() => onTagSelect(tag)}

                          title={`Filter by ${tag}`}
                        >
                          {tag}
                        </Button>
                      ) : (
                        <Badge key={tag}>{tag}</Badge>
                      ),
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell variant="label" className="whitespace-normal">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Text as="p" tone="primary" textRole="body-small">
                      {currentStep
                        ? `${currentStep.name} · ${currentStep.nameZh}`
                        : project.stage || '待登记流程'}
                    </Text>
                    <Text
                      as="p"
                      tone="muted"
                      textRole="body-small"
                      className="mt-1"
                    >
                      {onHold
                        ? 'On Hold · Workflow monitoring paused'
                        : completed
                          ? '报价完成 · 停止提醒'
                          : `${currentStep?.owner || '待填写负责人'} · ${currentStep?.followUpDate || '待填写跟进日期'}`}
                    </Text>
                    {currentStep?.note && (
                      <Text
                        as="p"
                        tone="muted"
                        textRole="body-small"
                        className="mt-1 max-w-[220px] truncate"
                        title={currentStep.note}
                      >
                        {currentStep.note}
                      </Text>
                    )}
                  </div>
                  {onTrackWorkflow && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => onTrackWorkflow(project)}
                      aria-label={`更新项目流程 ${project.name}`}
                    >
                      更新流程
                    </Button>
                  )}
                </div>
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {formatSgd(Number(project.serviceCost || 0))}
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {formatSgd(Number(project.subcontractCost || 0))}
              </TableCell>
              <TableCell variant="numeric" className="text-right">
                <Button
                  variant="ghost"
                  className="financial-numeral underline-offset-4 hover:underline"
                  aria-label={`Open cost for ${project.name}`}
                  onClick={() => onCost(project)}
                  title="Open Cost Workspace / 打开成本界面"
                >
                  {formatSgd(Number(project.totalCost || 0))}
                </Button>
                <Text
                  as="span"
                  tone="muted"
                  textRole="body-small"
                  className="financial-numeral mt-1 block"
                >
                  {project.version}
                </Text>
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {Number(project.totalMandays || 0).toLocaleString('en-SG', {
                  maximumFractionDigits: 4,
                })}
              </TableCell>
              <TableCell variant="numeric" className="text-right">
                <Button
                  variant="ghost"
                  className="financial-numeral underline-offset-4 hover:underline"
                  aria-label={`Open quotation for ${project.name}`}
                  onClick={() => onQuote(project)}
                  title="Open Pricing & Quote / 打开报价界面"
                >
                  {formatSgd(Number(project.totalQuote || 0))}
                </Button>
              </TableCell>
              <TableCell
                variant="numeric"
                className="financial-numeral text-right"
              >
                {Number(project.grossMarginPercent || 0).toFixed(2)}%
              </TableCell>
              {hasActions && (
                <TableCell>
                  <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                    {onEditProject && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2"
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
                        className="gap-2"
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
