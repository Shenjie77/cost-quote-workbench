/** Compact, version-owned Subcon rates; personnel assumptions are never copied. */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getSubcontractRateFactors,
  type SubcontractRateSettings,
} from '../subcontract-domain';

const inputClass = 'h-8 min-w-0 rounded-md bg-card px-2 text-xs shadow-none';

/** Commit complete percentages on blur so typing a minus sign cannot erase saved rates. */
export function SubcontractUpliftInput({
  id,
  value,
  label,
  disabled,
  className,
  onChange,
}: {
  id?: string;
  value: number;
  label: string;
  disabled: boolean;
  className: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [invalid, setInvalid] = useState(false);
  const [edited, setEdited] = useState(false);
  const save = () => {
    if (disabled || !edited) return;
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next) || next < -100 || next > 1000) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setDraft(next.toFixed(2));
    setEdited(false);
    if (next !== value) onChange(next);
  };
  return (
    <>
      <Input
        id={id}
        aria-label={label}
        aria-invalid={invalid}
        type="text"
        inputMode="decimal"
        min={-100}
        max={1000}
        step="any"
        className={className}
        value={draft}
        disabled={disabled}
        onChange={(event) => {
          if (!disabled) {
            setDraft(event.target.value);
            setEdited(true);
            setInvalid(false);
          }
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setDraft(value.toFixed(2));
            setEdited(false);
            setInvalid(false);
          }
        }}
      />
      {invalid && (
        <span role="alert" className="block text-xs text-destructive">
          Enter -100% to 1000%.
        </span>
      )}
    </>
  );
}

/** Keep partial year typing local; only a complete valid baseline is persisted. */
export function SubcontractBaseYearInput({
  value,
  locked,
  onChange,
}: {
  value?: number;
  locked: boolean;
  onChange: (year: number) => void;
}) {
  const [draft, setDraft] = useState(value?.toString() ?? '');
  const [invalid, setInvalid] = useState(false);
  const save = () => {
    if (locked || (!draft && value === undefined)) return;
    const year = Number(draft);
    if (!Number.isInteger(year) || year < 2000 || year > 2200) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (year !== value) onChange(year);
  };
  return (
    <label className="flex min-w-0 flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
      Base Year
      <Input
        aria-label="Subcon base year"
        aria-invalid={invalid}
        className={`${inputClass} w-24`}
        type="number"
        min={2000}
        max={2200}
        value={draft}
        placeholder="Enter year"
        disabled={locked}
        onChange={(event) => {
          if (!locked) {
            setDraft(event.target.value);
            setInvalid(false);
          }
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
      />
      {invalid && (
        <span role="alert" className="text-destructive">
          Enter 2000–2200.
        </span>
      )}
    </label>
  );
}

/** Expose annual factors beside the inputs while keeping routine entry compact. */
export function SubcontractRateAssumptions({
  settings,
  onChange,
  actualYears,
  locked = false,
}: {
  settings?: SubcontractRateSettings;
  onChange: (settings: SubcontractRateSettings) => void;
  actualYears: (number | null)[];
  locked?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const startYear = actualYears[0];
  const factors = getSubcontractRateFactors(settings, startYear);
  /** Validate interactive percentages before they enter the saved cost version. */
  const changeUplift = (value: number, index?: number) => {
    if (locked || !settings) return;
    if (!Number.isFinite(value) || value < -100 || value > 1000) return;
    onChange(
      index === undefined
        ? {
            ...settings,
            defaultUplift: value,
            annualUplifts: Array(5).fill(value),
          }
        : {
            ...settings,
            annualUplifts: settings.annualUplifts.map((old, i) =>
              i === index ? value : old,
            ),
          },
    );
  };
  return (
    <section
      className="wb-panel min-w-0 overflow-hidden"
      aria-label="Subcon annual rate assumptions"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        <h2 className="text-xs font-semibold">Subcon Rates</h2>
        <SubcontractBaseYearInput
          key={settings?.baseYear ?? 'unset'}
          value={settings?.baseYear}
          locked={locked}
          onChange={(baseYear) => {
            if (!locked)
              onChange(
                settings
                  ? { ...settings, baseYear }
                  : {
                      baseYear,
                      defaultUplift: 0,
                      annualUplifts: [0, 0, 0, 0, 0],
                    },
              );
          }}
        />
        <span className="text-xs text-muted-foreground">
          {settings
            ? 'Independent of personnel rates'
            : 'Flat prices until rates are set'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1 px-2 text-xs"
          aria-expanded={expanded}
          aria-controls="subcon-annual-rates"
          onClick={() => setExpanded(!expanded)}
        >
          Rate settings{' '}
          <ChevronDown
            className={`size-3 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </Button>
      </header>
      {expanded && (
        <div id="subcon-annual-rates" className="border-t">
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/10 px-3 py-2">
            <label
              htmlFor="subcon-default-uplift"
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground"
            >
              Default Uplift %
              <SubcontractUpliftInput
                id="subcon-default-uplift"
                key={settings?.defaultUplift ?? 'unset'}
                label="Subcon default uplift"
                className={`${inputClass} w-24 text-right`}
                value={settings?.defaultUplift ?? 0}
                disabled={locked || !settings}
                onChange={(value) => changeUplift(value)}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              {!settings
                ? 'Enter the Subcon base year first.'
                : 'Default fills all five years; each year can be adjusted below.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 px-3 py-2 sm:grid-cols-5">
            {actualYears.map((year, index) => {
              const baseYear =
                year != null && settings != null && year <= settings.baseYear;
              return (
                <label
                  key={index}
                  htmlFor={`subcon-year-uplift-${index}`}
                  className="min-w-0 text-xs font-medium text-muted-foreground"
                >
                  Y{index + 1}
                  {year ? ` · ${year}` : ''} · %
                  <SubcontractUpliftInput
                    id={`subcon-year-uplift-${index}`}
                    key={`${baseYear}:${settings?.annualUplifts[index] ?? 'unset'}`}
                    label={`Y${index + 1} subcon rate uplift`}
                    className={`${inputClass} mt-1 w-full text-right`}
                    value={baseYear ? 0 : (settings?.annualUplifts[index] ?? 0)}
                    disabled={locked || !settings || !startYear || baseYear}
                    onChange={(value) => changeUplift(value, index)}
                  />
                  <span className="mt-1 block text-right tabular-nums">
                    {startYear
                      ? `${factors[index].toFixed(4)}×`
                      : 'Set project start'}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="border-t bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
            Annual uplift adjusts Subcon BOQ costs only. Years through the base
            year keep the base price; later years compound in sequence. Y1
            includes any gap after the base year.
          </p>
        </div>
      )}
    </section>
  );
}
