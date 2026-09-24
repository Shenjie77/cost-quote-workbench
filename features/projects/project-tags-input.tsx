/** Multi-label project editor with reusable suggestions and local validation. */
import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  MAX_PROJECT_TAG_LENGTH,
  normalizeProjectTags,
  projectTagKey,
} from './project-tags';

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
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  /** Add one new or suggested label; duplicates keep their existing spelling and order. */
  const add = () => {
    if (disabled || !draft.trim()) return;
    try {
      const existing = suggestions.find(
        (tag) => projectTagKey(tag) === projectTagKey(draft),
      );
      onChange(normalizeProjectTags([...value, existing ?? draft]));
      setDraft('');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid tag.');
    }
  };
  return (
    <section aria-label="Project tags" className="space-y-2">
      <label htmlFor={id} className="text-xs font-medium">
        Tags / 项目标签
      </label>
      <div className="flex flex-wrap gap-1">
        {value.map((tag) => (
          <span
            key={projectTagKey(tag)}
            className="inline-flex max-w-full items-center gap-1 rounded border bg-muted/40 px-2 py-1 text-xs"
          >
            <span className="break-words">{tag}</span>
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              className="rounded focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              onClick={() => {
                if (!disabled)
                  onChange(
                    value.filter(
                      (item) => projectTagKey(item) !== projectTagKey(tag),
                    ),
                  );
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          aria-label="New or existing project tag"
          list={`${id}-suggestions`}
          value={draft}
          maxLength={MAX_PROJECT_TAG_LENGTH}
          disabled={disabled}
          placeholder="New or existing tag / 新建或选择标签"
          onChange={(event) => {
            setDraft(event.target.value);
            setError('');
          }}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              Reflect.get(event.nativeEvent, 'keyCode') !== 229
            ) {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          Add tag
        </Button>
      </div>
      <datalist id={`${id}-suggestions`}>
        {suggestions
          .filter(
            (tag) =>
              !value.some(
                (selected) => projectTagKey(selected) === projectTagKey(tag),
              ),
          )
          .map((tag) => (
            <option key={projectTagKey(tag)} value={tag}>
              {tag}
            </option>
          ))}
      </datalist>
      <p className="text-xs text-muted-foreground">
        按 Enter 或 Add tag 添加，可分配多个标签。保存项目后生效。
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
