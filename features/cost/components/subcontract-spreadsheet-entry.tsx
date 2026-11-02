import { Surface, Text } from '@/components/ui/presentation';
/** A single editable grid replaces the duplicate preview/detail editors. */
import type { ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EntryLine } from '../subcontract-spreadsheet';
import { SubcontractLinesTable } from './subcontract-lines-table';

export function SubcontractSpreadsheetEntry({
  name,
  lines,
  project = false,
  factors,
  locked,
  onReplace,
  onDelete,
  announce,
  itemActions,
  titleActions,
  titleEditor,
  actualYears = [null, null, null, null, null],
  yearIndex = 0,
  onYearChange,
  deleteConfirmation,
}: {
  draftId: string;
  name: string;
  lines: EntryLine[];
  project?: boolean;
  factors: number[];
  locked: boolean;
  onReplace: (lines: EntryLine[]) => void;
  onDelete?: (id: string) => void;
  announce: (message: string) => void;
  itemActions?: ReactNode;
  titleActions?: ReactNode;
  titleEditor?: ReactNode;
  actualYears?: (number | null)[];
  yearIndex?: number | 'all';
  onYearChange?: (year: number | 'all') => void;
  deleteConfirmation?: (line: EntryLine) => string;
}) {
  return (
    <div>
      <Surface as="div" variant="header" aria-label="Worksheet toolbar">
        <div className="flex items-center gap-2">
          {titleEditor ?? <h3>{name}</h3>}
          <Text as="span" tone="muted" textRole="body-small">
            {lines.length} items
          </Text>
          {titleActions}
        </div>
        <div className="flex flex-wrap items-center gap-2">{itemActions}</div>
      </Surface>
      {project && onYearChange && (
        <Tabs
          value={String(yearIndex)}
          onValueChange={(value) =>
            onYearChange(value === 'all' ? 'all' : Number(value))
          }
        >
          <TabsList variant="line" aria-label="Item details year">
            {actualYears.map((year, index) => (
              <TabsTrigger key={index} value={String(index)}>
                Y{index + 1}
                {year ? ` · ${year}` : ''}
              </TabsTrigger>
            ))}
            <TabsTrigger value="all">All years</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <SubcontractLinesTable
        lines={lines}
        project={project}
        actualYears={actualYears}
        yearIndex={yearIndex}
        rateFactors={factors}
        locked={locked}
        announce={announce}
        onChange={(next) => {
          if (!locked)
            onReplace(lines.map((line) => (line.id === next.id ? next : line)));
        }}
        onDelete={(id) => {
          if (!locked) {
            if (onDelete) onDelete(id);
            else onReplace(lines.filter((line) => line.id !== id));
          }
        }}
        deleteConfirmation={deleteConfirmation}
      />
    </div>
  );
}
