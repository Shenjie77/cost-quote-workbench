/** Edits one global workflow draft; project execution is handled separately. */
import { useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { WorkflowStep } from '@/features/projects/types';
import {
  normalizeWorkflowDefinition,
  workflowPhaseGroups,
} from '@/features/projects/workflow-engine';

const stepTitle = (step: WorkflowStep) => step.name || step.nameZh;
const renumber = (steps: WorkflowStep[]) =>
  steps.map((step, index) => ({
    ...step,
    no: String(index + 1).padStart(2, '0'),
  }));

/** New ordinary nodes belong before the independent closing node. */
export function insertWorkflowTemplateStep(
  steps: WorkflowStep[],
  step: WorkflowStep,
) {
  const end = steps.findIndex(
    (item) => normalizeWorkflowDefinition(item).finishesWorkflow,
  );
  const index = end < 0 ? steps.length : end;
  return renumber([...steps.slice(0, index), step, ...steps.slice(index)]);
}

/** Move an entire phase, retaining each parallel group's continuity and closing position. */
export function moveWorkflowTemplatePhase(
  steps: WorkflowStep[],
  code: string,
  direction: -1 | 1,
) {
  const phases = workflowPhaseGroups(steps);
  const index = phases.findIndex((phase) =>
    phase.steps.some((step) => step.code === code),
  );
  const target = index + direction;
  if (
    index < 0 ||
    target < 0 ||
    target >= phases.length ||
    [phases[index], phases[target]].some((phase) =>
      phase.steps.some(
        (step) => normalizeWorkflowDefinition(step).finishesWorkflow,
      ),
    )
  )
    return steps;
  [phases[index], phases[target]] = [phases[target], phases[index]];
  return renumber(phases.flatMap((phase) => phase.steps));
}

/** Within a parallel phase, individual arrows only change peer order. */
export function moveWorkflowTemplateNode(
  steps: WorkflowStep[],
  code: string,
  direction: -1 | 1,
) {
  const phase = workflowPhaseGroups(steps).find((item) =>
    item.steps.some((step) => step.code === code),
  );
  if (!phase) return steps;
  if (!phase.parallel) return moveWorkflowTemplatePhase(steps, code, direction);
  const index = steps.findIndex((step) => step.code === code);
  const peer = steps[index + direction];
  if (!peer || !phase.steps.some((step) => step.code === peer.code))
    return steps;
  const next = [...steps];
  [next[index], next[index + direction]] = [
    next[index + direction],
    next[index],
  ];
  return renumber(next);
}

export function WorkflowTemplateEditor({
  steps,
  setSteps,
  query = '',
  disabled = false,
  announce,
}: {
  steps: WorkflowStep[];
  setSteps: React.Dispatch<React.SetStateAction<WorkflowStep[]>>;
  query?: string;
  disabled?: boolean;
  announce: (message: string) => void;
}) {
  const [editing, setEditing] = useState<WorkflowStep | null>(null);
  const phases = workflowPhaseGroups(steps);
  const matches = (step: WorkflowStep) =>
    [step.name, step.nameZh, step.owner, step.parallelGroup]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const visible = phases.filter((phase) => phase.steps.some(matches));
  const reorder = (code: string, direction: -1 | 1) => {
    setSteps((current) => moveWorkflowTemplateNode(current, code, direction));
  };
  const create = () =>
    setEditing(
      normalizeWorkflowDefinition({
        code: `CUSTOM-STAGE-${globalThis.crypto.randomUUID()}`,
        no: String(steps.length + 1).padStart(2, '0'),
        name: '',
        nameZh: '',
        owner: '',
        state: 'not_started',
        tone: 'gray',
        date: '',
        dateZh: '',
        detail: '',
        detailZh: '',
        input: '',
        inputZh: '',
        required: false,
      }),
    );
  const apply = () => {
    if (!editing || !editing.name.trim() || !editing.owner.trim()) return;
    const next = {
      ...editing,
      name: editing.name.trim(),
      nameZh: editing.nameZh.trim(),
      owner: editing.owner.trim(),
      parallelGroup: editing.parallelGroup?.trim() || '',
      requiredFields: [
        ...new Set(
          (editing.requiredFields || [])
            .map((field) => field.trim())
            .filter(Boolean),
        ),
      ],
      slaHolidays: [
        ...new Set(
          (editing.slaHolidays || []).map((day) => day.trim()).filter(Boolean),
        ),
      ],
    };
    setSteps((current) =>
      current.some((step) => step.code === next.code)
        ? current.map((step) => (step.code === next.code ? next : step))
        : insertWorkflowTemplateStep(current, next),
    );
    setEditing(null);
    announce('Step changes added to the template draft.');
  };
  return (
    <section>
      <div className="wb-toolbar justify-between border-b">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Workflow Template</p>
            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {steps.length} Steps · {phases.length} Phases
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Configure steps, deadlines and requirements, then preview the impact
            before publishing.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Phase arrows move the entire parallel group. Arrows within a group
            reorder its steps. New steps are inserted before the closing step.
          </p>
        </div>
        <Button type="button" size="sm" disabled={disabled} onClick={create}>
          <Plus />
          Add Step
        </Button>
      </div>
      <div className="space-y-3 p-4">
        {visible.length ? (
          visible.map((phase, phaseIndex) => (
            <section
              key={`${phase.id}:${phaseIndex}`}
              className={
                phase.parallel
                  ? 'space-y-2 rounded-xl border border-primary/20 bg-accent/40 p-3'
                  : 'space-y-2'
              }
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Phase {phases.indexOf(phase) + 1}
                  {phase.parallel
                    ? ` · ${phase.name} · Parallel`
                    : ' · Sequential'}
                </p>
                {phase.parallel && (
                  <div className="flex items-center gap-1">
                    {([-1, 1] as const).map((direction) => (
                      <Button
                        key={direction}
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={
                          disabled ||
                          moveWorkflowTemplatePhase(
                            steps,
                            phase.steps[0].code,
                            direction,
                          ) === steps
                        }
                        aria-label={`${direction === -1 ? 'Move Phase Up' : 'Move Phase Down'} ${phase.name}`}
                        onClick={() =>
                          setSteps((current) =>
                            moveWorkflowTemplatePhase(
                              current,
                              phase.steps[0].code,
                              direction,
                            ),
                          )
                        }
                      >
                        {direction === -1 ? <ArrowUp /> : <ArrowDown />}
                        {direction === -1 ? 'Move Phase Up' : 'Move Phase Down'}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
              {phase.steps.filter(matches).map((step) => {
                const index = steps.findIndex(
                  (item) => item.code === step.code,
                );
                return (
                  <article
                    key={step.code}
                    className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3"
                  >
                    <span className="financial-numeral flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs text-accent-foreground">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{stepTitle(step)}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {step.owner || 'Owner not assigned'} ·{' '}
                        {normalizeWorkflowDefinition(step).slaDays}{' '}
                        {normalizeWorkflowDefinition(step).slaCalendar ===
                        'business'
                          ? 'Business Days'
                          : 'Calendar Days'}{' '}
                        · {step.required ? 'Required Step' : 'Optional Step'}
                      </p>
                      <p className="mt-1 text-xs text-accent-foreground">
                        {[
                          step.roundStart && 'Round Start',
                          step.requiresConfirmedCost &&
                            'Confirmed Cost Required',
                          step.finishesWorkflow && 'Closing Step',
                          step.autoSkip && 'Skip by Default',
                          (step.createFolder ?? true)
                            ? 'Create Folder for New Projects'
                            : 'No Step Folder for New Projects',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      {step.detail && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Requirements: {step.detail}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={
                          disabled ||
                          moveWorkflowTemplateNode(steps, step.code, -1) ===
                            steps
                        }
                        aria-label={`Move Up ${stepTitle(step)}`}
                        onClick={() => reorder(step.code, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={
                          disabled ||
                          moveWorkflowTemplateNode(steps, step.code, 1) ===
                            steps
                        }
                        aria-label={`Move Down ${stepTitle(step)}`}
                        onClick={() => reorder(step.code, 1)}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        aria-label={`Edit ${stepTitle(step)}`}
                        onClick={() => setEditing(structuredClone(step))}
                      >
                        <Pencil />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        disabled={disabled}
                        className="text-destructive"
                        aria-label={`Delete ${stepTitle(step)}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove “${stepTitle(step)}” from the template draft? Existing project records will be checked in the publish preview.`,
                            )
                          )
                            return;
                          setSteps((current) =>
                            current
                              .filter((item) => item.code !== step.code)
                              .map((item, i) => ({
                                ...item,
                                no: String(i + 1).padStart(2, '0'),
                              })),
                          );
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </article>
                );
              })}
            </section>
          ))
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No matching steps.
          </p>
        )}
      </div>
      <div className="wb-toolbar justify-between border-t">
        <p className="text-xs text-muted-foreground">
          Add another step, then Preview &amp; Publish to sync projects.
        </p>
        <Button type="button" size="sm" disabled={disabled} onClick={create}>
          <Plus />
          Add Step
        </Button>
      </div>
      {editing && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        >
          <SheetContent className="overflow-y-auto sm:max-w-lg">
            <SheetHeader>
              <SheetTitle>Edit Workflow Step</SheetTitle>
              <SheetDescription>
                Renaming keeps the existing step identity. Changes here apply to
                the template draft.
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4">
              <WorkflowNodeDefinitionFields
                value={editing}
                onChange={setEditing}
                disabled={disabled}
              />
            </div>
            <SheetFooter>
              <Button
                type="button"
                disabled={
                  disabled || !editing.name.trim() || !editing.owner.trim()
                }
                onClick={apply}
              >
                Apply to Draft
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      )}
    </section>
  );
}

/** Edit the template definition, including folder choices that apply only at project creation. */
export function WorkflowNodeDefinitionFields({
  value,
  onChange,
  disabled = false,
}: {
  value: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
  disabled?: boolean;
}) {
  const normalized = normalizeWorkflowDefinition(value);
  const flags = [
    [
      'required',
      'Required Step',
      'Requires explicit completion confirmation and cannot be skipped.',
    ],
    [
      'reminderEnabled',
      'Enable Reminders',
      'Show reminders based on the deadline and follow-up date.',
    ],
    [
      'createFolder',
      'Create Folder',
      'Only applies to new projects. Create an archive folder for this step when a project is created; existing project folders are unchanged.',
    ],
    [
      'roundStart',
      'New Cost Round Start',
      'Restart from this step when a new cost draft is created.',
    ],
    [
      'requiresConfirmedCost',
      'Require Confirmed Cost',
      'Confirm the current round’s cost before starting this step.',
    ],
    [
      'finishesWorkflow',
      'Complete Workflow',
      'Completing this step stops all project reminders for the current round.',
    ],
    [
      'autoSkip',
      'Skip Optional Step by Default',
      'Use for optional steps that are usually not needed in this template.',
    ],
  ] as const;
  return (
    <>
      <label className="block space-y-1 text-xs">
        English Name
        <Input
          aria-label="Step English Name"
          value={value.name}
          disabled={disabled}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      <label className="block space-y-1 text-xs">
        Chinese Name
        <Input
          aria-label="Step Chinese Name"
          value={value.nameZh}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, nameZh: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1 text-xs">
        Default Owner
        <Input
          aria-label="Step Default Owner"
          value={value.owner}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, owner: event.target.value })
          }
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-xs">
          SLA Duration
          <Input
            aria-label="SLA Days"
            type="number"
            min={1}
            max={365}
            step={1}
            value={normalized.slaDays ?? 3}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                slaDays: Math.min(
                  365,
                  Math.max(1, Math.floor(Number(event.target.value) || 1)),
                ),
              })
            }
          />
        </label>
        <label className="block space-y-1 text-xs">
          Calendar
          <select
            aria-label="SLA Calendar"
            className="h-9 w-full rounded-md border border-input bg-background px-3"
            value={normalized.slaCalendar}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                slaCalendar: event.target.value as 'business' | 'calendar',
              })
            }
          >
            <option value="business">Business Days</option>
            <option value="calendar">Calendar Days</option>
          </select>
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        Business hours are Monday–Friday, 09:00–18:00 Singapore time. One
        business day equals 9 hours.
      </p>
      <label className="block space-y-1 text-xs">
        Parallel Group
        <Input
          aria-label="Parallel Group"
          placeholder="Leave blank for a standalone sequential step"
          value={value.parallelGroup || ''}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, parallelGroup: event.target.value })
          }
        />
        <span className="block text-muted-foreground">
          Adjacent steps with the same group name run in parallel. Publishing
          validates that group members are consecutive.
        </span>
      </label>
      <label className="block space-y-1 text-xs">
        Requirements
        <textarea
          aria-label="Step Requirements"
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          rows={3}
          value={value.detail}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, detail: event.target.value })
          }
        />
      </label>
      <label className="block space-y-1 text-xs">
        Required Completion Fields
        <textarea
          aria-label="Required Completion Fields"
          className="w-full rounded-md border border-input bg-background px-3 py-2"
          rows={3}
          placeholder="One field per line, e.g. Application Number, Review Outcome"
          value={(value.requiredFields || []).join('\n')}
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...value,
              requiredFields: event.target.value.split('\n'),
            })
          }
        />
        <span className="block text-muted-foreground">
          Enter one field name per line. The owner fills in these fields when
          completing the step.
        </span>
      </label>
      <div className="space-y-3 rounded-lg border p-3">
        {flags.map(([key, label, detail]) => (
          <label key={key} className="flex items-start gap-2 text-xs">
            <input
              aria-label={label}
              type="checkbox"
              checked={!!normalized[key]}
              disabled={disabled || (key === 'autoSkip' && !!value.required)}
              className="mt-0.5"
              onChange={(event) =>
                onChange({
                  ...value,
                  [key]: event.target.checked,
                  ...(key === 'required' && event.target.checked
                    ? { autoSkip: false }
                    : {}),
                })
              }
            />
            <span>
              <strong className="font-medium">{label}</strong>
              <span className="mt-1 block text-muted-foreground">{detail}</span>
            </span>
          </label>
        ))}
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-xs font-medium">
          Advanced: Non-working Dates
        </summary>
        <label className="mt-3 block space-y-1 text-xs">
          One date per line (YYYY-MM-DD)
          <textarea
            aria-label="Non-working Dates"
            className="w-full rounded-md border border-input bg-background px-3 py-2"
            rows={3}
            value={(value.slaHolidays || []).join('\n')}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                ...value,
                slaHolidays: event.target.value.split('\n'),
              })
            }
          />
        </label>
      </details>
    </>
  );
}
