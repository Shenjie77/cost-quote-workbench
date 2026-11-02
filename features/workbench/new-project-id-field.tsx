import { Surface, Text } from '@/components/ui/presentation';
/** Shared optional identity field for both project-creation entry points. */
import { Input } from '@/components/ui/input';
import { PROJECT_ID_MAX_LENGTH, projectIdError } from './project-creation';

export function NewProjectIdField({
  inputId,
  value,
  onChange,
  disabled = false,
}: {
  inputId: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const error = projectIdError(value);
  return (
    <Surface as="div" textRole="body-main" className="space-y-2">
      <label htmlFor={inputId}>Project ID / 项目编号 (optional)</label>
      <Input
        id={inputId}
        name="projectId"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        placeholder="Leave blank to generate automatically"
        aria-invalid={Boolean(error)}
        aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ''}`}
      />
      <Text id={`${inputId}-hint`} as="p" tone="muted" textRole="body-small">
        Up to {PROJECT_ID_MAX_LENGTH} characters. Cannot be changed after
        creation.
      </Text>
      {error && (
        <Text
          id={`${inputId}-error`}
          role="alert"
          as="p"
          tone="danger"
          textRole="body-small"
        >
          {error}
        </Text>
      )}
    </Surface>
  );
}
