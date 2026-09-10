/** Real UI rendering verifies visible share assumptions and customer-output guards. */
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
import { calculatePricing } from '../features/quote/domain.ts';

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
const { QuoteView } = await import('../features/quote/quote-view.tsx');
const { ProfitShareSummary } =
  await import('../features/quote/profit-share-summary.tsx');
const { ProfitShareEditor } =
  await import('../features/master-data/profit-share-editor.tsx');
hooks.deregister();

const noop = () => {};
const rates = [
  { id: 'share-network', bu: 'Network', ratePercent: 20, active: true },
];
const allocation = {
  totalCost: 50,
  entries: [{ bu: 'Network', cost: 50, directCost: 45, unassignedCost: 5 }],
  largestBu: 'Network',
  unassignedCost: 5,
  warnings: [],
};
const pricing = {
  targetGrossMargin: 30,
  discount: 0,
  gstPercent: 0,
  profitShareRates: rates,
  profitShareMasterDataRevision: 7,
};
const quoteProps = {
  project: {
    id: 'PRJ-SHARE',
    name: 'Rate snapshot',
    client: 'Client A',
    currency: 'SGD',
  },
  activeVersion: 'V1',
  versionState: 'Confirmed',
  totalCost: 50,
  costAllocation: allocation,
  costErrors: [],
  onSave: async () => true,
  onOpenMasterData: noop,
  onApplyProfitShare: async () => true,
  onExportStateChange: noop,
  exportInProgress: false,
  pricing,
  setPricing: noop,
  assumptionLibrary: [],
  quoteTemplates: [initialQuoteTemplates[0]],
  selectedQuoteTemplateId: initialQuoteTemplates[0].id,
  setSelectedQuoteTemplateId: noop,
  quoteAssumptions: [],
  setQuoteAssumptions: noop,
  quoteHistory: [],
  setQuoteHistory: noop,
  announce: noop,
};
const render = (Component, props) =>
  renderToStaticMarkup(React.createElement(Component, props));

test('pricing displays applied BU share, unassigned cost allocation and net Sales GP', () => {
  let writes = 0;
  const markup = render(QuoteView, {
    ...quoteProps,
    setPricing: () => writes++,
  });
  assert.match(markup, /Applied Master Data · Revision 7/);
  assert.match(markup, /Apply Latest Master Data/);
  assert.match(markup, /Manage Rates/);
  assert.match(markup, /Target Sales GP/);
  assert.match(markup, /Actual Sales GP/);
  assert.match(markup, /30\.00%/);
  assert.match(markup, /20\.00%/);
  assert.match(markup, /Includes S\$ 5\.00 without BU/);
  assert.match(markup, /S\$ 100\.00/);
  assert.equal(
    writes,
    0,
    'opening pricing does not refresh captured global rates',
  );
});

test('missing active BU rate is visibly flagged as a zero-rate assumption', () => {
  const result = calculatePricing(
    50,
    { ...pricing, profitShareRates: [] },
    allocation,
  );
  const markup = render(ProfitShareSummary, {
    result,
    onManage: noop,
    applying: false,
    disabled: false,
  });
  assert.match(markup, /No master data revision applied/);
  assert.match(markup, /Not configured/);
  assert.match(markup, /No active profit-share rate for Network; 0% is used/);
  assert.match(markup, /0\.00%/);
});

test('target GP plus share at 100 percent blocks quotation generation', () => {
  const markup = render(QuoteView, {
    ...quoteProps,
    pricing: { ...pricing, targetGrossMargin: 80 },
  });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /<button[^>]*disabled[^>]*>[^]*?Generate XLSX/);
  assert.doesNotMatch(markup, /NaN|Infinity/);
});

test('master-data rate editor is independent of projects and flags duplicate BU definitions', () => {
  const empty = render(ProfitShareEditor, {
    items: [],
    setItems: noop,
    query: '',
  });
  assert.match(empty, /No profit share rates configured/);
  assert.match(empty, /Add BU/);
  assert.doesNotMatch(empty, /Select Project|Choose Project/);
  const markup = render(ProfitShareEditor, {
    items: [...rates, { ...rates[0], id: 'duplicate', bu: ' network ' }],
    setItems: noop,
    query: '',
  });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /requires a unique BU/);
  assert.match(markup, /min="0"/);
  assert.match(markup, /max="100"/);
});
