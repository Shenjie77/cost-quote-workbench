import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMoney } from '../lib/money.ts';
import { readColumnWidths } from '../lib/table-column-widths.ts';
test('money presentation groups thousands with two decimals without changing the source number', () => {
  const source = 123456.789;
  assert.equal(formatMoney(source), '123,456.79');
  assert.equal(source, 123456.789);
  assert.equal(formatMoney(0), '0.00');
  assert.equal(formatMoney(-1234), '-1,234.00');
  assert.equal(formatMoney(null), '—');
});
test('saved column sizes reject corrupt data and changed column schemas', () => {
  assert.deepEqual(readColumnWidths('[80,240,120]', 3), [80, 240, 120]);
  for (const raw of [
    'invalid',
    '{}',
    '[80]',
    '[0,240,120]',
    '[80,"240",120]',
    '[80,240,99999]',
  ])
    assert.equal(readColumnWidths(raw, 3), null);
});
