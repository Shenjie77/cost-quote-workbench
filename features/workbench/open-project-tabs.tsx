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

/** Keep open projects in a compact tab strip with independent close actions. */
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
      className="workbench-scrollbar flex min-w-0 items-center gap-1 overflow-x-auto border-t border-border/70 bg-muted/30 px-3 py-1 sm:px-4"
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
              'flex h-8 min-w-[150px] max-w-[240px] items-center rounded border transition-colors ' +
              (active
                ? 'border-ring/35 bg-card text-primary'
                : 'border-transparent bg-transparent text-muted-foreground hover:border-border hover:bg-card/80')
            }
          >
            <button
              type="button"
              className="min-w-0 flex-1 px-2 text-left disabled:cursor-wait disabled:opacity-60"
              disabled={disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!disabled) void onSelect(project);
              }}
              title={`${project.id} · ${project.name}`}
            >
              <span className="financial-numeral sr-only">{project.id}</span>
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
