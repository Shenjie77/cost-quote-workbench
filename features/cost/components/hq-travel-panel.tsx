/** HQ-only allowance and airfare calculator driven by marked resource types. */

import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { SectionHeading } from '@/components/workbench/section-heading';
import { StatusBadge } from '@/components/workbench/status-badge';
import {
  getHQTravelSummary,
  roundMoney,
  type CostInputRow,
  type ResourceType,
  type TravelSettings,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';

export function HQTravelPanel({
  rows,
  resourceTypes,
  settings,
  setSettings,
}: {
  rows: CostInputRow[];
  resourceTypes: ResourceType[];
  settings: TravelSettings;
  setSettings: React.Dispatch<React.SetStateAction<TravelSettings>>;
}) {
  const summary = getHQTravelSummary(rows, resourceTypes, settings);
  const mandaysPerMonth = Array.from(
    new Set(
      summary.hqRows.map((row) =>
        Number(
          resourceTypes.find((item) => item.id === row.reTypeId)
            ?.mandaysPerMonth || 21.75,
        ),
      ),
    ),
  )
    .map((value) => value.toLocaleString('en-SG'))
    .join(' / ');
  const inputClass =
    'h-9 w-full rounded-none border-0 bg-transparent px-2 text-right text-[11px] shadow-none focus-visible:relative focus-visible:z-20 focus-visible:bg-white focus-visible:ring-1';

  const updateSetting = (key: keyof TravelSettings, value: number) =>
    setSettings((current) => ({
      ...current,
      [key]:
        key === 'trips' ? Math.max(0, Math.round(value)) : Math.max(0, value),
    }));

  return (
    <section className="overflow-hidden border border-border bg-card">
      <SectionHeading
        index="03"
        title="HQ Travel Calculation"
        titleZh="HQ 资源差旅计算"
        description="Triggered only by RE Types marked HQ; months come from HQ mandays and airfare trips are entered manually."
        descriptionZh="仅由标记为 HQ 的资源类型触发；人月由 HQ 人天折算，机票 Trip 数手动录入。"
        action={
          <StatusBadge tone={summary.required ? 'amber' : 'gray'}>
            <BiInline
              en={summary.required ? 'Travel required' : 'Not required'}
              zh={summary.required ? '需要差旅' : '无需差旅'}
            />
          </StatusBadge>
        }
      />
      <div className="grid gap-px border-b border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            en: 'HQ Mandays',
            zh: 'HQ 总人天',
            value: `${summary.hqMandays.toLocaleString('en-SG')} MD`,
            note: `Y1 ${summary.yearMandays[0]?.toLocaleString('en-SG') ?? 0} · Y2–Y5 ${(summary.hqMandays - (summary.yearMandays[0] ?? 0)).toLocaleString('en-SG')}`,
          },
          {
            en: 'Equivalent Months',
            zh: '折算人月',
            value: `${summary.months.toFixed(2)} MM`,
            note: `${mandaysPerMonth || '21.75'} MD per month / 每月人天`,
          },
          {
            en: 'Allowance Cost',
            zh: '住宿与日常补贴',
            value: formatSgd(summary.allowanceCost),
            note: 'Months × monthly allowance / 人月 × 月补贴',
          },
          {
            en: 'HQ Travel Total',
            zh: 'HQ 差旅总成本',
            value: formatSgd(summary.totalCost),
            note: 'No annual labour uplift / 不计人力年度浮动',
          },
        ].map((item) => (
          <div key={item.en} className="bg-[#f7f5f0] px-4 py-3">
            <BiText
              en={item.en}
              zh={item.zh}
              className="text-[10px] text-muted-foreground"
            />
            <p className="financial-numeral mt-1.5 text-lg font-semibold">
              {item.value}
            </p>
            <p className="mt-1 text-[9px] text-muted-foreground">{item.note}</p>
          </div>
        ))}
      </div>
      <div className="min-w-0 max-w-full">
        <Table className="w-max min-w-full text-[11px]">
          <caption className="sr-only">
            HQ travel calculation driven by HQ resource mandays, monthly
            allowance, and manually entered round trips.
          </caption>
          <TableHeader>
            <TableRow className="h-8 bg-[#e9e6de] hover:bg-[#e9e6de]">
              <TableHead className="w-[250px] min-w-[250px] border-r border-border px-2">
                <BiText en="Triggered Scope" zh="触发差旅的 Scope" />
              </TableHead>
              <TableHead className="w-[110px] min-w-[110px] border-r border-border px-2 text-right">
                <BiText en="HQ MD" zh="HQ 人天" className="items-end" />
              </TableHead>
              <TableHead className="w-[105px] min-w-[105px] border-r border-border px-2 text-right">
                <BiText en="Months" zh="人月" className="items-end" />
              </TableHead>
              <TableHead className="w-[145px] min-w-[145px] border-r border-border px-2 text-right">
                <BiText
                  en="Allowance / Month"
                  zh="每月补贴"
                  className="items-end"
                />
              </TableHead>
              <TableHead className="w-[140px] min-w-[140px] border-r border-border px-2 text-right">
                <BiText
                  en="Allowance Cost"
                  zh="补贴小计"
                  className="items-end"
                />
              </TableHead>
              <TableHead className="w-[90px] min-w-[90px] border-r border-border px-2 text-right">
                <BiText en="Round Trips" zh="往返 Trip" className="items-end" />
              </TableHead>
              <TableHead className="w-[135px] min-w-[135px] border-r border-border px-2 text-right">
                <BiText
                  en="Airfare / Trip"
                  zh="单次机票"
                  className="items-end"
                />
              </TableHead>
              <TableHead className="w-[130px] min-w-[130px] border-r border-border px-2 text-right">
                <BiText en="Airfare Cost" zh="机票小计" className="items-end" />
              </TableHead>
              <TableHead className="w-[140px] min-w-[140px] px-2 text-right">
                <BiText en="Total Travel" zh="差旅合计" className="items-end" />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="h-9 bg-card hover:bg-[#f2f7f6]">
              <TableCell className="max-w-[250px] border-r border-border px-2">
                <span
                  className="block truncate"
                  title={summary.hqRows.map((row) => row.scope).join(', ')}
                >
                  {summary.required
                    ? summary.hqRows.map((row) => row.scope).join(', ')
                    : 'No HQ resource selected / 未选择 HQ 资源'}
                </span>
              </TableCell>
              <TableCell className="financial-numeral border-r border-border px-2 text-right font-semibold">
                {summary.hqMandays.toLocaleString('en-SG')}
              </TableCell>
              <TableCell className="financial-numeral border-r border-border px-2 text-right">
                {summary.months.toFixed(2)}
              </TableCell>
              <TableCell className="border-r border-border p-0">
                <Input
                  aria-label="Monthly HQ allowance"
                  type="number"
                  min="0"
                  step="100"
                  className={inputClass}
                  value={settings.monthlyAllowance}
                  onChange={(event) =>
                    updateSetting(
                      'monthlyAllowance',
                      Number(event.target.value),
                    )
                  }
                  onBlur={(event) =>
                    updateSetting(
                      'monthlyAllowance',
                      roundMoney(Number(event.target.value)),
                    )
                  }
                />
              </TableCell>
              <TableCell className="financial-numeral border-r border-border bg-[#faf9f6] px-2 text-right font-semibold">
                {formatSgd(summary.allowanceCost)}
              </TableCell>
              <TableCell className="border-r border-border p-0">
                <Input
                  aria-label="Number of HQ round trips"
                  type="number"
                  min="0"
                  step="1"
                  className={inputClass}
                  value={settings.trips}
                  onChange={(event) =>
                    updateSetting('trips', Number(event.target.value))
                  }
                />
              </TableCell>
              <TableCell className="border-r border-border p-0">
                <Input
                  aria-label="Airfare per HQ round trip"
                  type="number"
                  min="0"
                  step="50"
                  className={inputClass}
                  value={settings.airfarePerTrip}
                  onChange={(event) =>
                    updateSetting('airfarePerTrip', Number(event.target.value))
                  }
                  onBlur={(event) =>
                    updateSetting(
                      'airfarePerTrip',
                      roundMoney(Number(event.target.value)),
                    )
                  }
                />
              </TableCell>
              <TableCell className="financial-numeral border-r border-border bg-[#faf9f6] px-2 text-right font-semibold">
                {formatSgd(summary.airfareCost)}
              </TableCell>
              <TableCell className="financial-numeral bg-[#edf4f3] px-2 text-right font-bold text-[#173a52]">
                {formatSgd(summary.totalCost)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[#f7f5f0] px-4 py-2 text-[10px] text-muted-foreground">
        <span>
          Formula: HQ MD ÷ MD/month × monthly allowance + round trips × airfare.
          <span className="ml-1 text-[9px]">
            公式：HQ 人天 ÷ 每月人天 × 月补贴 + 往返 Trip × 单次机票。
          </span>
        </span>
        {!summary.required && settings.trips > 0 ? (
          <span className="text-[#8d5b12]">
            Trips entered with 0 HQ MD / HQ 人天为 0
          </span>
        ) : null}
      </div>
    </section>
  );
}
