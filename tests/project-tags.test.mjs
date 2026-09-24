/** Tag normalization is independent from project costs and preserves user display labels. */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProjectTags,
  availableProjectTags,
} from '../features/projects/project-tags.ts';

test('tags deduplicate Unicode/case/spacing without mutating input and reuse portfolio labels', () => {
  const input = [' ＤＣ ', 'dc', '  Data   Centre ', 'data centre', '', '维保'];
  const copy = [...input];
  assert.deepEqual(normalizeProjectTags(input), ['DC', 'Data Centre', '维保']);
  assert.deepEqual(input, copy);
  assert.deepEqual(normalizeProjectTags(undefined), []);
  assert.deepEqual(
    availableProjectTags([
      { tags: ['DC'] },
      { tags: ['dc', 'Maintenance'] },
      {},
    ]),
    ['DC', 'Maintenance'],
  );
});

test('tags reject non-text, overlong labels and excessive unique labels', () => {
  for (const input of [
    null,
    'tag',
    [3],
    ['x'.repeat(41)],
    Array.from({ length: 31 }, (_, i) => `Tag ${i}`),
  ])
    assert.throws(() => normalizeProjectTags(input));
  assert.equal(normalizeProjectTags(Array(40).fill('Duplicate')).length, 1);
});
