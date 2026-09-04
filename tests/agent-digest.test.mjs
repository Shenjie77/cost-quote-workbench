/** Regression coverage for deterministic review timing and Agent digest rules. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDailyDigest,
  normalizeDigestDate,
} from '../features/agent/digest-domain.ts';
import { getReviewTiming } from '../features/reviews/types.ts';

const blockedReview = {
  id: 'review-001',
  projectId: 'PRJ-001',
  gate: 'Delivery Review',
  gateZh: '交付评审',
  owner: 'PM',
  dueDate: '2026-09-03',
  status: 'blocked',
  note: '',
  noteZh: '',
  workflowStepCode: 'delivery-review',
  lastUpdatedAt: '2026-09-01T00:00:00.000Z',
  followUps: [],
};

test('review timing is derived from explicit dates and status', () => {
  const timing = getReviewTiming(
    blockedReview,
    new Date('2026-09-05T12:00:00.000Z'),
  );
  assert.equal(timing.overdue, true);
  assert.equal(timing.daysUntilDue, -2);
});

test('daily digest groups persisted review, version, and quality exceptions', () => {
  const digest = buildDailyDigest(
    [
      {
        projectId: 'PRJ-001',
        name: 'Test Project',
        client: 'Test Client',
        activeVersion: 'V2',
        versionState: 'Draft',
        totalCost: 100,
        incompleteCostRows: 2,
      },
    ],
    [blockedReview],
    '2026-09-05',
  );
  assert.deepEqual(digest.counts, {
    immediate_follow_up: 1,
    decisions_due: 0,
    cost_attention: 1,
    data_quality: 1,
  });
  assert.equal(digest.items[0].reviewId, blockedReview.id);
  assert.equal(
    digest.items.every((item) => item.projectId === 'PRJ-001'),
    true,
  );
});

test('digest dates reject impossible calendar dates', () => {
  assert.throws(() => normalizeDigestDate('2026-02-31'), /real calendar date/);
});
