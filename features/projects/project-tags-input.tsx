import { Surface, Text } from '@/components/ui/presentation';
import { CheckInput } from '@/components/ui/check-input';
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
      <Surface htmlFor={id} as="label" variant="field" textRole="body-small">
        Tags / 项目标签
      </Surface>
      <Input
        id={id}
        aria-label="Search project tags"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search saved tags / 搜索主数据标签"
        disabled={disabled}
      />
      <Surface
        as="div"
        variant="panel"
        padded
        className="flex max-h-40 flex-wrap gap-2 overflow-y-auto"
      >
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
              <Surface
                key={projectTagKey(tag)}
                as="label"
                variant="field"
                textRole="body-small"
                className="inline-flex items-center"
              >
                <CheckInput
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
                  <Text as="span" tone="muted">
                    （已停用或不在目录）
                  </Text>
                )}
              </Surface>
            );
          })}
        {!options.length && (
          <Text as="span" tone="muted" textRole="body-small">
            No tags available / 暂无可选标签
          </Text>
        )}
      </Surface>
      <Text as="p" tone="muted" textRole="body-small">
        可多选。新增或停用标签请前往 Master Data → Project
        Tags；保存项目后生效。
      </Text>
      {error && (
        <Text role="alert" as="p" tone="danger" textRole="body-small">
          {error}
        </Text>
      )}
    </section>
  );
}
