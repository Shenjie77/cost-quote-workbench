import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workflowPageHash,
  parseWorkflowPageHash,
} from '../features/projects/workflow-route.ts';

test('workflow links retain exact project and node identities, including reserved characters', () => {
  const projectId = 'PRJ/报价 #2026?客户';
  const nodeCode = 'DRB/Legal & delivery';
  assert.deepEqual(
    parseWorkflowPageHash(workflowPageHash(projectId, nodeCode)),
    {
      projectId,
      nodeCode,
    },
  );
  assert.deepEqual(parseWorkflowPageHash(workflowPageHash(projectId)), {
    projectId,
  });
});

test('unrelated, incomplete and malformed page locations do not select a workflow', () => {
  for (const hash of [
    '',
    '#today',
    '#workflow',
    '#workflow/',
    '#workflow/%20',
    '#workflow/P/',
    '#workflow/P/%20',
    '#workflow/P/N/extra',
    '#workflow/%E0%A4%A',
    '#workflow/P/%GG',
  ]) {
    assert.equal(parseWorkflowPageHash(hash), null, hash);
  }
});
