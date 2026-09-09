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
    <div className="space-y-2 text-sm">
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
      <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
        Up to {PROJECT_ID_MAX_LENGTH} characters. Cannot be changed after
        creation.
      </p>
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </div>
  );
}
