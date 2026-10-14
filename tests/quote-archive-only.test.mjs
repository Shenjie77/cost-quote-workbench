import assert from 'node:assert/strict';
import test from 'node:test';
import { downloadQuoteWorkbook } from '../features/quote/export-quote-workbook.ts';
import { downloadCombinedQuoteWorkbook } from '../features/quote/export-combined-workbook.ts';
import {
  calculatePricing,
  initialPricingSettings,
} from '../features/quote/domain.ts';
import { initialQuoteTemplates } from '../features/quote/types.ts';
import { makeCostSnapshot } from './helpers.mjs';

test('Generate XLSX and simple cost review archive once without browser downloads and propagate archive failures', async (t) => {
  const savedFetch = globalThis.fetch;
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    globalThis.fetch = savedFetch;
    if (savedDocument)
      Object.defineProperty(globalThis, 'document', savedDocument);
    else delete globalThis.document;
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    get() {
      throw new Error('Must not create a browser download');
    },
  });
  const calls = [];
  let fail = false;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: new URL(url), init });
    return new Response(
      JSON.stringify(
        fail
          ? { ok: false, error: { message: 'Archive unavailable' } }
          : { ok: true, data: { id: 'archived' } },
      ),
      { status: fail ? 503 : 200 },
    );
  };
  const snapshot = makeCostSnapshot();
  const quote = {
    project: snapshot.project,
    quoteNumber: 'QT-TEST',
    costVersion: 'V1',
    template: initialQuoteTemplates[0],
    assumptions: [],
    pricing: calculatePricing(100, initialPricingSettings),
  };
  const combined = { costSnapshot: snapshot, pricing: initialPricingSettings };
  const result = await downloadQuoteWorkbook(quote);
  assert.match(result.fileName, /^Quotation_/);
  const review = await downloadCombinedQuoteWorkbook(combined);
  assert.match(review.fileName, /^simple_cost_review_/);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.url.searchParams.get('category')),
    ['quote', 'cost'],
  );
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.ok(call.init.body.size > 0);
  }
  fail = true;
  await assert.rejects(downloadQuoteWorkbook(quote), /Archive unavailable/);
  await assert.rejects(
    downloadCombinedQuoteWorkbook(combined),
    /Archive unavailable/,
  );
});
