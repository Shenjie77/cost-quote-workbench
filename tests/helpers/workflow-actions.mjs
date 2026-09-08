import assert from 'node:assert/strict';

/** Build workflow fixtures through the same confirmed actions used by UI/CLI. */
export function completeWorkflowThrough(
  repository,
  projectId,
  targetCode,
  { includeTarget = true } = {},
) {
  const initial = repository.get(projectId);
  const target = initial.workspace.processSteps.findIndex(
    (step) => step.code === targetCode,
  );
  assert.ok(target >= 0, `Unknown fixture workflow node ${targetCode}`);
  const codes = initial.workspace.processSteps
    .slice(0, target + (includeTarget ? 1 : 0))
    .map((step) => step.code);
  for (const nodeCode of codes) {
    let record = repository.get(projectId);
    const step = record.workspace.processSteps.find(
      (entry) => entry.code === nodeCode,
    );
    if (['completed', 'skipped'].includes(step.state)) continue;
    if (step.state === 'not_started')
      record = repository.applyWorkflowAction(
        projectId,
        { nodeCode, action: 'start' },
        record.revision,
      );
    else if (step.state === 'paused')
      record = repository.applyWorkflowAction(
        projectId,
        { nodeCode, action: 'resume' },
        record.revision,
      );
    repository.applyWorkflowAction(
      projectId,
      {
        nodeCode,
        action: 'complete',
        confirmed: true,
        fields: Object.fromEntries(
          (step.requiredFields || []).map((field) => [
            field,
            'Confirmed fixture evidence',
          ]),
        ),
      },
      record.revision,
    );
  }
  return repository.get(projectId);
}
