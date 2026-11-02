import { Surface, Text } from '@/components/ui/presentation';
/** Dense page-level KPI card. Table-adjacent metrics use compact strips instead. */

import type { Gauge } from 'lucide-react';
import type { StatusTone } from '@/features/workbench/types';

export function KpiCard({
  label,
  labelZh,
  value,
  note,
  noteZh,
  icon: Icon,
  tone = 'navy',
}: {
  label: string;
  labelZh: string;
  value: string;
  note: string;
  noteZh: string;
  icon: typeof Gauge;
  tone?: StatusTone;
}) {
  const semanticTone = {
    navy: 'primary',
    blue: 'info',
    green: 'success',
    amber: 'warning',
    red: 'danger',
    gray: 'muted',
  } as const;
  return (
    <Surface
      variant="panel"
      padded
      className="h-full"
      title={`${note} / ${noteZh}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <Text textRole="body-small" tone="muted">
            {label}
          </Text>
          <Text className="ml-2" textRole="body-small" tone="muted">
            {labelZh}
          </Text>
        </div>
        <Text
          as={Icon}
          aria-hidden="true"
          className="size-4"
          tone={semanticTone[tone]}
        />
      </div>
      <Text as="p" textRole="h2" className="financial-numeral break-words">
        {value}
      </Text>
      <Text
        as="p"
        textRole="body-small"
        tone="muted"
        className="truncate"
        title={`${note} / ${noteZh}`}
      >
        {note}
        <span className="sr-only">{noteZh}</span>
      </Text>
    </Surface>
  );
}
