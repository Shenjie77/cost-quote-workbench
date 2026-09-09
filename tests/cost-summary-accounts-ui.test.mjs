import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import React from 'react';
import ts from 'typescript';
import { makeCostSnapshot } from './helpers.mjs';
import { getCostStatementValues, roundMoney } from '../features/cost/domain.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      specifier.startsWith('@/') ||
      (specifier.startsWith('.') &&
        context.parentURL?.startsWith(pathToFileURL(root).href) &&
        !context.parentURL.includes('/node_modules/'))
    ) {
      const base = specifier.startsWith('@/')
        ? path.join(root, specifier.slice(2))
        : fileURLToPath(new URL(specifier, context.parentURL));
      for (const extension of ['.ts', '.tsx'])
        if (existsSync(base + extension))
          return nextResolve(pathToFileURL(base + extension).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (!url.endsWith('.tsx') || url.includes('/node_modules/'))
      return nextLoad(url, context);
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
});
const { CostSummaryView } =
  await import('../features/cost/cost-summary-view.tsx');
const { Tabs, TabsTrigger } = await import('../components/ui/tabs.tsx');
const { BreakdownTable } =
  await import('../features/cost/components/breakdown-table.tsx');
const { CostStatementTable } =
  await import('../features/cost/components/cost-statement-table.tsx');
hooks.deregister();
const walk = (node) =>
  Array.isArray(node)
    ? node.flatMap(walk)
    : React.isValidElement(node)
      ? [node, ...walk(node.props.children)]
      : [];

test('Cost Statement opens first; locked summaries keep named accounts and a separate Subcon tab without writes', () => {
  const snapshot = makeCostSnapshot();
  snapshot.manualCosts.riskContingency = 555;
  const before = structuredClone(snapshot);
  let writes = 0;
  const view = walk(
    CostSummaryView({
      readOnly: true,
      rows: snapshot.costRows,
      resourceTypes: snapshot.resourceTypes,
      travelCost: 20,
      manualCosts: snapshot.manualCosts,
      setManualCosts: () => writes++,
    }),
  );
  assert.equal(
    view.find((node) => node.type === Tabs).props.defaultValue,
    'statement',
  );
  assert.deepEqual(
    view
      .filter((node) => node.type === TabsTrigger)
      .map((node) => node.props.value),
    ['statement', 'scope', 'bu', 'resource-type', 'subcontract'],
  );
  const values = getCostStatementValues(
    snapshot.costRows,
    snapshot.resourceTypes,
    20,
    snapshot.manualCosts,
  );
  const breakdowns = view
    .filter((node) => node.type === BreakdownTable)
    .map((node) => node.props.items);
  assert.equal(breakdowns.length, 4);
  for (const items of breakdowns.slice(0, 3)) {
    assert.equal(
      roundMoney(items.reduce((sum, item) => sum + item.amount, 0)),
      values.totalWithRisk,
    );
    assert.equal(
      items.find((item) => item.name.startsWith('15 · ')).amount,
      555,
    );
    assert.ok(
      !items.some((item) => /UNALLOCATED|Non-resource|待分摊/.test(item.name)),
    );
  }
  assert.equal(
    roundMoney(breakdowns[3].reduce((sum, item) => sum + item.amount, 0)),
    values.subcontract,
  );
  assert.equal(
    view.find((node) => node.type === CostStatementTable).props.readOnly,
    true,
  );
  assert.equal(writes, 0);
  assert.deepEqual(snapshot, before);
});
