'use client';
import { useState } from 'react';
import { CalculationEditor } from './calculation-editor';
import { initialScratchpad } from './workbook';

export function CalculationDraftPage({
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const [initial] = useState(initialScratchpad);
  return (
    <div
      className={standalone ? 'h-dvh' : 'h-[calc(100dvh-112px)] min-h-[480px]'}
    >
      <CalculationEditor
        draftId="scratchpad"
        initialDocument={initial}
        title="Calculation Drafts"
        pageLayout
        backToWorkbench={standalone}
      />
    </div>
  );
}
