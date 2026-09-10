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
// Transform UI modules and the API client's TypeScript parameter properties for Node.
// Resolve only application modules; production builds and dependencies are unchanged.
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
    if (
      (!url.endsWith('.tsx') && !url.endsWith('/workspace-client.ts')) ||
      url.includes('/node_modules/')
    )
      return nextLoad(url, context);
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
const { QuoteTemplatesView } =
  await import('../features/master-data/quote-catalog-view.tsx');
const { GlobalConflictFields } =
  await import('../features/master-data/global-master-data-page.tsx');
hooks.deregister();

const template = {
  ...initialQuoteTemplates[0],
  id: 'internal-template-id',
  name: 'Customer Service Quote',
  documentTitleZh: '历史报价标题',
  paymentTermsZh: '历史付款条件',
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
  assert.doesNotMatch(markup, /\p{Script=Han}/u);
  const selector = markup.match(
    /<button[^>]*id="quote-template-select"[^>]*>[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(selector);
  assert.match(selector, /Customer Service Quote/);
  assert.doesNotMatch(selector, />internal-template-id</);
});

test('template editor hides legacy translation inputs while retaining original T&C', () => {
  const legacy = {
    ...template,
    nameZh: '旧模板名称',
    documentTitleZh: '旧标题',
    paymentTermsZh: '旧付款条款',
    termsAndConditions: 'Customer original text\n客户原始条款',
  };
  const before = structuredClone(legacy);
  const markup = renderToStaticMarkup(
    React.createElement(QuoteTemplatesView, {
      templates: [legacy],
      setTemplates: noop,
      library: [],
      query: '',
      announce: noop,
    }),
  );
  assert.doesNotMatch(markup, /旧模板名称|旧标题|旧付款条款|Translation|译文/);
  assert.match(markup, /客户原始条款/);
  assert.doesNotMatch(markup.replace('客户原始条款', ''), /\p{Script=Han}/u);
  assert.deepEqual(legacy, before);
});

test('quotation template conflict previews use English labels and hide legacy translations', () => {
  const markup = renderToStaticMarkup(
    React.createElement(GlobalConflictFields, {
      item: {
        ...template,
        nameZh: '历史模板名称',
        defaultAssumptionIds: ['scope', 'delivery'],
        termsAndConditions: 'Customer T&C',
      },
      tab: 'quote-templates',
    }),
  );
  assert.match(markup, /Document title/i);
  assert.match(markup, /Payment terms/i);
  assert.match(markup, /Customer T&amp;C/);
  assert.match(markup, /scope, delivery/);
  assert.doesNotMatch(
    markup,
    /\p{Script=Han}|nameZh|documentTitleZh|paymentTermsZh/u,
  );
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
      costSnapshot: {
        schemaVersion: '2.0.0',
        exportedAt: '2026-09-11T00:00:00Z',
        project: {
          id: 'PRJ-TEMPLATE-TEST',
          name: 'Entry test',
          client: 'Client A',
          currency: 'SGD',
        },
        costVersion: { code: 'V1', status: 'Draft' },
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
          otherService: 100,
          riskContingency: 0,
        },
      },
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
      quoteAssumptions: [
        {
          id: 'included',
          text: 'Included English clause',
          textZh: '历史假设译文',
          included: true,
        },
      ],
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
  const preview = markup
    .match(/<section\b[\s\S]*?<\/section>/g)
    ?.find((section) => section.includes('Client Output Preview'));
  assert.ok(preview);
  assert.doesNotMatch(preview, /\p{Script=Han}/u);
  assert.match(preview, /Included English clause/);
  assert.doesNotMatch(
    markup,
    /历史报价标题|历史付款条件|历史假设译文|Quotation assumption translation/,
  );
  assert.equal(
    writes,
    0,
    'opening the quote must not apply a template automatically',
  );
});
