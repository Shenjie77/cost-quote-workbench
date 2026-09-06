/** Server-render real UI components without browser automation or database writes. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialQuoteTemplates } from '../features/quote/types.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// Node strips .ts natively, but TSX needs a test-only transform. Resolve only
// application modules; leave dependency resolution and production builds alone.
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
    if (!url.endsWith('.tsx')) return nextLoad(url, context);
    const source = ts.transpileModule(
      readFileSync(fileURLToPath(url), 'utf8'),
      {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText;
    return { format: 'module', source, shortCircuit: true };
  },
});
const { QuoteTemplatePicker } =
  await import('../features/quote/template-picker.tsx');
const { QuoteView } = await import('../features/quote/quote-view.tsx');
hooks.deregister();

const template = {
  ...initialQuoteTemplates[0],
  id: 'internal-template-id',
  name: 'Customer Service Quote',
};
const noop = () => {};
const pickerProps = {
  templates: [template],
  client: 'Client A',
  selectedId: template.id,
  onApply: noop,
  onManage: noop,
  busy: false,
};

test('quotation template entry renders a named selector and explicit Apply button', () => {
  const markup = renderToStaticMarkup(
    React.createElement(QuoteTemplatePicker, pickerProps),
  );
  assert.match(markup, /Quotation Template/);
  assert.match(markup, /Apply Template/);
  assert.match(markup, /引用模板/);
  const selector = markup.match(
    /<button[^>]*id="quote-template-select"[^>]*>[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(selector);
  assert.match(selector, /Customer Service Quote/);
  assert.doesNotMatch(selector, />internal-template-id</);
});

test('missing customer templates leave an actionable entry instead of hiding it', () => {
  const markup = renderToStaticMarkup(
    React.createElement(QuoteTemplatePicker, {
      ...pickerProps,
      templates: [{ ...template, clientPattern: 'Other Client' }],
    }),
  );
  assert.match(markup, /No active template matches this client/);
  assert.match(markup, /Manage templates/);
  assert.match(markup, /<button[^>]*disabled[^>]*>[\s\S]*?Apply Template/);
});

test('quotation template entry precedes pricing and customer preview in the real page', () => {
  let writes = 0;
  const trackWrite = () => {
    writes += 1;
  };
  const markup = renderToStaticMarkup(
    React.createElement(QuoteView, {
      project: {
        id: 'PRJ-TEMPLATE-TEST',
        name: 'Entry test',
        client: 'Client A',
        currency: 'SGD',
      },
      activeVersion: 'V1',
      versionState: 'Draft',
      totalCost: 100,
      costErrors: [],
      onSave: async () => true,
      onOpenMasterData: noop,
      onExportStateChange: noop,
      exportInProgress: false,
      pricing: { targetGrossMargin: 20, discount: 0, gstPercent: 9 },
      setPricing: trackWrite,
      assumptionLibrary: [],
      quoteTemplates: [template],
      selectedQuoteTemplateId: template.id,
      setSelectedQuoteTemplateId: trackWrite,
      quoteAssumptions: [],
      setQuoteAssumptions: trackWrite,
      quoteHistory: [],
      setQuoteHistory: trackWrite,
      announce: noop,
    }),
  );
  assert.ok(
    markup.indexOf('Quotation Template') < markup.indexOf('Pricing Parameters'),
  );
  assert.ok(
    markup.indexOf('Quotation Template') <
      markup.indexOf('Client Output Preview'),
  );
  assert.equal((markup.match(/id="quote-template-select"/g) || []).length, 1);
  assert.equal(
    writes,
    0,
    'opening the quote must not apply a template automatically',
  );
});
