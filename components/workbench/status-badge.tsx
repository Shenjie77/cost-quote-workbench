/** Shared semantic status treatment; tone names are stable across features. */

import type React from 'react';
import { Badge } from '@/components/ui/badge';
import type { StatusTone } from '@/features/workbench/types';

export function StatusBadge({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  const tones: Record<StatusTone, string> = {
    blue: 'border-info/20 bg-info-muted text-info',
    green: 'border-success/20 bg-success-muted text-success',
    amber: 'border-warning/20 bg-warning-muted text-warning',
    red: 'border-destructive/20 bg-danger-muted text-destructive',
    gray: 'border-border bg-muted text-muted-foreground',
    navy: 'border-primary bg-primary text-primary-foreground',
  };
  return (
    <Badge
      variant="outline"
      className={
        'min-h-6 rounded px-2 py-0.5 text-xs font-medium ' + tones[tone]
      }
    >
      {children}
    </Badge>
  );
}
