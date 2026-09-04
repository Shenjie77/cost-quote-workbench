import assert from 'node:assert/strict';
import test from 'node:test';

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
  assert.equal(result.quoteAfterTax, 27392.86);
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
