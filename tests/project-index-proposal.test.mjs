/** Project searches receive commercial references from the index without loading every workspace. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Ajv2020 from 'ajv/dist/2020.js';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { updateResource } from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  projectFromIndex,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { mergeWorkflowProjection } from '../features/workbench/workspace-projections.ts';
import { emptySsr } from '../features/ssr/domain.ts';

/** Keeps proposal data in its established SSR owner while the persisted project identity stays unchanged. */
function workspace(id, proposalNumber) {
  const value = createBlankWorkspace(
    projectRecord(id, `Project ${id}`, 'Customer'),
    'input_preparation',
  );
  if (proposalNumber !== undefined)
    value.ssr = { ...emptySsr(), proposalNumber };
  return value;
}

test('index and UI projections include proposal numbers for projects that are not currently open', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    repo.save('ACTIVE', workspace('ACTIVE', 'PR-2026-001'), null);
    repo.save('OTHER', workspace('OTHER', 'Company/Quote 002'), null);
    const index = repo.list();
    const records = new Map(
      index.map((item) => [item.projectId, projectFromIndex(item)]),
    );
    assert.equal(records.get('ACTIVE').proposalNumber, 'PR-2026-001');
    assert.equal(records.get('OTHER').proposalNumber, 'Company/Quote 002');
    assert.equal(repo.get('OTHER').workspace.project.proposalNumber, undefined);
    assert.equal(
      repo.get('OTHER').workspace.ssr.proposalNumber,
      'Company/Quote 002',
    );
  } finally {
    repo.close();
  }
});

test('metadata updates and clearing immediately refresh the proposal index without duplicating its source', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    const saved = repo.save('UPDATE', workspace('UPDATE', 'Original'), null);
    const changed = updateResource(
      repo,
      'UPDATE',
      'project',
      { section: 'metadata' },
      { set: { proposalNumber: 'Updated reference' } },
      saved.revision,
    );
    assert.equal(repo.list()[0].proposalNumber, 'Updated reference');
    assert.equal(
      projectFromIndex(repo.list()[0]).proposalNumber,
      'Updated reference',
    );
    updateResource(
      repo,
      'UPDATE',
      'project',
      { section: 'metadata' },
      { set: { proposalNumber: '' } },
      changed.revision,
    );
    assert.equal(repo.list()[0].proposalNumber, '');
    assert.equal(
      repo.get('UPDATE').workspace.project.proposalNumber,
      undefined,
    );
  } finally {
    repo.close();
  }
});

test('legacy missing SSR and missing index references display an empty proposal number', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    repo.save('LEGACY', workspace('LEGACY'), null);
    assert.equal(repo.list()[0].proposalNumber, '');
    const legacyItem = { ...repo.list()[0] };
    delete legacyItem.proposalNumber;
    assert.equal(projectFromIndex(legacyItem).proposalNumber, '');
  } finally {
    repo.close();
  }
});

test('metadata projection updates or clears references and retains stale-response protection', () => {
  const project = {
    ...projectRecord('MERGE', 'Project', 'Customer'),
    revision: 5,
    proposalNumber: 'Current',
    totalCost: 99,
  };
  const newer = workspace('MERGE', 'Replacement');
  const stale = mergeWorkflowProjection([project], {
    workspace: newer,
    revision: 4,
  });
  assert.equal(stale[0], project);
  const updated = mergeWorkflowProjection([project], {
    workspace: newer,
    revision: 6,
  });
  assert.equal(updated[0].proposalNumber, 'Replacement');
  assert.equal(updated[0].totalCost, 99);
  delete newer.ssr;
  assert.equal(
    mergeWorkflowProjection(updated, { workspace: newer, revision: 7 })[0]
      .proposalNumber,
    '',
  );
  assert.equal(project.proposalNumber, 'Current');
});

test('CLI workspace index remains valid under the strict response schema with empty and populated references', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-proposal-index-'));
  const dbPath = path.join(directory, 'workspace.sqlite');
  const repo = openWorkspaceRepository(dbPath);
  try {
    repo.save('WITH-NUMBER', workspace('WITH-NUMBER', 'P-001'), null);
    repo.save('WITHOUT-NUMBER', workspace('WITHOUT-NUMBER', ''), null);
  } finally {
    repo.close();
  }
  try {
    const root = path.resolve(import.meta.dirname, '..');
    const response = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        'cli/cost-cli.mjs',
        'workspace',
        'list',
        '--db',
        dbPath,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(response.status, 0, response.stdout + response.stderr);
    const body = JSON.parse(response.stdout);
    const schema = JSON.parse(
      readFileSync(
        path.join(root, 'schemas/command-envelope.schema.json'),
        'utf8',
      ),
    );
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
      schema,
    );
    assert.equal(validate(body), true, JSON.stringify(validate.errors));
    const numbers = new Map(
      body.data.items.map((item) => [item.projectId, item.proposalNumber]),
    );
    assert.equal(numbers.get('WITH-NUMBER'), 'P-001');
    assert.equal(numbers.get('WITHOUT-NUMBER'), '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
