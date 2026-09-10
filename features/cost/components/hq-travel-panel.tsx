/** Version-level HQ travel opt-in with explicit, preserved expense assumptions. */
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  getHQTravelSummary,
  isHQTravelEnabled,
  roundMoney,
  type CostInputRow,
  type ResourceType,
  type TravelSettings,
} from '@/features/cost/domain';
import { formatSgd } from '@/lib/formatters';
import { COST_LIMITS } from '../validation';

type TravelAmount = 'monthlyAllowance' | 'airfarePerTrip' | 'trips';

export function HQTravelPanel({
  rows,
  resourceTypes,
  settings,
  setSettings,
  locked = false,
  announce = () => {},
}: {
  rows: CostInputRow[];
  resourceTypes: ResourceType[];
  settings: TravelSettings;
  setSettings: React.Dispatch<React.SetStateAction<TravelSettings>>;
  locked?: boolean;
  announce?: (message: string) => void;
}) {
  const summary = getHQTravelSummary(rows, resourceTypes, settings);
  const enabled = isHQTravelEnabled(settings);
  const updateAmount = (key: TravelAmount, raw: string, round = false) => {
    if (locked || !enabled) return;
    const amount = Number(raw);
    if (
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > (key === 'trips' ? COST_LIMITS.trips : COST_LIMITS.money) ||
      (key === 'trips' && !Number.isInteger(amount))
    ) {
      announce(
        key === 'trips'
          ? 'Round trips must be a whole number between 0 and 100,000.'
          : 'Enter a valid non-negative travel amount.',
      );
      return;
    }
    setSettings((current) => ({
      ...current,
      [key]: round ? roundMoney(amount) : amount,
    }));
  };
  const mandaysPerMonth = [
    ...new Set(
      summary.hqRows.map(
        (row) =>
          resourceTypes.find((resource) => resource.id === row.reTypeId)
            ?.mandaysPerMonth || 21.75,
      ),
    ),
  ];
  return (
    <section
      className="wb-panel min-w-0 overflow-hidden"
      aria-label="HQ travel cost"
    >
      <header className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold">
            <Checkbox
              aria-label="Include HQ travel cost"
              checked={enabled}
              disabled={locked}
              onCheckedChange={(checked) => {
                if (!locked)
                  setSettings((current) => ({
                    ...current,
                    enabled: checked === true,
                  }));
              }}
            />
            Include HQ Travel
          </label>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {enabled
              ? 'Calculated from HQ effort and the expenses below.'
              : 'Off · HQ effort is available for reference; no travel cost is included.'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] text-muted-foreground">HQ Travel · SGD</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-primary">
            {summary.totalCost.toLocaleString('en-SG', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </p>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-muted/20 px-3 py-2 text-[11px]">
        <span>
          <span className="text-muted-foreground">HQ effort </span>
          <strong className="tabular-nums">
            {summary.hqMandays.toLocaleString('en-SG')} MD
          </strong>
        </span>
        <span>
          <span className="text-muted-foreground">Equivalent </span>
          <strong className="tabular-nums">
            {summary.months.toFixed(2)} months
          </strong>
        </span>
        {summary.hqMandays > 0 && (
          <span className="text-muted-foreground">
            {mandaysPerMonth.join(' / ')} MD per month
          </span>
        )}
      </div>
      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-4 border-t px-4 py-4 sm:grid-cols-3">
            {(
              [
                [
                  'monthlyAllowance',
                  'Monthly allowance',
                  'Monthly HQ allowance',
                ],
                ['trips', 'Round trips', 'Number of HQ round trips'],
                [
                  'airfarePerTrip',
                  'Airfare per trip',
                  'Airfare per HQ round trip',
                ],
              ] as const
            ).map(([key, label, ariaLabel]) => (
              <label
                key={key}
                className="min-w-0 space-y-1.5 text-[11px] font-medium text-muted-foreground"
              >
                <span className="block">
                  {label}
                  {key !== 'trips' && (
                    <span className="ml-1 text-[10px]">SGD</span>
                  )}
                </span>
                <Input
                  aria-label={ariaLabel}
                  type="number"
                  min={0}
                  max={key === 'trips' ? COST_LIMITS.trips : COST_LIMITS.money}
                  step={key === 'trips' ? 1 : 'any'}
                  className="h-9 w-full bg-background px-2.5 text-right text-xs tabular-nums disabled:bg-muted/40"
                  value={settings[key]}
                  disabled={locked}
                  onChange={(event) => updateAmount(key, event.target.value)}
                  onBlur={(event) =>
                    updateAmount(key, event.target.value, true)
                  }
                />
              </label>
            ))}
          </div>
          {!summary.required && (
            <p className="border-t bg-muted/10 px-3 py-2 text-[11px] text-muted-foreground">
              No HQ mandays in this version. Travel will calculate when HQ
              effort is entered.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/10 px-3 py-2 text-[11px]">
            <span>
              <span className="text-muted-foreground">Monthly expenses </span>
              <strong className="tabular-nums">
                {formatSgd(summary.allowanceCost)}
              </strong>
            </span>
            <span>
              <span className="text-muted-foreground">Airfare </span>
              <strong className="tabular-nums">
                {formatSgd(summary.airfareCost)}
              </strong>
            </span>
            <span className="text-muted-foreground">
              No labour uplift or 3% allowance
            </span>
          </div>
          {summary.hqRows.length > 0 && (
            <details className="border-t">
              <summary className="cursor-pointer px-3 py-2 text-[11px] font-medium hover:bg-muted/20">
                HQ effort sources · {summary.hqRows.length} lines
              </summary>
              <ul className="space-y-1 px-3 pb-3 text-xs text-muted-foreground">
                {summary.hqRows.map((row) => (
                  <li key={row.id}>
                    {row.scope} ·{' '}
                    {resourceTypes.find(
                      (resource) => resource.id === row.reTypeId,
                    )?.name || row.reTypeId}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
