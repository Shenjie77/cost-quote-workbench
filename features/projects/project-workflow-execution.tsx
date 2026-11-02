import { Badge } from '@/components/ui/badge';
import { Text, Surface } from '@/components/ui/presentation';
import { Textarea } from '@/components/ui/textarea';
import { CheckInput } from '@/components/ui/check-input';
/** Project execution cards share the domain's phase ordering and SLA urgency. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WorkbenchWorkspace } from '@/features/workbench/workspace-types';
import type { WorkflowStep, WorkflowState } from './types';
import {
  workflowPhaseGroups,
  workflowUrgency,
  workflowComplete,
  workflowActionBlockers,
  type WorkflowAction,
} from './workflow-engine';

const stateLabels: Record<WorkflowState, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  awaiting_review: 'Awaiting Review',
  completed: 'Completed',
  blocked: 'Blocked',
  skipped: 'Skipped',
  paused: 'Paused',
};
const dateTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('en-SG', {
        timeZone: 'Asia/Singapore',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date)
    : '—';
};

export function ProjectWorkflowExecution({
  workspace,
  onAction,
  busy = false,
  focusNodeCode,
}: {
  workspace: WorkbenchWorkspace;
  onAction: (action: WorkflowAction) => Promise<void>;
  busy?: boolean;
  focusNodeCode?: string;
}) {
  const phases = workflowPhaseGroups(workspace.processSteps);
  const complete = workflowComplete(workspace);
  const completedCount = workspace.processSteps.filter((step) =>
    ['completed', 'skipped'].includes(step.state),
  ).length;
  return (
    <section className="space-y-3">
      <Surface
        as="div"
        variant={complete ? 'notice' : 'inset'}
        tone={complete ? 'success' : 'inherit'}
        className=""
        padded
      >
        <Text as="p" textRole="body-main">
          {complete
            ? 'This workflow round is complete. Project reminders have stopped.'
            : 'Record each step using the actual progress on the company platform.'}
        </Text>
        <Text as="p" tone="muted" textRole="body-small" className="mt-1">
          Completed or skipped: {completedCount} /{' '}
          {workspace.processSteps.length} · Tasks in a parallel group can run
          together. Later required steps depend on their prerequisites.
        </Text>
      </Surface>
      {phases.map((phase, index) => (
        <section key={phase.id} className="space-y-2">
          <Surface
            as="div"
            tone="primary"
            textRole="body-small"
            className="flex items-center gap-2"
          >
            <Badge className="financial-numeral flex items-center justify-center">
              {index + 1}
            </Badge>
            {phase.parallel
              ? `${phase.name} · Parallel`
              : phase.steps[0].name || phase.steps[0].nameZh}
          </Surface>
          <Surface
            as="div"
            variant={phase.parallel ? 'panel' : 'plain'}
            tone={'inherit'}
            className={
              phase.parallel ? 'grid gap-3 md:grid-cols-2' : 'space-y-3'
            }
            padded
          >
            {phase.steps.map((step) => (
              <WorkflowExecutionNode
                key={`${step.code}:${step.updatedAt || ''}:${step.state}`}
                step={step}
                parallel={phase.parallel}
                blockers={workflowActionBlockers(workspace, step.code)}
                onAction={onAction}
                busy={busy || complete}
                focused={step.code === focusNodeCode}
              />
            ))}
          </Surface>
        </section>
      ))}
    </section>
  );
}

export function WorkflowExecutionNode({
  step,
  parallel,
  blockers = [],
  onAction,
  busy = false,
  focused = false,
}: {
  step: WorkflowStep;
  parallel?: boolean;
  blockers?: string[];
  onAction: (action: WorkflowAction) => Promise<void>;
  busy?: boolean;
  focused?: boolean;
}) {
  const card = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<WorkflowAction['action'] | null>(() =>
    focused && !['completed', 'skipped'].includes(step.state) ? 'update' : null,
  );
  useEffect(() => {
    if (focused)
      card.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused]);
  const [value, setValue] = useState<WorkflowActionDraft>(() => ({
    owner: step.owner,
    note: step.note || '',
    followUpDate: step.followUpDate || '',
    fields: step.fieldValues || {},
    confirmed: false,
    reason: '',
  }));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const disabled = busy || working;
  const pending = step.state === 'not_started';
  const paused = step.state === 'paused';
  const done = ['completed', 'skipped'].includes(step.state);
  const active = !pending && !paused && !done;
  const urgency = workflowUrgency(step);
  const urgencyLabel = {
    none: '',
    normal: 'On Track',
    immediate: 'Follow-up Required',
    urgent: 'Urgent Follow-up',
  }[urgency];
  const run = async (request: WorkflowAction) => {
    if (disabled) return;
    setWorking(true);
    setError('');
    try {
      await onAction(request);
      setMode(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to update this step.',
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <Surface
      ref={card}
      as="article"
      variant="panel"
      selected={focused}
      tone={
        urgency === 'urgent'
          ? 'danger'
          : urgency === 'immediate'
            ? 'warning'
            : 'inherit'
      }
      className=""
      padded
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Text as="p" textRole="body-main">
            {step.name || step.nameZh}
          </Text>
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {step.owner || 'Owner not assigned'} ·{' '}
            {step.required ? 'Required Step' : 'Optional Step'}
          </Text>
        </div>
        <Badge className="shrink-0">{stateLabels[step.state]}</Badge>
      </div>
      <Surface
        as="div"
        textRole="body-small"
        className="mt-2 grid gap-2 sm:grid-cols-2"
      >
        <p>Started: {dateTime(step.startedAt)}</p>
        <Text
          as="p"
          tone={urgency === 'urgent' ? 'danger' : 'inherit'}
          className=""
        >
          Due: {dateTime(step.dueAt)}
        </Text>
      </Surface>
      {urgencyLabel && !done && (
        <Text
          as="p"
          tone={
            urgency === 'urgent'
              ? 'danger'
              : urgency === 'immediate'
                ? 'warning'
                : 'muted'
          }
          textRole="body-small"
          className="mt-2"
        >
          {urgencyLabel}
          {step.followUpDate ? ` · Follow-up: ${step.followUpDate}` : ''}
        </Text>
      )}
      {paused && (
        <Text as="p" tone="warning" textRole="body-small" className="mt-2">
          Paused · Planned resume: {step.followUpDate || 'Not set'}
        </Text>
      )}
      {step.note && (
        <Text
          as="p"
          tone="muted"
          textRole="body-small"
          className="mt-2 whitespace-pre-wrap"
        >
          {step.note}
        </Text>
      )}
      {step.detail && (
        <Text
          as="p"
          tone="muted"
          textRole="body-small"
          className="mt-2 whitespace-pre-wrap"
        >
          Requirements: {step.detail}
        </Text>
      )}
      {done && step.completedAt && (
        <Text as="p" tone="muted" textRole="body-small" className="mt-2">
          {step.state === 'skipped' ? 'Skipped at' : 'Completed at'}:
          {dateTime(step.completedAt)}
        </Text>
      )}
      {!mode && Object.keys(step.fieldValues || {}).length > 0 && (
        <Surface
          as="dl"
          variant="panel"
          padded
          textRole="body-small"
          className="mt-2 space-y-1"
        >
          {Object.entries(step.fieldValues || {}).map(([field, value]) => (
            <div key={field} className="flex flex-wrap gap-2">
              <dt className="shrink-0">{field}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </Surface>
      )}
      {pending && blockers.length > 0 && (
        <Surface
          as="ul"
          variant="body"
          tone="warning"
          textRole="body-small"
          className="mt-2 list-disc space-y-1"
        >
          {blockers.map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </Surface>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {pending && (
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void run({ nodeCode: step.code, action: 'start' })}
          >
            {parallel ? 'Start Group' : 'Start'}
          </Button>
        )}
        {active && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setMode('complete');
                setValue({ ...value, confirmed: false });
              }}
            >
              Complete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => setMode('pause')}
            >
              Pause
            </Button>
          </>
        )}
        {paused && (
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void run({ nodeCode: step.code, action: 'resume' })}
          >
            Resume
          </Button>
        )}
        {!done && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setMode('update')}
          >
            Update
          </Button>
        )}
        {!done && !step.required && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => setMode('skip')}
          >
            Skip
          </Button>
        )}
        {done && !step.required && !step.finishesWorkflow && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => setMode('reopen')}
          >
            Reopen
          </Button>
        )}
      </div>
      {mode && (
        <WorkflowNodeActionForm
          step={step}
          action={mode}
          value={value}
          onChange={setValue}
          onSubmit={run}
          onCancel={() => setMode(null)}
          busy={disabled}
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

export type WorkflowActionDraft = {
  owner: string;
  note: string;
  followUpDate: string;
  fields: Record<string, string>;
  confirmed: boolean;
  reason: string;
};

/** The real form stages input and only emits a valid, explicitly confirmed action. */
export function WorkflowNodeActionForm({
  step,
  action: mode,
  value,
  onChange,
  onSubmit,
  onCancel,
  busy = false,
}: {
  step: WorkflowStep;
  action: WorkflowAction['action'];
  value: WorkflowActionDraft;
  onChange: (value: WorkflowActionDraft) => void;
  onSubmit: (action: WorkflowAction) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const { owner, note, followUpDate, fields, confirmed, reason } = value;
  const disabled = busy;
  const requiresReason =
    mode === 'skip' || mode === 'pause' || mode === 'reopen';
  const missingFields =
    mode === 'complete' &&
    (step.requiredFields || []).some((field) => !fields[field]?.trim());
  const submitDisabled =
    disabled ||
    !owner.trim() ||
    !!missingFields ||
    (mode === 'complete' && step.required && !confirmed) ||
    (requiresReason && !reason.trim()) ||
    (mode === 'pause' && !followUpDate);

  const submit = () => {
    if (submitDisabled) return;
    void onSubmit({
      nodeCode: step.code,
      action: mode,
      owner,
      note,
      followUpDate,
      ...(mode === 'reopen'
        ? {}
        : {
            fields: Object.fromEntries(
              (step.requiredFields || []).map((field) => [
                field,
                fields[field] || '',
              ]),
            ),
          }),
      ...(mode === 'complete' ? { confirmed } : {}),
      ...(reason.trim() ? { reason: reason.trim() } : {}),
    });
  };
  return (
    <Surface as="div" variant="footer" className="mt-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="block"
        >
          Owner
          <Input
            aria-label="Step Owner"
            value={owner}
            disabled={disabled}
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
          {mode === 'pause'
            ? 'Planned Resume Date (Required)'
            : 'Next Follow-up Date'}
          <Input
            aria-label="Step Follow-up Date"
            type="date"
            value={followUpDate}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, followUpDate: event.target.value })
            }
          />
        </Surface>
      </div>
      {mode !== 'reopen' &&
        (step.requiredFields || []).map((field) => (
          <Surface
            key={field}
            as="label"
            variant="field"
            textRole="body-small"
            className="block"
          >
            {field}
            {mode === 'complete' ? ' (Required to complete)' : ''}
            <Input
              aria-label={`Step Information: ${field}`}
              value={fields[field] || ''}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  fields: { ...fields, [field]: event.target.value },
                })
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
        Progress Note
        <Textarea
          aria-label="Step Progress Note"
          rows={3}
          className="w-full"
          value={note}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </Surface>
      {requiresReason && (
        <Surface
          as="label"
          variant="field"
          textRole="body-small"
          className="block"
        >
          {mode === 'pause'
            ? 'Reason for Pausing'
            : mode === 'skip'
              ? 'Reason for Skipping'
              : 'Reason for Reopening'}
          <Input
            aria-label="Action Reason"
            value={reason}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, reason: event.target.value })
            }
          />
        </Surface>
      )}
      {mode === 'complete' && step.required && (
        <Surface
          as="label"
          variant="inline-field"
          textRole="body-small"
          className="flex items-start"
        >
          <CheckInput
            type="checkbox"
            aria-label="Confirm Required Step Completion"
            checked={confirmed}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...value, confirmed: event.target.checked })
            }
          />
          <span>
            I have checked the company platform and confirm that this required
            step is complete and the information above is accurate.
          </span>
        </Surface>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!!submitDisabled}
          onClick={submit}
        >
          {mode === 'complete'
            ? 'Confirm Completion'
            : mode === 'skip'
              ? 'Confirm Skip'
              : mode === 'pause'
                ? 'Confirm Pause'
                : mode === 'reopen'
                  ? 'Confirm Reopen'
                  : 'Save Update'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </Surface>
  );
}
