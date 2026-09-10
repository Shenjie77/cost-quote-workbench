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

/** Edit delivery dates and optionally expand annual labour assumptions. */
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
    'h-7 min-w-0 rounded-md bg-card px-2 text-[11px] shadow-none disabled:bg-muted/40';
  const change: React.Dispatch<React.SetStateAction<RateSettings>> = (next) => {
    if (!locked) setSettings(next);
  };
  return (
    <section
      className="wb-panel min-w-0 overflow-hidden"
      aria-label="Delivery and labour rate assumptions"
    >
      {/* Delivery dates stay beside the table; less frequent rate controls expand on request. */}
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 sm:gap-x-4">
        <h2 className="text-xs font-semibold">Delivery & Rates</h2>
        {/* Date editors stay mounted and become an explicit settings row on narrow screens. */}
        <div
          id="delivery-date-settings"
          className={
            annualDetailsOpen
              ? 'order-last grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-2 sm:contents'
              : 'hidden sm:contents'
          }
        >
          {(
            [
              ['quoteAsOf', 'Quote as of', 'quote-as-of'],
              ['tdStart', 'Proj Start', 'td-start'],
              ['tdEnd', 'Proj End', 'td-end'],
            ] as const
          ).map(([key, label, inputId]) => (
            <label
              key={key}
              className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11px] font-medium text-muted-foreground"
              htmlFor={inputId}
            >
              {label}
              <Input
                id={inputId}
                aria-label={label}
                type="date"
                className={`${inputClass} ml-auto w-[128px] sm:ml-0`}
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

        <span
          className={`text-[11px] ${y1Year === null ? 'text-amber-700' : 'text-muted-foreground'}`}
        >
          {y1Year === null
            ? 'Set delivery start to map Y1–Y5'
            : `Y1 ${y1Year} → Y5 ${y1Year + 4}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7 gap-1 px-2 text-[11px]"
          aria-expanded={annualDetailsOpen}
          aria-controls="annual-rate-details delivery-date-settings"
          onClick={() => setAnnualDetailsOpen(!annualDetailsOpen)}
        >
          Rate settings
          <ChevronDown
            className={`size-3 transition-transform ${annualDetailsOpen ? 'rotate-180' : ''}`}
          />
        </Button>
      </header>
      {annualDetailsOpen && (
        <div id="annual-rate-details" className="border-t">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-muted/10 px-3 py-2">
            <label
              className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[11px] font-medium text-muted-foreground"
              htmlFor="rate-base-year"
            >
              Base Year
              <Input
                id="rate-base-year"
                type="number"
                min={2000}
                max={2200}
                className={`${inputClass} w-24`}
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
              className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[11px] font-medium text-muted-foreground"
              htmlFor="default-uplift"
            >
              Default Uplift %
              <Input
                id="default-uplift"
                type="number"
                min={-100}
                max={1000}
                step="any"
                className={`${inputClass} w-24 text-right`}
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
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 py-2 sm:grid-cols-5">
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
                  className={`${inputClass} mt-1 w-full text-right`}
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
