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
  const tones = {
    blue: 'info',
    green: 'success',
    amber: 'warning',
    red: 'danger',
    gray: 'neutral',
    navy: 'primary',
  } as const;
  return <Badge tone={tones[tone]}>{children}</Badge>;
}
