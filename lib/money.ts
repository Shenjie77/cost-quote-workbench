/** Presentation only: preserve numeric calculations while showing grouped amounts to two decimal places. */
const amountFormat = new Intl.NumberFormat('en-SG', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});
export function formatMoney(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? '—'
    : amountFormat.format(value);
}
