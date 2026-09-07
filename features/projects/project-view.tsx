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
  onCreateProject,
  onDeleteProject,
  onEditProject,
}: {
  projects: Project[];
  onOpenProject: (project: Project) => void;
  onOpenCost: (project: Project) => void;
  onOpenQuote: (project: Project) => void;
  onStatusChange: (project: Project, status: ProjectStatus) => void;
  onWorkflowChange: (project: Project, workflowCode: string) => void;
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
    <section className="overflow-hidden border border-border bg-card">
      <SectionHeading
        index="01"
        title="Project List"
        titleZh="项目列表"
        description="Set project status and current workflow; open cost or quote in project tabs."
        descriptionZh="直接设置项目状态与当前流程，点击成本或报价进入项目标签。"
        action={
          <Button size="sm" onClick={onCreateProject}>
            <FolderPlus />
            New Project <span className="text-[9px] opacity-60">新建项目</span>
          </Button>
        }
      />
      <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border bg-[#f7f5f0] md:grid-cols-4 md:divide-y-0">
        <div className="px-3 py-2">
          <BiText
            en="Projects"
            zh="项目数"
            className="text-[9px] text-muted-foreground"
          />
          <p className="financial-numeral mt-0.5 text-sm font-semibold">
            {projects.length}
          </p>
        </div>
        <div className="px-3 py-2">
          <BiText
            en="Portfolio Cost"
            zh="项目总成本"
            className="text-[9px] text-muted-foreground"
          />
          <p className="financial-numeral mt-0.5 text-sm font-semibold">
            {formatSgd(totals.cost)}
          </p>
        </div>
        <div className="px-3 py-2">
          <BiText
            en="Total Mandays"
            zh="项目总人天"
            className="text-[9px] text-muted-foreground"
          />
          <p className="financial-numeral mt-0.5 text-sm font-semibold">
            {totals.mandays.toLocaleString('en-SG')}
          </p>
        </div>
        <div className="px-3 py-2">
          <BiText
            en="Portfolio Quote"
            zh="项目总报价"
            className="text-[9px] text-muted-foreground"
          />
          <p className="financial-numeral mt-0.5 text-sm font-semibold">
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
      />
      <div className="border-t border-border bg-[#f7f5f0] px-4 py-2 text-[10px] text-muted-foreground">
        {projects.length} local projects · {projects.length} 个本地项目
      </div>
    </section>
  );
}
