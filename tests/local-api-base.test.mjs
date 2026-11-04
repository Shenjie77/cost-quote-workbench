import assert from 'node:assert/strict';
import test from 'node:test';
import { localApiBase, LOCAL_API_BASE } from '../lib/local-api.ts';
test('all live modules retain the installed API default and support explicit loopback test instances', () => {
  assert.equal(LOCAL_API_BASE, 'http://127.0.0.1:3210/api/local');
  assert.equal(
    localApiBase('http://localhost:3321'),
    'http://localhost:3321/api/local',
  );
  assert.equal(
    localApiBase('http://[::1]:3321'),
    'http://[::1]:3321/api/local',
  );
  for (const origin of [
    'https://example.com',
    'http://example.com',
    'http://localhost@evil.test',
    'http://localhost/path',
    'http://localhost/?token=x',
    'http://localhost/#x',
    'http://user:secret@localhost',
  ])
    assert.throws(() => localApiBase(origin));
});
