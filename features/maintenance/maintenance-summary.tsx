/** Shared compact summary table used by maintenance entry and quotation review. */
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import type { MaintenanceWorkspace } from './domain';
import {
  maintenanceGridDraft,
  calculateComponentMaintenance,
} from './component-pricing';
export function MaintenanceSummary({
  value,
  serviceQuote,
  details = false,
}: {
  value: MaintenanceWorkspace;
  serviceQuote?: number;
  details?: boolean;
}) {
  const draft = maintenanceGridDraft(value);
  let result: ReturnType<typeof calculateComponentMaintenance>;
  try {
    result = calculateComponentMaintenance(draft);
  } catch (error) {
    return (
      <p role="alert" className="p-3 text-xs text-destructive">
        {String(error)}
      </p>
    );
  }
  return (
    <div className="bg-muted/10">
      <Table className="text-xs [&_td]:border [&_th]:border">
        <TableHeader>
          <TableRow>
            <TableHead>Maintenance Total</TableHead>
            <TableHead>Years</TableHead>
            {result.annual.map((item) => (
              <TableHead key={item.year}>{item.year}</TableHead>
            ))}
            {serviceQuote !== undefined && (
              <TableHead>Quote + Maintenance</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="financial-numeral font-semibold">
              {result.quote.toFixed(2)}
            </TableCell>
            <TableCell>
              {result.annual.length
                ? `${draft.startYear}–${result.annual.at(-1)!.year}`
                : '—'}
            </TableCell>
            {result.annual.map((item) => (
              <TableCell key={item.year} className="financial-numeral">
                {item.total.toFixed(2)}
              </TableCell>
            ))}
            {serviceQuote !== undefined && (
              <TableCell className="financial-numeral font-semibold">
                {(serviceQuote + result.quote).toFixed(2)}
              </TableCell>
            )}
          </TableRow>
        </TableBody>
      </Table>
      {details && (
        <Table className="min-w-[850px] text-xs [&_td]:border [&_th]:border">
          <TableHeader>
            <TableRow>
              {[
                'Model',
                'Desc.',
                'CT',
                'SPMS',
                'U/P',
                'QTY',
                'Yearly',
                'Dur.',
                'Total',
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.lines.map((line) => {
              const row = line.boq,
                unit = (row.ct ?? 0) + (row.spms ?? 0);
              return (
                <TableRow key={row.id}>
                  <TableCell>{row.model}</TableCell>
                  <TableCell className="max-w-72 whitespace-pre-wrap">
                    {row.description}
                  </TableCell>
                  <TableCell>{row.ct?.toFixed(2)}</TableCell>
                  <TableCell>{row.spms?.toFixed(2)}</TableCell>
                  <TableCell>{unit.toFixed(2)}</TableCell>
                  <TableCell>{row.quantity}</TableCell>
                  <TableCell>{(unit * row.quantity).toFixed(2)}</TableCell>
                  <TableCell>{row.durationYears}</TableCell>
                  <TableCell>{line.quote.toFixed(2)}</TableCell>
                </TableRow>
              );
            })}
            {!result.lines.length && (
              <TableRow>
                <TableCell colSpan={9}>暂无维保设备</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
