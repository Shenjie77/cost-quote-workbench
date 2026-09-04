/** Dense page-level KPI card. Table-adjacent metrics use compact strips instead. */

import type { Gauge } from 'lucide-react';
import { BiText } from '@/components/workbench/bilingual-text';
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
    gray: 'bg-[#eeece7] text-[#68737c]',
  }[tone];
  return (
    <div className="border border-border bg-card px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <BiText
            en={label}
            zh={labelZh}
            className="text-[10px] font-medium text-muted-foreground"
            zhClassName="text-[8px] leading-3"
          />
          <p className="financial-numeral mt-1 text-[18px] font-semibold leading-none">
            {value}
          </p>
        </div>
        <span
          className={
            'flex size-7 items-center justify-center rounded-md ' + iconTone
          }
        >
          <Icon className="size-3.5" />
        </span>
      </div>
      <p
        className="mt-1.5 truncate text-[9px] leading-4 text-muted-foreground"
        title={`${note} / ${noteZh}`}
      >
        {note}
        <span className="ml-1 text-[8px]">/ {noteZh}</span>
      </p>
    </div>
  );
}
