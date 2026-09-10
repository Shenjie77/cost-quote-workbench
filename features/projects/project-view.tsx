/**
 * Portfolio-first project page. Workflow details remain in each persisted
 * workspace, while day-to-day navigation happens from this compact list.
 */

import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BiText } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { ProjectTable } from '@/features/projects/project-table';
import type { Project, ProjectStatus } from '@/features/projects/types';
import { formatSgd } from '@/lib/formatters';

export function ProjectView({
  projects,
  onOpenProject,
  onOpenCost,
  onOpenQuote,
  onStatusChange,
  onWorkflowChange,
  onTrackWorkflow,
  onCreateProject,
  onDeleteProject,
  onEditProject,
}: {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onOpenCost: (project: Project) => void;
  onOpenQuote: (project: Project) => void;
  onStatusChange?: (project: Project, status: ProjectStatus) => void;
  onWorkflowChange?: (project: Project, workflowCode: string) => void;
  onTrackWorkflow?: (project: Project) => void;
  onCreateProject: () => void;
  onDeleteProject: (project: Project) => void;
  onEditProject: (project: Project) => void;
}) {
  const totals = projects.reduce(
    (summary, project) => ({
      cost: summary.cost + Number(project.totalCost || 0),
      mandays: summary.mandays + Number(project.totalMandays || 0),
      quote: summary.quote + Number(project.totalQuote || 0),
    }),
    { cost: 0, mandays: 0, quote: 0 },
  );

  return (
    <section className="wb-panel overflow-hidden">
      <SectionHeading
        index="01"
        title="Project List"
        titleZh="项目列表"
        description="Record one project workflow, owner and follow-up date; open cost or quote in project tabs."
        descriptionZh="统一登记项目流程、负责人和跟进日期；报价完成后停止提醒。"
        action={
          <Button size="sm" onClick={onCreateProject}>
            <FolderPlus />
            New Project <span className="text-[11px] opacity-60">新建项目</span>
          </Button>
        }
      />
      <div className="grid grid-cols-1 divide-y divide-border border-b border-border bg-muted/25 min-[480px]:grid-cols-2 min-[480px]:divide-x lg:grid-cols-4 lg:divide-y-0">
        <div className="px-5 py-4">
          <BiText
            en="Projects"
            zh="项目数"
            className="text-[11px] text-muted-foreground"
          />
          <p className="financial-numeral mt-2 text-xl font-semibold tracking-tight text-primary">
            {projects.length}
          </p>
        </div>
        <div className="px-5 py-4">
          <BiText
            en="Portfolio Cost"
            zh="项目总成本"
            className="text-[11px] text-muted-foreground"
          />
          <p className="financial-numeral mt-2 text-xl font-semibold tracking-tight text-primary">
            {formatSgd(totals.cost)}
          </p>
        </div>
        <div className="px-5 py-4">
          <BiText
            en="Total Mandays"
            zh="项目总人天"
            className="text-[11px] text-muted-foreground"
          />
          <p className="financial-numeral mt-2 text-xl font-semibold tracking-tight text-primary">
            {totals.mandays.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="px-5 py-4">
          <BiText
            en="Portfolio Quote"
            zh="项目总报价"
            className="text-[11px] text-muted-foreground"
          />
          <p className="financial-numeral mt-2 text-xl font-semibold tracking-tight text-primary">
            {formatSgd(totals.quote)}
          </p>
        </div>
      </div>
      <ProjectTable
        projects={projects}
        onProject={onOpenProject}
        onDeleteProject={onDeleteProject}
        onEditProject={onEditProject}
        onCost={onOpenCost}
        onQuote={onOpenQuote}
        onStatusChange={onStatusChange}
        onWorkflowChange={onWorkflowChange}
        onTrackWorkflow={onTrackWorkflow}
      />
      <div className="border-t border-border bg-[#f6f8fa] px-5 py-3 text-xs text-muted-foreground">
        {projects.length} local projects · {projects.length} 个本地项目
      </div>
    </section>
  );
}
