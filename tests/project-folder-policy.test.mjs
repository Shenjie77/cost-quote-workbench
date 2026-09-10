/** Integration coverage for project-owned archive folder choices across real workflow publications. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import {
  createCostDraft,
  createProject,
} from '../server/workspace-resources.mjs';
import { createProjectWorkflowSteps } from '../features/projects/workflow-domain.ts';

const binary = Buffer.from([0, 1, 255, 42, 128, 10]);

/** Leave createFolder absent unless explicitly configured so legacy defaults are exercised. */
function definitions(reviewCreatesFolder) {
  const base = createProjectWorkflowSteps()[0];
  return [
    { code: 'START', name: 'Start', roundStart: true },
    {
      code: 'REVIEW',
      name: 'Review',
      ...(reviewCreatesFolder === undefined
        ? {}
        : { createFolder: reviewCreatesFolder }),
    },
    { code: 'DONE', name: 'Done', finishesWorkflow: true },
  ].map((patch, index) => ({
    ...base,
    state: 'not_started',
    tone: 'gray',
    owner: 'SSR',
    roundStart: false,
    finishesWorkflow: false,
    requiresConfirmedCost: false,
    required: true,
    autoSkip: false,
    ...patch,
    no: String(index + 1).padStart(2, '0'),
    nameZh: '',
  }));
}

/** Publish through the same revision-checked transaction used by the workflow editor. */
function publish(repository, steps) {
  const master = repository.globalMasterData.get('workflow');
  const preview = repository.previewWorkflowPublication(steps, master.revision);
  assert.deepEqual(
    preview.projects.flatMap((project) => project.blockers),
    [],
  );
  const revisions = Object.fromEntries(
    preview.projects
      .filter((project) => !project.completed)
      .map((project) => [project.projectId, project.revision]),
  );
  return repository.publishWorkflow(steps, master.revision, revisions);
}

/** Keep all database and archive files under one disposable temporary directory. */
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'project-folder-policy-'));
  const database = path.join(directory, 'workspace.sqlite');
  let repository = openWorkspaceRepository(database);
  return {
    directory,
    database,
    get repository() {
      return repository;
    },
    closeRepository() {
      repository?.close();
      repository = undefined;
    },
    reopen() {
      repository = openWorkspaceRepository(database);
    },
    close() {
      repository?.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

/** Inspect persisted archive metadata independently of repository read projections. */
function query(f, sql, ...args) {
  const database = new DatabaseSync(f.database);
  try {
    return database.prepare(sql).all(...args);
  } finally {
    database.close();
  }
}

/** Read the immutable project-level folder choices as stored in SQLite. */
function policy(f, id) {
  const row = query(
    f,
    'SELECT policy_json FROM project_file_folder_policies WHERE project_id = ?',
    id,
  )[0];
  assert.ok(row, `Expected a frozen folder policy for ${id}`);
  return JSON.parse(row.policy_json);
}

/** Create projects from the currently published global template, never from test workspace copies. */
function create(repository, id) {
  createProject(repository, {
    id,
    name: `Folder policy ${id}`,
    client: 'Client',
  });
  return repository.files.list(id);
}

/** Include only physical directories so workflow-root uploads do not affect folder assertions. */
function workflowFolders(archive) {
  return readdirSync(path.join(archive.projectPath, 'workflow'), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** Store real bytes against a workflow node and preserve its version association. */
function upload(repository, id, nodeCode = 'REVIEW', versionCode = 'V1') {
  return repository.files.add(id, {
    category: 'workflow',
    nodeCode,
    versionCode,
    originalName: 'evidence.bin',
    mimeType: 'application/octet-stream',
    buffer: binary,
  });
}

test('omitted createFolder defaults create folders for every step at actual project creation', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions());
    const archive = create(f.repository, 'DEFAULT');
    assert.deepEqual(workflowFolders(archive), ['Done', 'Review', 'Start']);
    assert.deepEqual(policy(f, 'DEFAULT'), {
      START: true,
      REVIEW: true,
      DONE: true,
    });
    const file = upload(f.repository, 'DEFAULT');
    assert.equal(
      path.dirname(file.relativePath),
      path.join('workflow', 'Review'),
    );
    assert.deepEqual(
      f.repository.files.read('DEFAULT', file.id).buffer,
      binary,
    );
  } finally {
    f.close();
  }
});

test('disabling a template folder affects later projects while existing folders, uploaded files and cost evidence remain', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions());
    const oldArchive = create(f.repository, 'OLDER');
    const file = upload(f.repository, 'OLDER');
    const before = f.repository.get('OLDER');
    const originalPolicy = policy(f, 'OLDER');
    publish(f.repository, definitions(false));
    const laterArchive = create(f.repository, 'LATER');
    assert.deepEqual(workflowFolders(f.repository.files.list('OLDER')), [
      'Done',
      'Review',
      'Start',
    ]);
    assert.deepEqual(workflowFolders(laterArchive), ['Done', 'Start']);
    assert.deepEqual(policy(f, 'OLDER'), originalPolicy);
    assert.deepEqual(policy(f, 'LATER'), {
      START: true,
      REVIEW: false,
      DONE: true,
    });
    assert.deepEqual(
      f.repository.get('OLDER').workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.deepEqual(
      f.repository.get('OLDER').workspace.processSteps,
      before.workspace.processSteps,
    );
    assert.deepEqual(f.repository.files.read('OLDER', file.id), {
      record: file,
      buffer: binary,
    });
    assert.deepEqual(
      readFileSync(path.join(oldArchive.projectPath, file.relativePath)),
      binary,
    );
  } finally {
    f.close();
  }
});

test('uploads for a disabled node use workflow root while retaining node, version, filtering and read metadata', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions(false));
    const archive = create(f.repository, 'ROOT-UPLOAD');
    const before = f.repository.get('ROOT-UPLOAD');
    const file = upload(f.repository, 'ROOT-UPLOAD');
    assert.equal(path.dirname(file.relativePath), 'workflow');
    assert.equal(file.category, 'workflow');
    assert.equal(file.nodeCode, 'REVIEW');
    assert.equal(file.nodeName, 'Review');
    assert.equal(file.versionCode, 'V1');
    assert.equal(
      existsSync(path.join(archive.projectPath, 'workflow', 'Review')),
      false,
    );
    assert.deepEqual(
      readFileSync(path.join(archive.projectPath, file.relativePath)),
      binary,
    );
    assert.deepEqual(f.repository.files.read('ROOT-UPLOAD', file.id), {
      record: file,
      buffer: binary,
    });
    assert.deepEqual(
      f.repository.files.list('ROOT-UPLOAD', {
        category: 'workflow',
        nodeCode: 'REVIEW',
        versionCode: 'V1',
      }).files,
      [file],
    );
    assert.deepEqual(
      f.repository.files.list('ROOT-UPLOAD', { nodeCode: 'START' }).files,
      [],
    );
    assert.deepEqual(f.repository.get('ROOT-UPLOAD'), before);
  } finally {
    f.close();
  }
});

test('enabling a template folder again applies only to projects created after that publication', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions(false));
    const disabledArchive = create(f.repository, 'DISABLED');
    const oldFile = upload(f.repository, 'DISABLED');
    const frozen = policy(f, 'DISABLED');
    publish(f.repository, definitions(true));
    const enabledArchive = create(f.repository, 'ENABLED');
    assert.deepEqual(workflowFolders(f.repository.files.list('DISABLED')), [
      'Done',
      'Start',
    ]);
    assert.deepEqual(workflowFolders(enabledArchive), [
      'Done',
      'Review',
      'Start',
    ]);
    assert.deepEqual(policy(f, 'DISABLED'), frozen);
    assert.equal(policy(f, 'ENABLED').REVIEW, true);
    const another = upload(f.repository, 'DISABLED');
    assert.equal(path.dirname(another.relativePath), 'workflow');
    assert.equal(
      path.dirname(upload(f.repository, 'ENABLED').relativePath),
      path.join('workflow', 'Review'),
    );
    assert.deepEqual(
      f.repository.files.read('DISABLED', oldFile.id).buffer,
      binary,
    );
    assert.equal(
      existsSync(path.join(disabledArchive.projectPath, 'workflow', 'Review')),
      false,
    );
  } finally {
    f.close();
  }
});

test('added workflow steps and a subsequent cost round keep the original folder policy despite latest template flags', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions(false));
    const archive = create(f.repository, 'ROUND');
    const initial = f.repository.get('ROUND');
    const frozen = policy(f, 'ROUND');
    const oldFile = upload(f.repository, 'ROUND');
    const updated = definitions(true);
    updated.splice(2, 0, {
      ...updated[1],
      code: 'ADDED',
      name: 'Added Review',
      createFolder: true,
    });
    publish(
      f.repository,
      updated.map((step, index) => ({
        ...step,
        no: String(index + 1).padStart(2, '0'),
      })),
    );
    assert.equal(
      f.repository
        .get('ROUND')
        .workspace.processSteps.find((step) => step.code === 'ADDED')
        .createFolder,
      false,
    );
    assert.equal(
      path.dirname(upload(f.repository, 'ROUND', 'ADDED').relativePath),
      'workflow',
    );
    createCostDraft(
      f.repository,
      'ROUND',
      { mode: 'clone', sourceVersion: 'V1' },
      f.repository.get('ROUND').revision,
    );
    const next = f.repository.get('ROUND').workspace;
    assert.equal(next.workflowVersion, 'V2');
    assert.ok(
      next.processSteps
        .filter((step) => ['REVIEW', 'ADDED'].includes(step.code))
        .every((step) => step.createFolder === true),
    );
    assert.deepEqual(policy(f, 'ROUND'), frozen);
    assert.deepEqual(workflowFolders(f.repository.files.list('ROUND')), [
      'Done',
      'Start',
    ]);
    for (const code of ['REVIEW', 'ADDED'])
      assert.equal(
        path.dirname(upload(f.repository, 'ROUND', code, 'V2').relativePath),
        'workflow',
      );
    assert.deepEqual(
      next.costVersions.find((version) => version.code === 'V1'),
      initial.workspace.costVersions[0],
    );
    assert.deepEqual(
      f.repository.files.read('ROUND', oldFile.id).buffer,
      binary,
    );
    assert.equal(
      existsSync(path.join(archive.projectPath, 'workflow', 'Added Review')),
      false,
    );
  } finally {
    f.close();
  }
});

test('reopening an old database restores policy from recorded folders without changing files or workspace bytes', () => {
  const f = fixture();
  try {
    publish(f.repository, definitions());
    const archive = create(f.repository, 'LEGACY');
    const file = upload(f.repository, 'LEGACY');
    const manual = path.join(
      archive.projectPath,
      'workflow',
      'Review',
      'manual.txt',
    );
    writeFileSync(manual, 'Unindexed original evidence');
    const updated = definitions(false);
    updated.splice(2, 0, {
      ...updated[1],
      code: 'ADDED',
      name: 'Added Later',
      createFolder: true,
    });
    publish(
      f.repository,
      updated.map((step, index) => ({
        ...step,
        no: String(index + 1).padStart(2, '0'),
      })),
    );
    createCostDraft(
      f.repository,
      'LEGACY',
      { mode: 'clone', sourceVersion: 'V1' },
      f.repository.get('LEGACY').revision,
    );
    const before = f.repository.get('LEGACY');
    const snapshot = query(
      f,
      'SELECT * FROM workspace_snapshots WHERE project_id = ?',
      'LEGACY',
    );
    const archiveFiles = query(
      f,
      'SELECT * FROM project_files WHERE project_id = ? ORDER BY id',
      'LEGACY',
    );
    const folders = query(
      f,
      'SELECT * FROM project_file_node_folders WHERE project_id = ? ORDER BY node_code',
      'LEGACY',
    );
    assert.equal(
      before.workspace.processSteps.find((step) => step.code === 'ADDED')
        .createFolder,
      true,
    );
    assert.ok(!folders.some((folder) => folder.node_code === 'ADDED'));
    f.closeRepository();
    const oldDatabase = new DatabaseSync(f.database);
    oldDatabase.exec('DROP TABLE project_file_folder_policies');
    oldDatabase.close();
    f.reopen();
    const restored = f.repository.files.list('LEGACY');
    assert.deepEqual(workflowFolders(restored), ['Done', 'Review', 'Start']);
    assert.deepEqual(policy(f, 'LEGACY'), {
      DONE: true,
      REVIEW: true,
      START: true,
    });
    assert.deepEqual(
      query(
        f,
        'SELECT * FROM workspace_snapshots WHERE project_id = ?',
        'LEGACY',
      ),
      snapshot,
    );
    assert.deepEqual(
      query(
        f,
        'SELECT * FROM project_files WHERE project_id = ? ORDER BY id',
        'LEGACY',
      ),
      archiveFiles,
    );
    assert.deepEqual(
      query(
        f,
        'SELECT * FROM project_file_node_folders WHERE project_id = ? ORDER BY node_code',
        'LEGACY',
      ),
      folders,
    );
    assert.deepEqual(f.repository.get('LEGACY'), before);
    assert.deepEqual(f.repository.files.read('LEGACY', file.id), {
      record: file,
      buffer: binary,
    });
    assert.equal(readFileSync(manual, 'utf8'), 'Unindexed original evidence');
    assert.equal(
      path.dirname(upload(f.repository, 'LEGACY', 'ADDED', 'V2').relativePath),
      'workflow',
    );
    assert.deepEqual(
      f.repository.get('LEGACY').workspace.costVersions,
      before.workspace.costVersions,
    );
    assert.equal(
      existsSync(path.join(restored.projectPath, 'workflow', 'Added Later')),
      false,
    );
  } finally {
    f.close();
  }
});

test('an existing archive with no recorded step folders restores an empty policy without provisioning folders', () => {
  const f = fixture();
  try {
    publish(
      f.repository,
      definitions().map((step) => ({ ...step, createFolder: false })),
    );
    const archive = create(f.repository, 'EMPTY-LEGACY');
    const file = upload(f.repository, 'EMPTY-LEGACY');
    assert.deepEqual(workflowFolders(archive), []);
    assert.deepEqual(
      query(
        f,
        'SELECT * FROM project_file_node_folders WHERE project_id = ?',
        'EMPTY-LEGACY',
      ),
      [],
    );
    // The latest template deliberately disagrees with the archive's existing empty layout.
    publish(f.repository, definitions(true));
    createCostDraft(
      f.repository,
      'EMPTY-LEGACY',
      { mode: 'clone', sourceVersion: 'V1' },
      f.repository.get('EMPTY-LEGACY').revision,
    );
    assert.ok(
      f.repository
        .get('EMPTY-LEGACY')
        .workspace.processSteps.every((step) => step.createFolder === true),
    );
    const before = f.repository.get('EMPTY-LEGACY');
    const snapshot = query(
      f,
      'SELECT * FROM workspace_snapshots WHERE project_id = ?',
      'EMPTY-LEGACY',
    );
    f.closeRepository();
    const oldDatabase = new DatabaseSync(f.database);
    oldDatabase.exec('DROP TABLE project_file_folder_policies');
    oldDatabase.close();
    f.reopen();
    assert.deepEqual(
      workflowFolders(f.repository.files.list('EMPTY-LEGACY')),
      [],
    );
    assert.deepEqual(policy(f, 'EMPTY-LEGACY'), {});
    assert.deepEqual(f.repository.files.read('EMPTY-LEGACY', file.id), {
      record: file,
      buffer: binary,
    });
    assert.equal(
      path.dirname(
        upload(f.repository, 'EMPTY-LEGACY', 'REVIEW', 'V2').relativePath,
      ),
      'workflow',
    );
    assert.deepEqual(workflowFolders(archive), []);
    assert.deepEqual(
      query(
        f,
        'SELECT * FROM workspace_snapshots WHERE project_id = ?',
        'EMPTY-LEGACY',
      ),
      snapshot,
    );
    assert.deepEqual(f.repository.get('EMPTY-LEGACY'), before);
  } finally {
    f.close();
  }
});
