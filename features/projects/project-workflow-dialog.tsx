import {
  Surface,
  Disclosure,
  DisclosureSummary,
  Text,
} from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
/** One company-process register, with earlier review evidence available read-only. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { Project, WorkflowStep } from './types';
import {
  projectWorkflowSteps,
  QUOTE_COMPLETED,
  type ProjectWorkflowPatch,
} from './workflow-domain';
import type { WorkbenchWorkspace } from '../workbench/workspace-types';
import type { SsrWorkspace } from '../ssr/domain';
import type { WorkflowAction } from './workflow-engine';
import { ProjectWorkflowExecution } from './project-workflow-execution';

export type ProjectWorkflowMeta = Pick<
  SsrWorkspace,
  'proposalNumber' | 'scopeBrief' | 'companyUrl' | 'cpqUrl' | 'technicalBasis'
>;
export type ProjectWorkflowFormValue = Required<ProjectWorkflowPatch>;

export function projectWorkflowFormValue(
  workspace: WorkbenchWorkspace,
): ProjectWorkflowFormValue {
  const step = workspace.processSteps.find(
    (item) => item.code === workspace.currentWorkflowStepCode,
  );
  return {
    currentWorkflowStepCode: workspace.currentWorkflowStepCode,
    owner: step?.owner || '',
    followUpDate: step?.followUpDate || '',
    note: step?.note || '',
  };
}

/** Stateless fields keep all edits local until the one Save action. */
export function ProjectWorkflowFields({
  value,
  steps,
  onChange,
  busy = false,
}: {
  value: ProjectWorkflowFormValue;
  steps: WorkflowStep[];
  onChange: (value: ProjectWorkflowFormValue) => void;
  busy?: boolean;
}) {
  const completed = value.currentWorkflowStepCode === QUOTE_COMPLETED;
  return (
    <div className="space-y-3">
      <Surface
        as="label"
        variant="field"
        textRole="body-small"
        className="block"
      >
        Current Workflow
        <SelectField
          aria-label="Current Workflow"
          value={value.currentWorkflowStepCode}
          disabled={busy}
          required
          className="h-10 w-full"
          onChange={(event) => {
            const target = steps.find(
              (step) => step.code === event.target.value,
            );
            if (!target) return;
            onChange({
              currentWorkflowStepCode: target.code,
              owner: target.owner || value.owner,
              followUpDate: target.followUpDate || '',
              note: target.note || '',
            });
          }}
        >
          {steps.map((step) => (
            <option key={step.code} value={step.code}>
              {step.name || step.nameZh}
            </option>
          ))}
        </SelectField>
      </Surface>
      <div className="grid gap-3 sm:grid-cols-2">
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="block"
        >
          Owner
          <Input
            aria-label="Workflow Owner"
            value={value.owner}
            disabled={busy}
            required
            maxLength={200}
            onChange={(event) =>
              onChange({ ...value, owner: event.target.value })
            }
          />
        </Surface>
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="block"
        >
          Next Follow-up
          <Input
            aria-label="Next Follow-up"
            type="date"
            value={value.followUpDate}
            disabled={busy || completed}
            onChange={(event) =>
              onChange({ ...value, followUpDate: event.target.value })
            }
          />
        </Surface>
      </div>
      <Text
        as="p"
        tone={completed ? 'primary' : 'muted'}
        textRole="body-small"
        className=""
      >
        {completed
          ? 'Project reminders stop after the quotation is complete. A new cost round restarts the workflow.'
          : 'Record actual progress from the company platform. Projects without a follow-up date are flagged for scheduling.'}
      </Text>
      <Surface
        as="label"
        variant="field"
        textRole="body-small"
        className="block"
      >
        Progress / Follow-up Note
        <Textarea
          aria-label="Workflow Note"
          value={value.note}
          disabled={busy}
          rows={3}
          maxLength={10000}
          className="w-full resize-y"
          placeholder="Example: PM submitted DRB on the company platform; awaiting the result. Reference: DRB-2026-001."
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </Surface>
    </div>
  );
}

/** Historical submissions are evidence only; they do not create another editable process. */
export function ProjectWorkflowHistory({
  workspace,
}: {
  workspace: WorkbenchWorkspace;
}) {
  const label = (code: string, costVersion?: string) => {
    // A later round may reuse a node identity with a different business name.
    const steps = [
      ...(costVersion
        ? [
            ...(workspace.versionWorkflows?.[costVersion]?.processSteps || []),
            ...(workspace.legacyWorkflowArchive?.[costVersion]?.processSteps ||
              []),
            ...(workspace.deletedCostVersions?.[costVersion]?.workflow
              .processSteps || []),
          ]
        : []),
      ...workspace.processSteps,
    ];
    const step = steps.find((item) => item.code === code);
    return step ? step.name || step.nameZh : 'Historical Stage';
  };
  const updates = [...(workspace.workflowUpdates || [])].reverse();
  const submissions = [...(workspace.ssr?.submissions || [])].reverse();
  const gates = [...workspace.reviewGates].sort((a, b) =>
    b.lastUpdatedAt.localeCompare(a.lastUpdatedAt),
  );
  return (
    <Disclosure>
      <DisclosureSummary className="cursor-pointer">
        Workflow History (Read Only)
      </DisclosureSummary>
      <Surface
        as="div"
        textRole="body-small"
        className="mt-4 max-h-80 space-y-4 overflow-y-auto"
      >
        {!updates.length && !submissions.length && !gates.length && (
          <Text as="p" tone="muted">
            No history recorded.
          </Text>
        )}
        {updates.map((entry) => (
          <Surface key={entry.id} as="article" variant="panel" padded>
            <p>
              {entry.costVersion} · {label(entry.toStepCode, entry.costVersion)}
            </p>
            <Text as="p" tone="muted" className="mt-1">
              Recorded: {entry.updatedAt} · {entry.owner} · Follow-up:
              {entry.followUpDate || 'Not set'}
            </Text>
            {entry.fromStepCode !== entry.toStepCode && (
              <Text as="p" tone="muted" className="mt-1">
                From: {label(entry.fromStepCode, entry.costVersion)}
              </Text>
            )}
            <p className="mt-1 whitespace-pre-wrap">
              {entry.note || 'No additional notes'}
            </p>
            {entry.action && (
              <Text as="p" tone="muted" className="mt-1">
                Action:
                {(
                  {
                    start: 'Start',
                    complete: 'Confirm Completion',
                    skip: 'Skip',
                    update: 'Update',
                    pause: 'Pause',
                    resume: 'Resume',
                    reopen: 'Reopen',
                  } as Record<string, string>
                )[entry.action] || 'Workflow Update'}
              </Text>
            )}
            {(entry.startedAt || entry.dueAt) && (
              <Text as="p" tone="muted" className="mt-1">
                Recorded start: {entry.startedAt || 'Not recorded'} · Recorded
                deadline:
                {entry.dueAt || 'Not recorded'}
              </Text>
            )}
            {!!Object.keys(entry.fields || {}).length && (
              <Surface
                as="dl"
                variant="panel"
                padded
                className="mt-2 space-y-1"
              >
                {Object.entries(entry.fields || {}).map(([field, value]) => (
                  <div key={field} className="flex gap-2">
                    <dt>{field}</dt>
                    <dd className="whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              </Surface>
            )}
          </Surface>
        ))}
        {submissions.map((entry) => (
          <Surface key={entry.id} as="article" variant="panel" padded>
            <p>
              Historical Review · {entry.costBaseline.code} · {entry.kind}
              {entry.domain ? ` · ${entry.domain}` : ''}
            </p>
            <Text as="p" tone="muted" className="mt-1">
              Recorded: {entry.createdAt} · {entry.owner} · Reference:
              {entry.applicationNumber || 'Not recorded'}
            </Text>
            {entry.evidence && (
              <p className="mt-1 whitespace-pre-wrap">{entry.evidence}</p>
            )}
            {entry.results.map((result) => (
              <p key={result.id} className="mt-1 whitespace-pre-wrap">
                {result.recordedAt} · {result.outcome} · {result.evidence}
                {result.conditions.length
                  ? ` · Conditions: ${result.conditions.join('; ')}`
                  : ''}
              </p>
            ))}
            {entry.closures.map((closure, index) => (
              <p
                key={`${closure.resultId}-${index}`}
                className="mt-1 whitespace-pre-wrap"
              >
                {closure.recordedAt} · Closed condition: {closure.condition} ·{' '}
                {closure.evidence}
              </p>
            ))}
            {entry.followUps.map((followUp) => (
              <p key={followUp.id} className="mt-1 whitespace-pre-wrap">
                {followUp.recordedAt} · {followUp.note} · Next follow-up:
                {followUp.nextDate || 'Not set'}
              </p>
            ))}
          </Surface>
        ))}
        {gates.map((entry) => (
          <Surface key={entry.id} as="article" variant="panel" padded>
            <p>
              Historical Checkpoint ·{' '}
              {entry.costVersion || 'Version not recorded'} ·{' '}
              {entry.gate || entry.gateZh}
            </p>
            {entry.workflowStepCode && (
              <Text as="p" tone="muted" className="mt-1">
                Workflow: {label(entry.workflowStepCode, entry.costVersion)}
              </Text>
            )}
            <Text as="p" tone="muted" className="mt-1">
              Recorded: {entry.lastUpdatedAt || 'Time not recorded'} ·{' '}
              {entry.owner} · {entry.status}
            </Text>
            <p className="mt-1 whitespace-pre-wrap">
              {entry.note}
              {entry.noteZh && entry.noteZh !== entry.note
                ? ` · ${entry.noteZh}`
                : ''}
            </p>
            {entry.followUps.map((followUp) => (
              <p key={followUp.id} className="mt-1 whitespace-pre-wrap">
                {followUp.createdAt} · {followUp.summary} · Next follow-up:
                {followUp.nextFollowUpAt || 'Not set'}
              </p>
            ))}
          </Surface>
        ))}
      </Surface>
    </Disclosure>
  );
}

export function ProjectWorkflowDialog({
  project,
  workspace,
  onSave,
  onAction,
  focusNodeCode,
  onClose,
  busy = false,
  error = '',
}: {
  project: Project;
  workspace: WorkbenchWorkspace;
  onSave: (
    patch: ProjectWorkflowPatch,
    meta: ProjectWorkflowMeta,
  ) => void | Promise<void>;
  onAction?: (action: WorkflowAction) => Promise<void>;
  focusNodeCode?: string;
  onClose: () => void;
  busy?: boolean;
  error?: string;
}) {
  const [value, setValue] = useState(() => projectWorkflowFormValue(workspace));
  const [meta, setMeta] = useState<ProjectWorkflowMeta>(() => ({
    proposalNumber: workspace.ssr?.proposalNumber || '',
    scopeBrief: workspace.ssr?.scopeBrief || '',
    companyUrl: workspace.ssr?.companyUrl || '',
    technicalBasis: workspace.ssr?.technicalBasis || '',
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const disabled = busy || saving;
  const save = async () => {
    if (disabled || (!onAction && !value.owner.trim())) return;
    setSaving(true);
    setSaveError('');
    try {
      await onSave(onAction ? {} : value, meta);
    } catch (cause) {
      setSaveError(
        cause instanceof Error ? cause.message : 'Unable to save the workflow.',
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !disabled) onClose();
      }}
    >
      <DialogContent
        size="lg"
        className="overflow-y-auto"
        showCloseButton={!disabled}
      >
        <DialogHeader>
          <DialogTitle>Project Workflow</DialogTitle>
          <DialogDescription>
            {project.name} · Workflow round{' '}
            {workspace.workflowVersion || workspace.activeVersion}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {onAction ? (
            <ProjectWorkflowExecution
              workspace={workspace}
              onAction={onAction}
              busy={disabled}
              focusNodeCode={focusNodeCode}
            />
          ) : (
            <ProjectWorkflowFields
              value={value}
              steps={projectWorkflowSteps(workspace)}
              onChange={setValue}
              busy={disabled}
            />
          )}
          <Disclosure>
            <DisclosureSummary className="cursor-pointer">
              Project References
            </DisclosureSummary>
            <div className="mt-3 space-y-3">
              {(
                [
                  ['proposalNumber', 'Proposal Number'],
                  ['companyUrl', 'Company Platform Link'],
                  ['technicalBasis', 'Technical Document Version'],
                ] as const
              ).map(([key, label]) => (
                <Surface
                  key={key}
                  as="label"
                  variant="field"
                  textRole="body-small"
                  className="block"
                >
                  {label}
                  <Input
                    value={meta[key]}
                    disabled={disabled}
                    maxLength={2000}
                    onChange={(event) =>
                      setMeta({ ...meta, [key]: event.target.value })
                    }
                  />
                </Surface>
              ))}
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                Scope Brief
                <Textarea
                  value={meta.scopeBrief}
                  disabled={disabled}
                  rows={3}
                  maxLength={10000}
                  className="w-full"
                  onChange={(event) =>
                    setMeta({ ...meta, scopeBrief: event.target.value })
                  }
                />
              </Surface>
            </div>
          </Disclosure>
          <ProjectWorkflowHistory workspace={workspace} />
          {(error || saveError) && (
            <Text role="alert" as="p" tone="danger" textRole="body-main">
              {error || saveError}
            </Text>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={disabled || (!onAction && !value.owner.trim())}
            >
              {disabled
                ? 'Saving…'
                : onAction
                  ? 'Save References'
                  : 'Save Workflow'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
