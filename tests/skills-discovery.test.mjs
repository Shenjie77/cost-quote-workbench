import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// Renames must leave installed entrypoints and their reference files reachable.
test('business skill discovery links and referenced resources remain usable', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/check-business-skills.mjs'],
    {
      cwd: new URL('../', import.meta.url),
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
