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
    <div className={standalone ? 'h-dvh' : 'wb-formula-workspace'}>
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
