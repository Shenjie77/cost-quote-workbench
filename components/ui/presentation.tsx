/** Presentation contracts for every feature. Geometry may be composed; appearance belongs here. */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { layoutClassName } from '@/lib/ui-layout';

export type Tone =
  | 'inherit'
  | 'default'
  | 'muted'
  | 'primary'
  | 'inverse'
  | 'info'
  | 'success'
  | 'warning'
  | 'danger';
export type TextRole = 'h1' | 'h2' | 'h3' | 'body-main' | 'body-small';
type ElementProps<T extends React.ElementType> = {
  as?: T;
  className?: string;
} & Omit<React.ComponentPropsWithRef<T>, 'as' | 'className' | 'color'>;
type PresentationProps = { tone?: Tone; textRole?: TextRole };

export function Text<T extends React.ElementType = 'span'>({
  as,
  className,
  tone = 'inherit',
  textRole,
  ...props
}: ElementProps<T> & PresentationProps) {
  const Tag = as || 'span';
  const headingRole =
    typeof Tag === 'string' && /^h[1-6]$/.test(Tag)
      ? ['h1', 'h2'].includes(Tag)
        ? (Tag as 'h1' | 'h2')
        : 'h3'
      : undefined;
  return (
    <Tag
      data-slot="text"
      data-tone={headingRole ? 'default' : tone}
      data-text-role={headingRole ?? textRole}
      className={cn('ui-text', layoutClassName(className))}
      {...props}
    />
  );
}

export type SurfaceVariant =
  | 'shell-header'
  | 'navigation'
  | 'tab'
  | 'control-group'
  | 'sheet-controls'
  | 'plain'
  | 'panel'
  | 'body'
  | 'inset'
  | 'header'
  | 'toolbar'
  | 'footer'
  | 'empty'
  | 'notice'
  | 'field'
  | 'inline-field'
  | 'item'
  | 'list'
  | 'page';
export function Surface<T extends React.ElementType = 'div'>({
  as,
  className,
  variant = 'plain',
  tone = 'inherit',
  textRole,
  padded = false,
  selected,
  ...props
}: ElementProps<T> &
  PresentationProps & {
    variant?: SurfaceVariant;
    padded?: boolean;
    selected?: boolean;
  }) {
  const Tag = as || 'div';
  return (
    <Tag
      data-slot="surface"
      data-variant={variant}
      data-tone={tone}
      data-text-role={textRole}
      data-padded={(padded && variant === 'panel') || undefined}
      data-selected={selected || undefined}
      className={cn('ui-surface', layoutClassName(className))}
      {...props}
    />
  );
}

/** Native details retains keyboard behavior and requires no local open/close state. */
export function Disclosure({
  className,
  ...props
}: React.ComponentProps<'details'>) {
  return (
    <details
      data-slot="disclosure"
      className={cn('ui-disclosure', layoutClassName(className))}
      {...props}
    />
  );
}
export function DisclosureSummary({
  className,
  ...props
}: React.ComponentProps<'summary'>) {
  return (
    <summary
      data-slot="disclosure-summary"
      className={cn('ui-disclosure-summary', layoutClassName(className))}
      {...props}
    />
  );
}
export function StatusDot({
  tone = 'muted',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      className={cn('ui-status-dot', layoutClassName(className))}
      {...props}
    />
  );
}
