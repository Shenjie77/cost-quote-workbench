/** Render real project context and exercise controlled edit/save intent. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
      for (const extension of ['.ts', '.tsx']) {
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
      }
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
const {
  ProjectWorkflowHeader,
  ProjectWorkflowInfoFields,
  safeProjectReferenceUrl,
  projectReferenceLinkErrors,
} = await import('../features/projects/project-workflow-header.tsx');
hooks.deregister();

const noop = () => {};
const reference = (extra = {}) => ({
  proposalNumber: 'P-2026-460042',
  companyUrl: 'https://isales.example.test/proposals/460042?view=current',
  cpqUrl: 'https://cpq.example.test/configurations/37',
  scopeBrief: 'Remote commissioning · 远程调测',
  technicalBasis: 'TD Design Rev 03',
  ...extra,
});
const header = (value = reference(), extra = {}) =>
  renderToStaticMarkup(
    React.createElement(ProjectWorkflowHeader, {
      project: {
        id: 'PRJ-2026-460042',
        name: 'test2',
        client: 'Client A',
      },
      round: 'V2',
      value,
      dirty: false,
      onChange: noop,
      onSave: noop,
      onReset: noop,
      onBack: noop,
      onRefresh: noop,
      onOpenCost: noop,
      ...extra,
    }),
  );
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : React.isValidElement(node)
      ? textOf(node.props.children)
      : typeof node === 'string'
        ? node
        : '';

test('compact read view includes identity and references together, with actionable company and CPQ links', () => {
  const value = reference();
  const before = structuredClone(value);
  const html = header(value);
  assert.match(html, /aria-label="Project Workflow Info"/);
  for (const text of [
    'test2',
    'PRJ-2026-460042',
    'Client A',
    'SGD',
    'V2',
    value.proposalNumber,
    value.scopeBrief,
    value.technicalBasis,
  ])
    assert.ok(html.includes(text), text);
  assert.match(
    html,
    /href="https:\/\/isales\.example\.test\/proposals\/460042\?view=current"/,
  );
  assert.match(html, /href="https:\/\/cpq\.example\.test\/configurations\/37"/);
  assert.equal(
    (html.match(/target="_blank" rel="noopener noreferrer"/g) || []).length,
    2,
  );
  assert.match(html, /Edit Info/);
  assert.doesNotMatch(html, /<form|<input|<textarea|Project References/);
  assert.deepEqual(value, before);
});

test('only explicit HTTP(S) destinations activate links; blank, malformed and script references remain text', () => {
  for (const address of [
    '',
    'Internal reference 2026-001',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//example.test/record',
    '/relative/record',
    'mailto:pm@example.test',
    'https://',
    'https://user:password@example.test/record',
    'https://example.test/record\n?token=1',
  ]) {
    assert.equal(safeProjectReferenceUrl(address), null, address);
    const html = header(reference({ companyUrl: address, cpqUrl: '' }));
    assert.doesNotMatch(html, /<a[\s>]/);
  }
  assert.equal(
    safeProjectReferenceUrl('  HTTPS://EXAMPLE.TEST/path?id=1#review  '),
    'https://example.test/path?id=1#review',
  );
  assert.equal(
    safeProjectReferenceUrl('http://example.test/'),
    'http://example.test/',
  );
  assert.match(
    header(reference({ companyUrl: '', cpqUrl: '' })),
    /CPQ: Not set/,
  );
});

test('new invalid links block saving while legacy free-text references allow unrelated edits', () => {
  const legacy = reference({ companyUrl: 'Company proposal reference 42' });
  assert.deepEqual(projectReferenceLinkErrors(legacy, {}), {});
  assert.deepEqual(projectReferenceLinkErrors(legacy, { cpqUrl: true }), {});
  assert.deepEqual(
    Object.keys(projectReferenceLinkErrors(legacy, { companyUrl: true })),
    ['companyUrl'],
  );
  assert.deepEqual(
    projectReferenceLinkErrors(reference({ companyUrl: '  ', cpqUrl: '' }), {
      companyUrl: true,
      cpqUrl: true,
    }),
    {},
  );
  assert.deepEqual(
    Object.keys(
      projectReferenceLinkErrors(reference({ cpqUrl: 'javascript:alert(1)' }), {
        cpqUrl: true,
      }),
    ),
    ['cpqUrl'],
  );
});

test('controlled fields retain other references and only submit save intent, never mutate the source', () => {
  const source = reference();
  const before = structuredClone(source);
  let value = source;
  let saves = 0;
  let resets = 0;
  let closes = 0;
  const edited = {};
  const fields = (extra = {}) =>
    walk(
      ProjectWorkflowInfoFields({
        value,
        dirty: true,
        busy: false,
        onChange: (next) => {
          value = next;
        },
        onLinkEdit: (field) => {
          edited[field] = true;
        },
        onSave: () => {
          saves++;
        },
        onReset: () => {
          resets++;
        },
        onClose: () => {
          closes++;
        },
        ...extra,
      }),
    );
  const input = (label) =>
    fields().find((node) => node.props['aria-label'] === label);
  input('Proposal Number').props.onChange({ target: { value: 'P-NEW' } });
  input('CPQ Link').props.onChange({
    target: { value: 'https://cpq.example.test/configurations/38' },
  });
  assert.equal(value.proposalNumber, 'P-NEW');
  assert.equal(value.companyUrl, source.companyUrl);
  assert.equal(value.scopeBrief, source.scopeBrief);
  assert.equal(value.cpqUrl, 'https://cpq.example.test/configurations/38');
  assert.deepEqual(edited, { cpqUrl: true });
  assert.equal(saves, 0);
  let prevented = false;
  fields()
    .find((node) => node.type === 'form')
    .props.onSubmit({
      preventDefault() {
        prevented = true;
      },
    });
  assert.equal(prevented, true);
  assert.equal(saves, 1);
  fields()
    .find((node) => textOf(node) === 'Close' && node.props.onClick)
    .props.onClick();
  assert.equal(closes, 1);
  assert.equal(resets, 0);
  assert.equal(value.proposalNumber, 'P-NEW');
  fields()
    .find((node) => textOf(node) === 'Reset' && node.props.onClick)
    .props.onClick();
  assert.equal(resets, 1);
  assert.deepEqual(source, before);
});

test('busy, clean and invalid editor states all prevent save submission', () => {
  for (const state of [
    { busy: true },
    { dirty: false },
    { linkErrors: { cpqUrl: 'Enter a full http:// or https:// address.' } },
  ]) {
    let saves = 0;
    const fields = walk(
      ProjectWorkflowInfoFields({
        value: reference(),
        dirty: true,
        onChange: noop,
        onLinkEdit: noop,
        onSave: () => {
          saves++;
        },
        onReset: noop,
        onClose: noop,
        ...state,
      }),
    );
    assert.equal(
      fields.find((node) => node.props.type === 'submit').props.disabled,
      true,
    );
    fields
      .find((node) => node.type === 'form')
      .props.onSubmit({ preventDefault: noop });
    assert.equal(saves, 0);
  }
});

test('long scope stays expandable and user-authored content is escaped rather than becoming markup', () => {
  const scopeBrief =
    '<script>alert("scope")</script> ' + 'Delivery scope detail. '.repeat(20);
  const html = header(reference({ scopeBrief }));
  assert.match(html, /<details[^>]*><summary/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script|<textarea/);
  assert.ok(html.includes('Delivery scope detail. '.repeat(10)));
});
