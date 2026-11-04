import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { SectionHeading } from '@/components/workbench/section-heading';
import { useWorkbenchLanguage } from '../workbench/workbench-language';
import { Badge } from '@/components/ui/badge';
import {
  Surface,
  Disclosure,
  DisclosureSummary,
  Text,
} from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { Textarea } from '@/components/ui/textarea';
import { CheckInput } from '@/components/ui/check-input';
/** A focused project task page: one editor, persistent drafts, canonical actions. */
import { useEffect, useRef, useState } from 'react';
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
import { ArchiveSettingsPanel, ProjectFilesPanel } from './project-files-panel';
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
  onEditProject?: () => void;
  onOpenCost: () => void;
  onSetHold?: (onHold: boolean) => Promise<void>;
  announce?: (message: string) => void;
  busy?: boolean;
  error?: string;
  focusNodeCode?: string;
  /** Changes only when the shell explicitly opens this task, including the same node again. */
  navigationRequest?: number;
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
  onEditProject,
  onSetHold,
  announce,
  busy = false,
  error = '',
  focusNodeCode,
  navigationRequest = 0,
  onFocusNode,
  onDirtyChange,
}: ProjectWorkflowPageProps) {
  const { label } = useWorkbenchLanguage();
  const [expandedCode, setExpandedCode] = useState(focusNodeCode || '');
  const pageRef = useRef<HTMLElement>(null);
  const taskEditorRef = useRef<HTMLElement>(null);
  const [selectedCode, setSelectedCode] = useState(() =>
    selectWorkflowTask(workspace, focusNodeCode),
  );
  const [previousFocus, setPreviousFocus] = useState(focusNodeCode);
  const [drafts, setDrafts] = useState<Record<string, WorkflowActionDraft>>({});
  const [referenceDraft, setReferenceDraft] =
    useState<ProjectWorkflowMeta | null>(null);
  const [working, setWorking] = useState(false);
  const [localError, setLocalError] = useState('');
  const [advanceFrom, setAdvanceFrom] = useState('');
  const [filesRevision, setFilesRevision] = useState(0);
  const [nodeUploadBusy, setNodeUploadBusy] = useState(false);
  const [generalUploadBusy, setGeneralUploadBusy] = useState(false);
  if (focusNodeCode !== previousFocus) {
    setPreviousFocus(focusNodeCode);
    setExpandedCode(focusNodeCode || '');
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
  const onHold = Boolean(workspace.workflowHold);
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
  const documentsUploading = nodeUploadBusy || generalUploadBusy;
  const dirty = dirtyCodes.length > 0 || referencesDirty || documentsUploading;
  const disabled = busy || working || documentsUploading;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (visibleCode && visibleCode !== focusNodeCode)
      onFocusNode?.(visibleCode);
  }, [visibleCode, focusNodeCode, onFocusNode]);
  // Explicit task links reveal the selected editor once; field edits do not move focus.
  useEffect(() => {
    if (!focusNodeCode) return;
    const frame = requestAnimationFrame(() => {
      const editor = taskEditorRef.current;
      if (!editor || editor.closest('[hidden], [inert]')) return;
      editor.focus({ preventScroll: true });
      const header = document.querySelector('[data-workbench-header]');
      const headerHeight = header?.getBoundingClientRect().height || 0;
      window.scrollTo({
        top: Math.max(
          0,
          window.scrollY +
            editor.getBoundingClientRect().top -
            headerHeight -
            12,
        ),
        behavior: 'instant',
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [project.id, focusNodeCode, navigationRequest]);
  useEffect(() => {
    const protectFileDrop = (event: DragEvent) => {
      if (!pageRef.current || pageRef.current.closest('[hidden], [inert]'))
        return;
      if (Array.from(event.dataTransfer?.types || []).includes('Files'))
        event.preventDefault();
    };
    window.addEventListener('dragover', protectFileDrop);
    window.addEventListener('drop', protectFileDrop);
    return () => {
      window.removeEventListener('dragover', protectFileDrop);
      window.removeEventListener('drop', protectFileDrop);
    };
  }, []);

  const choose = (code: string) => {
    setExpandedCode(code);
    setSelectedCode(code);
    setLocalError('');
    onFocusNode?.(code);
  };
  const run = async (action: WorkflowAction) => {
    if (disabled || onHold) return;
    setWorking(true);
    setLocalError('');
    try {
      const conflicts = workflowActionDraftConflicts(workspace, action, drafts);
      if (conflicts.length)
        throw new Error(
          `Save or reset changes in ${conflicts.join(', ')} first. Completing this step will automatically skip those optional tasks.`,
        );
      await onAction(action);
      setDrafts((previous) => {
        const next = { ...previous };
        if (action.nodeCode) delete next[action.nodeCode];
        return next;
      });
      announce?.(
        action.action === 'complete' ? 'Step completed.' : 'Step updated.',
      );
      if (action.action === 'complete' || action.action === 'skip')
        setAdvanceFrom(action.nodeCode || '');
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
      announce?.('Project references saved.');
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
      announce?.('Workflow refreshed.');
    } catch (cause) {
      setLocalError(
        cause instanceof Error ? cause.message : 'Unable to refresh.',
      );
    } finally {
      setWorking(false);
    }
  };
  const setHold = async (held: boolean) => {
    if (disabled || !onSetHold || held === onHold) return;
    setWorking(true);
    setLocalError('');
    try {
      await onSetHold(held);
      announce?.(
        held
          ? 'Project put on hold. Workflow monitoring is paused.'
          : 'Project resumed. Workflow monitoring is active.',
      );
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : 'Unable to update project hold.',
      );
      throw cause;
    } finally {
      setWorking(false);
    }
  };

  return (
    <Surface
      ref={pageRef}
      as="section"
      variant="page"
      aria-label="Project Workflow Page"
    >
      <SectionHeading
        variant="page"
        title="Project workflow"
        titleZh="项目流程"
        description="Record progress in the worksheet. Open a step to complete, pause or review its documents."
        descriptionZh="在表格中登记进展，展开节点后完成、暂停或查看附件。"
        action={
          <>
            <Button
              variant="outline"
              onClick={() => void refresh()}
              disabled={disabled}
            >
              {label('Refresh', '刷新')}
            </Button>
            <Button variant="outline" onClick={onOpenCost}>
              {label('HR Cost', '人力成本')}
            </Button>
            {onSetHold && (
              <Button
                variant={onHold ? 'default' : 'outline'}
                disabled={disabled || (complete && !onHold)}
                onClick={() => void setHold(!onHold)}
              >
                {onHold
                  ? label('Resume project', '恢复项目')
                  : label('Hold project', '暂停项目')}
              </Button>
            )}
          </>
        }
      />
      <Disclosure>
        <DisclosureSummary>
          {label('Project references', '项目资料与引用')}
        </DisclosureSummary>{' '}
        <ProjectWorkflowHeader
          onEditProject={onEditProject}
          status={onHold ? 'On Hold' : complete ? 'Completed' : 'In Progress'}
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
          onHold={onHold}
          holdDisabled={complete && !onHold}
          onSetHold={onSetHold ? setHold : undefined}
        />
      </Disclosure>
      <Disclosure>
        <DisclosureSummary className="cursor-pointer">
          Project Files &amp; Archive
        </DisclosureSummary>
        <div className="mt-3 grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
          <ProjectFilesPanel
            projectId={project.id}
            disabled={busy || working}
            refreshKey={filesRevision}
            onArchived={() => setFilesRevision((value) => value + 1)}
            onUploadingChange={setGeneralUploadBusy}
          />
          <ArchiveSettingsPanel />
        </div>
      </Disclosure>
      <Surface
        as="div"
        variant="toolbar"
        textRole="body-small"
        className="justify-between"
      >
        <Text
          as="p"
          tone={onHold ? 'warning' : complete ? 'success' : 'muted'}
          className=""
        >
          {onHold
            ? 'Project On Hold. Workflow monitoring and reminders are paused. Turn off the switch to resume with existing progress.'
            : complete
              ? 'Workflow complete. Reminders have stopped.'
              : 'Select a step, record progress, then save or complete it.'}
        </Text>
        <Text as="p" tone={dirty ? 'warning' : 'muted'} className="">
          {dirty
            ? [
                dirtyCodes.length > 0
                  ? `${dirtyCodes.length} unsaved task${dirtyCodes.length === 1 ? '' : 's'}`
                  : '',
                referencesDirty ? 'Unsaved project info' : '',
                documentsUploading ? 'Uploading documents' : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : 'All changes saved'}
        </Text>
      </Surface>
      {(error || localError) && (
        <Surface
          role="alert"
          as="p"
          variant="notice"
          tone="danger"
          textRole="body-main"
        >
          {localError || error}
        </Surface>
      )}
      <Surface variant="sheet">
        <Table aria-label="Workflow worksheet" className="min-w-[960px]">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>{label('Workflow step', '流程节点')}</TableHead>
              <TableHead>{label('Status', '状态')}</TableHead>
              <TableHead>{label('Owner', '负责人')}</TableHead>
              <TableHead>{label('Follow-up', '跟进日期')}</TableHead>
              <TableHead>{label('Progress note', '跟进备注')}</TableHead>
              <TableHead>{label('Actions', '操作')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workspace.processSteps.map((step, index) => {
              const draft = drafts[step.code] || workflowTaskDraft(step);
              const locked = disabled || onHold || isDone(step) || complete;
              const change = (patch: Partial<WorkflowActionDraft>) =>
                setDrafts((previous) => ({
                  ...previous,
                  [step.code]: { ...draft, ...patch },
                }));
              return (
                <TableRow key={step.code}>
                  <TableCell>{index + 1}</TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      aria-label={`Select ${step.name || step.nameZh}`}
                      disabled={disabled}
                      onClick={() => choose(step.code)}
                    >
                      {label(step.name, step.nameZh)}
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Badge
                      tone={
                        isDone(step)
                          ? 'success'
                          : workflowNodeActive(step)
                            ? 'primary'
                            : 'neutral'
                      }
                    >
                      {stateLabels[step.state]}
                    </Badge>
                  </TableCell>
                  <TableCell variant="editable">
                    <Input
                      variant="grid"
                      aria-label={`Owner ${step.code}`}
                      value={draft.owner}
                      maxLength={200}
                      disabled={locked}
                      onChange={(e) => change({ owner: e.target.value })}
                    />
                  </TableCell>
                  <TableCell variant="editable">
                    <Input
                      variant="grid"
                      type="date"
                      aria-label={`Follow-up ${step.code}`}
                      value={draft.followUpDate}
                      disabled={locked}
                      onChange={(e) => change({ followUpDate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell variant="editable">
                    <Input
                      variant="grid"
                      aria-label={`Progress ${step.code}`}
                      value={draft.note}
                      maxLength={10000}
                      disabled={locked}
                      onChange={(e) => change({ note: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          locked ||
                          !draft.owner.trim() ||
                          !workflowTaskIsDirty(step, draft)
                        }
                        onClick={() =>
                          void run({
                            nodeCode: step.code,
                            action: 'update',
                            owner: draft.owner,
                            note: draft.note,
                            followUpDate: draft.followUpDate,
                            fields: draft.fields,
                          }).catch(() => {})
                        }
                      >
                        {label('Save', '保存')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          if (expandedCode === step.code) setExpandedCode('');
                          else choose(step.code);
                        }}
                      >
                        {expandedCode === step.code
                          ? label('Collapse', '收起')
                          : label('Actions & files', '执行与附件')}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {expandedCode === visibleCode && (
          <div className="min-w-0 space-y-3">
            <Surface
              ref={taskEditorRef}
              tabIndex={-1}
              aria-label={`Current workflow task: ${selected?.name || selected?.nameZh || 'Not selected'}`}
              as="section"
              className="scroll-mt-32"
            >
              {selected ? (
                <WorkflowTaskEditor
                  compact
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
                  onHold={onHold}
                  busy={disabled || onHold}
                />
              ) : (
                <Surface as="p" variant="empty">
                  No workflow steps are configured.
                </Surface>
              )}
            </Surface>
            {selected && (
              <ProjectFilesPanel
                projectId={project.id}
                disabled={busy || working}
                nodeCode={selected.code}
                nodeName={selected.name || selected.nameZh}
                versionCode={
                  workspace.workflowVersion || workspace.activeVersion
                }
                refreshKey={filesRevision}
                onArchived={() => setFilesRevision((value) => value + 1)}
                onUploadingChange={setNodeUploadBusy}
              />
            )}
          </div>
        )}
      </Surface>
      <ProjectWorkflowHistory workspace={workspace} />
    </Surface>
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
    <div className="space-y-2 lg:hidden">
      <Surface
        as="label"
        variant="field"
        textRole="body-small"
        className="block"
      >
        Workflow Step
        <SelectField
          aria-label="Select Workflow Step"
          value={selectedCode}
          disabled={busy || !steps.length}
          className="h-8 w-full"
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
        </SelectField>
      </Surface>
      {selectedPhase?.parallel && (
        <Text as="p" tone="primary" textRole="body-small">
          {selectedPhase.name} · {selectedPhase.steps.length} parallel tasks
        </Text>
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
  compact = false,
}: {
  step: WorkflowStep;
  value: WorkflowActionDraft;
  onChange: (value: WorkflowActionDraft) => void;
  onAction: (action: WorkflowAction) => Promise<void>;
  onReset: () => void;
  parallel?: boolean;
  busy?: boolean;
  canAdvance?: boolean;
  compact?: boolean;
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
    <div className="space-y-3">
      {/* Primary task actions stay above editable fields, while existing validation still controls completion. */}
      <Surface as="div" variant="toolbar" className="-mx-3 -mt-3">
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
      </Surface>
      {!compact && (
        <>
          {' '}
          <div className="grid gap-3 sm:grid-cols-2">
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
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
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
              {step.state === 'paused'
                ? 'Planned Resume Date'
                : 'Next Follow-up'}
              <Input
                aria-label="Task Follow-up"
                type="date"
                value={value.followUpDate}
                disabled={busy}
                onChange={(event) =>
                  onChange({ ...value, followUpDate: event.target.value })
                }
              />
            </Surface>
          </div>
        </>
      )}
      {(step.requiredFields || []).length > 0 && (
        <Surface as="div" variant="body" className="space-y-2">
          <Text as="p" textRole="body-small">
            Required to Complete
          </Text>
          {(step.requiredFields || []).map((field) => (
            <Surface
              key={field}
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
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
            </Surface>
          ))}
        </Surface>
      )}
      {!compact && (
        <>
          {' '}
          <Surface
            as="label"
            variant="field"
            textRole="body-small"
            className="block"
          >
            Progress Note
            <Textarea
              aria-label="Task Progress Note"
              rows={3}
              maxLength={10000}
              value={value.note}
              disabled={busy}
              placeholder="Record the latest progress, decision, or company-platform reference."
              className="w-full resize-y"
              onChange={(event) =>
                onChange({ ...value, note: event.target.value })
              }
            />
          </Surface>
        </>
      )}
      {active && step.required && (
        <Surface
          as="label"
          variant="inline-field"
          textRole="body-small"
          className="flex items-start"
        >
          <CheckInput
            type="checkbox"
            aria-label="Confirm Task Completion"
            className="mt-1"
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
        </Surface>
      )}

      {active &&
        (missingFields.length > 0 || (step.required && !value.confirmed)) && (
          <Text as="p" tone="muted" textRole="body-small">
            Save progress at any time. To complete, fill the required
            information
            {step.required ? ' and check the confirmation above' : ''}.
          </Text>
        )}
      {step.state === 'not_started' && parallel && (
        <Text as="p" tone="muted" textRole="body-small">
          Starting this step also starts the other pending steps in this
          parallel group. Each task keeps its own owner and deadline.
        </Text>
      )}
    </div>
  );
}

function WorkflowTaskEditor({
  compact = false,
  step,
  value,
  onChange,
  onAction,
  onReset,
  blockers,
  canAdvance,
  parallel,
  complete,
  onHold,
  busy,
}: {
  compact?: boolean;
  step: WorkflowStep;
  value: WorkflowActionDraft;
  onChange: (value: WorkflowActionDraft) => void;
  onAction: (action: WorkflowAction) => Promise<void>;
  onReset: () => void;
  blockers: string[];
  canAdvance: boolean;
  parallel: boolean;
  complete: boolean;
  onHold: boolean;
  busy: boolean;
}) {
  const [moreAction, setMoreAction] = useState<
    'pause' | 'skip' | 'reopen' | null
  >(null);
  const done = isDone(step);
  const urgency = onHold ? 'none' : workflowUrgency(step);
  return (
    <Surface as="article" variant="panel" className="overflow-hidden">
      <Surface as="div" variant="item" className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Text as="h2" tone="primary">
              {step.name || step.nameZh}
            </Text>
            <Text as="p" tone="muted" textRole="body-small" className="mt-1">
              {step.required ? 'Required Step' : 'Optional Step'} ·{' '}
              {step.slaDays || 3}{' '}
              {step.slaCalendar === 'calendar' ? 'Calendar' : 'Business'} Days ·{' '}
              {onHold
                ? 'Monitoring Paused'
                : step.reminderEnabled === false
                  ? 'Reminders Off'
                  : 'Reminders On'}
            </Text>
          </div>
          <Badge
            tone={
              done
                ? 'success'
                : urgency === 'urgent'
                  ? 'danger'
                  : urgency === 'immediate' || step.state === 'paused'
                    ? 'warning'
                    : 'primary'
            }
            className=""
          >
            {stateLabels[step.state]}
          </Badge>
        </div>
        <Surface
          as="dl"
          textRole="body-small"
          className="flex flex-wrap gap-x-4 gap-y-1 [&>div]:flex [&>div]:items-baseline [&>div]:gap-2 [&_dd]:mt-0"
        >
          <div>
            <Text as="dt" tone="muted">
              Started
            </Text>
            <dd className="mt-1">{timeLabel(step.startedAt)}</dd>
          </div>
          <div>
            <Text as="dt" tone="muted">
              {onHold ? 'SLA Due · Timing Paused' : 'SLA Due · Singapore'}
            </Text>
            <Text
              as="dd"
              tone={urgency === 'urgent' ? 'danger' : 'inherit'}
              className="mt-1"
            >
              {timeLabel(step.dueAt)}
            </Text>
          </div>
          {done && (
            <div>
              <Text as="dt" tone="muted">
                {step.state === 'skipped' ? 'Skipped' : 'Completed'}
              </Text>
              <dd className="mt-1">{timeLabel(step.completedAt)}</dd>
            </div>
          )}
        </Surface>
        {step.detail && (
          <Text
            as="p"
            tone="muted"
            textRole="body-small"
            className="whitespace-pre-wrap"
          >
            {step.detail}
          </Text>
        )}
        {!done && blockers.length > 0 && (
          <Surface
            as="div"
            variant="notice"
            tone="warning"
            textRole="body-small"
          >
            <p>Before this step can start or complete</p>
            <Surface
              as="ul"
              variant="body"
              className="mt-1 list-disc space-y-1"
            >
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </Surface>
          </Surface>
        )}
      </Surface>
      <Surface as="div" variant="body" className="space-y-3">
        {done || complete ? (
          <Surface as="div" textRole="body-main" className="space-y-3">
            <Text as="p" tone="muted" textRole="body-small">
              This record is read only.
            </Text>
            <p>
              <Text as="span" tone="muted">
                Owner:
              </Text>{' '}
              {step.owner || 'Not assigned'}
            </p>
            <p className="whitespace-pre-wrap">
              {step.note || 'No progress note recorded.'}
            </p>
            {Object.entries(step.fieldValues || {}).map(([field, value]) => (
              <p key={field} className="whitespace-pre-wrap">
                <Text as="span" tone="muted">
                  {field}:
                </Text>{' '}
                {value || 'Not recorded'}
              </p>
            ))}
          </Surface>
        ) : (
          <WorkflowTaskFields
            compact={compact}
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
          <Disclosure>
            <DisclosureSummary className="cursor-pointer">
              More Actions
            </DisclosureSummary>
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
                <Text as="p" tone="muted" textRole="body-small">
                  Required steps cannot be skipped.
                </Text>
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
          </Disclosure>
        )}
      </Surface>
    </Surface>
  );
}
