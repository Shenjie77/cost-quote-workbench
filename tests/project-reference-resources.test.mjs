import assert from 'node:assert/strict';
import test from 'node:test';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  readResource,
  updateResource,
} from '../server/workspace-resources.mjs';
import {
  createBlankWorkspace,
  createCostVersion,
  projectRecord,
} from '../features/workbench/workspace-factories.ts';
import { initialCostRows } from '../features/cost/demo-data.ts';
import { costLockReason } from '../features/cost/cost-lock.ts';
import { emptySsr } from '../features/ssr/domain.ts';
import { completeWorkflowThrough } from './helpers/workflow-actions.mjs';

const projectId = 'REFERENCE-FIXTURE';
function setup() {
  const repository = openWorkspaceRepository(':memory:');
  const workspace = createBlankWorkspace(
    projectRecord(projectId, 'Reference fixture', 'Customer'),
    'input_preparation',
  );
  workspace.costRows = structuredClone(initialCostRows);
  workspace.costVersions = [createCostVersion('V1', 'Draft', null, workspace)];
  workspace.ssr = {
    ...emptySsr(),
    proposalNumber: 'P-100',
    companyUrl: 'https://isales.example/proposal/P-100',
  };
  repository.save(projectId, workspace, null);
  return repository;
}

test('CPQ reference is optional for existing documents and round-trips through both narrow metadata resources', () => {
  const repository = setup();
  try {
    const original = repository.get(projectId);
    assert.equal(Object.hasOwn(original.workspace.ssr, 'cpqUrl'), false);
    for (const [module, section] of [
      ['project', 'metadata'],
      ['ssr', 'settings'],
    ]) {
      const beforeRead = repository.get(projectId);
      const read = readResource(repository, projectId, module, { section });
      assert.equal(read.value.companyUrl, original.workspace.ssr.companyUrl);
      assert.equal(read.value.proposalNumber, 'P-100');
      assert.equal(read.workspace, undefined);
      assert.deepEqual(repository.get(projectId), beforeRead);

      const cpqUrl = `https://cpq.example/config/${module}?proposal=P-100`;
      const receipt = updateResource(
        repository,
        projectId,
        module,
        { section },
        { set: { cpqUrl } },
        beforeRead.revision,
      );
      assert.deepEqual(receipt.changedFields, ['cpqUrl']);
      assert.equal(receipt.workspace, undefined);
      for (const [otherModule, otherSection] of [
        ['project', 'metadata'],
        ['ssr', 'settings'],
      ])
        assert.equal(
          readResource(repository, projectId, otherModule, {
            section: otherSection,
          }).value.cpqUrl,
          cpqUrl,
        );
      assert.deepEqual(repository.get(projectId).workspace, {
        ...original.workspace,
        ssr: { ...original.workspace.ssr, cpqUrl },
      });
    }
    const record = repository.get(projectId);
    const fullSave = repository.save(
      projectId,
      record.workspace,
      record.revision,
    );
    assert.deepEqual(fullSave.workspace, record.workspace);
  } finally {
    repository.close();
  }
});

for (const lockedStage of ['Confirmed', 'DRB completed']) {
  test(`reference updates remain editable after ${lockedStage} without changing costs, snapshots, or workflow progress`, () => {
    const repository = setup();
    try {
      updateResource(
        repository,
        projectId,
        'cost',
        { section: 'settings', version: 'V1' },
        { set: { state: 'Confirmed' } },
        repository.get(projectId).revision,
      );
      if (lockedStage === 'DRB completed')
        completeWorkflowThrough(repository, projectId, 'DELIVERY_REVIEW');
      const before = repository.get(projectId);
      assert.ok(costLockReason(before.workspace, 'V1'));
      for (const [module, section] of [
        ['project', 'metadata'],
        ['ssr', 'settings'],
      ]) {
        const patch = {
          proposalNumber: 'P-101',
          companyUrl: `https://isales.example/proposal/P-101/${module}`,
          cpqUrl: `https://cpq.example/config/P-101/${module}`,
        };
        updateResource(
          repository,
          projectId,
          module,
          { section },
          { set: patch },
          repository.get(projectId).revision,
        );
        assert.deepEqual(repository.get(projectId).workspace, {
          ...before.workspace,
          ssr: { ...before.workspace.ssr, ...patch },
        });
      }
    } finally {
      repository.close();
    }
  });
}

test('reference validation and revision conflicts are atomic, and an optional CPQ link can be cleared', () => {
  const repository = setup();
  try {
    const before = repository.get(projectId);
    for (const [module, section] of [
      ['project', 'metadata'],
      ['ssr', 'settings'],
    ]) {
      for (const patch of [
        { cpqUrl: null },
        { cpqUrl: 42 },
        { cpqUrl: 'x'.repeat(10001) },
        { cpqUrl: 'https://cpq.example', unknownReference: 'extra' },
      ]) {
        assert.throws(() =>
          updateResource(
            repository,
            projectId,
            module,
            { section },
            { set: patch },
            before.revision,
          ),
        );
        assert.deepEqual(repository.get(projectId), before);
      }
    }
    const receipt = updateResource(
      repository,
      projectId,
      'project',
      { section: 'metadata' },
      { set: { cpqUrl: 'https://cpq.example/config/1' } },
      before.revision,
    );
    const updated = repository.get(projectId);
    assert.throws(
      () =>
        updateResource(
          repository,
          projectId,
          'project',
          { section: 'metadata' },
          { set: { cpqUrl: 'https://cpq.example/stale' } },
          before.revision,
        ),
      /changed|revision/,
    );
    assert.deepEqual(repository.get(projectId), updated);
    updateResource(
      repository,
      projectId,
      'project',
      { section: 'metadata' },
      { set: { cpqUrl: '' } },
      receipt.revision,
    );
    assert.deepEqual(repository.get(projectId).workspace, {
      ...before.workspace,
      ssr: { ...before.workspace.ssr, cpqUrl: '' },
    });
  } finally {
    repository.close();
  }
});
