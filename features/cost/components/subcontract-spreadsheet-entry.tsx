import { type ReactNode, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { CalculationEditor } from '@/features/calculation/calculation-editor';
import {
  readSubcontractWorkbook,
  subcontractBasis,
  subcontractWorkbook,
  type EntryLine,
} from '../subcontract-spreadsheet';

export function SubcontractSpreadsheetEntry({
  draftId,
  name,
  lines,
  project = false,
  factors,
  locked,
  onReplace,
  announce,
  itemActions,
  titleActions,
}: {
  draftId: string;
  name: string;
  lines: EntryLine[];
  project?: boolean;
  factors: number[];
  locked: boolean;
  onReplace: (lines: EntryLine[]) => void;
  announce: (message: string) => void;
  itemActions?: ReactNode;
  titleActions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const active = editing && !locked;
  return (
    <div className="space-y-2 p-3">
      {!active ? (
        <>
          <div
            className="flex flex-wrap items-center justify-between gap-2"
            aria-label="Worksheet toolbar"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">{name}</h3>
              <span className="text-xs text-muted-foreground">
                {lines.length} items
              </span>
              {titleActions}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {itemActions}
              <Button
                ref={editButton}
                size="sm"
                variant="outline"
                disabled={locked || !lines.length}
                onClick={() => setEditing(true)}
              >
                Edit worksheet
              </Button>
            </div>
          </div>
          {!lines.length ? (
            <p className="py-5 text-xs text-muted-foreground">
              Add catalog items to start this worksheet.
            </p>
          ) : (
            <div
              className="overflow-x-auto rounded border"
              aria-label={`${name} cost preview`}
            >
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="p-2">Code</th>
                    <th className="p-2">Description</th>
                    <th className="p-2">Unit</th>
                    <th className="p-2 text-right">Unit price</th>
                    {project ? (
                      [1, 2, 3, 4, 5].map((year) => (
                        <th key={year} className="p-2 text-right">
                          Y{year} quantity
                        </th>
                      ))
                    ) : (
                      <th className="p-2 text-right">Quantity / site</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.id} className="border-t">
                      <td className="p-2 font-medium">{line.code}</td>
                      <td className="p-2">{line.description}</td>
                      <td className="p-2">{line.unit}</td>
                      <td className="p-2 text-right tabular-nums">
                        {line.unitPrice === null
                          ? 'Not priced'
                          : formatMoney(line.unitPrice)}
                      </td>
                      {'quantities' in line ? (
                        line.quantities.map((quantity, index) => (
                          <td
                            key={index}
                            className="p-2 text-right tabular-nums"
                          >
                            {quantity}
                          </td>
                        ))
                      ) : (
                        <td className="p-2 text-right tabular-nums">
                          {line.quantityPerSite}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <CalculationEditor
            key={draftId}
            draftId={draftId}
            title={name}
            headerActions={itemActions}
            titleActions={titleActions}
            readOnly={locked}
            onClose={() => {
              setEditing(false);
              requestAnimationFrame(() =>
                editButton.current?.focus({ preventScroll: true }),
              );
            }}
            initialDocument={subcontractWorkbook(lines, project, factors, name)}
            onApply={(document) => {
              if (locked) throw new Error('This cost version is locked.');
              const next = readSubcontractWorkbook(
                document,
                lines,
                project,
                factors,
              );
              onReplace(next);
              announce('Spreadsheet prices and quantities applied to costs.');
              return subcontractBasis(next, project, factors);
            }}
          />
        </>
      )}
    </div>
  );
}
