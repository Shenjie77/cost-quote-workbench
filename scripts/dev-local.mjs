#!/usr/bin/env node

/** Runs the local SQLite API and Vinext UI as one developer command. */

import { spawn } from 'node:child_process';
import path from 'node:path';

const vinextBinary = path.resolve('node_modules/.bin/vinext');

const children = [
  spawn(
    process.execPath,
    ['--disable-warning=ExperimentalWarning', 'server/local-api.mjs'],
    {
      stdio: 'inherit',
    },
  ),
  spawn(vinextBinary, ['dev'], { stdio: 'inherit' }),
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
