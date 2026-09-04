/** Read-only cost and manday distribution table for one reporting dimension. */

import { BiText } from '@/components/workbench/bilingual-text';
import type { BreakdownItem } from '@/features/cost/ui-types';
import { formatSgd } from '@/lib/formatters';

export function BreakdownTable({ items }: { items: BreakdownItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.amount));
  const totalMandays = items.reduce((sum, item) => sum + item.mandays, 0);
  return (
    <div>
      <div className="grid grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] gap-4 border-b border-border bg-[#f7f5f0] px-5 py-2 text-[9px] font-semibold uppercase tracking-[0.05em] text-muted-foreground max-md:grid-cols-[130px_1fr_90px]">
        <span>Dimension / 维度</span>
        <span>Cost Distribution / 成本分布</span>
        <span className="text-right max-md:hidden">Mandays / 人天</span>
        <span className="text-right">Cost / 成本</span>
        <span className="text-right max-md:hidden">Share</span>
      </div>
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.name}
            className="grid grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] items-center gap-4 px-5 py-3 text-xs max-md:grid-cols-[130px_1fr_90px]"
          >
            {item.nameZh ? (
              <BiText en={item.name} zh={item.nameZh} className="font-medium" />
            ) : (
              <span className="truncate font-medium" title={item.name}>
                {item.name}
              </span>
            )}
            <div className="h-2 overflow-hidden rounded-full bg-[#e5e2db]">
              <div
                className="h-full rounded-full"
                style={{
                  width: (item.amount / max) * 100 + '%',
                  backgroundColor: item.color,
                }}
              />
            </div>
            <span className="financial-numeral text-right font-semibold max-md:hidden">
              {item.mandays.toLocaleString('en-SG')} MD
              <span className="block text-[8px] font-normal text-muted-foreground">
                {totalMandays > 0
                  ? ((item.mandays / totalMandays) * 100).toFixed(1)
                  : '0.0'}
                %
              </span>
            </span>
            <span className="financial-numeral text-right font-semibold">
              {formatSgd(item.amount)}
            </span>
            <span className="financial-numeral text-right text-[10px] text-muted-foreground max-md:hidden">
              {item.share}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
