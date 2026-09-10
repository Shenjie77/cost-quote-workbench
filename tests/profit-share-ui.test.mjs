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
  costSnapshot: {
    schemaVersion: '2.0.0',
    exportedAt: '2026-09-11T00:00:00Z',
    project: {
      id: 'PRJ-SHARE',
      name: 'Rate snapshot',
      client: 'Client A',
      currency: 'SGD',
    },
    costVersion: { code: 'V1', status: 'Confirmed' },
    rateSettings: {
      quoteAsOf: '',
      tdStart: '',
      tdEnd: '',
      baseYear: 2026,
      defaultUplift: 0,
      annualUplifts: [0, 0, 0, 0, 0],
    },
    travelSettings: {
      enabled: false,
      monthlyAllowance: 0,
      airfarePerTrip: 0,
      trips: 0,
    },
    resourceTypes: [],
    costRows: [],
    manualCosts: {
      localPurchasedEquipment: 0,
      inlandLogistics: 0,
      countryWarehousing: 0,
      nonInHouseLabour: 0,
      settlement: 0,
      carFee: 0,
      otherService: 50,
      riskContingency: 0,
    },
  },
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

test('manual quotation lines expose editable selling prices and disable the unused target GP control', () => {
  const markup = render(QuoteView, {
    ...quoteProps,
    pricing: {
      ...pricing,
      targetGrossMargin: 95,
      lineMode: 'manual',
      manualLines: [
        {
          id: 'customer-line',
          description: 'Customer service',
          quantity: 2,
          unit: 'site',
          unitPrice: 50,
        },
      ],
    },
  });
  assert.match(markup, /aria-label="Line 1 description"/);
  assert.match(markup, /aria-label="Line 1 quantity"/);
  assert.match(markup, /aria-label="Line 1 unit price"/);
  assert.match(markup, /Add line/);
  assert.match(markup, /Line Total Before Discount/);
  assert.match(markup, /id="target-gross-margin"[^>]*disabled/);
  assert.doesNotMatch(
    markup,
    /Target sales GP plus weighted profit-share rate must be less/,
  );
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
