/** Preview visibility must never write quotation data or trigger customer output. */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { makeCostSnapshot } from './helpers.mjs';
import { calculatePricing } from '../features/quote/domain.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hookKey = Symbol.for('quote-preview-layout-hooks');
const adapter = `data:text/javascript,${encodeURIComponent(`
  import * as React from ${JSON.stringify(import.meta.resolve('react'))};
  export * from ${JSON.stringify(import.meta.resolve('react'))};
  const hooks = () => globalThis[Symbol.for('quote-preview-layout-hooks')] || React;
  export const useState = (...args) => hooks().useState(...args);
  export const useRef = (...args) => hooks().useRef(...args);
  export const useEffect = (...args) => hooks().useEffect(...args);
`)}`;
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      /\/(quote-view|quote-preview-dialog)\.tsx$/.test(context.parentURL || '')
    )
      return { url: adapter, shortCircuit: true };
    if (
      specifier.startsWith('@/') ||
      (specifier.startsWith('.') &&
        context.parentURL?.startsWith(pathToFileURL(root).href) &&
        !context.parentURL.includes('/node_modules/'))
    ) {
      const base = specifier.startsWith('@/')
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
const { QuoteView } = await import('../features/quote/quote-view.tsx');
const { QuotePreviewDialog } =
  await import('../features/quote/quote-preview-dialog.tsx');
const { QuoteLinesEditor } =
  await import('../features/quote/quote-lines-editor.tsx');
const { Dialog, DialogTrigger, DialogContent, DialogFooter } =
  await import('../components/ui/dialog.tsx');
const { Table } = await import('../components/ui/table.tsx');
const { SectionHeading } =
  await import('../components/workbench/section-heading.tsx');
const { QuoteNumberInput } =
  await import('../features/quote/quote-number-input.tsx');
after(() => loader.deregister());

/** Walk public component slots without executing unrelated controls or their effects. */
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children), ...walk(node.props.action)]
      : [];

/** Retain only local hook state while running a component's actual event handlers. */
function harness(component, props) {
  const state = [];
  let cursor = 0;
  const backend = {
    useState(initial) {
      const index = cursor++;
      state[index] ??= {
        value: typeof initial === 'function' ? initial() : initial,
      };
      return [
        state[index].value,
        (next) => {
          state[index].value =
            typeof next === 'function' ? next(state[index].value) : next;
        },
      ];
    },
    useRef(initial) {
      return (state[cursor++] ??= { current: initial });
    },
    useEffect() {},
  };
  return () => {
    cursor = 0;
    globalThis[hookKey] = backend;
    try {
      return component(props);
    } finally {
      delete globalThis[hookKey];
    }
  };
}

/** Use synthetic customer content and callbacks that count every business-state write. */
function fixture(overrides = {}) {
  const snapshot = makeCostSnapshot();
  const pricing = {
    targetGrossMargin: 20,
    discount: 30,
    gstPercent: 0,
    lineMode: 'manual',
    manualTargetPrice: 250,
    manualLines: [
      {
        id: 'line-1',
        description: 'Design & engineering',
        quantity: 1,
        unit: 'lot',
        unitPrice: 100,
        allocationWeight: 40,
      },
      {
        id: 'line-2',
        description: 'Delivery\nTwo visits',
        quantity: 2,
        unit: 'visit',
        unitPrice: 75,
        allocationWeight: 60,
        priceFixed: true,
      },
    ],
    ...overrides,
  };
  let writes = 0;
  const changed = () => {
    writes++;
  };
  return {
    writes: () => writes,
    props: {
      project: snapshot.project,
      activeVersion: 'V7',
      versionState: 'Confirmed',
      totalCost: 100,
      costSnapshot: snapshot,
      costErrors: [],
      onSave: changed,
      onOpenMasterData: changed,
      onApplyProfitShare: changed,
      onExportStateChange: changed,
      exportInProgress: false,
      pricing,
      setPricing: changed,
      assumptionLibrary: [],
      quoteTemplates: [
        {
          id: 'template-1',
          name: 'Customer workbook',
          active: true,
          clientPattern: '*',
          documentTitle: 'CUSTOMER SERVICES',
          validityDays: 45,
          paymentTerms: 'Thirty days after acceptance',
          termsAndConditions: 'First condition.\nSecond condition.',
          defaultAssumptionIds: [],
        },
      ],
      selectedQuoteTemplateId: 'template-1',
      setSelectedQuoteTemplateId: changed,
      quoteAssumptions: [
        {
          id: 'included',
          text: 'Access is provided by the client.',
          textZh: '',
          included: true,
        },
        {
          id: 'excluded',
          text: 'INTERNAL EXCLUDED ASSUMPTION',
          textZh: '',
          included: false,
        },
      ],
      setQuoteAssumptions: changed,
      quoteHistory: [],
      setQuoteHistory: changed,
      announce: changed,
    },
  };
}

test('pricing occupies one full-width section with the input grid before the detail editor', () => {
  const { props, writes } = fixture();
  const view = harness(QuoteView, props)();
  const panel = React.Children.toArray(view.props.children).find(
    (node) => node.props['aria-label'] === 'Quotation pricing',
  );
  assert.ok(panel, 'pricing is a direct page section, not a sidebar column');
  const children = React.Children.toArray(panel.props.children);
  assert.ok(
    children.findIndex((node) => node.type === Table) <
      children.findIndex((node) => node.type === QuoteLinesEditor),
  );
  const nodes = walk(view);
  assert.deepEqual(
    nodes
      .filter((node) => node.type === SectionHeading)
      .map((node) => node.props.title),
    ['Pricing Parameters', 'Quote Assumptions', 'Quotation History'],
  );
  const heading = children.find((node) => node.type === SectionHeading);
  assert.ok(
    walk(heading.props.action).some((node) => node.type === QuotePreviewDialog),
  );
  const gp = nodes.find(
    (node) =>
      node.type === QuoteNumberInput && node.props.id === 'target-gross-margin',
  );
  assert.notEqual(
    gp.props.disabled,
    true,
    'manual quotations must retain an editable GP control',
  );
  assert.equal(gp.props.title, undefined);
  assert.equal(writes(), 0);
});

test('opening and closing the preview changes only visibility and preserves every customer field', () => {
  const { props, writes } = fixture();
  const before = structuredClone({
    pricing: props.pricing,
    snapshot: props.costSnapshot,
    templates: props.quoteTemplates,
    assumptions: props.quoteAssumptions,
    history: props.quoteHistory,
  });
  const preview = walk(harness(QuoteView, props)()).find(
    (node) => node.type === QuotePreviewDialog,
  );
  const render = harness(QuotePreviewDialog, preview.props);
  let dialog = render();
  assert.equal(dialog.type, Dialog);
  assert.equal(dialog.props.open, false);
  assert.ok(walk(dialog).some((node) => node.type === DialogTrigger));
  dialog.props.onOpenChange(true);
  dialog = render();
  assert.equal(dialog.props.open, true);
  assert.equal(
    walk(dialog).find((node) => node.type === DialogFooter).props
      .showCloseButton,
    true,
  );
  const content = walk(dialog).find((node) => node.type === DialogContent);
  assert.match(content.props.className, /max-h-/);
  const article = walk(content).find((node) => node.type === 'article');
  const html = renderToStaticMarkup(article);
  for (const text of [
    'CUSTOMER SERVICES',
    'QT-TEST-001-V7',
    'Test Client',
    'Test Service Project',
    'Design &amp; engineering',
    'Delivery',
    'Two visits',
    '45 days',
    'Thirty days after acceptance',
    'First condition.',
    'Second condition.',
    'Access is provided by the client.',
    'GST 0.00%',
    '250.00',
    '220.00',
    '30.00',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /INTERNAL EXCLUDED ASSUMPTION|allocationWeight|priceFixed|<input|<textarea|<button|<select/,
  );
  dialog.props.onOpenChange(false);
  assert.equal(render().props.open, false);
  assert.equal(
    writes(),
    0,
    'preview must not save, export, set prices or record history',
  );
  assert.deepEqual(
    {
      pricing: props.pricing,
      snapshot: props.costSnapshot,
      templates: props.quoteTemplates,
      assumptions: props.quoteAssumptions,
      history: props.quoteHistory,
    },
    before,
  );
});

test('GP-derived allocated lines are shared by the editor and preview without persisting a render-time price change', () => {
  const { props, writes } = fixture({
    manualPricingBasis: 'gp',
    manualTargetPrice: undefined,
    manualLines: [
      {
        id: 'line-1',
        description: 'Design',
        quantity: 1,
        unit: 'lot',
        unitPrice: 100,
        allocationWeight: 40,
      },
      {
        id: 'line-2',
        description: 'Delivery',
        quantity: 2,
        unit: 'visit',
        unitPrice: 75,
        allocationWeight: 60,
      },
    ],
  });
  const before = structuredClone(props.pricing);
  const nodes = walk(harness(QuoteView, props)());
  const preview = nodes.find((node) => node.type === QuotePreviewDialog).props;
  const editor = nodes.find((node) => node.type === QuoteLinesEditor).props;
  const result = calculatePricing(props.totalCost, props.pricing);
  assert.equal(result.valid, true, result.errors.join('; '));
  assert.deepEqual(editor.allocatedLines, result.allocatedManualLines);
  assert.equal(editor.gpTargetPrice, result.listPrice);
  assert.deepEqual(preview.lines, editor.lines);
  assert.equal(
    preview.lines.reduce((sum, line) => sum + line.amount, 0),
    result.listPrice,
  );
  assert.deepEqual(props.pricing, before);
  assert.equal(writes(), 0);
});

test('preview preserves four-decimal unit rates and flags unresolved draft prices outside the customer document', () => {
  const { props } = fixture({
    manualTargetPrice: 1000,
    manualLines: [
      {
        id: 'precision',
        description: 'Precise delivery rate',
        quantity: 2.5,
        unit: 'day',
        unitPrice: 373.332,
      },
    ],
  });
  const preview = walk(harness(QuoteView, props)()).find(
    (node) => node.type === QuotePreviewDialog,
  );
  const result = preview.props.pricing;
  assert.equal(
    result.valid,
    false,
    'the line total differs from the saved legacy target',
  );
  const nodes = walk(harness(QuotePreviewDialog, preview.props)());
  const alert = nodes.find((node) => node.props.role === 'alert');
  assert.ok(alert);
  assert.match(renderToStaticMarkup(alert), /Draft has unresolved pricing/);
  const article = nodes.find((node) => node.type === 'article');
  const html = renderToStaticMarkup(article);
  assert.match(html, /S\$ 373\.332/);
  assert.match(html, /S\$ 933\.33/);
  assert.doesNotMatch(html, /373\.34|Draft has unresolved pricing/);
});

/** Exercise the real page-level GP handler with controlled state, including legacy activation and export locks. */
test('the original GP control updates manual targets and locks without a second target field', () => {
  const { props } = fixture();
  let writes = 0;
  props.setPricing = (next) => {
    writes++;
    props.pricing = typeof next === 'function' ? next(props.pricing) : next;
  };
  const render = harness(QuoteView, props);
  const gp = () =>
    walk(render()).find(
      (node) =>
        node.type === QuoteNumberInput &&
        node.props.id === 'target-gross-margin',
    );
  gp().props.onCommit(50);
  assert.equal(props.pricing.manualPricingBasis, 'gp');
  assert.equal(props.pricing.manualTargetPrice, undefined);
  assert.equal(props.pricing.targetGrossMargin, 50);
  assert.equal(props.pricing.discount, 30);
  assert.equal(props.pricing.gstPercent, 0);
  let result = calculatePricing(100, props.pricing);
  assert.equal(result.listPrice, 200);
  assert.deepEqual(
    result.allocatedManualLines.map((line) => line.quantity * line.unitPrice),
    [50, 150],
  );
  gp().props.onCommit(60);
  result = calculatePricing(100, props.pricing);
  assert.equal(result.listPrice, 250);
  assert.deepEqual(
    result.allocatedManualLines.map((line) => line.quantity * line.unitPrice),
    [100, 150],
  );
  assert.equal(writes, 2);
  props.exportInProgress = true;
  assert.equal(gp().props.disabled, true);
  gp().props.onCommit(70);
  assert.equal(writes, 2);
  assert.equal(props.pricing.targetGrossMargin, 60);
});
