'use client';

import { Text, Surface } from '@/components/ui/presentation';
import { Input } from '@/components/ui/input';
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
          <Text
            aria-hidden="true"
            as={LoaderCircle}
            tone="muted"
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 animate-spin"
          />
        ) : (
          <Text
            aria-hidden="true"
            as={Search}
            tone="muted"
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2"
          />
        )}
        <Input
          variant="search"
          ref={input}
          role="combobox"
          name="project-search"
          spellCheck={false}
          aria-label="Search projects by proposal number, name, workflow, or tag"
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
          placeholder="Proposal / project / workflow / tag…"
          className="w-full min-w-0 disabled:cursor-not-allowed"
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
            className="absolute right-1 top-1/2 -translate-y-1/2"
            disabled={disabled || busy}
            onClick={clearSearch}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      {visible && (
        <Surface
          as="div"
          variant="panel"
          className="absolute left-0 right-0 top-full z-[70] mt-2 overflow-hidden"
        >
          <Surface
            as="div"
            variant="item"
            tone="muted"
            textRole="body-small"
            className="flex items-center justify-between gap-2"
          >
            <span>
              {matches.length} {matches.length === 1 ? 'project' : 'projects'}
            </span>
            <span>{busy ? 'Opening…' : 'Select to switch project'}</span>
          </Surface>
          {/* Rich project options use the WAI-ARIA combobox/listbox pattern so each result can include its workflow context. */}
          {/* oxlint-disable jsx-a11y/prefer-tag-over-role */}
          <Surface
            ref={list}
            id={listId}
            role="listbox"
            tabIndex={-1}
            aria-label="Matching projects"
            as="div"
            variant="body"
            className="relative max-h-[min(360px,60dvh)] overflow-y-auto overscroll-contain"
          >
            {matches.map((project, index) => {
              const workflow = projectWorkflowSearchInfo(project).summary;
              return (
                <Button
                  variant="ghost"
                  key={project.id}
                  id={`${listId}-option-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-search-index={index}
                  tabIndex={-1}
                  disabled={busy}
                  className="flex w-full items-start gap-2 text-left disabled:cursor-wait"
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    if (!busy) setHighlight(index);
                  }}
                  onClick={() => void selectProject(project)}
                >
                  <span className="min-w-0 flex-1">
                    <Text
                      as="span"
                      textRole="body-small"
                      className="block truncate"
                      title={project.name}
                    >
                      {project.name}
                    </Text>
                    <Text
                      as="span"
                      tone="muted"
                      textRole="body-small"
                      className="mt-1 block truncate"
                      title={`${project.proposalNumber || project.name} · ${project.client}`}
                    >
                      {project.proposalNumber || project.name} ·{' '}
                      {project.client}
                    </Text>
                    <Text
                      as="span"
                      tone="muted"
                      textRole="body-small"
                      className="mt-1 block [overflow-wrap:anywhere]"
                    >
                      {workflow}
                    </Text>
                    {!!project.tags?.length && (
                      <Text
                        as="span"
                        tone="primary"
                        textRole="body-small"
                        className="mt-1 block"
                      >
                        {project.tags.map((tag) => `#${tag}`).join(' · ')}
                      </Text>
                    )}
                  </span>
                  {project.id === activeProjectId && (
                    <Text
                      aria-label="Current project"
                      as={Check}
                      tone="primary"
                      className="mt-1 size-4 shrink-0"
                    />
                  )}
                </Button>
              );
            })}
          </Surface>
          {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
          {!matches.length && (
            <Surface
              as="p"
              variant="body"
              tone="muted"
              textRole="body-small"
              className="text-center"
            >
              No matching projects / 未找到匹配项目
            </Surface>
          )}
          {error && (
            <Surface
              role="alert"
              as="p"
              variant="footer"
              tone="danger"
              textRole="body-small"
            >
              {error}
            </Surface>
          )}
        </Surface>
      )}
    </div>
  );
}
