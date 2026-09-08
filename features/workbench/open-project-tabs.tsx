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
      className="workbench-scrollbar flex items-end gap-1 overflow-x-auto border-t border-border bg-[#eeeae2] px-4 pt-1.5 sm:px-6 xl:px-8"
    >
      <span className="mb-2 mr-2 shrink-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
              'flex h-8 min-w-[190px] max-w-[280px] items-center border border-b-0 ' +
              (active
                ? 'border-border bg-background text-[#173a52]'
                : 'border-transparent bg-[#e3dfd6] text-muted-foreground hover:bg-[#e9e6de]')
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
              <span className="financial-numeral block truncate text-[9px] font-semibold">
                {project.id}
              </span>
              <span className="block truncate text-[8px]">{project.name}</span>
            </button>
            <button
              type="button"
              className="mr-1.5 rounded-sm p-1 hover:bg-black/5 disabled:cursor-wait disabled:opacity-60"
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
