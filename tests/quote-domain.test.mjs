import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePricingSettings } from '../features/quote/domain.ts';

test('quotation output rejects invalid margin and excessive discounts', () => {
  const valid = { targetGrossMargin: 25, gstPercent: 9, discount: 0 };
  assert.deepEqual(validatePricingSettings(valid, 100), []);
  for (const change of [{ targetGrossMargin: 96 }, { discount: 1000 }])
    assert.ok(validatePricingSettings({ ...valid, ...change }, 100).length > 0);
});

import { calculatePricing } from '../features/quote/domain.ts';

test('pricing derives quotation and actual sales gross margin from cost', () => {
  const result = calculatePricing(18848.282, {
    targetGrossMargin: 25,
    discount: 0,
    gstPercent: 9,
  });
  assert.equal(result.cost, 18848.29);
  assert.equal(result.quoteBeforeTax, 25131.06);
  assert.equal(result.grossMarginPercent.toFixed(2), '25.00');
  assert.equal(result.quoteAfterTax, 25131.06);
  assert.equal(result.gstPercent, 0);
  assert.equal(result.gstAmount, 0);
});

test('legacy tax settings never charge tax or block a newly calculated quotation', () => {
  for (const gstPercent of [0, 9, -1, 101, NaN, Infinity, undefined]) {
    const settings = { targetGrossMargin: 50, discount: 0, gstPercent };
    const before = structuredClone(settings);
    const result = calculatePricing(100, settings);
    assert.equal(result.valid, true, result.errors.join('; '));
    assert.equal(result.quoteBeforeTax, 200);
    assert.equal(result.quoteAfterTax, 200);
    assert.equal(result.gstPercent, 0);
    assert.equal(result.gstAmount, 0);
    assert.deepEqual(settings, before);
  }
});

test('discount changes actual gross margin without changing target list price', () => {
  const result = calculatePricing(750, {
    targetGrossMargin: 25,
    discount: 100,
    gstPercent: 0,
  });
  assert.equal(result.listPrice, 1000);
  assert.equal(result.quoteBeforeTax, 900);
  assert.equal(result.grossMarginPercent.toFixed(2), '16.67');
});
