import { Surface, Text } from '@/components/ui/presentation';
import { Button } from '@/components/ui/button';
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
    <Surface
      aria-label="Open Projects"
      as="nav"
      variant="footer"
      className="workbench-scrollbar flex min-w-0 items-center overflow-x-auto"
    >
      <Text
        as="span"
        tone="muted"
        textRole="body-small"
        className="mr-2 shrink-0"
      >
        Projects <span className="sr-only">已打开项目</span>
      </Text>
      {openProjectIds.map((projectId) => {
        const project = projects.find((item) => item.id === projectId);
        if (!project) return null;
        const active = projectId === activeProjectId;
        return (
          <Surface
            key={projectId}
            as="div"
            variant="tab"
            selected={active}
            tone={active ? 'primary' : 'muted'}
            className={'flex min-w-[120px] max-w-[240px] shrink-0 items-center'}
          >
            <Button
              variant="ghost"
              type="button"
              className="flex min-w-0 flex-1 items-center text-left disabled:cursor-wait"
              disabled={disabled}
              aria-current={active ? 'page' : undefined}
              onClick={() => {
                if (!disabled) void onSelect(project);
              }}
              title={project.name}
            >
              <Text
                as="span"
                textRole="body-small"
                className="block min-w-0 flex-1 truncate"
              >
                {project.name}
              </Text>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              className="flex shrink-0 items-center justify-center disabled:cursor-wait"
              disabled={disabled}
              onClick={() => {
                if (!disabled) void onClose(projectId);
              }}
              aria-label={`Close ${project.name} tab`}
              title="Close tab only / 仅关闭标签"
            >
              <X aria-hidden="true" className="size-3" />
            </Button>
          </Surface>
        );
      })}
    </Surface>
  );
}
