'use client';
import { exportTimestamp } from '../../lib/file-names';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { inspectCostWorkbook } from '@/features/cost/import-workbook';
import type { MaintenancePriceRecord } from '@/features/master-data/domain';
import { archiveProjectFile } from '@/features/projects/project-files';
import {
  appendBoq,
  archiveMaintenance,
  calculateMaintenance,
  importBoq,
  buildMaintenanceWorkbook,
  type MaintenanceWorkspace,
  type BoqLine,
} from './domain';
import {
  maintenanceGridDraft,
  calculateComponentMaintenance,
  newMaintenanceLine,
} from './component-pricing';
import { MaintenanceGrid } from './maintenance-grid';
import { MaintenanceBulkDialog } from './maintenance-bulk-dialog';
/** Keeps BOQ quantities, reference selection and draft actions in one compact workspace. */
export function MaintenanceView({
  projectId,
  canApply,
  value: storedValue,
  onChange,
  records,
  client,
  announce,
}: {
  projectId: string;
  canApply?: () => boolean;
  value: MaintenanceWorkspace;
  onChange: React.Dispatch<React.SetStateAction<MaintenanceWorkspace>>;
  records: MaintenancePriceRecord[];
  client: string;
  announce: (s: string) => void;
}) {
  const value = maintenanceGridDraft(storedValue);
  let summary: ReturnType<typeof calculateComponentMaintenance> | undefined;
  let calculationError = '';
  try {
    summary = calculateComponentMaintenance(value);
  } catch (error) {
    calculationError = String(error);
  }
  const mounted = useRef(true);
  const importing = useRef(false);
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  }, [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [file, setFile] = useState<File | null>(null),
    [sheets, setSheets] = useState<string[]>([]),
    [sheet, setSheet] = useState(''),
    [header, setHeader] = useState(1),
    [modelCol, setModelCol] = useState(1),
    [qtyCol, setQtyCol] = useState(2),
    [excluded, setExcluded] = useState(''),
    [preview, setPreview] = useState<BoqLine[]>([]),
    [busy, setBusy] = useState(false);
  /** Apply edits to the latest draft while preserving immutable archive snapshots. */
  const update = (id: string, patch: Partial<BoqLine>) => {
    if (busy || (canApply && !canApply())) return;
    onChange((current) => {
      const draft = maintenanceGridDraft(current);
      return {
        ...draft,
        boq: draft.boq.map((row) =>
          row.id === id ? { ...row, ...patch } : row,
        ),
      };
    });
  };
  /** Validate the entire batch before adding any rows. */
  const addRows = (rows: BoqLine[]) => {
    if (busy || (canApply && !canApply())) return false;
    try {
      const boq = appendBoq(value.boq, rows);
      onChange({ ...value, boq });
      return true;
    } catch (error) {
      announce(String(error));
      return false;
    }
  };
  const attempt = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      announce(String(e));
    }
  };
  const download = async (id: string) => {
    try {
      const a = structuredClone(value.archives.find((x) => x.id === id)!);
      const bytes = await buildMaintenanceWorkbook(a);
      const blob = new Blob([new Uint8Array(bytes).buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const fileName = `Maintenance_${exportTimestamp()}.xlsx`;
      await archiveProjectFile(projectId, blob, {
        originalName: fileName,
        category: 'maintenance',
      });
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      announce(String(e));
    }
  };
  return (
    <div className="wb-page-stack">
      <section className="wb-panel overflow-hidden">
        <div className="wb-toolbar justify-between border-b">
          <h2 className="text-sm font-semibold text-primary">BOQ 维保配置</h2>
          <label className="flex items-center gap-2 text-xs">
            开始年份
            <Input
              aria-label="Maintenance start year"
              type="text"
              inputMode="numeric"
              className="h-8 w-24"
              value={value.startYear}
              disabled={busy}
              onChange={(event) => {
                if (canApply && !canApply()) return;
                if (/^\d{0,4}$/.test(event.target.value))
                  onChange({ ...value, startYear: Number(event.target.value) });
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => addRows([newMaintenanceLine()])}
            >
              添加设备
            </Button>
            <MaintenanceBulkDialog disabled={busy} onImport={addRows} />
            <Button
              variant="outline"
              disabled={busy || !!calculationError}
              onClick={() =>
                attempt(() =>
                  announce(
                    `维保总价 SGD ${calculateMaintenance(value, records).quote.toFixed(2)}`,
                  ),
                )
              }
            >
              计算维保草稿
            </Button>
            <Button
              disabled={busy || !!calculationError}
              onClick={() =>
                attempt(() => {
                  if (canApply && !canApply()) return;
                  onChange(archiveMaintenance(value, records, client));
                  announce('已归档设备明细、年度单价和计算结果');
                })
              }
            >
              归档配置
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b px-3 py-3 text-xs">
          <div>
            维保总价{' '}
            <strong className="ml-2 financial-numeral text-base">
              SGD {summary?.quote.toFixed(2) ?? '—'}
            </strong>
          </div>
          <div>
            维保年份{' '}
            <strong>
              {summary?.annual.length
                ? `${value.startYear}–${summary.annual.at(-1)!.year}`
                : '—'}
            </strong>
          </div>
          {summary?.annual.map((item) => (
            <div key={item.year} className="financial-numeral">
              {item.year}{' '}
              <strong className="ml-1">{item.total.toFixed(2)}</strong>
            </div>
          ))}
        </div>
        {calculationError && (
          <p role="alert" className="px-3 py-2 text-xs text-destructive">
            {calculationError}
          </p>
        )}
        <p className="border-b px-3 py-2 text-xs text-muted-foreground">
          UnitPrice = CT + SPMS（单台年度价格）；Yearly = UnitPrice × QTY；Total
          = Yearly × Duration（年）。各项可留空；History
          仅供价格对比。拖动列边界调整列宽，行末底边调整行高，也可聚焦后使用方向键。
        </p>
        <details className="bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">
            从产品 BOQ Excel 导入设备
          </summary>
          <fieldset disabled={busy} className="space-y-2 pt-3">
            <Input
              type="file"
              aria-label="产品 BOQ Excel 文件"
              accept=".xlsx"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                setPreview([]);
                try {
                  const info = await inspectCostWorkbook(
                    new Uint8Array(await f.arrayBuffer()),
                  );
                  setFile(f);
                  setSheets(info.sheets.map((s) => s.name));
                  setSheet(info.sheets[0]?.name || '');
                } catch (error) {
                  announce(String(error));
                } finally {
                  setBusy(false);
                }
              }}
            />
            <div className="grid gap-3 md:grid-cols-5">
              <label className="block space-y-1 text-xs font-medium">
                工作表
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setPreview([]);
                  }}
                  className="block h-8 w-full rounded-md border border-input bg-card px-2.5 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              {[
                [header, setHeader, '表头行'],
                [modelCol, setModelCol, '型号列号'],
                [qtyCol, setQtyCol, '数量列号'],
              ].map(([n, set, label]) => (
                <label
                  className="block space-y-1 text-xs font-medium"
                  key={String(label)}
                >
                  {String(label)}
                  <Input
                    type="number"
                    value={n as number}
                    onChange={(e) => {
                      (set as (n: number) => void)(Number(e.target.value));
                      setPreview([]);
                    }}
                  />
                </label>
              ))}
              <label className="block space-y-1 text-xs font-medium">
                排除行号
                <Input
                  value={excluded}
                  onChange={(e) => {
                    setExcluded(e.target.value);
                    setPreview([]);
                  }}
                />
              </label>
            </div>
            <Button
              variant="outline"
              disabled={!file || busy}
              onClick={async () => {
                if (!file) return;
                setBusy(true);
                try {
                  setPreview(
                    await importBoq(
                      new Uint8Array(await file.arrayBuffer()),
                      file.name,
                      {
                        sheet,
                        headerRow: header,
                        modelColumn: modelCol,
                        quantityColumn: qtyCol,
                        excludeRows: excluded
                          .split(/[,，]/)
                          .filter((s) => s.trim())
                          .map(Number),
                      },
                    ),
                  );
                } catch (e) {
                  announce(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              预览 BOQ
            </Button>
            {preview.length > 0 && (
              <>
                <div className="max-h-40 overflow-auto text-sm">
                  {preview.map((r) => (
                    <p key={r.id}>
                      {r.model} · {r.quantity} 台
                    </p>
                  ))}
                </div>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    if (importing.current || !file) return;
                    importing.current = true;
                    setBusy(true);
                    try {
                      if (canApply && !canApply())
                        throw new Error(
                          'Wait for the current project operation before importing.',
                        );
                      if (
                        preview.some((r) =>
                          latest.current.boq.some(
                            (x) => x.source === r.source || x.id === r.id,
                          ),
                        )
                      )
                        throw new Error('这些BOQ行已经导入');
                      await archiveProjectFile(projectId, file, {
                        category: 'source',
                      });
                      if (!mounted.current) return;
                      if (canApply && !canApply())
                        throw new Error(
                          'Source file archived. Project is switching; reopen the import to apply its BOQ rows.',
                        );
                      onChange((current) => {
                        try {
                          if (canApply && !canApply())
                            throw new Error(
                              'Project changed before the BOQ import could be applied.',
                            );
                          return {
                            ...current,
                            boq: appendBoq(current.boq, preview),
                          };
                        } catch (error) {
                          queueMicrotask(() =>
                            announce(
                              `Source file archived; BOQ import was not applied: ${String(error)}`,
                            ),
                          );
                          return current;
                        }
                      });
                      setPreview([]);
                    } catch (error) {
                      if (mounted.current) announce(String(error));
                    } finally {
                      importing.current = false;
                      if (mounted.current) setBusy(false);
                    }
                  }}
                >
                  导入已预览的设备
                </Button>
              </>
            )}
          </fieldset>
        </details>
      </section>
      {/* One grid keeps equipment inputs aligned; reference context remains beside each row. */}
      <section className="wb-panel overflow-hidden">
        <div className="wb-toolbar justify-between border-b">
          <h2 className="text-sm font-semibold text-primary">设备明细</h2>
          <span className="text-xs text-muted-foreground">
            {value.boq.length} 条设备记录
          </span>
        </div>
        <MaintenanceGrid
          rows={value.boq}
          totals={
            new Map(
              summary?.lines.map((line) => [line.boq.id, line.quote]) ?? [],
            )
          }
          records={records}
          onPatch={update}
          disabled={busy}
          onDelete={(id) => {
            if (busy || (canApply && !canApply())) return;
            onChange({
              ...value,
              boq: value.boq.filter((row) => row.id !== id),
            });
          }}
        />
      </section>

      {value.archives.length > 0 && (
        <section className="wb-panel overflow-hidden">
          <div className="wb-toolbar border-b">
            <h2 className="text-sm font-semibold text-primary">维保配置历史</h2>
            <span className="text-xs text-muted-foreground">
              {value.archives.length} 条归档
            </span>
          </div>
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>归档日期</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>维保期限</TableHead>
                <TableHead className="text-right">报价 SGD</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...value.archives].reverse().map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.createdAt.slice(0, 10)}</TableCell>
                  <TableCell>{a.client}</TableCell>
                  <TableCell className="financial-numeral">
                    {a.pricingMode === 'components'
                      ? `${a.startYear} · ${Math.max(0, ...a.lines.map((line) => line.boq.durationYears ?? 0))} 年`
                      : `${a.coverageMonths} 月（旧归档）`}
                  </TableCell>
                  <TableCell className="financial-numeral text-right">
                    {a.quote.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void download(a.id)}
                    >
                      导出维保草稿 Excel
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}
