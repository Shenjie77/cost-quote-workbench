/** Enforce the shared visual boundary across every business view. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { layoutClassName, fieldLayoutClassName } from '../lib/ui-layout.ts';
const root = new URL('../', import.meta.url);
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(path.join(dir, entry.name))
      : entry.name.endsWith('.tsx')
        ? [path.join(dir, entry.name)]
        : [],
  );
const read = (name) => readFileSync(new URL(name, root), 'utf8');

test('the shared boundary preserves responsive geometry but rejects appearance overrides', () => {
  assert.equal(
    layoutClassName(
      'grid w-full md:grid-cols-2 text-right px-2 bg-primary rounded-lg text-h1 shadow-card !p-0 hover:bg-card',
    ),
    'grid w-full md:grid-cols-2 text-right',
  );
  assert.equal(
    layoutClassName('calculation-page-editor flex-1 min-h-0'),
    'calculation-page-editor flex-1 min-h-0',
  );
});

test('tokens define exactly five type roles, three radii and two shadows', () => {
  const css = read('styles/design-tokens.css');
  assert.deepEqual(
    [...css.matchAll(/--type-([a-z0-9-]+)-size:/g)]
      .map((match) => match[1])
      .sort(),
    ['body-main', 'body-small', 'h1', 'h2', 'h3'],
  );
  assert.deepEqual(
    [...css.matchAll(/--radius-([a-z]+):/g)].map((match) => match[1]).sort(),
    ['lg', 'md', 'sm'],
  );
  assert.deepEqual(
    [
      ...new Set(
        [...css.matchAll(/--shadow-([a-z]+):/g)].map((match) => match[1]),
      ),
    ].sort(),
    ['card', 'dropdown'],
  );
  for (const [, value] of css.matchAll(/--space-[a-z0-9]+:\s*(\d+)px/g))
    assert.equal(Number(value) % 4, 0);
});

test('business views use shared controls and semantic colors and type roles', () => {
  const violations = [];
  for (const file of [
    ...files(fileURLToPath(new URL('features', root))),
    ...files(fileURLToPath(new URL('components/workbench', root))),
  ]) {
    const source = readFileSync(file, 'utf8');
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (
          /^(button|input|select|textarea|table)$/.test(
            node.tagName.getText(sf),
          )
        )
          violations.push(`${file}: raw ${node.tagName.getText(sf)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    if (
      /(?:bg|text|border)-\[#[0-9a-f]+\]|#[0-9a-fA-F]{6}\b|text-\[\d+(?:px|rem)\]|text-(?:xs|sm|base|lg|xl|[2-9]xl)\b|rounded-(?:full|xl|[2-9]xl)/.test(
        source,
      )
    )
      violations.push(`${file}: nonsemantic visual value`);
  }
  assert.deepEqual(violations, []);
});

test('Bulk Entry delegates modal lifetime and scroll locks to the shared Dialog', () => {
  const source = read('features/bulk-entry/bulk-entry-page.tsx');
  assert.match(source, /<Dialog\s+open/);
  assert.match(source, /variant="workspace"/);
  assert.doesNotMatch(
    source,
    /createPortal|document\.body\.style\.overflow|\.inert\s*=/,
  );
});

test('resized grid fields cannot overflow because of caller minimum widths', () => {
  assert.equal(
    fieldLayoutClassName('w-full min-w-36 sm:min-w-20 h-10 text-right'),
    'w-full text-right',
  );
});

test('every feature uses semantic presentation roles instead of defining its own visual classes', () => {
  const violations = [];
  const visual = (token) =>
    /^(?:!?)(?:p[xytrblse]?-|rounded|border(?:-|$)|divide-|bg-|shadow|font-|leading-|tracking-|text-(?!left$|right$|center$|start$|end$|wrap$|nowrap$)|opacity-|ring|outline|transition|duration|ease-)/.test(
      token.split(':').at(-1),
    );
  for (const file of files(fileURLToPath(new URL('features', root)))) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node) {
      if (
        ts.isJsxAttribute(node) &&
        /className$/i.test(node.name.text) &&
        node.initializer
      ) {
        function inspect(n) {
          if (
            ts.isStringLiteralLike(n) ||
            ts.isTemplateHead(n) ||
            ts.isTemplateMiddle(n) ||
            ts.isTemplateTail(n)
          ) {
            for (const token of n.text.split(/\s+/))
              if (visual(token))
                violations.push(
                  `${path.relative(fileURLToPath(root), file)}: ${token}`,
                );
          }
          ts.forEachChild(n, inspect);
        }
        inspect(node.initializer);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.name.text === 'style' &&
        node.initializer
      ) {
        function inspect(n) {
          if (
            ts.isPropertyAssignment(n) &&
            /^(color|background|backgroundColor|border|borderRadius|fontSize|fontWeight|padding|boxShadow|lineHeight)$/.test(
              n.name.getText(sf),
            )
          )
            violations.push(`${file}: inline ${n.name.getText(sf)}`);
          ts.forEachChild(n, inspect);
        }
        inspect(node.initializer);
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);
  }
  assert.deepEqual(violations, []);
});

test('interaction duration is shared and reduced motion is an explicit override', () => {
  const css = read('app/globals.css');
  assert.match(css, /transition-duration: var\(--motion-duration\)/);
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration: var\(--motion-reduced\)/,
  );
  assert.doesNotMatch(read('styles/presentation.css'), /:is\(h1, h2, h3\)/);
});
