/** Compact project context and editable references shared by the workflow tasks. */
import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Pencil, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Project } from './types';
import type { ProjectWorkflowMeta } from './project-workflow-dialog';

type LinkField = 'companyUrl' | 'cpqUrl';
type EditedLinks = Partial<Record<LinkField, boolean>>;

/** References may contain legacy notes; only explicit web addresses are links. */
export function safeProjectReferenceUrl(value?: string): string | null {
  const address = value?.trim();
  if (!address || !/^https?:\/\/\S+$/i.test(address)) return null;
  try {
    const parsed = new URL(address);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** An existing free-text reference must not block an unrelated proposal edit. */
export function projectReferenceLinkErrors(
  value: ProjectWorkflowMeta,
  editedLinks: EditedLinks,
): Partial<Record<LinkField, string>> {
  return Object.fromEntries(
    (['companyUrl', 'cpqUrl'] as const)
      .filter(
        (field) =>
          editedLinks[field] &&
          value[field]?.trim() &&
          !safeProjectReferenceUrl(value[field]),
      )
      .map((field) => [field, 'Enter a full http:// or https:// address.']),
  );
}

function ReferenceLink({ label, value }: { label: string; value?: string }) {
  const href = safeProjectReferenceUrl(value);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label} in a new tab`}
      title={href}
      className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-primary underline-offset-4 hover:bg-primary/5 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {label}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  ) : (
    <span
      className="px-1.5 py-0.5 text-xs text-muted-foreground"
      title={value?.trim() || `${label} link is not set`}
    >
      {label}: {value?.trim() ? 'Reference only' : 'Not set'}
    </span>
  );
}

function ReferenceText({ label, value }: { label: string; value?: string }) {
  const text = value?.trim() || 'Not set';
  return text.length > 180 ? (
    <details className="min-w-0 text-xs leading-5">
      <summary className="cursor-pointer break-words text-muted-foreground">
        <span className="font-medium">{label}</span>
        <span className="ml-2 text-foreground">{text.slice(0, 150)}…</span>
      </summary>
      <p className="mt-1 whitespace-pre-wrap break-words pl-4 text-foreground">
        {text}
      </p>
    </details>
  ) : (
    <p className="min-w-0 break-words text-xs leading-5">
      <span className="mr-2 font-medium text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap">{text}</span>
    </p>
  );
}

type InfoFieldsProps = {
  value: ProjectWorkflowMeta;
  onChange: (value: ProjectWorkflowMeta) => void;
  onLinkEdit: (field: LinkField, value: string) => void;
  onSave: () => Promise<void> | void;
  onReset: () => void;
  onClose: () => void;
  dirty: boolean;
  busy?: boolean;
  linkErrors?: Partial<Record<LinkField, string>>;
};

/** Controlled fields only express edit/save intent; they never write project data. */
export function ProjectWorkflowInfoFields({
  value,
  onChange,
  onLinkEdit,
  onSave,
  onReset,
  onClose,
  dirty,
  busy = false,
  linkErrors = {},
}: InfoFieldsProps) {
  const canSave = dirty && !busy && Object.keys(linkErrors).length === 0;
  return (
    <form
      aria-label="Edit Project Info"
      className="mt-4 border-t border-border pt-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void onSave();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium">
          Proposal Number
          <Input
            aria-label="Proposal Number"
            className="h-10"
            value={value.proposalNumber}
            maxLength={300}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, proposalNumber: event.target.value })
            }
          />
        </label>
        {(
          [
            ['companyUrl', 'iSales / Company Link'],
            ['cpqUrl', 'CPQ Link'],
          ] as const
        ).map(([field, label]) => (
          <label key={field} className="grid gap-1 text-xs font-medium">
            {label}
            <Input
              aria-label={label}
              type="text"
              inputMode="url"
              className="h-10"
              value={value[field] || ''}
              maxLength={10000}
              placeholder="https://…"
              disabled={busy}
              aria-invalid={!!linkErrors[field]}
              aria-describedby={
                linkErrors[field] ? `${field}-error` : undefined
              }
              onChange={(event) => {
                onLinkEdit(field, event.target.value);
                onChange({ ...value, [field]: event.target.value });
              }}
            />
            {linkErrors[field] && (
              <span
                id={`${field}-error`}
                className="font-normal text-destructive"
              >
                {linkErrors[field]}
              </span>
            )}
          </label>
        ))}
        <label className="grid content-start gap-1 text-xs font-medium">
          Technical Document Version
          <Input
            aria-label="Technical Document Version"
            className="h-10"
            value={value.technicalBasis}
            maxLength={10000}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, technicalBasis: event.target.value })
            }
          />
        </label>
        <label className="grid gap-1 text-xs font-medium xl:col-span-2">
          Scope Brief
          <textarea
            aria-label="Scope Brief"
            className="min-h-24 w-full resize-y rounded-lg border border-input bg-white px-3 py-2.5 text-sm font-normal leading-6 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-55"
            rows={2}
            value={value.scopeBrief}
            maxLength={10000}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, scopeBrief: event.target.value })
            }
          />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!canSave}>
          Save Info
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!dirty || busy}
          onClick={onReset}
        >
          Reset
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </Button>
        {dirty && <span className="text-xs text-amber-700">Unsaved info</span>}
      </div>
    </form>
  );
}

/** One project-wide monitoring switch; the caller persists the canonical workflow hold. */
export function ProjectWorkflowHoldControl({
  onHold,
  onSetHold,
  disabled = false,
}: {
  onHold: boolean;
  onSetHold: (onHold: boolean) => Promise<void>;
  disabled?: boolean;
}) {
  return (
    <label
      htmlFor="project-workflow-on-hold"
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs ${onHold ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-border text-muted-foreground'}`}
    >
      <Switch
        id="project-workflow-on-hold"
        aria-label="Project On Hold"
        size="sm"
        checked={onHold}
        disabled={disabled}
        onCheckedChange={(checked) => {
          if (!disabled && checked !== onHold)
            void onSetHold(checked).catch(() => {});
        }}
      />
      <span className="whitespace-nowrap font-medium">Project On Hold</span>
    </label>
  );
}

export type ProjectWorkflowHeaderProps = {
  project: Project;
  round: string;
  currency?: string;
  value: ProjectWorkflowMeta;
  /** Latest canonical references distinguish draft edits from legacy link text. */
  savedValue?: ProjectWorkflowMeta;
  dirty: boolean;
  busy?: boolean;
  onChange: (value: ProjectWorkflowMeta) => void;
  onSave: () => Promise<void> | void;
  onReset: () => void;
  onBack: () => void;
  onRefresh: () => Promise<void> | void;
  onOpenCost: () => void;
  onHold?: boolean;
  holdDisabled?: boolean;
  onSetHold?: (onHold: boolean) => Promise<void>;
};

export function ProjectWorkflowHeader({
  project,
  round,
  currency = 'SGD',
  value,
  savedValue,
  dirty,
  busy = false,
  onChange,
  onSave,
  onReset,
  onBack,
  onRefresh,
  onOpenCost,
  onHold = false,
  holdDisabled = false,
  onSetHold,
}: ProjectWorkflowHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [editedLinks, setEditedLinks] = useState<EditedLinks>({});
  const [savedLinks, setSavedLinks] = useState(() => ({
    companyUrl: value.companyUrl || '',
    cpqUrl: value.cpqUrl || '',
  }));
  const disabled = busy || working;
  const baseline = savedValue || savedLinks;
  const changedLinks = Object.fromEntries(
    (['companyUrl', 'cpqUrl'] as const).map((field) => [
      field,
      editedLinks[field] && (value[field] || '') !== (baseline[field] || ''),
    ]),
  );
  const linkErrors = projectReferenceLinkErrors(value, changedLinks);
  const save = async () => {
    if (disabled || !dirty || Object.keys(linkErrors).length > 0) return;
    setWorking(true);
    setError('');
    try {
      await onSave();
      setSavedLinks({
        companyUrl: value.companyUrl || '',
        cpqUrl: value.cpqUrl || '',
      });
      setEditedLinks({});
      setEditing(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save project info.',
      );
    } finally {
      setWorking(false);
    }
  };
  const refresh = async () => {
    if (disabled) return;
    setWorking(true);
    try {
      await onRefresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to refresh workflow.',
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      aria-label="Project Workflow Info"
      className="wb-panel min-w-0 px-5 py-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Back from Workflow"
          title="Back from Workflow"
          onClick={onBack}
          disabled={disabled}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
        </Button>
        <h2 className="min-w-0 flex-1 basis-48 break-words text-xl font-semibold leading-7 tracking-tight text-primary">
          {project.name || project.nameZh || project.id}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onSetHold && (
            <ProjectWorkflowHoldControl
              onHold={onHold}
              onSetHold={onSetHold}
              disabled={disabled || holdDisabled}
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={disabled}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCost}
            disabled={disabled}
          >
            Open Cost
          </Button>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3 text-xs">
        <dl className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          {[
            ['Project ID', project.id],
            ['Client', project.client || project.clientZh || 'Not set'],
            ['Currency', currency],
            ['Round', round],
            ['Proposal', value.proposalNumber || 'Not set'],
          ].map(([label, text]) => (
            <div key={label} className="flex min-w-0 items-baseline gap-1.5">
              <dt className="shrink-0 text-muted-foreground">{label}</dt>
              <dd className="break-words font-medium">{text}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-1">
          <ReferenceLink label="iSales / Company" value={value.companyUrl} />
          <ReferenceLink label="CPQ" value={value.cpqUrl} />
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          disabled={disabled}
          aria-expanded={editing}
          onClick={() => setEditing((current) => !current)}
        >
          <Pencil className="size-3" aria-hidden="true" />
          {editing ? 'Close Info' : 'Edit Info'}
          {dirty && <span className="text-amber-700">*</span>}
        </Button>
      </div>
      {!editing && (
        <div className="mt-4 grid min-w-0 gap-x-6 gap-y-2 border-t border-border pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)]">
          <ReferenceText label="Scope Brief" value={value.scopeBrief} />
          <ReferenceText
            label="Technical Document Version"
            value={value.technicalBasis}
          />
        </div>
      )}
      {editing && (
        <ProjectWorkflowInfoFields
          value={value}
          onChange={onChange}
          dirty={dirty}
          busy={disabled}
          linkErrors={linkErrors}
          onLinkEdit={(field) =>
            setEditedLinks((current) => ({
              ...current,
              [field]: true,
            }))
          }
          onSave={save}
          onReset={() => {
            onReset();
            setEditedLinks({});
            setError('');
          }}
          onClose={() => setEditing(false)}
        />
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
