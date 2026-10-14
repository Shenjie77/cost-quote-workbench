/** Generate public command inventory from the running CLI; --check detects drift. */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(
  process.execPath,
  ['--disable-warning=ExperimentalWarning', 'cli/cost-cli.mjs', 'help'],
  { cwd: root, encoding: 'utf8' },
);
if (result.status !== 0) throw new Error(result.stderr || result.stdout);
const { data } = JSON.parse(result.stdout);
const content = `# CLI command reference\n\nGenerated from cost-cli ${data.version} help. Do not edit this inventory by hand.\nRun \`node scripts/update-cli-reference.mjs\` after changing commands or package version.\n\nUse \`npm run --silent cost-cli -- <command>\`. Options use separate tokens\n(\`--name value\`); unknown options are rejected. See [the control manual](cli-control-manual.md)\nfor request envelopes, revisions and errors, and [platform coverage](cli-platform-coverage.md)\nfor supported fields and UI-only features. The inventory describes command discovery;\nper-command validation remains authoritative.\n\n\`\`\`text\n${data.commands.join('\n')}\n\`\`\`\n`;
const file = new URL('../docs/cli-command-reference.md', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== content)
    throw new Error(
      'CLI reference is stale. Run node scripts/update-cli-reference.mjs',
    );
} else writeFileSync(file, content);
