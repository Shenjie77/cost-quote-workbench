#!/usr/bin/env node

/** Starts only the built web worker with static paths relative to dist/server. */

import { spawn } from 'node:child_process';
import path from 'node:path';

const child = spawn(
  process.execPath,
  [
    path.resolve('node_modules/wrangler/bin/wrangler.js'),
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
child.on('error', (error) => {
  console.error('Unable to start built web:', error.message);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
