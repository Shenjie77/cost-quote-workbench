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
    gray: 'bg-muted text-muted-foreground',
  }[tone];
  return (
    <div className="wb-panel flex h-full flex-col px-4 py-4 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <BiText
            en={label}
            zh={labelZh}
            className="text-xs font-medium text-muted-foreground"
            zhClassName="text-[10px] leading-4"
          />
        </div>
        <span
          className={
            'flex size-9 shrink-0 items-center justify-center rounded-xl ' +
            iconTone
          }
        >
          <Icon className="size-4" />
        </span>
      </div>
      <p className="financial-numeral mt-2 break-words text-[22px] font-semibold leading-tight tracking-tight text-foreground sm:text-[25px]">
        {value}
      </p>
      <p
        className="mt-3 text-[11px] leading-4 text-muted-foreground"
        title={`${note} / ${noteZh}`}
      >
        {note}
        <span className="mt-0.5 block text-[10px]">{noteZh}</span>
      </p>
    </div>
  );
}
