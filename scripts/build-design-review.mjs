#!/usr/bin/env node
/** Rebuild the isolated design review's calculation bundle without reading customer data. */
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await build({
  configFile: false,
  root,
  publicDir: false,
  resolve: { alias: { '@': root } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  logLevel: 'warn',
  build: {
    target: 'es2022',
    outDir: path.join(root, 'public/design-review/generated'),
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        engine: path.join(root, 'features/design-review/business-entry.ts'),
        output: path.join(root, 'features/design-review/output-entry.ts'),
        draft: path.join(root, 'features/design-review/draft-entry.ts'),
        capabilities: path.join(
          root,
          'features/design-review/capabilities-entry.ts',
        ),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'draft',
    },
  },
});
console.log(
  'Design review calculation bundle refreshed from production modules.',
);
