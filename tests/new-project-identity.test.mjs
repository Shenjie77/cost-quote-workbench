import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PROJECT_ID_MAX_LENGTH,
  projectIdError,
  resolveNewProjectId,
} from '../features/workbench/project-creation.ts';
import { openWorkspaceRepository } from '../server/workspace-repository.mjs';
import { createProject } from '../server/workspace-resources.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const alias = specifier.startsWith('@/');
    const relative =
      specifier.startsWith('.') &&
      context.parentURL?.startsWith(pathToFileURL(root).href) &&
      !context.parentURL.includes('/node_modules/');
    if (alias || relative) {
      const base = alias
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    return {
      format: 'module',
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
      shortCircuit: true,
    };
  },
});
const { NewProjectIdField } =
  await import('../features/workbench/new-project-id-field.tsx');
hooks.deregister();

const schema = JSON.parse(
  readFileSync(
    new URL('../schemas/cost-export.schema.json', import.meta.url),
    'utf8',
  ),
);
const validateProject = new Ajv2020({ strict: true })
  .addSchema(schema)
  .getSchema(`${schema.$id}#/$defs/project`);
const project = (id) => ({
  id,
  name: 'New project',
  client: 'Customer',
  currency: 'SGD',
});

test('manual Project IDs follow the canonical 80-character contract without a generated-ID namespace restriction', () => {
  assert.equal(PROJECT_ID_MAX_LENGTH, 80);
  for (const value of [
    'CUSTOM-460042',
    '客户/项目 2026-A.01',
    'A'.repeat(80),
    '🛠'.repeat(80),
  ]) {
    const id = resolveNewProjectId(`  ${value}  `, () =>
      assert.fail('custom ID must not be generated'),
    );
    assert.equal(id, value);
    assert.equal(projectIdError(value), '');
    assert.equal(
      validateProject(project(id)),
      true,
      JSON.stringify(validateProject.errors),
    );
  }
  for (const value of ['A'.repeat(81), '🛠'.repeat(81)]) {
    assert.equal(validateProject(project(value)), false);
    assert.match(projectIdError(value), /80 characters/);
    assert.throws(
      () =>
        resolveNewProjectId(value, () =>
          assert.fail(
            'invalid custom ID must not fall back to automatic generation',
          ),
        ),
      /80 characters/,
    );
  }
});

test('blank optional IDs retain automatic generation and custom values never invoke that fallback', () => {
  for (const value of [undefined, '', '  \t ']) {
    assert.equal(projectIdError(value ?? ''), '');
    assert.equal(
      resolveNewProjectId(value, () => 'PRJ-AUTO-TEST'),
      'PRJ-AUTO-TEST',
    );
  }
  const generated = resolveNewProjectId();
  assert.match(
    generated,
    new RegExp(`^PRJ-${new Date().getFullYear()}-[0-9a-f]{8}$`),
  );
  assert.equal(validateProject(project(generated)), true);
});

test('the shared optional Project ID field displays validation and immutable-after-create guidance', () => {
  const field = (value, disabled = false) =>
    renderToStaticMarkup(
      React.createElement(NewProjectIdField, {
        inputId: 'create-project-id',
        value,
        disabled,
        onChange: () => {},
      }),
    );
  const blank = field('');
  assert.match(blank, /Project ID/);
  assert.match(blank, /optional/);
  assert.match(blank, /Leave blank to generate automatically/);
  assert.match(blank, /Cannot be changed after creation/);
  assert.doesNotMatch(blank, / required=|aria-invalid="true"/);
  assert.match(field('A'.repeat(81)), /aria-invalid="true"/);
  assert.match(field('A'.repeat(81)), /role="alert"/);
  assert.match(field('CUSTOM-ID', true), /disabled=""/);
});

test('custom-ID creation preserves existing projects and backend duplicate protection includes deleted IDs', () => {
  const repo = openWorkspaceRepository(':memory:');
  try {
    createProject(repo, {
      id: 'KEEP-EXISTING',
      name: 'Existing',
      client: 'Customer',
    });
    const existing = repo.get('KEEP-EXISTING');
    const input = {
      id: resolveNewProjectId('  客户/2026-CUSTOM  '),
      name: 'Manual ID',
      client: 'Customer',
      reviewOwner: 'SSR',
    };
    createProject(repo, input);
    const created = repo.get(input.id);
    assert.equal(created.workspace.project.id, '客户/2026-CUSTOM');
    assert.equal(created.revision, 1);
    assert.deepEqual(repo.get('KEEP-EXISTING'), existing);
    assert.throws(
      () => createProject(repo, { ...input, name: 'Replacement' }),
      /revision/i,
    );
    assert.deepEqual(repo.get(input.id), created);
    repo.setDeleted(input.id, created.revision);
    const deleted = repo.headers(true);
    assert.throws(() => createProject(repo, input), /deleted/i);
    assert.deepEqual(repo.headers(true), deleted);
    assert.deepEqual(repo.get('KEEP-EXISTING'), existing);
    assert.equal(repo.headers().length, 1);
  } finally {
    repo.close();
  }
});
