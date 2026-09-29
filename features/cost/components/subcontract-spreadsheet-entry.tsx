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
}: {
  draftId: string;
  name: string;
  lines: EntryLine[];
  project?: boolean;
  factors: number[];
  locked: boolean;
  onReplace: (lines: EntryLine[]) => void;
  announce: (message: string) => void;
}) {
  if (!lines.length)
    return (
      <p className="px-3 py-6 text-sm text-muted-foreground">
        Add catalog items to start this cost worksheet.
      </p>
    );
  return (
    <div className="space-y-2 px-3 pb-3">
      <p className="text-xs text-muted-foreground">
        Edit unit prices and quantities, or enter formulas. Base amount excludes
        annual uplift. Apply to costs updates the official totals; drafts save
        separately. Use Item details to change or remove catalog items.
      </p>
      <CalculationEditor
        key={draftId}
        draftId={draftId}
        title={name}
        readOnly={locked}
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
    </div>
  );
}
