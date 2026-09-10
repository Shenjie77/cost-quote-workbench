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
  const iconTone = {
    navy: 'bg-[#e5ecef] text-[#173a52]',
    blue: 'bg-[#e9f1f5] text-[#376b8a]',
    green: 'bg-[#e9f2ed] text-[#377054]',
    amber: 'bg-[#f7efe0] text-[#8d5b12]',
    red: 'bg-[#f7e9e8] text-[#9f3e3b]',
    gray: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <div
      className="wb-panel flex h-full flex-col px-3 py-2"
      title={`${note} / ${noteZh}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <span className="text-xs font-medium text-muted-foreground">
            {label}
          </span>
          <span className="ml-1.5 text-[10px] text-muted-foreground">
            {labelZh}
          </span>
        </div>
        <span
          className={
            'flex size-5 shrink-0 items-center justify-center rounded ' +
            iconTone
          }
        >
          <Icon className="size-3" />
        </span>
      </div>
      <p className="financial-numeral mt-1 break-words text-xl font-semibold leading-tight tracking-tight text-foreground">
        {value}
      </p>
      <p
        className="mt-1 truncate text-[10px] leading-4 text-muted-foreground"
        title={`${note} / ${noteZh}`}
      >
        {note}
        <span className="sr-only">{noteZh}</span>
      </p>
    </div>
  );
}
