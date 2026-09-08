'use client';

/** Browser interaction wrapper around the pure snapshot and workbook modules. */

import { useRef, useState } from 'react';
import type { CostExportSnapshot } from '@/features/cost/contracts';
import { downloadCostWorkbook } from '@/features/cost/export-workbook';
import { downloadSimpleCostWorkbook } from '@/features/cost/export-simple-workbook';

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
  const exportInFlight = useRef(false);

  const runExport = async (simple: boolean) => {
    if (!enabled || exportInFlight.current) return;

    exportInFlight.current = true;
    setIsExporting(true);
    try {
      const download = simple
        ? downloadSimpleCostWorkbook
        : downloadCostWorkbook;
      const result = await download(createSnapshot());
      announce(
        `Exported ${result.fileName} (${Math.ceil(result.sizeBytes / 1024)} KB). / ${simple ? '已按页面格式导出成本详表、多维汇总与成本报表。' : '已导出成本明细与多维汇总工作簿。'}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      announce(`Export failed: ${message} / 导出失败，请先修正成本数据。`);
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
