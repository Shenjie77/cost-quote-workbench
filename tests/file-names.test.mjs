/** Portable display names keep time detail while excluding system identities from file paths. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readableFileStem,
  readableArchiveFileName,
  exportTimestamp,
} from '../lib/file-names.ts';

test('export timestamp includes the Singapore calendar, time and milliseconds', () => {
  assert.equal(
    exportTimestamp('2026-09-24T17:02:03.004Z'),
    '20260925_010203_004',
  );
  assert.throws(() => exportTimestamp('invalid'));
});
test('portable names preserve Chinese and extensions, reject device names, and keep timestamps after shortening', () => {
  assert.equal(readableFileStem('CON'), '_CON');
  assert.equal(readableFileStem('A/B:C*D?'), 'A-B-C-D-');
  assert.equal(readableArchiveFileName('报价.xlsx', 2), '报价 (2).xlsx');
  const file = readableArchiveFileName(
    `${'Long project '.repeat(30)}_20260925_010203_004.xlsx`,
    12,
  );
  assert.ok(file.length <= 80);
  assert.match(file, /_20260925_010203_004 \(12\)\.xlsx$/);
  assert.ok(!/[<>:"/\\|?*]/.test(file));
  const unicode = readableArchiveFileName('😀'.repeat(200) + '.xlsx');
  assert.ok(unicode.length <= 80);
  assert.ok(Buffer.byteLength(unicode) <= 240);
  assert.ok(unicode.endsWith('.xlsx'));
});
