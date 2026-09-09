/** New-project identity follows the canonical workspace project ID contract. */
export const PROJECT_ID_MAX_LENGTH = 80;

export type NewProjectInput = {
  id?: string;
  name: string;
  client: string;
  owner: string;
};

/** Blank input requests an automatic ID; custom IDs have no prefix/ASCII restriction. */
export function projectIdError(value: string): string {
  // JSON Schema maxLength counts Unicode code points, not UTF-16 units or graphemes.
  return Array.from(value.trim()).length > PROJECT_ID_MAX_LENGTH
    ? `Project ID must be ${PROJECT_ID_MAX_LENGTH} characters or fewer.`
    : '';
}

export function resolveNewProjectId(
  value = '',
  generate = () =>
    `PRJ-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8)}`,
): string {
  const error = projectIdError(value);
  if (error) throw new Error(error);
  return value.trim() || generate();
}
