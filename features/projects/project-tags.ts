/** Project classification is independent from commercial terms, cost versions and workflow. */
export const MAX_PROJECT_TAGS = 30;
export const MAX_PROJECT_TAG_LENGTH = 40;

/** Canonical matching ignores case, full-width variants and repeated spaces while retaining the first display label. */
export const projectTagKey = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');

/** Validate user-defined labels, remove blanks and deduplicate without modifying the caller's array. */
export function normalizeProjectTags(
  values: readonly string[] | undefined,
): string[] {
  if (values === undefined) return [];
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string')
  )
    throw new Error('Project tags must be text labels.');
  const unique = new Map<string, string>();
  for (const value of values) {
    const label = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!label) continue;
    if (label.length > MAX_PROJECT_TAG_LENGTH)
      throw new Error(
        `Each tag supports up to ${MAX_PROJECT_TAG_LENGTH} characters.`,
      );
    if (!unique.has(projectTagKey(label)))
      unique.set(projectTagKey(label), label);
  }
  if (unique.size > MAX_PROJECT_TAGS)
    throw new Error(`A project supports up to ${MAX_PROJECT_TAGS} tags.`);
  return [...unique.values()];
}

/** Suggest existing portfolio labels without creating a separate global catalogue or mutating other projects. */
export function availableProjectTags(
  projects: readonly { tags?: string[] }[],
): string[] {
  const unique = new Map<string, string>();
  for (const project of projects)
    for (const tag of project.tags ?? []) {
      if (!unique.has(projectTagKey(tag))) unique.set(projectTagKey(tag), tag);
    }
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}
