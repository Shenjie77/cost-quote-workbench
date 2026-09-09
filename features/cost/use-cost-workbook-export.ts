'use client';

/** Browser interaction wrapper around the pure snapshot and workbook modules. */

import { useRef, useState } from 'react';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { downloadCostWorkbook } from '@/features/cost/export-workbook';
import { downloadSimpleCostWorkbook } from '@/features/cost/export-simple-workbook';
import type { PersonnelTableLayout } from '@/features/cost/personnel-table-layout';

type UseCostWorkbookExportInput = {
  enabled: boolean;
  announce: (message: string) => void;
  createSnapshot: () => CostExportSnapshot;
  createSimpleLayout?: () => PersonnelTableLayout;
  simpleLayoutReady?: boolean;
};

/** Owns only export progress and user feedback; it never calculates cost. */
export function useCostWorkbookExport({
  enabled,
  announce,
  createSnapshot,
  createSimpleLayout,
  simpleLayoutReady = true,
}: UseCostWorkbookExportInput) {
  const [isExporting, setIsExporting] = useState(false);
  const exportInFlight = useRef(false);

  const runExport = async (simple: boolean) => {
    if (!enabled || exportInFlight.current || (simple && !simpleLayoutReady))
      return;

    exportInFlight.current = true;
    setIsExporting(true);
    try {
      // Capture both inputs at click time, before loading ExcelJS or starting the download.
      const snapshot = structuredClone(createSnapshot());
      const layout =
        simple && createSimpleLayout
          ? structuredClone(createSimpleLayout())
          : undefined;
      const result = await (simple
        ? downloadSimpleCostWorkbook(snapshot, layout)
        : downloadCostWorkbook(snapshot));
      announce(
        `Exported ${result.fileName} (${Math.ceil(result.sizeBytes / 1024)} KB). / ${simple ? '成本详表已按当前分组、列和年份导出；汇总与成本报表保留五年完整口径。' : '已导出成本明细与多维汇总工作簿。'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      announce(
        `Export failed: ${message} / 导出失败，请检查成本数据和导出设置。`,
      );
    } finally {
      exportInFlight.current = false;
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    exportWorkbook: () => runExport(false),
    exportSimpleWorkbook: () => runExport(true),
  };
}
