/** Project assignments select saved Master Data labels; catalog changes belong to Master Data. */
import { useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { normalizeProjectTags, projectTagKey } from './project-tags';

/** Keep existing unavailable assignments visible so retiring a global label never silently removes project data. */
export function ProjectTagsInput({
  value,
  suggestions = [],
  disabled = false,
  onChange,
}: {
  value: string[];
  suggestions?: string[];
  disabled?: boolean;
  onChange: (tags: string[]) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const options = [
    ...new Map(
      [...suggestions, ...value].map((tag) => [projectTagKey(tag), tag]),
    ).values(),
  ];
  return (
    <section aria-label="Project tags" className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium">
        Tags / 项目标签
      </label>
      <Input
        id={id}
        aria-label="Search project tags"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search saved tags / 搜索主数据标签"
        disabled={disabled}
      />
      <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded border p-2">
        {options
          .filter((tag) => projectTagKey(tag).includes(projectTagKey(query)))
          .map((tag) => {
            const selected = value.some(
              (item) => projectTagKey(item) === projectTagKey(tag),
            );
            const available = suggestions.some(
              (item) => projectTagKey(item) === projectTagKey(tag),
            );
            return (
              <label
                key={projectTagKey(tag)}
                className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs"
              >
                <input
                  type="checkbox"
                  aria-label={`Assign tag ${tag}`}
                  checked={selected}
                  disabled={disabled || (!available && !selected)}
                  onChange={(event) => {
                    if (disabled || (event.target.checked && !available))
                      return;
                    try {
                      onChange(
                        normalizeProjectTags(
                          event.target.checked
                            ? [...value, tag]
                            : value.filter(
                                (item) =>
                                  projectTagKey(item) !== projectTagKey(tag),
                              ),
                        ),
                      );
                      setError('');
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : 'Invalid tags.',
                      );
                    }
                  }}
                />
                {tag}
                {!available && (
                  <span className="text-muted-foreground">
                    （已停用或不在目录）
                  </span>
                )}
              </label>
            );
          })}
        {!options.length && (
          <span className="text-xs text-muted-foreground">
            No tags available / 暂无可选标签
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        可多选。新增或停用标签请前往 Master Data → Project
        Tags；保存项目后生效。
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
