import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
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
    <Surface
      as="section"
      variant="panel"
      className="min-w-0 overflow-hidden"
      aria-label="HQ travel cost"
    >
      <Surface as="header" variant="header" className="justify-between">
        <div>
          <Surface
            as="label"
            variant="inline-field"
            textRole="body-main"
            className="flex items-center"
          >
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
          </Surface>
          <Text as="p" tone="muted" textRole="body-small" className="mt-1">
            {enabled
              ? 'Calculated from HQ effort and the expenses below.'
              : 'Off · HQ effort is available for reference; no travel cost is included.'}
          </Text>
        </div>
        <div className="shrink-0 text-right">
          <Text as="p" tone="muted" textRole="body-small">
            HQ Travel · SGD
          </Text>
          <Text
            as="p"
            tone="primary"
            textRole="body-main"
            className="mt-1 tabular-nums"
          >
            {summary.totalCost.toLocaleString('en-SG', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </Text>
        </div>
      </Surface>
      <Surface
        as="div"
        variant="footer"
        textRole="body-small"
        className="flex flex-wrap items-center"
      >
        <span>
          <Text as="span" tone="muted">
            HQ effort{' '}
          </Text>
          <strong className="tabular-nums">
            {summary.hqMandays.toLocaleString('en-SG')} MD
          </strong>
        </span>
        <span>
          <Text as="span" tone="muted">
            Equivalent{' '}
          </Text>
          <strong className="tabular-nums">
            {summary.months.toFixed(2)} months
          </strong>
        </span>
        {summary.hqMandays > 0 && (
          <Text as="span" tone="muted">
            {mandaysPerMonth.join(' / ')} MD per month
          </Text>
        )}
      </Surface>
      {enabled && (
        <>
          <Surface
            as="div"
            variant="footer"
            className="grid grid-cols-2 sm:grid-cols-3"
          >
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
              <Surface
                key={key}
                as="label"
                variant="field"
                tone="muted"
                textRole="body-small"
                className="min-w-0"
              >
                <span className="block">
                  {label}
                  {key !== 'trips' && (
                    <Text as="span" textRole="body-small" className="ml-1">
                      SGD
                    </Text>
                  )}
                </span>
                <Input
                  money={key !== 'trips'}
                  aria-label={ariaLabel}
                  type="number"
                  min={0}
                  max={key === 'trips' ? COST_LIMITS.trips : COST_LIMITS.money}
                  step={key === 'trips' ? 1 : 'any'}
                  className="w-full text-right tabular-nums"
                  value={settings[key]}
                  disabled={locked}
                  onChange={(event) => updateAmount(key, event.target.value)}
                  onBlur={(event) =>
                    updateAmount(key, event.target.value, true)
                  }
                />
              </Surface>
            ))}
          </Surface>
          {!summary.required && (
            <Surface as="p" variant="footer" tone="muted" textRole="body-small">
              No HQ mandays in this version. Travel will calculate when HQ
              effort is entered.
            </Surface>
          )}
          <Surface
            as="div"
            variant="footer"
            textRole="body-small"
            className="flex flex-wrap items-center justify-between"
          >
            <span>
              <Text as="span" tone="muted">
                Monthly expenses{' '}
              </Text>
              <strong className="tabular-nums">
                {formatSgd(summary.allowanceCost)}
              </strong>
            </span>
            <span>
              <Text as="span" tone="muted">
                Airfare{' '}
              </Text>
              <strong className="tabular-nums">
                {formatSgd(summary.airfareCost)}
              </strong>
            </span>
            <Text as="span" tone="muted">
              No labour uplift or 3% allowance
            </Text>
          </Surface>
          {summary.hqRows.length > 0 && (
            <Disclosure>
              <DisclosureSummary className="cursor-pointer">
                HQ effort sources · {summary.hqRows.length} lines
              </DisclosureSummary>
              <Surface
                as="ul"
                variant="body"
                tone="muted"
                textRole="body-small"
                className="space-y-1"
              >
                {summary.hqRows.map((row) => (
                  <li key={row.id}>
                    {row.scope} ·{' '}
                    {resourceTypes.find(
                      (resource) => resource.id === row.reTypeId,
                    )?.name || row.reTypeId}
                  </li>
                ))}
              </Surface>
            </Disclosure>
          )}
        </>
      )}
    </Surface>
  );
}
