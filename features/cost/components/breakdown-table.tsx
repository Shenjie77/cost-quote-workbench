/** Read-only cost and manday distribution table for one reporting dimension. */

import { BiText } from '@/components/workbench/bilingual-text';
import type { BreakdownItem } from '@/features/cost/ui-types';
import { formatSgd } from '@/lib/formatters';

/** Keep every reporting measure available through a contained table scroll. */
export function BreakdownTable({ items }: { items: BreakdownItem[] }) {
  const max = Math.max(1, ...items.map((item) => item.amount));
  const totalMandays = items.reduce((sum, item) => sum + item.mandays, 0);
  return (
    <div className="wb-table-scroll min-w-0">
      <div className="grid min-w-[760px] grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] gap-4 border-b border-border bg-muted/30 px-5 py-2 text-[9px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <span>Dimension / 维度</span>
        <span>Cost Distribution / 成本分布</span>
        <span className="text-right">Mandays / 人天</span>
        <span className="text-right">Cost / 成本</span>
        <span className="text-right">Share</span>
      </div>
      <div className="min-w-[760px] divide-y divide-border">
        {items.map((item) => (
          <div
            key={item.name}
            className="grid min-w-[760px] grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] items-center gap-4 px-5 py-4 text-xs hover:bg-muted/20"
          >
            {item.nameZh ? (
              <BiText en={item.name} zh={item.nameZh} className="font-medium" />
            ) : (
              <span className="truncate font-medium" title={item.name}>
                {item.name}
              </span>
            )}
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: (item.amount / max) * 100 + '%',
                  backgroundColor: item.color,
                }}
              />
            </div>
            <span className="financial-numeral text-right font-semibold">
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
            <span className="financial-numeral text-right text-[10px] text-muted-foreground">
              {item.share}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
