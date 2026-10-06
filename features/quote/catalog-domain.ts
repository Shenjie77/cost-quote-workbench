/** Pure customer matching and copy rules shared by UI, CLI consumers and tests. */
import type {
  AssumptionDefinition,
  QuoteAssumption,
  QuoteTemplate,
} from './types.ts';

/** Exact case-insensitive customer name, or '*' for all customers. No regex. */
export function matchesClient(pattern: string, client: string): boolean {
  const normalized = pattern.trim().toLocaleLowerCase();
  return normalized === '*' || normalized === client.trim().toLocaleLowerCase();
}

/** Customer-specific choices precede common templates; original order breaks ties. */
export function applicableTemplates(
  templates: QuoteTemplate[],
  client: string,
): QuoteTemplate[] {
  return templates
    .filter((item) => item.active && matchesClient(item.clientPattern, client))
    .sort(
      (a, b) =>
        Number(a.clientPattern.trim() === '*') -
        Number(b.clientPattern.trim() === '*'),
    );
}

const textKey = (row: { text: string; textZh: string }) =>
  `${row.text.trim().toLocaleLowerCase()}\n${row.textZh.trim().toLocaleLowerCase()}`;

/** Idempotent append: never overwrite local edits or re-enable an excluded row. */
export function referenceAssumptions(
  current: QuoteAssumption[],
  library: AssumptionDefinition[],
  ids: string[],
  client: string,
  makeId: () => string = () => `assumption-${globalThis.crypto.randomUUID()}`,
): QuoteAssumption[] {
  const sources = new Set(current.map((row) => row.sourceAssumptionId));
  const texts = new Set(current.map(textKey));
  const additions: QuoteAssumption[] = [];
  for (const id of new Set(ids)) {
    const entry = library.find((row) => row.id === id);
    if (
      !entry ||
      !entry.active ||
      !matchesClient(entry.clientPattern, client) ||
      sources.has(id) ||
      texts.has(textKey(entry))
    )
      continue;
    additions.push({
      id: makeId(),
      text: entry.text,
      textZh: entry.textZh,
      included: true,
      sourceAssumptionId: id,
      sourceText: entry.text,
      sourceTextZh: entry.textZh,
    });
    sources.add(id);
    texts.add(textKey(entry));
  }
  return [...current, ...additions];
}

/** Copy another project's catalogs under new IDs, preserving all local records. */
export function copyQuoteCatalog(
  library: AssumptionDefinition[],
  templates: QuoteTemplate[],
) {
  const ids = new Map(
    library.map((row) => [row.id, `library-${globalThis.crypto.randomUUID()}`]),
  );
  return {
    library: library.map((row) => ({ ...row, id: ids.get(row.id)! })),
    templates: templates.map((row) => ({
      ...row,
      id: `quote-template-${globalThis.crypto.randomUUID()}`,
      defaultAssumptionIds: row.defaultAssumptionIds
        .map((id) => ids.get(id))
        .filter((id): id is string => Boolean(id)),
    })),
  };
}

/** Capture only explicitly applied references; unrelated project snapshots remain unchanged. */
export function captureQuoteReferences<T extends { id: string }>(
  current: T[],
  selected: T[],
): T[] {
  const replacements = new Map(
    selected.map((item) => [item.id, structuredClone(item)]),
  );
  const existing = new Set(current.map((item) => item.id));
  return [
    ...current.map((item) => replacements.get(item.id) ?? item),
    ...[...replacements.values()].filter((item) => !existing.has(item.id)),
  ];
}

/** Refresh unchanged references; retain quote-specific edits, inclusion and historical records. */
export function syncQuoteAssumptions(
  current: QuoteAssumption[],
  previous: AssumptionDefinition[],
  latest: AssumptionDefinition[],
  client: string,
): QuoteAssumption[] {
  return current.map((row) => {
    const sourceId = row.sourceAssumptionId ?? row.id;
    const entry = latest.find((item) => item.id === sourceId);
    const old = previous.find((item) => item.id === sourceId);
    if (!entry?.active || !matchesClient(entry.clientPattern, client))
      return row;
    const baseline = row.sourceText ?? old?.text;
    const baselineZh = row.sourceTextZh ?? old?.textZh;
    if (
      baseline === undefined ||
      row.text !== baseline ||
      row.textZh !== (baselineZh ?? '')
    )
      return row;
    return {
      ...row,
      sourceAssumptionId: sourceId,
      text: entry.text,
      textZh: entry.textZh,
      sourceText: entry.text,
      sourceTextZh: entry.textZh,
    };
  });
}
