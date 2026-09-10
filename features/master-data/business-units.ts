/** Cost entry uses saved BU names; company codes are labels and never matching keys. */
import { normalizeBu } from '../quote/profit-share.ts';

export type BusinessUnitOption = {
  value: string;
  label: string;
};

/** Read active, uniquely named business units without mutating the saved master records. */
export function getBusinessUnitOptions(input: unknown): BusinessUnitOption[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const options: BusinessUnitOption[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object' || item.active !== true) continue;
    const value =
      typeof item.bu === 'string' ? item.bu.trim().replace(/\s+/g, ' ') : '';
    const key = normalizeBu(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const code = typeof item.buCode === 'string' ? item.buCode.trim() : '';
    options.push({ value, label: code ? `${value} · ${code}` : value });
  }
  return options;
}
