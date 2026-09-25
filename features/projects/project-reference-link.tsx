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
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${label} in a new tab`}
      title={href}
      className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary underline-offset-4 hover:bg-primary/5 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
    >
      {label}
      <ArrowUpRight className="size-3" aria-hidden="true" />
    </a>
  ) : (
    <span
      className="px-1.5 py-0.5 text-xs text-muted-foreground"
      title={value?.trim() || `${label} link is not set`}
    >
      {label}: {value?.trim() ? 'Reference only' : 'Not set'}
    </span>
  );
}
