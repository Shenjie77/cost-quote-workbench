import { Surface, Text } from '@/components/ui/presentation';
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
      <Surface
        as="div"
        variant="item"
        tone="muted"
        textRole="body-small"
        className="grid min-w-[760px] grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] gap-4 uppercase"
      >
        <span>Dimension / 维度</span>
        <span>Cost Distribution / 成本分布</span>
        <span className="text-right">Mandays / 人天</span>
        <span className="text-right">Cost / 成本</span>
        <span className="text-right">Share</span>
      </Surface>
      <Surface as="div" variant="list" className="min-w-[760px]">
        {items.map((item, index) => (
          <Surface
            key={item.name}
            as="div"
            variant="body"
            textRole="body-small"
            className="grid min-w-[760px] grid-cols-[180px_minmax(120px,1fr)_110px_110px_58px] items-center gap-4"
          >
            {item.nameZh ? (
              <BiText en={item.name} zh={item.nameZh} />
            ) : (
              <span className="truncate" title={item.name}>
                {item.name}
              </span>
            )}
            <Surface as="div" variant="inset" className="h-2 overflow-hidden">
              <div
                className="ui-chart-bar"
                data-series={index % 5}
                style={{
                  width: (item.amount / max) * 100 + '%',
                }}
              />
            </Surface>
            <span className="financial-numeral text-right">
              {item.mandays.toLocaleString('en-SG')} MD
              <Text
                as="span"
                tone="muted"
                textRole="body-small"
                className="block"
              >
                {totalMandays > 0
                  ? ((item.mandays / totalMandays) * 100).toFixed(1)
                  : '0.0'}
                %
              </Text>
            </span>
            <span className="financial-numeral text-right">
              {formatSgd(item.amount)}
            </span>
            <Text
              as="span"
              tone="muted"
              textRole="body-small"
              className="financial-numeral text-right"
            >
              {item.share}%
            </Text>
          </Surface>
        ))}
      </Surface>
    </div>
  );
}
