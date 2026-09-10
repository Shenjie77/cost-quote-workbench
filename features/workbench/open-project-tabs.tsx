import { X } from 'lucide-react';
import type { Project } from '@/features/projects/types';

type OpenProjectTabsProps = {
  projects: Project[];
  openProjectIds: string[];
  activeProjectId: string;
  onSelect: (project: Project) => void | Promise<void>;
  onClose: (projectId: string) => void | Promise<void>;
  disabled?: boolean;
};

export function OpenProjectTabs({
  projects,
  openProjectIds,
  activeProjectId,
  onSelect,
  onClose,
  disabled = false,
}: OpenProjectTabsProps) {
  return (
    <nav
      aria-label="Open Projects"
      className="workbench-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto border-t border-border/70 bg-muted/50 px-4 py-2 sm:px-6 xl:px-8"
    >
      <span className="mr-2 shrink-0 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        Open Projects <span className="normal-case">已打开项目</span>
      </span>
      {openProjectIds.map((projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project) return null;
        const active = projectId === activeProjectId;
        return (
          <div
            key={projectId}
            className={
              'flex h-11 min-w-[190px] max-w-[280px] items-center rounded-lg border transition-colors ' +
              (active
                ? 'border-ring/35 bg-card text-primary shadow-xs'
                : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-card/80')
            }
          >
            <button
              type="button"
              className="min-w-0 flex-1 px-3 text-left disabled:cursor-wait disabled:opacity-60"
              disabled={disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!disabled) void onSelect(project);
              }}
              title={`${project.id} · ${project.name}`}
            >
              <span className="financial-numeral block truncate text-[10px] font-medium">
                {project.id}
              </span>
              <span className="block truncate text-xs font-medium">
                {project.name}
              </span>
            </button>
            <button
              type="button"
              className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-muted disabled:cursor-wait disabled:opacity-60"
              disabled={disabled}
              onClick={() => {
                if (!disabled) void onClose(projectId);
              }}
              aria-label={`Close ${project.name} tab`}
              title="Close tab only / 仅关闭标签"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
