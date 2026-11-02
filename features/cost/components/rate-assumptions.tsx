import { Surface, Text } from '@/components/ui/presentation';
import { PercentageInput } from '@/components/ui/percentage-input';
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
  const inputClass = 'min-w-0';
  const change: React.Dispatch<React.SetStateAction<RateSettings>> = (next) => {
    if (!locked) setSettings(next);
  };
  return (
    <Surface
      as="section"
      variant="panel"
      className="min-w-0 overflow-hidden"
      aria-label="Delivery and labour rate assumptions"
    >
      {/* Delivery dates stay beside the table; less frequent rate controls expand on request. */}
      <Surface as="header" variant="header" className="min-w-0 sm:gap-x-4">
        <h2>Delivery & Rates</h2>
        {/* Date editors stay mounted and become an explicit settings row on narrow screens. */}
        <div
          id="delivery-date-settings"
          className={
            annualDetailsOpen || !settings.tdStart
              ? 'order-last grid w-full grid-cols-1 gap-2 min-[480px]:grid-cols-3'
              : 'hidden'
          }
        >
          {(
            [
              ['quoteAsOf', 'Quote as of', 'quote-as-of'],
              ['tdStart', 'Proj Start', 'td-start'],
              ['tdEnd', 'Proj End', 'td-end'],
            ] as const
          ).map(([key, label, inputId]) => (
            <Surface
              key={key}
              as="label"
              variant="inline-field"
              tone="muted"
              textRole="body-small"
              className="flex min-w-0 items-center whitespace-nowrap"
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
            </Surface>
          ))}
        </div>

        <Text
          as="span"
          tone={y1Year === null ? 'warning' : 'muted'}
          textRole="body-small"
          className=""
        >
          {y1Year === null
            ? 'Set delivery start to map Y1–Y5'
            : `Y1 ${y1Year} → Y5 ${y1Year + 4}`}
        </Text>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1"
          aria-expanded={annualDetailsOpen}
          aria-controls="annual-rate-details delivery-date-settings"
          onClick={() => setAnnualDetailsOpen(!annualDetailsOpen)}
        >
          Delivery / Rate settings
          <Text
            as={ChevronDown}
            tone={'inherit'}
            className={`size-3  ${annualDetailsOpen ? 'rotate-180' : ''}`}
          />
        </Button>
      </Surface>
      {annualDetailsOpen && (
        <Surface id="annual-rate-details" as="div" variant="footer">
          <Surface
            as="div"
            variant="item"
            className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2"
          >
            <Surface
              as="label"
              variant="inline-field"
              tone="muted"
              textRole="body-small"
              className="flex min-w-0 items-center whitespace-nowrap"
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
            </Surface>
            <Surface
              as="label"
              variant="inline-field"
              tone="muted"
              textRole="body-small"
              className="flex min-w-0 items-center whitespace-nowrap"
              htmlFor="default-uplift"
            >
              Default Uplift %
              <PercentageInput
                id="default-uplift"
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
            </Surface>
          </Surface>
          <Surface
            as="div"
            variant="body"
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            {actualYears.map((year, index) => (
              <div key={index} className="min-w-0">
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="whitespace-nowrap"
                >
                  Y{index + 1}
                  {year ? ` · ${year}` : ''}
                </Text>
                <PercentageInput
                  aria-label={`Y${index + 1} labour rate uplift`}
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
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="mt-1 text-right tabular-nums"
                >
                  {y1Year === null
                    ? 'Unmapped'
                    : `${factors[index].toFixed(4)}×`}
                </Text>
              </div>
            ))}
          </Surface>
          <Surface
            as="div"
            variant="footer"
            className="flex flex-wrap items-center justify-between"
          >
            <Text as="p" tone="muted" textRole="body-small">
              Annual uplift applies to labour only. Y1 has no uplift in the base
              year.
            </Text>
            <Button
              type="button"
              variant="outline"
              size="sm"

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
          </Surface>
        </Surface>
      )}
    </Surface>
  );
}
