'use client';
import { useId, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/presentation';
import { useWorkbenchLanguage } from '@/features/workbench/workbench-language';
/** Each task has one primary worksheet; supporting work stays one click away without losing drafts. */
export function TaskTabs({
  items,
  defaultTab,
}: {
  items: { id: string; en: string; zh: string; content: ReactNode }[];
  defaultTab?: string;
}) {
  const prefix = useId();
  const [selected, setSelected] = useState(defaultTab || items[0]?.id);
  const { label } = useWorkbenchLanguage();
  return (
    <>
      <Surface
        variant="plain"
        className="flex flex-wrap items-center gap-1"
        role="tablist"
        aria-label={label('Workspace sections', '工作区栏目')}
      >
        {items.map((item, index) => (
          <Button
            key={item.id}
            role="tab"
            aria-selected={item.id === selected}
            aria-controls={`${prefix}-task-panel-${item.id}`}
            id={`${prefix}-task-tab-${item.id}`}
            variant={item.id === selected ? 'secondary' : 'ghost'}
            size="sm"
            tabIndex={item.id === selected ? 0 : -1}
            onKeyDown={(event) => {
              const next =
                event.key === 'ArrowRight'
                  ? (index + 1) % items.length
                  : event.key === 'ArrowLeft'
                    ? (index - 1 + items.length) % items.length
                    : event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? items.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              setSelected(items[next].id);
              const tabs =
                event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                  '[role="tab"]',
                );
              tabs?.[next]?.focus();
            }}
            onClick={() => setSelected(item.id)}
          >
            {label(item.en, item.zh)}
          </Button>
        ))}
      </Surface>
      {items.map((item) => (
        <div
          role="tabpanel"
          id={`${prefix}-task-panel-${item.id}`}
          aria-labelledby={`${prefix}-task-tab-${item.id}`}
          key={item.id}
          hidden={selected !== item.id}
        >
          {item.content}
        </div>
      ))}
    </>
  );
}
