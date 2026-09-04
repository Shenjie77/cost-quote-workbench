#!/usr/bin/env node

/** Starts only the built web worker with static paths relative to dist/server. */

import { spawn } from 'node:child_process';
import path from 'node:path';

const child = spawn(
  path.resolve('node_modules/.bin/wrangler'),
  [
    'dev',
    '--config',
    'dist/server/wrangler.json',
    '--assets',
    'dist/client',
    '--port',
    '3000',
  ],
  { stdio: 'inherit' },
);

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
