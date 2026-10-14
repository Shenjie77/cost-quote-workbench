/** Validate discoverability and local references after business skill renames. */
import {
  readdirSync,
  readFileSync,
  lstatSync,
  realpathSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'skills');
const discovery = path.join(root, '.agents/skills');
const fail = (message) => {
  throw new Error(message);
};
const folders = readdirSync(source).filter((name) =>
  existsSync(path.join(source, name, 'SKILL.md')),
);
const names = new Set();
for (const folder of folders) {
  const file = path.join(source, folder, 'SKILL.md');
  const text = readFileSync(file, 'utf8');
  const front = text.match(/^---\r?\n([\s\S]+?)\r?\n---/);
  const name = front?.[1].match(/^name: (.+)$/m)?.[1];
  const description = front?.[1].match(/^description: (.+)$/m)?.[1];
  if (
    name !== folder ||
    !/^ssr-[a-z0-9-]+$/.test(name) ||
    name.length >= 64 ||
    names.has(name)
  )
    fail(`Invalid or duplicate skill: ${file}`);
  if (!description?.trim()) fail(`Missing description: ${file}`);
  names.add(name);
  const link = path.join(discovery, name);
  if (
    !lstatSync(link).isSymbolicLink() ||
    realpathSync(link) !== realpathSync(path.dirname(file))
  )
    fail(`Invalid discovery link: ${link}`);
  const ui = readFileSync(
    path.join(source, folder, 'agents/openai.yaml'),
    'utf8',
  );
  if (!ui.includes(`$${name}`))
    fail(`Default prompt uses an outdated name: ${folder}`);
}
for (const entry of readdirSync(discovery)) {
  if (
    (entry.startsWith('ssr-') || entry === 'cost-workbench') &&
    !names.has(entry)
  )
    fail(`Stale discovery entry: ${entry}`);
}
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.name.endsWith('.md')) {
      const text = readFileSync(file, 'utf8');
      for (const [, href] of text.matchAll(/\]\(([^)]+)\)/g)) {
        if (/^(?:[a-z]+:|#)/i.test(href)) continue;
        const target = href.split('#')[0];
        if (target && !existsSync(path.resolve(path.dirname(file), target)))
          fail(`Broken reference in ${file}: ${href}`);
      }
    }
  }
}
inspect(source);
console.log(
  `Validated ${names.size} business skills, discovery links, prompts and skill references.`,
);
