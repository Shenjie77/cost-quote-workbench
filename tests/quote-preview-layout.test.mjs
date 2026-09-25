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
  export const useSyncExternalStore = (...args) => hooks().useSyncExternalStore(...args);
`)}`;
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier === 'react' &&
      /\/(quote-view|quote-preview-dialog|quote-description-dialog|manual-history-form|use-personnel-table-view)\.tsx?$/.test(
        context.parentURL || '',
      )
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
const { QuoteDescriptionDialog } =
  await import('../features/quote/quote-description-dialog.tsx');
const { QuoteView } = await import('../features/quote/quote-view.tsx');
const { QuotePreviewDialog } =
  await import('../features/quote/quote-preview-dialog.tsx');
const { ManualHistoryForm } =
  await import('../features/quote/manual-history-form.tsx');
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

/** Read native labels without rendering controlled inputs or invoking their browser effects. */
const textOf = (node) =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : React.isValidElement(node)
      ? textOf(node.props.children)
      : typeof node === 'string'
        ? node
        : '';

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
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot();
    },
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
          id: 'assumption-tax',
          text: 'SYSTEM TAX CLAUSE MUST NOT APPEAR',
          textZh: '',
          included: true,
        },
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

test('internal combined export is available without a customer template and respects cost and pricing errors', () => {
  const { props, writes } = fixture();
  props.quoteTemplates = [];
  props.versionState = 'Draft';
  const button = () =>
    walk(harness(QuoteView, props)()).find(
      (node) => node.props.triggerLabel === 'Quotation + Simple Cost',
    );
  assert.equal(button().props.disabled, false);
  props.costErrors = ['Invalid cost'];
  assert.equal(button().props.disabled, true);
  props.costErrors = [];
  props.exportInProgress = true;
  assert.equal(button().props.disabled, true);
  assert.equal(writes(), 0);
});

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
  assert.equal(
    gp,
    undefined,
    'whole-quote GP is computed from the detail prices',
  );
  assert.equal(
    nodes.find((node) => node.props.id === 'pricing-discount').props.disabled,
    false,
  );
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
    'Quote Total',
    '250.00',
    '220.00',
    '30.00',
  ])
    assert.ok(html.includes(text), text);
  assert.doesNotMatch(
    html,
    /SYSTEM TAX CLAUSE|INTERNAL EXCLUDED ASSUMPTION|allocationWeight|priceFixed|targetGrossMargin|GST|Before Tax|After Tax|<input|<textarea|<button|<select/,
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

test('independent line prices are shared by editor and preview with current costs and no overall target control', () => {
  const { props, writes } = fixture({
    manualPricingBasis: 'line-gp',
    manualTargetPrice: undefined,
    manualLines: [
      {
        id: 'line-1',
        description: 'Design',
        quantity: 1,
        unit: 'lot',
        unitPrice: 1,
        costWeight: 40,
        targetGrossMargin: 50,
      },
      {
        id: 'line-2',
        description: 'Delivery',
        quantity: 2,
        unit: 'visit',
        unitPrice: 1,
        costWeight: 60,
        targetGrossMargin: 75,
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
  assert.equal(editor.gpTargetPrice, undefined);
  assert.equal(editor.costSnapshot, props.costSnapshot);
  assert.equal(editor.totalCost, props.totalCost);
  assert.equal(editor.weightedProfitShareRate, result.weightedProfitShareRate);
  assert.deepEqual(preview.lines, editor.lines);
  assert.deepEqual(
    preview.lines.map((line) => line.amount),
    [80, 240],
  );
  assert.equal(result.listPrice, 320);
  assert.equal(preview.pricing.quoteBeforeTax, 290);
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

/** Whole-quotation GP is derived from line prices; only discount remains editable in the pricing summary. */
test('quotation summary displays computed GP without whole-quote GP or tax inputs and disables line editing during export', () => {
  const { props, writes } = fixture({ gstPercent: 9 });
  const before = structuredClone(props.pricing);
  const render = harness(QuoteView, props);
  const nodes = walk(render());
  assert.equal(
    nodes.some((node) => node.props.id === 'target-gross-margin'),
    false,
  );
  assert.equal(
    nodes.some((node) => node.type === QuoteNumberInput),
    false,
  );
  assert.equal(
    nodes.some((node) =>
      /gst|tax/i.test(node.props.id || node.props['aria-label'] || ''),
    ),
    false,
  );
  const pageText = [
    textOf(render()),
    ...nodes.map((node) => node.props.en || ''),
  ].join(' ');
  assert.match(pageText, /Actual Sales GP/);
  assert.match(pageText, /54\.55%/);
  assert.match(pageText, /Quote Total/);
  assert.doesNotMatch(pageText, /GST|Before Tax|After Tax|SYSTEM TAX CLAUSE/);
  const editor = nodes.find((node) => node.type === QuoteLinesEditor);
  assert.equal(editor.props.disabled, false);
  assert.equal(editor.props.totalCost, 100);
  assert.equal(editor.props.costSnapshot, props.costSnapshot);
  const preview = nodes.find((node) => node.type === QuotePreviewDialog);
  assert.equal(preview.props.pricing.gstAmount, 0);
  assert.equal(preview.props.pricing.quoteBeforeTax, 220);
  assert.equal(preview.props.pricing.quoteAfterTax, 220);
  props.exportInProgress = true;
  const locked = walk(render());
  assert.equal(
    locked.find((node) => node.type === QuoteLinesEditor).props.disabled,
    true,
  );
  assert.equal(
    locked.find((node) => node.props.id === 'pricing-discount').props.disabled,
    true,
  );
  assert.equal(writes(), 0);
  assert.deepEqual(props.pricing, before);
});

/** New manual references accept one final quotation amount while keeping the durable record shape. */
test('manual history has one Quote Total field and stores no tax amount', () => {
  const records = [];
  const render = harness(ManualHistoryForm, {
    costVersion: 'V2',
    templateId: 'customer',
    onAdd: (record) => records.push(record),
    onCancel: () => {},
  });
  const set = (label, value) => {
    const control = walk(render()).find(
      (node) => node.type === 'label' && textOf(node).includes(label),
    );
    assert.ok(control, label);
    walk(control)
      .find((node) => typeof node.props.onChange === 'function')
      .props.onChange({ target: { value } });
  };
  assert.doesNotMatch(textOf(render()), /GST|tax|税/);
  set('Quote number', 'HISTORY-001');
  set('Quote date', '2026-09-24');
  set('Actual cost', '100');
  set('Quote Total', '200');
  render().props.onSubmit({ preventDefault() {} });
  assert.equal(records.length, 1);
  assert.equal(records[0].quoteBeforeTax, 200);
  assert.equal(records[0].quoteAfterTax, 200);
  assert.equal(records[0].gstAmount, 0);
  assert.equal(records[0].grossMarginPercent, 50);
});

test('full description popup preserves newlines and cancellation never writes', () => {
  const saved = [];
  const props = {
    value: 'One\nTwo\nThree\nFour',
    lineNumber: 1,
    editable: true,
    disabled: false,
    onSave: (value) => saved.push(value),
  };
  const render = harness(QuoteDescriptionDialog, props);
  const input = () =>
    walk(render()).find(
      (node) => node.props['aria-label'] === 'Full description for line 1',
    );
  const button = (label) =>
    walk(render()).find(
      (node) =>
        typeof node.props.onClick === 'function' && textOf(node) === label,
    );
  render().props.onOpenChange(true);
  assert.equal(input().props.value, props.value);
  input().props.onChange({ target: { value: 'Edited\nDescription' } });
  button('Cancel').props.onClick();
  assert.deepEqual(saved, []);
  render().props.onOpenChange(true);
  assert.equal(input().props.value, props.value);
  input().props.onChange({ target: { value: 'Saved\nDescription' } });
  button('Save description').props.onClick();
  assert.deepEqual(saved, ['Saved\nDescription']);
  props.disabled = true;
  button('Save description').props.onClick();
  assert.equal(saved.length, 1);
  props.editable = false;
  assert.equal(input(), undefined);
  assert.ok(textOf(render()).includes(props.value));
});
