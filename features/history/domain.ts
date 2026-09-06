/** Local scope references with provenance; matching never asserts scope equivalence. */
import { totalRowCost, totalRowMandays } from '../cost/domain.ts';
import { contentKey } from '../cpq/domain.ts';
import type { WorkbenchWorkspace } from '../workbench/workspace-types.ts';
const tokens = (s: string) => [
  ...new Set(
    (
      s
        .normalize('NFKC')
        .toLowerCase()
        .match(/[a-z0-9]+|[\u3400-\u9fff]+/gu) || []
    ).flatMap((t) =>
      /[\u3400-\u9fff]/u.test(t) && t.length > 1
        ? Array.from({ length: t.length - 1 }, (_, i) => t.slice(i, i + 2))
        : t,
    ),
  ),
];
export function searchScopeHistory(
  workspaces: WorkbenchWorkspace[],
  brief: string,
  client?: string,
) {
  const query = tokens(brief),
    items: {
      projectId: string;
      project: string;
      client: string;
      version: string;
      scope: string;
      bu: string;
      mandays: number;
      cost: number;
      source: string;
      matched: string[];
      unmatched: string[];
      score: number;
    }[] = [];
  if (!query.length) return items;
  for (const w of workspaces) {
    if (client && w.project.client.toLowerCase() !== client.toLowerCase())
      continue;
    const seen = new Set<string>();
    for (const v of [...w.costVersions].reverse())
      for (const row of v.costRows) {
        const identity = contentKey(row);
        if (seen.has(identity)) continue;
        seen.add(identity);
        const text = row.scope.normalize('NFKC').toLowerCase(),
          matched = query.filter((t) => text.includes(t));
        if (!matched.length) continue;
        items.push({
          projectId: w.project.id,
          project: w.project.name,
          client: w.project.client,
          version: v.code,
          scope: row.scope,
          bu: row.bu,
          mandays: totalRowMandays(row),
          cost: totalRowCost(row),
          source: row.source
            ? `${row.source.fileName} / ${row.source.sheet} / row ${row.source.row}`
            : 'Manual cost row ' + row.id,
          matched,
          unmatched: query.filter((t) => !text.includes(t)),
          score: matched.length / query.length,
        });
      }
  }
  return items
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.projectId.localeCompare(b.projectId) ||
        b.version.localeCompare(a.version),
    )
    .slice(0, 50);
}
