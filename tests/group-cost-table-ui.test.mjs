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
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});
const { GroupCostTable } =
  await import('../features/cost/components/group-cost-table.tsx');
hooks.deregister();

const item = (key, category, kind, amount) => ({
  key,
  category,
  kind,
  label: kind === 'Project' ? 'Risk' : 'Delivery',
  mandays: 0,
  personnel: kind === 'Group' ? amount : 0,
  travel: 0,
  subcontract: kind === 'Subcontract' ? amount : 0,
  ehs: 0,
  risk: kind === 'Project' ? amount : 0,
  other: 0,
  total: amount,
  share: amount / 100,
});

test('Group page renders Category segments, unclassified groups, project accounts and reconciled totals', () => {
  const html = renderToStaticMarkup(
    React.createElement(GroupCostTable, {
      items: [
        item('a', 'Services', 'Group', 20),
        item('b', '', 'Group', 10),
        item('c', 'Services', 'Subcontract', 30),
        item('d', undefined, 'Project', 40),
      ],
    }),
  );
  const cells = (part) =>
    [...part.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
      match[1].replace(/<[^>]*>/g, ''),
    );
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)].map((match) =>
    cells(match[1]),
  );
  const serviceSubtotal = rows.find(
    (row) => row[0] === 'Services — Category Subtotal',
  );
  const unclassifiedSubtotal = rows.find(
    (row) => row[0] === 'Uncategorized — Category Subtotal',
  );
  const projectSubtotal = rows.find(
    (row) => row[0] === 'Project Accounts Subtotal',
  );
  const grandTotal = rows.find((row) => row[0] === 'Total Cost with Risk');
  assert.equal(rows.filter((row) => row[0] === 'Category: Services').length, 1);
  assert.equal(
    rows.filter((row) => row[0] === 'Category: Uncategorized').length,
    1,
  );
  assert.equal(rows.filter((row) => row[0] === 'Project Accounts').length, 1);
  assert.match(serviceSubtotal.at(-2), /50\.00/);
  assert.match(unclassifiedSubtotal.at(-2), /10\.00/);
  assert.match(projectSubtotal.at(-2), /40\.00/);
  assert.match(grandTotal.at(-2), /100\.00/);
  assert.equal(grandTotal.at(-1), '100.0%');
  assert.ok(
    html.indexOf('Category: Services') <
      html.indexOf('Services — Category Subtotal'),
  );
  assert.ok(
    html.indexOf('Services — Category Subtotal') <
      html.indexOf('Category: Uncategorized'),
  );
});
