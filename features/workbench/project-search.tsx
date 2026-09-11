'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { Check, LoaderCircle, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import type { Project } from '../projects/types';
import {
  projectWorkflowSearchInfo,
  searchProjects,
} from './project-search-model.ts';

type ProjectSearchProps = {
  projects: Project[];
  activeProjectId: string;
  onSelect: (project: Project) => Promise<boolean>;
  disabled?: boolean;
};

/** A compact combobox switches the active project through the caller without changing any page filter. */
export function ProjectSearch({
  projects,
  activeProjectId,
  onSelect,
  disabled = false,
}: ProjectSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const selecting = useRef(false);
  const composing = useRef(false);
  const input = useRef<HTMLInputElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const listId = `project-search-${useId()}`;
  const matches = searchProjects(projects, query);
  const activeIndex = matches.length
    ? Math.min(highlight, matches.length - 1)
    : -1;
  const visible = open && !disabled;

  // Async selection may finish after navigation removes the header; ignore those local state updates.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Scroll only the bounded result list when keyboard navigation moves beyond its visible region.
  useEffect(() => {
    if (!visible || activeIndex < 0) return;
    const container = list.current;
    const item = container?.querySelector<HTMLElement>(
      `[data-search-index="${activeIndex}"]`,
    );
    if (!container || !item) return;
    if (item.offsetTop < container.scrollTop)
      container.scrollTop = item.offsetTop;
    else if (
      item.offsetTop + item.offsetHeight >
      container.scrollTop + container.clientHeight
    )
      container.scrollTop =
        item.offsetTop + item.offsetHeight - container.clientHeight;
  }, [visible, activeIndex, query]);

  /** Serialize all mouse and keyboard selections, preserving the query if the caller cannot switch projects. */
  async function selectProject(project: Project) {
    if (disabled || selecting.current) return;
    selecting.current = true;
    setBusy(true);
    setError('');
    try {
      const selected = await onSelect(project);
      if (!alive.current) return;
      if (selected) {
        setQuery('');
        setOpen(false);
        setHighlight(0);
      } else
        setError(
          'Project could not be opened. Your search is retained. / 项目未切换，搜索内容已保留。',
        );
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Unable to switch project. / 无法切换项目。',
        );
    } finally {
      selecting.current = false;
      if (alive.current) setBusy(false);
    }
  }

  /** Keep input focus for list navigation and let Chinese IME confirmation finish without selecting a project. */
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Some IMEs identify their final confirmation only with the legacy 229 native-event marker.
    if (
      disabled ||
      selecting.current ||
      composing.current ||
      event.nativeEvent.isComposing ||
      Reflect.get(event.nativeEvent, 'keyCode') === 229
    )
      return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (!matches.length) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight(
        !open
          ? direction > 0
            ? 0
            : matches.length - 1
          : (activeIndex + direction + matches.length) % matches.length,
      );
      return;
    }
    if (event.key === 'Enter' && visible && activeIndex >= 0) {
      event.preventDefault();
      void selectProject(matches[activeIndex]);
    }
  }

  /** Close only when focus leaves the entire search, allowing the clear control to remain usable. */
  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }

  /** Clearing affects this search alone and restores focus for another project lookup. */
  function clearSearch() {
    if (disabled || selecting.current) return;
    setQuery('');
    setHighlight(0);
    setError('');
    setOpen(true);
    input.current?.focus();
  }

  return (
    <div className="relative min-w-0 w-full" onBlur={handleBlur}>
      <div className="relative">
        {busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : (
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        )}
        <input
          ref={input}
          role="combobox"
          aria-label="Search projects by proposal number, name, or workflow"
          aria-controls={listId}
          aria-expanded={visible}
          aria-autocomplete="list"
          aria-activedescendant={
            visible && activeIndex >= 0
              ? `${listId}-option-${activeIndex}`
              : undefined
          }
          aria-busy={busy}
          autoComplete="off"
          placeholder="Proposal / project / workflow"
          className="h-8 w-full min-w-0 rounded-md border border-input bg-background py-1 pl-8 pr-8 text-xs outline-none placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-60"
          value={query}
          disabled={disabled}
          readOnly={busy}
          onFocus={() => {
            if (!disabled) setOpen(true);
          }}
          onChange={(event) => {
            if (!disabled && !selecting.current) {
              setQuery(event.target.value);
              setHighlight(0);
              setError('');
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
        />
        {query && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Clear project search"
            className="absolute right-1 top-1/2 size-6 -translate-y-1/2"
            disabled={disabled || busy}
            onClick={clearSearch}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
      {visible && (
        <div className="absolute left-0 right-0 top-full z-[70] mt-1.5 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            <span>
              {matches.length} {matches.length === 1 ? 'project' : 'projects'}
            </span>
            <span>{busy ? 'Opening…' : 'Select to switch project'}</span>
          </div>
          {/* Rich project options use the WAI-ARIA combobox/listbox pattern so each result can include its workflow context. */}
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
          <div
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Matching projects"
            className="relative max-h-[min(360px,60dvh)] overflow-y-auto overscroll-contain p-1"
          >
            {matches.map((project, index) => {
              const workflow = projectWorkflowSearchInfo(project).summary;
              return (
                <button
                  key={project.id}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-search-index={index}
                  tabIndex={-1}
                  disabled={busy}
                  className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors ${index === activeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/50'} disabled:cursor-wait disabled:opacity-60`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!busy) setHighlight(index);
                  }}
                  onClick={() => void selectProject(project)}
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-xs font-semibold"
                      title={project.name}
                    >
                      {project.name}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-[11px] text-muted-foreground"
                      title={`${project.proposalNumber || project.id} · ${project.client}`}
                    >
                      {project.proposalNumber || project.id} · {project.client}
                    </span>
                    <span className="mt-1 block text-[11px] leading-4 text-muted-foreground [overflow-wrap:anywhere]">
                      {workflow}
                    </span>
                  </span>
                  {project.id === activeProjectId && (
                    <Check
                      aria-label="Current project"
                      className="mt-0.5 size-3.5 shrink-0 text-primary"
                    />
                  )}
                </button>
              );
            })}
          </div>
          {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
          {!matches.length && (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">
              No matching projects / 未找到匹配项目
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="border-t px-3 py-2 text-xs leading-5 text-destructive"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
