/** A focused project task page: one editor, persistent drafts, canonical actions. */
import { useEffect, useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { WorkbenchWorkspace } from '@/features/workbench/workspace-types';
import type { Project, WorkflowState, WorkflowStep } from './types';
import {
  workflowActionBlockers,
  workflowComplete,
  workflowNodeActive,
  workflowPhaseGroups,
  workflowUrgency,
  type WorkflowAction,
} from './workflow-engine';
import {
  ProjectWorkflowHistory,
  type ProjectWorkflowMeta,
} from './project-workflow-dialog';
import { ProjectWorkflowHeader } from './project-workflow-header';
import {
  WorkflowNodeActionForm,
  type WorkflowActionDraft,
} from './project-workflow-execution';

const stateLabels: Record<WorkflowState, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  awaiting_review: 'Awaiting Review',
  completed: 'Completed',
  blocked: 'Blocked',
  skipped: 'Skipped',
  paused: 'Paused',
};
const isDone = (step: WorkflowStep) =>
  step.state === 'completed' || step.state === 'skipped';
const timeLabel = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en-SG', {
        timeZone: 'Asia/Singapore',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : 'Not set';

export function workflowTaskDraft(step: WorkflowStep): WorkflowActionDraft {
  return {
    owner: step.owner || '',
    note: step.note || '',
    followUpDate: step.followUpDate || '',
    fields: Object.fromEntries(
      (step.requiredFields || []).map((field) => [
        field,
        step.fieldValues?.[field] || '',
      ]),
    ),
    confirmed: false,
    reason: '',
  };
}

export function workflowTaskIsDirty(
  step: WorkflowStep,
  draft: WorkflowActionDraft,
) {
  const initial = workflowTaskDraft(step);
  return (
    draft.owner !== initial.owner ||
    draft.note !== initial.note ||
    draft.followUpDate !== initial.followUpDate ||
    draft.confirmed ||
    !!draft.reason ||
    (step.requiredFields || []).some(
      (field) => (draft.fields[field] || '') !== initial.fields[field],
    )
  );
}

/** Selection changes presentation only; it never advances the workflow. */
export function selectWorkflowTask(
  workspace: WorkbenchWorkspace,
  preferredCode?: string,
) {
  const steps = workspace.processSteps;
  const preferred = steps.find((step) => step.code === preferredCode);
  if (preferred) return preferred.code;
  const current = steps.find(
    (step) => step.code === workspace.currentWorkflowStepCode,
  );
  return (
    (current && workflowNodeActive(current) ? current.code : undefined) ||
    steps.find(workflowNodeActive)?.code ||
    steps.find(
      (step) =>
        step.state === 'not_started' &&
        workflowActionBlockers(workspace, step.code).length === 0,
    )?.code ||
    steps.find((step) => step.state === 'paused')?.code ||
    steps.find((step) => !isDone(step))?.code ||
    current?.code ||
    steps[0]?.code ||
    ''
  );
}

/** Completing downstream work must not silently retire an unsaved optional draft. */
export function workflowActionDraftConflicts(
  workspace: WorkbenchWorkspace,
  action: WorkflowAction,
  drafts: Record<string, WorkflowActionDraft>,
) {
  if (action.action !== 'complete') return [];
  const phases = workflowPhaseGroups(workspace.processSteps);
  const position = phases.findIndex((phase) =>
    phase.steps.some((step) => step.code === action.nodeCode),
  );
  return phases
    .slice(0, Math.max(0, position))
    .flatMap((phase) => phase.steps)
    .filter(
      (step) =>
        !step.required &&
        step.autoSkip &&
        !isDone(step) &&
        drafts[step.code] &&
        workflowTaskIsDirty(step, drafts[step.code]),
    )
    .map((step) => step.name || step.nameZh);
}

/** Cost confirmation has its own review UI; other engine blockers disable advancement. */
export function workflowTaskCanAdvance(
  workspace: WorkbenchWorkspace,
  nodeCode: string,
) {
  const versionCode = workspace.workflowVersion || workspace.activeVersion;
  return (
    workflowActionBlockers(
      {
        ...workspace,
        costVersions: workspace.costVersions.map((version) =>
          version.code === versionCode
            ? { ...version, state: 'Confirmed' as const }
            : version,
        ),
      },
      nodeCode,
    ).length === 0
  );
}

const referencesFrom = (
  workspace: WorkbenchWorkspace,
): ProjectWorkflowMeta => ({
  proposalNumber: workspace.ssr?.proposalNumber || '',
  scopeBrief: workspace.ssr?.scopeBrief || '',
  companyUrl: workspace.ssr?.companyUrl || '',
  cpqUrl: workspace.ssr?.cpqUrl || '',
  technicalBasis: workspace.ssr?.technicalBasis || '',
});

export type ProjectWorkflowPageProps = {
  project: Project;
  workspace: WorkbenchWorkspace;
  onAction: (action: WorkflowAction) => Promise<void>;
  onSaveReferences: (meta: ProjectWorkflowMeta) => Promise<void>;
  onBack: () => void;
  onRefresh: () => Promise<void>;
  onOpenCost: () => void;
  busy?: boolean;
  error?: string;
  focusNodeCode?: string;
  onFocusNode?: (code: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function ProjectWorkflowPage({
  project,
  workspace,
  onAction,
  onSaveReferences,
  onBack,
  onRefresh,
  onOpenCost,
  busy = false,
  error = '',
  focusNodeCode,
  onFocusNode,
  onDirtyChange,
}: ProjectWorkflowPageProps) {
  const [selectedCode, setSelectedCode] = useState(() =>
    selectWorkflowTask(workspace, focusNodeCode),
  );
  const [previousFocus, setPreviousFocus] = useState(focusNodeCode);
  const [drafts, setDrafts] = useState<Record<string, WorkflowActionDraft>>({});
  const [referenceDraft, setReferenceDraft] =
    useState<ProjectWorkflowMeta | null>(null);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState('');
  const [notice, setNotice] = useState('');
  const [advanceFrom, setAdvanceFrom] = useState('');
  if (focusNodeCode !== previousFocus) {
    setPreviousFocus(focusNodeCode);
    setSelectedCode(selectWorkflowTask(workspace, focusNodeCode));
  }
  const finishedAction = workspace.processSteps.find(
    (step) => step.code === advanceFrom,
  );
  if (finishedAction && isDone(finishedAction)) {
    setSelectedCode(selectWorkflowTask(workspace));
    setAdvanceFrom('');
  }
  const phases = workflowPhaseGroups(workspace.processSteps);
  const complete = workflowComplete(workspace);
  const visibleCode = selectWorkflowTask(workspace, selectedCode);
  const selected = workspace.processSteps.find(
    (step) => step.code === visibleCode,
  );
  const dirtyCodes = Object.keys(drafts).filter((code) => {
    const step = workspace.processSteps.find((item) => item.code === code);
    return !step || workflowTaskIsDirty(step, drafts[code]);
  });
  const savedReferences = referencesFrom(workspace);
  const references = referenceDraft || savedReferences;
  const referencesDirty =
    !!referenceDraft &&
    JSON.stringify(referenceDraft) !== JSON.stringify(savedReferences);
  const dirty = dirtyCodes.length > 0 || referencesDirty;
  const disabled = busy || working;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (visibleCode && visibleCode !== focusNodeCode)
      onFocusNode?.(visibleCode);
  }, [visibleCode, focusNodeCode, onFocusNode]);

  const choose = (code: string) => {
    setSelectedCode(code);
    setLocalError('');
    onFocusNode?.(code);
  };
  const run = async (action: WorkflowAction) => {
    if (disabled) return;
    setWorking(true);
    setLocalError('');
    setNotice('');
    try {
      const conflicts = workflowActionDraftConflicts(workspace, action, drafts);
      if (conflicts.length)
        throw new Error(
          `Save or reset changes in ${conflicts.join(', ')} first. Completing this step will automatically skip those optional tasks.`,
        );
      await onAction(action);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[action.nodeCode];
        return next;
      });
      setNotice(
        action.action === 'complete' ? 'Step completed.' : 'Step updated.',
      );
      if (action.action === 'complete' || action.action === 'skip')
        setAdvanceFrom(action.nodeCode);
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : 'Unable to update this step.',
      );
      throw cause;
    } finally {
      setWorking(false);
    }
  };
  const saveReferences = async () => {
    if (disabled || !referencesDirty) return;
    setWorking(true);
    setLocalError('');
    try {
      await onSaveReferences(references);
      setReferenceDraft(null);
      setNotice('Project references saved.');
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : 'Unable to save references.',
      );
      throw cause;
    } finally {
      setWorking(false);
    }
  };
  const refresh = async () => {
    if (disabled) return;
    setWorking(true);
    setLocalError('');
    try {
      await onRefresh();
      setNotice('Workflow refreshed.');
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : 'Unable to refresh.',
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section className="space-y-4" aria-label="Project Workflow Page">
      <ProjectWorkflowHeader
        project={project}
        round={workspace.workflowVersion || workspace.activeVersion}
        currency={workspace.project?.currency || 'SGD'}
        value={references}
        savedValue={savedReferences}
        dirty={referencesDirty}
        busy={disabled}
        onChange={setReferenceDraft}
        onSave={saveReferences}
        onReset={() => setReferenceDraft(null)}
        onBack={onBack}
        onRefresh={refresh}
        onOpenCost={onOpenCost}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <p
          className={
            complete ? 'font-medium text-emerald-700' : 'text-muted-foreground'
          }
        >
          {complete
            ? 'Workflow complete. Reminders have stopped.'
            : 'Select a step, record progress, then save or complete it.'}
        </p>
        <p
          className={
            dirty ? 'font-medium text-amber-800' : 'text-muted-foreground'
          }
        >
          {dirty
            ? [
                dirtyCodes.length > 0
                  ? `${dirtyCodes.length} unsaved task${dirtyCodes.length === 1 ? '' : 's'}`
                  : '',
                referencesDirty ? 'Unsaved project info' : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'All changes saved'}
        </p>
      </div>
      {(error || localError) && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-destructive"
        >
          {localError || error}
        </p>
      )}
      {notice && (
        <output className="block text-xs text-[#2e6f77]">{notice}</output>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <WorkflowTaskSelect
          steps={workspace.processSteps}
          selectedCode={visibleCode}
          dirtyCodes={dirtyCodes}
          onChange={choose}
          busy={disabled}
        />
        <nav
          aria-label="Workflow Steps"
          className="hidden space-y-2 rounded-xl border bg-card p-3 lg:sticky lg:top-4 lg:block lg:max-h-[75vh] lg:overflow-y-auto"
        >
          <div className="mb-3 flex items-center justify-between px-1 text-xs font-semibold">
            <span>Steps</span>
            <span className="text-muted-foreground">
              {workspace.processSteps.filter(isDone).length} /{' '}
              {workspace.processSteps.length} resolved
            </span>
          </div>
          {phases.map((phase, index) => (
            <div
              key={phase.id}
              className={
                phase.parallel
                  ? 'space-y-1 rounded-lg border border-[#c5dad8] bg-[#f2f8f7] p-2'
                  : ''
              }
            >
              {phase.parallel && (
                <p className="px-1 pb-1 text-[11px] font-semibold text-[#2e6f77]">
                  {index + 1}. {phase.name} · Parallel
                </p>
              )}
              {phase.steps.map((step) => (
                <button
                  key={step.code}
                  type="button"
                  aria-label={`Select ${step.name || step.nameZh}`}
                  aria-current={selectedCode === step.code ? 'step' : undefined}
                  disabled={disabled}
                  onClick={() => choose(step.code)}
                  className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left transition-colors disabled:opacity-60 ${selectedCode === step.code ? 'bg-[#173a52] text-white' : 'hover:bg-muted/60'}`}
                >
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] ${selectedCode === step.code ? 'bg-white/15' : 'bg-muted'}`}
                  >
                    {step.state === 'completed' ? (
                      <Check className="size-3" />
                    ) : phase.parallel ? (
                      '•'
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {step.name || step.nameZh}
                      {dirtyCodes.includes(step.code) ? ' *' : ''}
                    </span>
                    <span
                      className={`mt-1 block text-[10px] ${selectedCode === step.code ? 'text-white/75' : 'text-muted-foreground'}`}
                    >
                      {stateLabels[step.state]}
                      {step.owner ? ` · ${step.owner}` : ''}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          {selected ? (
            <WorkflowTaskEditor
              key={selected.code}
              step={selected}
              value={drafts[selected.code] || workflowTaskDraft(selected)}
              onChange={(value) =>
                setDrafts((previous) => ({
                  ...previous,
                  [selected.code]: value,
                }))
              }
              onAction={run}
              onReset={() =>
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[selected.code];
                  return next;
                })
              }
              blockers={workflowActionBlockers(workspace, selected.code)}
              canAdvance={workflowTaskCanAdvance(workspace, selected.code)}
              parallel={phases.some(
                (phase) =>
                  phase.parallel &&
                  phase.steps.some((step) => step.code === selected.code),
              )}
              complete={complete}
              busy={disabled}
            />
          ) : (
            <p className="rounded-xl border bg-card p-6 text-sm">
              No workflow steps are configured.
            </p>
          )}
          <ProjectWorkflowHistory workspace={workspace} />
        </div>
      </div>
    </section>
  );
}

/** A compact switcher puts the editor first on narrow app panels and phones. */
export function WorkflowTaskSelect({
  steps,
  selectedCode,
  dirtyCodes = [],
  onChange,
  busy = false,
}: {
  steps: WorkflowStep[];
  selectedCode: string;
  dirtyCodes?: string[];
  onChange: (code: string) => void;
  busy?: boolean;
}) {
  const phases = workflowPhaseGroups(steps);
  const selectedPhase = phases.find((phase) =>
    phase.steps.some((step) => step.code === selectedCode),
  );
  const option = (step: WorkflowStep) => (
    <option key={step.code} value={step.code}>
      {step.name || step.nameZh} · {stateLabels[step.state]}
      {dirtyCodes.includes(step.code) ? ' *' : ''}
    </option>
  );
  return (
    <div className="space-y-2 rounded-xl border bg-card p-3 lg:hidden">
      <label className="block space-y-1.5 text-xs font-medium">
        Workflow Step
        <select
          aria-label="Select Workflow Step"
          value={selectedCode}
          disabled={busy || !steps.length}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          onChange={(event) => onChange(event.target.value)}
        >
          {phases.map((phase) =>
            phase.parallel ? (
              <optgroup key={phase.id} label={`${phase.name} · Parallel`}>
                {phase.steps.map(option)}
              </optgroup>
            ) : (
              phase.steps.map(option)
            ),
          )}
        </select>
      </label>
      {selectedPhase?.parallel && (
        <p className="text-[11px] text-[#2e6f77]">
          {selectedPhase.name} · {selectedPhase.steps.length} parallel tasks
        </p>
      )}
    </div>
  );
}

/** Presentational editor also exposes the exact real controls to regression tests. */
export function WorkflowTaskFields({
  step,
  value,
  onChange,
  onAction,
  onReset,
  parallel = false,
  busy = false,
  canAdvance = true,
}: {
  step: WorkflowStep;
  value: WorkflowActionDraft;
  onChange: (value: WorkflowActionDraft) => void;
  onAction: (action: WorkflowAction) => Promise<void>;
  onReset: () => void;
  parallel?: boolean;
  busy?: boolean;
  canAdvance?: boolean;
}) {
  const active = workflowNodeActive(step);
  const missingFields = (step.requiredFields || []).filter(
    (field) => !value.fields[field]?.trim(),
  );
  const ownerMissing = !value.owner.trim();
  const send = (action: WorkflowAction['action']) => {
    if (
      busy ||
      ownerMissing ||
      (['start', 'complete'].includes(action) && !canAdvance) ||
      (action === 'complete' &&
        (missingFields.length > 0 || (step.required && !value.confirmed)))
    )
      return;
    void onAction({
      nodeCode: step.code,
      action,
      owner: value.owner,
      note: value.note,
      followUpDate: value.followUpDate,
      fields: Object.fromEntries(
        (step.requiredFields || []).map((field) => [
          field,
          value.fields[field] || '',
        ]),
      ),
      ...(action === 'complete' ? { confirmed: value.confirmed } : {}),
    }).catch(() => {});
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          Owner
          <Input
            aria-label="Task Owner"
            value={value.owner}
            maxLength={200}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, owner: event.target.value })
            }
          />
        </label>
        <label className="block space-y-1 text-xs">
          {step.state === 'paused' ? 'Planned Resume Date' : 'Next Follow-up'}
          <Input
            aria-label="Task Follow-up"
            type="date"
            value={value.followUpDate}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, followUpDate: event.target.value })
            }
          />
        </label>
      </div>
      {(step.requiredFields || []).length > 0 && (
        <div className="space-y-3 rounded-lg border bg-muted/15 p-3">
          <p className="text-xs font-medium">Required to Complete</p>
          {(step.requiredFields || []).map((field) => (
            <label key={field} className="block space-y-1 text-xs">
              {field}
              <Input
                aria-label={`Task Information: ${field}`}
                value={value.fields[field] || ''}
                maxLength={10000}
                disabled={busy}
                onChange={(event) =>
                  onChange({
                    ...value,
                    fields: { ...value.fields, [field]: event.target.value },
                  })
                }
              />
            </label>
          ))}
        </div>
      )}
      <label className="block space-y-1 text-xs">
        Progress Note
        <textarea
          aria-label="Task Progress Note"
          rows={4}
          maxLength={10000}
          value={value.note}
          disabled={busy}
          placeholder="Record the latest progress, decision, or company-platform reference."
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
          onChange={(event) => onChange({ ...value, note: event.target.value })}
        />
      </label>
      {active && step.required && (
        <label className="flex items-start gap-2 rounded-lg border border-[#c5dad8] bg-[#f2f8f7] p-3 text-xs">
          <input
            type="checkbox"
            aria-label="Confirm Task Completion"
            className="mt-0.5"
            checked={value.confirmed}
            disabled={busy}
            onChange={(event) =>
              onChange({ ...value, confirmed: event.target.checked })
            }
          />
          <span>
            I have checked the company platform and confirm this step is
            complete and the information above is accurate.
          </span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        {active && (
          <Button
            type="button"
            disabled={
              busy ||
              ownerMissing ||
              !canAdvance ||
              missingFields.length > 0 ||
              (step.required && !value.confirmed)
            }
            onClick={() => send('complete')}
          >
            <Check /> Complete Step
          </Button>
        )}
        {step.state === 'not_started' && (
          <Button
            type="button"
            disabled={busy || ownerMissing || !canAdvance}
            onClick={() => send('start')}
          >
            {parallel ? 'Start Parallel Group' : 'Start Step'} <ArrowRight />
          </Button>
        )}
        {step.state === 'paused' && (
          <Button
            type="button"
            disabled={busy || ownerMissing}
            onClick={() => send('resume')}
          >
            Resume Step <ArrowRight />
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          disabled={busy || ownerMissing || !workflowTaskIsDirty(step, value)}
          onClick={() => send('update')}
        >
          Save Update
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy || !workflowTaskIsDirty(step, value)}
          onClick={onReset}
        >
          Reset Changes
        </Button>
      </div>
      {active &&
        (missingFields.length > 0 || (step.required && !value.confirmed)) && (
          <p className="text-xs text-muted-foreground">
            Save progress at any time. To complete, fill the required
            information
            {step.required ? ' and check the confirmation above' : ''}.
          </p>
        )}
      {step.state === 'not_started' && parallel && (
        <p className="text-xs text-muted-foreground">
          Starting this step also starts the other pending steps in this
          parallel group. Each task keeps its own owner and deadline.
        </p>
      )}
    </div>
  );
}

function WorkflowTaskEditor({
  step,
  value,
  onChange,
  onAction,
  onReset,
  blockers,
  canAdvance,
  parallel,
  complete,
  busy,
}: {
  step: WorkflowStep;
  value: WorkflowActionDraft;
  onChange: (value: WorkflowActionDraft) => void;
  onAction: (action: WorkflowAction) => Promise<void>;
  onReset: () => void;
  blockers: string[];
  canAdvance: boolean;
  parallel: boolean;
  complete: boolean;
  busy: boolean;
}) {
  const [moreAction, setMoreAction] = useState<
    'pause' | 'skip' | 'reopen' | null
  >(null);
  const done = isDone(step);
  const urgency = workflowUrgency(step);
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="space-y-3 border-b bg-muted/15 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {step.name || step.nameZh}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {step.required ? 'Required Step' : 'Optional Step'} ·{' '}
              {step.slaDays || 3}{' '}
              {step.slaCalendar === 'calendar' ? 'Calendar' : 'Business'} Days ·{' '}
              {step.reminderEnabled === false
                ? 'Reminders Off'
                : 'Reminders On'}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${done ? 'bg-emerald-50 text-emerald-800' : urgency === 'urgent' ? 'bg-red-50 text-red-700' : urgency === 'immediate' || step.state === 'paused' ? 'bg-amber-50 text-amber-800' : 'bg-[#e9f1f2] text-[#2e6f77]'}`}
          >
            {stateLabels[step.state]}
          </span>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-xs">
          <div>
            <dt className="text-muted-foreground">Started</dt>
            <dd className="mt-1">{timeLabel(step.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">SLA Due · Singapore</dt>
            <dd
              className={`mt-1 ${urgency === 'urgent' ? 'font-semibold text-red-700' : ''}`}
            >
              {timeLabel(step.dueAt)}
            </dd>
          </div>
          {done && (
            <div>
              <dt className="text-muted-foreground">
                {step.state === 'skipped' ? 'Skipped' : 'Completed'}
              </dt>
              <dd className="mt-1">{timeLabel(step.completedAt)}</dd>
            </div>
          )}
        </dl>
        {step.detail && (
          <p className="whitespace-pre-wrap text-xs text-muted-foreground">
            {step.detail}
          </p>
        )}
        {!done && blockers.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <p className="font-medium">
              Before this step can start or complete
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="space-y-4 p-5">
        {done || complete ? (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-muted-foreground">
              This record is read only.
            </p>
            <p>
              <span className="text-muted-foreground">Owner:</span>{' '}
              {step.owner || 'Not assigned'}
            </p>
            <p className="whitespace-pre-wrap">
              {step.note || 'No progress note recorded.'}
            </p>
            {Object.entries(step.fieldValues || {}).map(([field, value]) => (
              <p key={field} className="whitespace-pre-wrap">
                <span className="text-muted-foreground">{field}:</span>{' '}
                {value || 'Not recorded'}
              </p>
            ))}
          </div>
        ) : (
          <WorkflowTaskFields
            step={step}
            value={value}
            onChange={onChange}
            onAction={onAction}
            onReset={onReset}
            parallel={parallel}
            busy={busy}
            canAdvance={canAdvance}
          />
        )}
        {!complete && (
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              More Actions
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              {workflowNodeActive(step) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMoreAction('pause')}
                >
                  Pause Step
                </Button>
              )}
              {!done && !step.required && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMoreAction('skip')}
                >
                  Skip Step
                </Button>
              )}
              {done && !step.finishesWorkflow && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setMoreAction('reopen')}
                >
                  Reopen Step
                </Button>
              )}
              {!workflowNodeActive(step) && !done && step.required && (
                <p className="text-xs text-muted-foreground">
                  Required steps cannot be skipped.
                </p>
              )}
            </div>
            {moreAction && (
              <WorkflowNodeActionForm
                step={step}
                action={moreAction}
                value={value}
                onChange={onChange}
                onSubmit={async (action) => {
                  try {
                    await onAction(action);
                    setMoreAction(null);
                  } catch {
                    /* The page keeps the draft and shows the action error. */
                  }
                }}
                onCancel={() => setMoreAction(null)}
                busy={busy}
              />
            )}
          </details>
        )}
      </div>
    </article>
  );
}
