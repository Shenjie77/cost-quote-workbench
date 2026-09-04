#!/usr/bin/env node

/** Runs the built workbench and SQLite API together on the company computer. */

import { spawn } from 'node:child_process';
import path from 'node:path';

const wranglerBinary = path.resolve('node_modules/.bin/wrangler');

const children = [
  spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'server/local-api.mjs'],
    {
      stdio: 'inherit',
    },
  ),
  spawn(
    wranglerBinary,
    [
      'dev',
      '--config',
      'dist/server/wrangler.json',
      // The generated relative asset path is interpreted from the caller's
      // working directory by this Wrangler release. Override it explicitly so
      // content-hashed CSS/JS files resolve from the built client directory.
      '--assets',
      'dist/client',
      '--port',
      '3000',
    ],
    { stdio: 'inherit' },
  ),
];

let closing = false;
const closeAll = (signal = 'SIGTERM') => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill(signal);
};

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!closing) {
      closeAll();
      process.exitCode = code ?? (signal ? 1 : 0);
    }
  });
}
process.on('SIGINT', () => closeAll('SIGINT'));
process.on('SIGTERM', () => closeAll('SIGTERM'));
