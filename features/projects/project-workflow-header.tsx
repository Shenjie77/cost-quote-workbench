import {
  Disclosure,
  DisclosureSummary,
  Text,
  Surface,
} from '@/components/ui/presentation';
import { Textarea } from '@/components/ui/textarea';
import { ContextBand } from './project-context-band';
import { safeProjectReferenceUrl } from './project-reference-link';
export { safeProjectReferenceUrl } from './project-reference-link';
/** Compact project context and editable references shared by the workflow tasks. */
import { useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Project } from './types';
import type { ProjectWorkflowMeta } from './project-workflow-dialog';

type LinkField = 'companyUrl' | 'cpqUrl';
type EditedLinks = Partial<Record<LinkField, boolean>>;

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

/** Keep long saved references available through a native disclosure. */
function ReferenceText({ label, value }: { label: string; value?: string }) {
  const text = value?.trim() || 'Not set';
  return text.length > 180 ? (
    <Disclosure className="min-w-0">
      <DisclosureSummary className="cursor-pointer break-words">
        <span>{label}</span>
        <Text as="span" tone="default" className="ml-2">
          {text.slice(0, 150)}…
        </Text>
      </DisclosureSummary>
      <Surface
        as="p"
        variant="body"
        tone="default"
        className="mt-1 whitespace-pre-wrap break-words"
      >
        {text}
      </Surface>
    </Disclosure>
  ) : (
    <Text as="p" textRole="body-small" className="min-w-0 break-words">
      <Text as="span" tone="muted" className="mr-2">
        {label}
      </Text>
      <span className="whitespace-pre-wrap">{text}</span>
    </Text>
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
    <Surface
      aria-label="Edit Project Info"
      as="form"
      variant="footer"
      className="mt-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void onSave();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="grid"
        >
          Proposal Number
          <Input
            aria-label="Proposal Number"

            value={value.proposalNumber}
            maxLength={300}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, proposalNumber: event.target.value })
            }
          />
        </Surface>
        {(
          [
            ['companyUrl', 'iSales / Company Link'],
            ['cpqUrl', 'CPQ Link'],
          ] as const
        ).map(([field, label]) => (
          <Surface
            key={field}
            as="label"
            variant="field"
            textRole="body-small"
            className="grid"
          >
            {label}
            <Input
              aria-label={label}
              type="text"
              inputMode="url"

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
              <Text id={`${field}-error`} as="span" tone="danger">
                {linkErrors[field]}
              </Text>
            )}
          </Surface>
        ))}
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="grid content-start"
        >
          Technical Document Version
          <Input
            aria-label="Technical Document Version"

            value={value.technicalBasis}
            maxLength={10000}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, technicalBasis: event.target.value })
            }
          />
        </Surface>
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="grid xl:col-span-2"
        >
          Scope Brief
          <Textarea
            aria-label="Scope Brief"
            className="min-h-20 w-full resize-y"
            rows={2}
            value={value.scopeBrief}
            maxLength={10000}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, scopeBrief: event.target.value })
            }
          />
        </Surface>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        {dirty && (
          <Text as="span" tone="warning" textRole="body-small">
            Unsaved info
          </Text>
        )}
      </div>
    </Surface>
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
    <Surface
      htmlFor="project-workflow-on-hold"
      as="label"
      variant="inline-field"
      tone={onHold ? 'warning' : 'muted'}
      textRole="body-small"
      className="inline-flex items-center gap-2"
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
      <span className="whitespace-nowrap">Project On Hold</span>
    </Surface>
  );
}

export type ProjectWorkflowHeaderProps = {
  project: Project;
  round: string;
  currency?: string;
  onEditProject?: () => void;
  status?: string;
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

/** Group project navigation, monitoring and reference editing in the shared compact header. */
export function ProjectWorkflowHeader({
  project,
  round,
  onEditProject,
  status,
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
    <Surface
      aria-label="Project Workflow Info"
      as="section"
      variant="panel"
      padded
      className="min-w-0"
    >
      <ContextBand
        project={project}
        proposalNumber={value.proposalNumber}
        companyUrl={value.companyUrl}
        cpqUrl={value.cpqUrl}
        costVersion={round}
        versionLabel="Current Round"
        versionStatus={status || (onHold ? 'On Hold' : 'In Progress')}
        onEdit={onEditProject || (() => setEditing((current) => !current))}
        editDisabled={disabled}
        action={
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
                <RefreshCw className="size-4" aria-hidden="true" />
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
        }
      />
      {!editing && (
        <div className="mt-2 grid min-w-0 gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)]">
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
        <Text
          role="alert"
          as="p"
          tone="danger"
          textRole="body-small"
          className="mt-2"
        >
          {error}
        </Text>
      )}
    </Surface>
  );
}
