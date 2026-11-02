import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
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

const { Table, TableBody, TableRow, TableCell } =
  await import('../components/ui/table.tsx');
const { Input } = await import('../components/ui/input.tsx');
const { SelectField } = await import('../components/ui/select-field.tsx');
const { Textarea } = await import('../components/ui/textarea.tsx');
const { FieldSurfaceProvider } =
  await import('../components/ui/field-surface.tsx');
const { Surface, Text } = await import('../components/ui/presentation.tsx');
const { Button } = await import('../components/ui/button.tsx');
const { MaintenanceGrid } = await import('../features/maintenance/maintenance-grid.tsx');
const { newMaintenanceLine } = await import('../features/maintenance/component-pricing.ts');
hooks.deregister();
const el = React.createElement;
const controls = () => [
  el(Input, { key: 'i', 'aria-label': 'quantity', defaultValue: '3' }),
  el(
    SelectField,
    { key: 's', 'aria-label': 'category', defaultValue: 'A' },
    el('option', { value: 'A' }, 'A'),
  ),
  el(Textarea, {
    key: 't',
    'aria-label': 'description',
    defaultValue: 'Line 1\nLine 2',
  }),
];
const grid = (children) =>
  el(
    Table,
    null,
    el(TableBody, null, el(TableRow, null, el(TableCell, null, children))),
  );
test('every native table field inherits the same editing surface without page variants', () => {
  const html = renderToStaticMarkup(grid(controls()));
  assert.equal((html.match(/data-field-variant="grid"/g) || []).length, 3);
  for (const kind of ['input', 'select', 'textarea'])
    assert.ok(html.includes(`ui-${kind}-grid`));
  assert.ok(html.includes('Line 1\nLine 2'));
  const form = renderToStaticMarkup(el('form', null, controls()));
  assert.equal((form.match(/data-field-variant="grid"/g) || []).length, 0);
});
test('dialog form boundaries reset the grid while nested tables restore it', () => {
  const html = renderToStaticMarkup(
    grid(
      el(
        FieldSurfaceProvider,
        { value: 'form' },
        el(Input, { 'aria-label': 'dialog field', variant: 'grid' }),
        grid(controls()),
      ),
    ),
  );
  assert.equal((html.match(/data-field-variant="grid"/g) || []).length, 3);
  assert.equal((html.match(/data-field-variant="default"/g) || []).length, 1);
});
test('feature composition preserves semantics and geometry but cannot change shared appearance', () => {
  const html = renderToStaticMarkup(
    el(
      Surface,
      {
        as: 'section',
        variant: 'panel',
        padded: true,
        className: 'grid md:grid-cols-2 rounded-lg p-0 bg-warning-muted',
      },
      el(Text, { as: 'h2' }, 'Costs'),
      el(
        Button,
        { className: 'h-20 px-8 bg-destructive text-h1 w-full' },
        'Save',
      ),
    ),
  );
  assert.match(html, /<section[^>]*data-variant="panel"/);
  assert.match(html, /<h2[^>]*>Costs<\/h2>/);
  assert.match(html, /grid md:grid-cols-2/);
  assert.doesNotMatch(
    html,
    /rounded-lg|p-0|bg-warning-muted|h-20|px-8|text-h1|bg-destructive/,
  );
  assert.match(html, /ui-button-primary[^>]*w-full/);
});


test('maintenance rows render the shared resize grip and editable fields without recursive components', () => {
 const line = {...newMaintenanceLine(1), model: 'Test router', quantity: 1, ct: 100, spms: 50};
 const html = renderToStaticMarkup(el(MaintenanceGrid, {rows:[line], totals:new Map([[line.id,150]]), records:[], disabled:false, onPatch:()=>{}, onDelete:()=>{}}));
 assert.match(html, /Maintenance equipment grid/);
 assert.match(html, /data-slot="resize-handle" data-axis="y"/);
 assert.match(html, /data-field-variant="grid"/);
 assert.match(html, /Test router/);
});
