'use client';

/** Browser interaction wrapper around the pure snapshot and workbook modules. */

import { useRef, useState } from 'react';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { downloadCostWorkbook } from '@/features/cost/export-workbook';
import { downloadSimpleCostWorkbook } from '@/features/cost/export-simple-workbook';
import type { PersonnelTableLayout } from '@/features/cost/personnel-table-layout';
import {
  getAvailableSimpleCostSheets,
  type SimpleCostSheetId,
} from '@/features/cost/simple-export-sheets';

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

  /** Freeze cost, view and sheet selection together; return success so the picker can stay open on failure. */
  const runExport = async (
    simple: boolean,
    selectedSheets?: readonly SimpleCostSheetId[],
  ) => {
    if (!enabled || exportInFlight.current || (simple && !simpleLayoutReady))
      return false;

    exportInFlight.current = true;
    setIsExporting(true);
    try {
      // Capture all inputs at confirmation time, before loading ExcelJS or starting the download.
      const snapshot = structuredClone(createSnapshot());
      const layout =
        simple && createSimpleLayout
          ? structuredClone(createSimpleLayout())
          : undefined;
      const sheets = selectedSheets ? [...selectedSheets] : undefined;
      const result = await (simple
        ? sheets === undefined
          ? downloadSimpleCostWorkbook(snapshot, layout)
          : downloadSimpleCostWorkbook(snapshot, layout, sheets)
        : downloadCostWorkbook(snapshot));
      announce(
        `Exported ${result.fileName} (${Math.ceil(result.sizeBytes / 1024)} KB). / ${simple ? '已导出所选页签；成本详表遵循当前视图，汇总与成本报表保留五年完整口径。' : '已导出成本明细与多维汇总工作簿。'}`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      announce(
        `Export failed: ${message} / 导出失败，请检查成本数据和导出设置。`,
      );
      return false;
    } finally {
      exportInFlight.current = false;
      setIsExporting(false);
    }
  };

  return {
    isExporting,
    // Re-read conditional sheets whenever the picker opens; this does not download or archive anything.
    getSimpleWorkbookSheets: () =>
      getAvailableSimpleCostSheets(createSnapshot(), createSimpleLayout?.()),
    exportWorkbook: () => runExport(false),
    exportSimpleWorkbook: (selectedSheets?: readonly SimpleCostSheetId[]) =>
      runExport(true, selectedSheets),
  };
}
