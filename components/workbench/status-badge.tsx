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
    blue: 'border-[#b8ccd8] bg-[#e9f1f5] text-[#376b8a]',
    green: 'border-[#b8d0c3] bg-[#e9f2ed] text-[#377054]',
    amber: 'border-[#dfc99e] bg-[#f7efe0] text-[#8d5b12]',
    red: 'border-[#e2b9b7] bg-[#f7e9e8] text-[#9f3e3b]',
    gray: 'border-border bg-muted text-muted-foreground',
    navy: 'border-primary bg-primary text-primary-foreground',
  };
  return (
    <Badge
      variant="outline"
      className={
        'min-h-6 rounded-full px-2.5 py-0.5 text-[11px] font-medium ' +
        tones[tone]
      }
    >
      {children}
    </Badge>
  );
}
