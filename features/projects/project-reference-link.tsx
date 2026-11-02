import { Surface, Text } from '@/components/ui/presentation';
/** Safe external links shared across project context bars. */
import { ArrowUpRight } from 'lucide-react';
/** References may contain legacy notes; only explicit web addresses are links. */
export function safeProjectReferenceUrl(value?: string): string | null {
  const address = value?.trim();
  if (!address || !/^https?:\/\/\S+$/i.test(address)) return null;
  try {
    const parsed = new URL(address);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    )
      return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/** Render a readable web link or the saved reference status without changing the underlying value. */
export function ReferenceLink({
  label,
  value,
}: {
  label: string;
  value?: string;
}) {
  const href = safeProjectReferenceUrl(value);
  return href ? (
    <Surface
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label} in a new tab`}
      title={href}
      as="a"
      variant="body"
      tone="primary"
      textRole="body-small"
      className="inline-flex min-h-8 items-center gap-1 underline-offset-4 hover:underline"
    >
      {label}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </Surface>
  ) : (
    <Text
      as="span"
      tone="muted"
      textRole="body-small"
      title={value?.trim() || `${label} link is not set`}
    >
      {label}: {value?.trim() ? 'Reference only' : 'Not set'}
    </Text>
  );
}
