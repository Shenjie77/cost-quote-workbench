/** Compact delivery mapping with annual rate settings available on demand. */
import { useState } from 'react';
import { ChevronDown, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getActualYears,
  getLabourRateFactors,
  getY1Year,
  type RateSettings,
} from '@/features/cost/domain';

export function RateAssumptions({
  settings,
  setSettings,
  locked = false,
}: {
  settings: RateSettings;
  setSettings: React.Dispatch<React.SetStateAction<RateSettings>>;
  locked?: boolean;
}) {
  const [annualDetailsOpen, setAnnualDetailsOpen] = useState(false);
  const y1Year = getY1Year(settings);
  const actualYears = getActualYears(settings);
  const factors = getLabourRateFactors(settings);
  const y1IsBaseYear = y1Year !== null && y1Year === settings.baseYear;
  const inputClass =
    'mt-1.5 h-8 min-w-0 w-full rounded-md bg-white px-2 text-xs shadow-none';
  const change: React.Dispatch<React.SetStateAction<RateSettings>> = (next) => {
    if (!locked) setSettings(next);
  };
  return (
    <section
      className="overflow-hidden rounded-lg border bg-card"
      aria-label="Delivery and labour rate assumptions"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">Delivery & Rates</h2>
          <span
            className={`text-[11px] ${y1Year === null ? 'text-amber-700' : 'text-muted-foreground'}`}
          >
            {y1Year === null
              ? 'Set delivery start to map Y1–Y5'
              : `Y1 ${y1Year} → Y5 ${y1Year + 4}`}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[11px]"
          aria-expanded={annualDetailsOpen}
          aria-controls="annual-rate-details"
          onClick={() => setAnnualDetailsOpen(!annualDetailsOpen)}
        >
          Rate settings
          <ChevronDown
            className={`size-3 transition-transform ${annualDetailsOpen ? 'rotate-180' : ''}`}
          />
        </Button>
      </header>
      <div className="overflow-x-auto">
        <div className="grid min-w-[540px] grid-cols-[minmax(64px,0.65fr)_minmax(76px,0.8fr)_repeat(3,minmax(110px,1fr))] gap-2 px-3 py-3">
          <label
            className="flex min-w-0 flex-col whitespace-nowrap text-[11px] font-medium text-muted-foreground"
            htmlFor="rate-base-year"
          >
            Base Year
            <Input
              id="rate-base-year"
              type="number"
              min={2000}
              max={2200}
              className={inputClass}
              value={settings.baseYear}
              disabled={locked}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  baseYear: Number(event.target.value),
                }))
              }
            />
          </label>
          <label
            className="flex min-w-0 flex-col whitespace-nowrap text-[11px] font-medium text-muted-foreground"
            htmlFor="default-uplift"
          >
            Default Uplift %
            <Input
              id="default-uplift"
              type="number"
              min={-100}
              max={1000}
              step="any"
              className={`${inputClass} text-right`}
              value={settings.defaultUplift}
              disabled={locked}
              onChange={(event) => {
                const value = Number(event.target.value);
                change((current) => ({
                  ...current,
                  defaultUplift: value,
                  annualUplifts: [value, value, value, value, value],
                }));
              }}
            />
          </label>
          {(
            [
              ['quoteAsOf', 'Quote as of', 'quote-as-of'],
              ['tdStart', 'Proj Start', 'td-start'],
              ['tdEnd', 'Proj End', 'td-end'],
            ] as const
          ).map(([key, label, inputId]) => (
            <label
              key={key}
              className="flex min-w-0 flex-col whitespace-nowrap text-[11px] font-medium text-muted-foreground"
              htmlFor={inputId}
            >
              {label}
              <Input
                id={inputId}
                aria-label={label}
                type="date"
                className={inputClass}
                value={settings[key]}
                disabled={locked}
                onChange={(event) =>
                  change((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      {annualDetailsOpen && (
        <div id="annual-rate-details" className="border-t">
          <div className="grid grid-cols-5 gap-2 px-3 py-3">
            {actualYears.map((year, index) => (
              <div key={index} className="min-w-0">
                <p className="whitespace-nowrap text-[10px] font-medium text-muted-foreground">
                  Y{index + 1}
                  {year ? ` · ${year}` : ''}
                </p>
                <Input
                  aria-label={`Y${index + 1} labour rate uplift`}
                  type="number"
                  min={-100}
                  max={1000}
                  step="any"
                  className={`${inputClass} text-right`}
                  value={
                    index === 0 && y1IsBaseYear
                      ? 0
                      : settings.annualUplifts[index]
                  }
                  disabled={
                    locked || y1Year === null || (index === 0 && y1IsBaseYear)
                  }
                  onChange={(event) =>
                    change((current) => ({
                      ...current,
                      annualUplifts: current.annualUplifts.map((uplift, i) =>
                        i === index ? Number(event.target.value) : uplift,
                      ),
                    }))
                  }
                />
                <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground">
                  {y1Year === null
                    ? 'Unmapped'
                    : `${factors[index].toFixed(4)}×`}
                </p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-3 py-2">
            <p className="text-[11px] text-muted-foreground">
              Annual uplift applies to labour only. Y1 has no uplift in the base
              year.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              disabled={locked}
              onClick={() =>
                change((current) => ({
                  ...current,
                  defaultUplift: 5,
                  annualUplifts: [5, 5, 5, 5, 5],
                }))
              }
            >
              <RefreshCcw className="size-3" />
              Reset to 5%
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
