/** Transactional project actions and template publication; costs never enter this boundary. */
import {
  applyWorkflowAction,
  applyWorkflowTemplate,
  migrateWorkflowEngine,
  normalizeWorkflowDefinition,
  previewWorkflowSync,
  validateWorkflowTemplate,
  workflowComplete,
  workflowPhaseGroups,
  workflowActionBlockers,
} from '../features/projects/workflow-engine.ts';
import { WorkspaceValidationError } from './workspace-document.mjs';
import { validateGlobalMasterDataRows } from './global-master-data.mjs';

const fail = (message) => {
  throw new WorkspaceValidationError(message, '/workflow');
};
export const workflowBusiness = (run) => {
  try {
    return run();
  } catch (error) {
    if (
      error instanceof WorkspaceValidationError ||
      error.name === 'RepositoryConflictError'
    )
      throw error;
    fail(error.message);
  }
};
const executionFields = [
  'startedAt',
  'dueAt',
  'completedAt',
  'pausedAt',
  'fieldValues',
  'skippedBy',
  'followUpDate',
  'note',
  'updatedAt',
];
export function workflowDefinitions(steps) {
  if (!Array.isArray(steps) || !steps.length)
    fail('Workflow requires at least one stage.');
  const definitions = steps.map((step) => {
    const normalized = workflowBusiness(() =>
      normalizeWorkflowDefinition(structuredClone(step)),
    );
    for (const key of executionFields) delete normalized[key];
    return {
      ...normalized,
      state: 'not_started',
      tone: 'gray',
      date: '',
      dateZh: '',
      input: '',
      inputZh: '',
    };
  });
  workflowBusiness(() => validateWorkflowTemplate(definitions));
  workflowBusiness(() => validateGlobalMasterDataRows('workflow', definitions));
  return definitions;
}
export function projectWorkflowPlan(record) {
  const w = record.workspace;
  return {
    ...(w.workflowHold
      ? { workflowHold: structuredClone(w.workflowHold) }
      : {}),
    projectId: w.project.id,
    revision: record.revision,
    updatedAt: record.updatedAt,
    workflowVersion: w.workflowVersion || w.activeVersion,
    templateRevision:
      w.workflowTemplateRevision || w.masterDataRevisions?.workflow || 0,
    completed: workflowComplete(w),
    currentWorkflowStepCode: w.currentWorkflowStepCode,
    steps: structuredClone(w.processSteps),
    phases: workflowPhaseGroups(w.processSteps),
    blockers: Object.fromEntries(
      w.processSteps.map((step) => [
        step.code,
        workflowActionBlockers(w, step.code),
      ]),
    ),
  };
}
export function workflowRepositoryMethods(
  db,
  repository,
  ConflictError,
  NotFoundError,
) {
  const getRecord = (id) => {
    const record = repository.get(id);
    if (!record) throw new NotFoundError('Project not found or deleted.');
    return record;
  };
  const checkRevision = (actual, expected) => {
    if (!Number.isSafeInteger(expected) || expected < 1)
      fail('Expected revision is required.');
    if (actual !== expected)
      throw new ConflictError(
        'Workflow changed. Refresh the plan before updating.',
        actual,
      );
  };
  const preview = (steps, revision, options = {}) => {
    const master = repository.globalMasterData.get('workflow', {
      limit: 10000,
    });
    checkRevision(master.revision, revision);
    const definitions = workflowDefinitions(steps);
    const activeIds = new Set(options.migrateActiveProjectIds || []);
    const projects = repository.headers().map((header) => {
      const record = getRecord(header.projectId);
      const w = migrateWorkflowEngine(record.workspace);
      if (workflowComplete(w))
        return {
          projectId: header.projectId,
          name: header.name,
          revision: record.revision,
          completed: true,
          changed: false,
          changes: [],
          blockers: [],
          retained: ['Completed project keeps its recorded workflow.'],
          steps: w.processSteps,
        };
      const plan = workflowBusiness(() =>
        previewWorkflowSync(w, definitions, {
          migrateActive: activeIds.has(header.projectId),
        }),
      );
      return {
        projectId: header.projectId,
        name: header.name,
        revision: record.revision,
        completed: false,
        ...plan,
      };
    });
    for (const id of activeIds)
      if (!projects.some((p) => p.projectId === id && !p.completed))
        fail(`Cannot migrate active SLA for project ${id}.`);
    return { revision, nextRevision: revision + 1, projects };
  };
  return {
    updateWorkflowMasterData(changes, revision) {
      const master = repository.globalMasterData.get('workflow', {
        limit: 10000,
      });
      checkRevision(master.revision, revision);
      if (
        !changes ||
        typeof changes !== 'object' ||
        Object.keys(changes).some((key) => !['upsert', 'remove'].includes(key))
      )
        fail('Workflow updates require upsert/remove changes.');
      const upsert = changes.upsert || [],
        remove = changes.remove || [];
      if (
        !Array.isArray(upsert) ||
        !Array.isArray(remove) ||
        (!upsert.length && !remove.length)
      )
        fail('At least one workflow definition change is required.');
      const known = new Set([
        ...master.items.map((step) => step.code),
        ...master.conflicts.map((entry) => entry.key),
      ]);
      if (remove.some((code) => !known.has(code)))
        fail('Cannot remove an unknown workflow stage.');
      if (
        new Set(upsert.map((s) => s.code)).size !== upsert.length ||
        new Set(remove).size !== remove.length ||
        upsert.some((s) => remove.includes(s.code))
      )
        fail('Workflow changes contain duplicate or contradictory codes.');
      if (
        master.conflicts.some(
          (entry) =>
            !remove.includes(entry.key) &&
            !upsert.some((s) => s.code === entry.key),
        )
      )
        fail('Resolve workflow source conflicts before publishing.');
      const steps = master.items
        .filter((s) => !remove.includes(s.code))
        .map((s) => ({ ...s, ...upsert.find((next) => next.code === s.code) }));
      for (const step of upsert)
        if (!steps.some((old) => old.code === step.code)) steps.push(step);
      steps.sort((a, b) =>
        String(a.no).localeCompare(String(b.no), 'en', { numeric: true }),
      );
      const plan = preview(steps, revision);
      const projectRevisions = Object.fromEntries(
        plan.projects
          .filter((p) => !p.completed)
          .map((p) => [p.projectId, p.revision]),
      );
      return repository.publishWorkflow(steps, revision, projectRevisions)
        .record;
    },
    workflowPlan(id) {
      return workflowBusiness(() => projectWorkflowPlan(getRecord(id)));
    },
    applyWorkflowAction(id, action, revision) {
      const record = getRecord(id);
      checkRevision(record.revision, revision);
      const next = workflowBusiness(() =>
        applyWorkflowAction(record.workspace, action),
      );
      return repository.save(id, next, revision, { workflowMutation: true });
    },
    previewWorkflowPublication(steps, revision, options) {
      return preview(steps, revision, options);
    },
    publishWorkflow(steps, revision, projectRevisions, options = {}) {
      if (
        !projectRevisions ||
        typeof projectRevisions !== 'object' ||
        Array.isArray(projectRevisions)
      )
        fail('Project revisions from the publication preview are required.');
      db.exec('BEGIN IMMEDIATE');
      try {
        const plan = preview(steps, revision, options);
        const pending = plan.projects.filter((item) => !item.completed);
        for (const item of pending) {
          if (!Object.hasOwn(projectRevisions, item.projectId))
            throw new ConflictError(
              'Project set changed. Refresh the publication preview.',
              item.revision,
            );
          checkRevision(item.revision, projectRevisions[item.projectId]);
          if (item.blockers.length)
            fail(`${item.name}: ${item.blockers.join('; ')}`);
        }
        const definitions = workflowDefinitions(steps);
        const current = repository.globalMasterData.get('workflow', {
          limit: 10000,
        });
        const keys = new Set(definitions.map((step) => step.code));
        const removed = new Set(
          [
            ...current.items.map((s) => s.code),
            ...current.conflicts.map((c) => c.key),
          ].filter((code) => !keys.has(code)),
        );
        const master = repository.globalMasterData.update(
          'workflow',
          {
            upsert: definitions,
            ...(removed.size ? { remove: [...removed] } : {}),
          },
          revision,
          { inTransaction: true, workflowPublication: true },
        );
        const migratedIds = new Set(options.migrateActiveProjectIds || []);
        const updatedProjects = [];
        for (const item of pending) {
          const record = getRecord(item.projectId);
          const next = workflowBusiness(() =>
            applyWorkflowTemplate(
              record.workspace,
              definitions,
              master.revision,
              { migrateActive: migratedIds.has(item.projectId) },
            ),
          );
          const saved = repository.save(item.projectId, next, item.revision, {
            inTransaction: true,
            workflowMutation: true,
          });
          updatedProjects.push({
            projectId: item.projectId,
            revision: saved.revision,
          });
        }
        db.exec('COMMIT');
        return {
          record: master,
          updatedProjects,
          retainedProjects: plan.projects
            .filter((p) => p.completed)
            .map((p) => ({ projectId: p.projectId, revision: p.revision })),
        };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
