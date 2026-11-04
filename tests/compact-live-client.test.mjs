import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactApi, apiBase } from '../public/design-review/live-client.js';
test('compact API preserves the project identity and expected revision', async () => {
  let request;
  const api = new CompactApi(
    'http://127.0.0.1:3321/api/local',
    async (url, options) => {
      request = { url, ...options };
      return {
        ok: true,
        json: async () => ({ ok: true, data: { revision: 8 } }),
      };
    },
  );
  assert.deepEqual(
    await api.save({ project: { id: 'Project / A' }, unknown: { keep: 1 } }, 7),
    { revision: 8 },
  );
  assert.match(request.url, /Project%20%2F%20A$/);
  const body = JSON.parse(request.body);
  assert.equal(body.expectedRevision, 7);
  assert.deepEqual(body.workspace.unknown, { keep: 1 });
});
test('compact API exposes conflicts without retrying or overwriting', async () => {
  let calls = 0;
  const api = new CompactApi('http://127.0.0.1:3321/api/local', async () => {
    calls++;
    return {
      ok: false,
      status: 409,
      json: async () => ({
        ok: false,
        error: { message: 'Revision conflict' },
      }),
    };
  });
  await assert.rejects(
    api.save({ project: { id: 'A' } }, 3),
    (e) => e.status === 409 && e.message === 'Revision conflict',
  );
  assert.equal(calls, 1);
});
test('preview transport stays on loopback and validates explicit test ports', () => {
  assert.equal(apiBase({ search: '' }), 'http://127.0.0.1:3210/api/local');
  assert.equal(
    apiBase({ search: '?apiPort=3321' }),
    'http://127.0.0.1:3321/api/local',
  );
  for (const search of [
    '?apiPort=https://example.com',
    '?apiPort=99999',
    '?apiPort=0',
  ])
    assert.throws(() => apiBase({ search }));
});
