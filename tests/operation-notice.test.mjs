import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoticeController } from '../features/workbench/notice-controller.ts';

test('operation notice disappears after exactly three seconds', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = [];
  const notice = createNoticeController((message) => values.push(message));
  notice.announce('Saved');
  t.mock.timers.tick(2999);
  assert.deepEqual(values, ['Saved']);
  t.mock.timers.tick(1);
  assert.deepEqual(values, ['Saved', '']);
});

test('a repeated or replacement notice restarts the timer instead of using the old expiry', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = [];
  const notice = createNoticeController((message) => values.push(message));
  notice.announce('Saved');
  t.mock.timers.tick(2000);
  notice.announce('Saved');
  t.mock.timers.tick(1000);
  assert.deepEqual(values, ['Saved', 'Saved']);
  notice.announce('Exported');
  t.mock.timers.tick(2999);
  assert.equal(values.at(-1), 'Exported');
  t.mock.timers.tick(1);
  assert.equal(values.at(-1), '');
  assert.equal(values.filter((value) => value === '').length, 1);
});

test('manual dismissal and unmount cancel pending updates; a remounted controller remains usable', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const values = [];
  const notice = createNoticeController((message) => values.push(message));
  notice.announce('Saved');
  notice.announce('');
  t.mock.timers.tick(3000);
  assert.deepEqual(values, ['Saved', '']);
  notice.announce('Exported');
  notice.dispose();
  t.mock.timers.tick(3000);
  assert.deepEqual(values, ['Saved', '', 'Exported']);
  notice.announce('Updated');
  t.mock.timers.tick(3000);
  assert.deepEqual(values.slice(-2), ['Updated', '']);
});
