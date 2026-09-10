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
      <label className="block space-y-1.5 text-xs font-medium">
        Current Workflow
        <select
          aria-label="Current Workflow"
          value={value.currentWorkflowStepCode}
          disabled={busy}
          required
          className="h-10 w-full rounded-lg border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20"
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
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5 text-xs font-medium">
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
        </label>
        <label className="block space-y-1.5 text-xs font-medium">
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
        </label>
      </div>
      <p
        className={`text-xs ${completed ? 'text-[#177c80]' : 'text-muted-foreground'}`}
      >
        {completed
          ? 'Project reminders stop after the quotation is complete. A new cost round restarts the workflow.'
          : 'Record actual progress from the company platform. Projects without a follow-up date are flagged for scheduling.'}
      </p>
      <label className="block space-y-1.5 text-xs font-medium">
        Progress / Follow-up Note
        <textarea
          aria-label="Workflow Note"
          value={value.note}
          disabled={busy}
          rows={3}
          maxLength={10000}
          className="w-full resize-y rounded-lg border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
          placeholder="Example: PM submitted DRB on the company platform; awaiting the result. Reference: DRB-2026-001."
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </label>
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
    <details className="wb-panel px-5 py-4">
      <summary className="cursor-pointer rounded-md text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
        Workflow History (Read Only)
      </summary>
      <div className="mt-4 max-h-80 space-y-4 overflow-y-auto text-xs leading-5">
        {!updates.length && !submissions.length && !gates.length && (
          <p className="text-muted-foreground">No history recorded.</p>
        )}
        {updates.map((entry) => (
          <article
            key={entry.id}
            className="rounded-lg border border-border bg-muted/15 p-4"
          >
            <p className="font-medium">
              {entry.costVersion} · {label(entry.toStepCode, entry.costVersion)}
            </p>
            <p className="mt-1 text-muted-foreground">
              Recorded: {entry.updatedAt} · {entry.owner} · Follow-up:
              {entry.followUpDate || 'Not set'}
            </p>
            {entry.fromStepCode !== entry.toStepCode && (
              <p className="mt-1 text-muted-foreground">
                From: {label(entry.fromStepCode, entry.costVersion)}
              </p>
            )}
            <p className="mt-1 whitespace-pre-wrap">
              {entry.note || 'No additional notes'}
            </p>
            {entry.action && (
              <p className="mt-1 text-muted-foreground">
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
              </p>
            )}
            {(entry.startedAt || entry.dueAt) && (
              <p className="mt-1 text-muted-foreground">
                Recorded start: {entry.startedAt || 'Not recorded'} · Recorded
                deadline:
                {entry.dueAt || 'Not recorded'}
              </p>
            )}
            {!!Object.keys(entry.fields || {}).length && (
              <dl className="mt-2 space-y-1 rounded border p-2">
                {Object.entries(entry.fields || {}).map(([field, value]) => (
                  <div key={field} className="flex gap-2">
                    <dt className="font-medium">{field}</dt>
                    <dd className="whitespace-pre-wrap">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </article>
        ))}
        {submissions.map((entry) => (
          <article
            key={entry.id}
            className="rounded-lg border border-border bg-muted/15 p-4"
          >
            <p className="font-medium">
              Historical Review · {entry.costBaseline.code} · {entry.kind}
              {entry.domain ? ` · ${entry.domain}` : ''}
            </p>
            <p className="mt-1 text-muted-foreground">
              Recorded: {entry.createdAt} · {entry.owner} · Reference:
              {entry.applicationNumber || 'Not recorded'}
            </p>
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
          </article>
        ))}
        {gates.map((entry) => (
          <article
            key={entry.id}
            className="rounded-lg border border-border bg-muted/15 p-4"
          >
            <p className="font-medium">
              Historical Checkpoint ·{' '}
              {entry.costVersion || 'Version not recorded'} ·{' '}
              {entry.gate || entry.gateZh}
            </p>
            {entry.workflowStepCode && (
              <p className="mt-1 text-muted-foreground">
                Workflow: {label(entry.workflowStepCode, entry.costVersion)}
              </p>
            )}
            <p className="mt-1 text-muted-foreground">
              Recorded: {entry.lastUpdatedAt || 'Time not recorded'} ·{' '}
              {entry.owner} · {entry.status}
            </p>
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
          </article>
        ))}
      </div>
    </details>
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
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
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
          <details className="wb-panel px-5 py-4">
            <summary className="cursor-pointer rounded-md text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring/30">
              Project References
            </summary>
            <div className="mt-3 space-y-3">
              {(
                [
                  ['proposalNumber', 'Proposal Number'],
                  ['companyUrl', 'Company Platform Link'],
                  ['technicalBasis', 'Technical Document Version'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="block space-y-1.5 text-xs font-medium"
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
                </label>
              ))}
              <label className="block space-y-1.5 text-xs font-medium">
                Scope Brief
                <textarea
                  value={meta.scopeBrief}
                  disabled={disabled}
                  rows={3}
                  maxLength={10000}
                  className="w-full rounded-lg border border-input bg-white px-3 py-2.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
                  onChange={(event) =>
                    setMeta({ ...meta, scopeBrief: event.target.value })
                  }
                />
              </label>
            </div>
          </details>
          <ProjectWorkflowHistory workspace={workspace} />
          {(error || saveError) && (
            <p role="alert" className="text-sm text-destructive">
              {error || saveError}
            </p>
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
