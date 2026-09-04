'use client';

/** Browser interaction wrapper around the pure snapshot and workbook modules. */

import { useState } from 'react';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { downloadCostWorkbook } from '@/features/cost/export-workbook';

type UseCostWorkbookExportInput = {
  enabled: boolean;
  announce: (message: string) => void;
  createSnapshot: () => CostExportSnapshot;
};

/** Owns only export progress and user feedback; it never calculates cost. */
export function useCostWorkbookExport({
  enabled,
  announce,
  createSnapshot,
}: UseCostWorkbookExportInput) {
  const [isExporting, setIsExporting] = useState(false);

  const exportWorkbook = async () => {
    if (!enabled || isExporting) return;

    setIsExporting(true);
    try {
      const result = await downloadCostWorkbook(createSnapshot());
      announce(
        `Exported ${result.fileName} (${Math.ceil(result.sizeBytes / 1024)} KB). / 已导出成本明细与多维汇总工作簿。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      announce(`Export failed: ${message} / 导出失败，请先修正成本数据。`);
    } finally {
      setIsExporting(false);
    }
  };

  return { isExporting, exportWorkbook };
}
