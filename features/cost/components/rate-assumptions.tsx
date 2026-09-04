/** Delivery-date mapping and annual labour uplift editor. */

import { useState } from 'react';
import { ChevronRight, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BiInline, BiText } from '@/components/workbench/bilingual-text';
import { StatusBadge } from '@/components/workbench/status-badge';
import {
  getActualYears,
  getLabourRateFactors,
  getY1Year,
  type RateSettings,
} from '@/features/cost/domain';

export function RateAssumptions({
  settings,
  setSettings,
}: {
  settings: RateSettings;
  setSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
}) {
  const [annualDetailsOpen, setAnnualDetailsOpen] = useState(false);
  const y1Year = getY1Year(settings);
  const actualYears = getActualYears(settings);
  const factors = getLabourRateFactors(settings);
  const y1Unresolved = y1Year === null;
  const y1IsBaseYear = y1Year !== null && y1Year === settings.baseYear;
  const inputClass =
    'mt-1 h-8 rounded-sm border-[#d8d5cd] bg-white text-xs shadow-none focus-visible:ring-1';

  const updateUplift = (index: number, value: number) =>
    setSettings((current) => ({
      ...current,
      annualUplifts: current.annualUplifts.map((uplift, upliftIndex) =>
        upliftIndex === index ? value : uplift,
      ),
    }));

  const resetUplifts = () =>
    setSettings((current) => ({
      ...current,
      defaultUplift: 5,
      annualUplifts: [5, 5, 5, 5, 5],
    }));

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="financial-numeral text-[10px] font-semibold text-[#a86432]">
            01
          </span>
          <h2 className="text-sm font-semibold tracking-[-0.01em]">
            Delivery & Labour Rate Assumptions
          </h2>
          <span className="text-[9px] text-muted-foreground">
            交付与人力费率假设
          </span>
          <span className="hidden text-[9px] text-muted-foreground 2xl:inline">
            TD dates map Y1; labour rates compound from the rate-card year. / TD
            日期映射 Y1，费率按基准年递增。
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone="blue">
            <BiInline en="Auto from TD dates" zh="根据 TD 日期自动判定" />
          </StatusBadge>
          <button
            type="button"
            aria-expanded={annualDetailsOpen}
            aria-controls="annual-rate-details"
            onClick={() => setAnnualDetailsOpen((open) => !open)}
            className="flex h-7 items-center gap-1 rounded-sm border border-border bg-[#fffdf9] px-2 text-[10px] font-medium text-[#173a52] hover:bg-[#f2f7f6] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            Year details{' '}
            <span className="text-[8px] text-muted-foreground">年度明细</span>
            <ChevronRight
              className={
                'size-3 transition-transform ' +
                (annualDetailsOpen ? 'rotate-90' : '')
              }
            />
          </button>
        </div>
      </div>
      <div className="grid gap-px bg-border min-[380px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(118px,1fr))_minmax(185px,1.25fr)]">
        <label className="min-w-0 bg-[#f7f5f0] px-3 py-2" htmlFor="quote-as-of">
          <BiText
            en="Quote As-of Date"
            zh="报价基准日期"
            className="text-[10px] font-medium text-muted-foreground"
          />
          <Input
            id="quote-as-of"
            type="date"
            className={inputClass}
            value={settings.quoteAsOf}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                quoteAsOf: event.target.value,
              }))
            }
          />
        </label>
        <label className="min-w-0 bg-[#f7f5f0] px-3 py-2" htmlFor="td-start">
          <BiText
            en="TD Delivery Start"
            zh="TD 预计交付开始"
            className="text-[10px] font-medium text-muted-foreground"
          />
          <Input
            id="td-start"
            type="date"
            className={inputClass}
            value={settings.tdStart}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                tdStart: event.target.value,
              }))
            }
          />
        </label>
        <label className="min-w-0 bg-[#f7f5f0] px-3 py-2" htmlFor="td-end">
          <BiText
            en="TD Delivery End"
            zh="TD 预计交付结束"
            className="text-[10px] font-medium text-muted-foreground"
          />
          <Input
            id="td-end"
            type="date"
            className={inputClass}
            value={settings.tdEnd}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                tdEnd: event.target.value,
              }))
            }
          />
        </label>
        <label
          className="min-w-0 bg-[#f7f5f0] px-3 py-2"
          htmlFor="rate-base-year"
        >
          <BiText
            en="Rate Card Base Year"
            zh="费率卡基准年"
            className="text-[10px] font-medium text-muted-foreground"
          />
          <Input
            id="rate-base-year"
            type="number"
            className={inputClass}
            value={settings.baseYear}
            onChange={(event) =>
              setSettings((current) => ({
                ...current,
                baseYear: Number(event.target.value),
              }))
            }
          />
        </label>
        <label
          className="min-w-0 bg-[#f7f5f0] px-3 py-2"
          htmlFor="default-uplift"
        >
          <BiText
            en="Default Annual Uplift"
            zh="默认年度浮动"
            className="text-[10px] font-medium text-muted-foreground"
          />
          <div className="relative">
            <Input
              id="default-uplift"
              type="number"
              step="0.1"
              className={inputClass + ' pr-7 text-right'}
              value={settings.defaultUplift}
              onChange={(event) => {
                const value = Number(event.target.value);
                setSettings((current) => ({
                  ...current,
                  defaultUplift: value,
                  annualUplifts: [value, value, value, value, value],
                }));
              }}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
        </label>
        <div className="min-w-0 bg-[#edf4f3] px-3 py-2">
          <BiText
            en="Year Mapping"
            zh="年份映射"
            className="text-[10px] font-medium text-[#557276]"
          />
          <p className="financial-numeral mt-1 text-sm font-semibold text-[#173a52]">
            {y1Unresolved ? 'Set delivery dates' : `Y1 = ${y1Year}`}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-[#557276]">
            {y1Unresolved
              ? 'No delivery year · 未指定交付年份'
              : y1IsBaseYear
                ? '0% · 1.0000× · 当年不浮动'
                : `+${settings.annualUplifts[0]}% · ${factors[0].toFixed(4)}× · 已应用浮动`}
          </p>
        </div>
      </div>
      {annualDetailsOpen ? (
        <div id="annual-rate-details" className="border-t border-border">
          <div className="grid gap-px bg-border md:grid-cols-5">
            {actualYears.map((actualYear, index) => {
              const uplift =
                index === 0 && y1IsBaseYear ? 0 : settings.annualUplifts[index];
              return (
                <div
                  key={actualYear + '-' + index}
                  className="bg-card px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="financial-numeral text-xs font-bold text-[#173a52]">
                        Y{index + 1} · {actualYear ?? 'Unmapped'}
                      </p>
                      <p className="mt-0.5 text-[9px] text-muted-foreground">
                        Uplift vs previous year / 较上一年浮动
                      </p>
                    </div>
                    {index === 0 ? (
                      <StatusBadge
                        tone={
                          y1Unresolved
                            ? 'gray'
                            : y1IsBaseYear
                              ? 'green'
                              : 'amber'
                        }
                      >
                        {y1Unresolved
                          ? 'Dates required'
                          : y1IsBaseYear
                            ? '0%'
                            : 'Applied'}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <div className="mt-1.5 grid grid-cols-[1fr_auto] items-center gap-2">
                    <div className="relative">
                      <Input
                        aria-label={'Y' + (index + 1) + ' labour rate uplift'}
                        type="number"
                        step="0.1"
                        className="h-7 rounded-sm border-[#d8d5cd] bg-[#fffdf9] pr-7 text-right text-xs shadow-none focus-visible:ring-1"
                        value={uplift}
                        disabled={y1Unresolved || (index === 0 && y1IsBaseYear)}
                        onChange={(event) =>
                          updateUplift(index, Number(event.target.value))
                        }
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                        %
                      </span>
                    </div>
                    <div className="text-right">
                      <p className="financial-numeral text-xs font-semibold">
                        {y1Unresolved ? '—' : factors[index].toFixed(4) + '×'}
                      </p>
                      <p className="text-[8px] text-muted-foreground">
                        factor / 系数
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-[#f7f5f0] px-3 py-2">
            <p className="text-[9px] leading-4 text-muted-foreground">
              Labour rates only; HQ travel has no labour-rate uplift. /
              仅作用于人力费率，HQ 差旅不参与年度浮动。
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[10px]"
              onClick={resetUplifts}
            >
              <RefreshCcw className="size-3" /> Reset to 5%{' '}
              <span className="text-[8px] opacity-60">恢复默认</span>
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
