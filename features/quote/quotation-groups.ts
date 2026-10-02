import type { QuoteExcelRegion, QuoteLine } from './excel-template-types.ts';
export type QuoteLineGroup = {
  category: string;
  inclusion: 'mandatory' | 'optional';
};
export type QuoteLineGroups = Record<string, QuoteLineGroup>;
export const categoryKey = (title: string) =>
  typeof title === 'string'
    ? title.trim().replace(/\s+/g, ' ').toLowerCase()
    : '';
export function groupFor(
  line: Pick<QuoteLine, 'id' | 'category' | 'inclusion'>,
  groups?: QuoteLineGroups,
): QuoteLineGroup {
  return (
    groups?.[line.id] ?? {
      category:
        line.category ??
        (line.id.startsWith('maintenance:')
          ? 'Maintenance'
          : 'Professional Service'),
      inclusion: line.inclusion ?? 'mandatory',
    }
  );
}
export function groupedLines(
  lines: readonly QuoteLine[],
  groups?: QuoteLineGroups,
): QuoteLine[] {
  return lines.map((line) => ({ ...line, ...groupFor(line, groups) }));
}
export function quotationSections(lines: readonly QuoteLine[]) {
  const sections: {
    category: string;
    inclusion: 'mandatory' | 'optional';
    lines: QuoteLine[];
  }[] = [];
  for (const inclusion of ['mandatory', 'optional'] as const)
    for (const line of lines) {
      const group = groupFor(line);
      if (group.inclusion !== inclusion) continue;
      let section = sections.find(
        (s) =>
          s.inclusion === inclusion &&
          categoryKey(s.category) === categoryKey(group.category),
      );
      if (!section) {
        section = { ...group, lines: [] };
        sections.push(section);
      }
      section.lines.push(line);
    }
  return sections;
}
export function regionMatches(region: QuoteExcelRegion, line: QuoteLine) {
  const group = groupFor(line);
  if (region.source === 'optional') return group.inclusion === 'optional';
  const title =
    region.source === 'category'
      ? (region.category ?? '')
      : region.source === 'service'
        ? 'Professional Service'
        : 'Maintenance';
  return (
    categoryKey(title) === categoryKey(group.category) &&
    group.inclusion === (region.inclusion ?? 'mandatory')
  );
}
export function validateLineGroups(
  groups: QuoteLineGroups | undefined,
): string[] {
  if (groups === undefined) return [];
  if (
    !groups ||
    typeof groups !== 'object' ||
    Array.isArray(groups) ||
    Object.keys(groups).length > 2000
  )
    return ['Invalid quotation groups.'];
  return Object.values(groups).every(
    (g) =>
      g &&
      typeof g.category === 'string' &&
      g.category.trim() &&
      g.category.length <= 120 &&
      ['mandatory', 'optional'].includes(g.inclusion),
  )
    ? []
    : [
        'Each quotation group needs a category (1–120 characters) and Mandatory or Optional.',
      ];
}
