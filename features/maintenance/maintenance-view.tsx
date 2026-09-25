'use client';
import { exportTimestamp } from '../../lib/file-names';
import { Fragment, useState, useRef, useEffect } from 'react';
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
  maintenanceCandidates,
  importBoq,
  buildMaintenanceWorkbook,
  type MaintenanceWorkspace,
  type BoqLine,
} from './domain';
/** Keeps BOQ quantities, reference selection and draft actions in one compact workspace. */
export function MaintenanceView({
  projectId,
  canApply,
  value,
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
  const update = (id: string, patch: Partial<BoqLine>) =>
    onChange({
      ...value,
      boq: value.boq.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    });
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
        {/* Keep the frequently edited coverage period beside the BOQ title. */}
        <div className="wb-toolbar justify-between border-b">
          <h2 className="text-sm font-semibold text-primary">BOQ 维保配置</h2>
          <label className="flex flex-wrap items-center gap-2 text-xs">
            维保期限（月）
            <Input
              type="number"
              className="h-8 w-24"
              value={value.coverageMonths}
              onChange={(e) =>
                onChange({ ...value, coverageMonths: Number(e.target.value) })
              }
            />
          </label>
          {/* Calculation and archive stay available above long BOQ lists. */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  boq: [
                    ...value.boq,
                    {
                      id: crypto.randomUUID(),
                      model: '',
                      quantity: 1,
                      serviceLevel: '',
                      site: '',
                      referenceId: '',
                      unitAnnualQuote: 0,
                      basis: '',
                      source: 'Manual BOQ',
                    },
                  ],
                })
              }
            >
              手工添加设备
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                attempt(() => {
                  const r = calculateMaintenance(value, records);
                  announce(
                    `维保报价草稿 SGD ${r.quote.toFixed(2)}；历史成本推算 SGD ${r.cost.toFixed(2)}。请核实差异依据。`,
                  );
                })
              }
            >
              计算维保草稿
            </Button>
            <Button
              onClick={() =>
                attempt(() => {
                  onChange(archiveMaintenance(value, records, client));
                  announce('已归档BOQ、参考价格、选价依据与计算结果');
                })
              }
            >
              归档配置
            </Button>
          </div>
        </div>

        <details className="border-b bg-muted/10 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            维保参考与报价说明
          </summary>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            按同型号查看各客户历史单台年价，选择参考后填写本次
            SLA、年价与选价依据。 输出为维保报价草稿，正式报价仍需整理税费、T&C
            并完成公司决策。
          </p>
        </details>
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
        <Table className="min-w-[1020px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">设备型号</TableHead>
              <TableHead className="w-28 text-right">BOQ 实际数量</TableHead>
              <TableHead className="w-36">本次 SLA</TableHead>
              <TableHead className="w-32">站点</TableHead>
              <TableHead className="w-40 text-right">
                本次单台年价 SGD
              </TableHead>
              <TableHead>选价依据及差异（期限、SLA、客户折扣等）</TableHead>
              <TableHead className="w-28">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!value.boq.length && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="h-20 whitespace-normal text-center text-xs text-muted-foreground"
                >
                  暂无设备。手工添加设备，或从产品 BOQ Excel 导入。
                </TableCell>
              </TableRow>
            )}
            {value.boq.map((row) => (
              <Fragment key={row.id}>
                <TableRow>
                  {(['model', 'quantity', 'serviceLevel', 'site'] as const).map(
                    (k, i) => (
                      <TableCell key={k}>
                        <Input
                          aria-label={
                            ['设备型号', 'BOQ 实际数量', '本次 SLA', '站点'][i]
                          }
                          className={`h-8 text-xs ${k === 'quantity' ? 'financial-numeral text-right' : k === 'model' ? 'font-semibold' : ''}`}
                          type={k === 'quantity' ? 'number' : 'text'}
                          value={row[k]}
                          onChange={(e) =>
                            update(row.id, {
                              [k]:
                                k === 'quantity'
                                  ? Number(e.target.value)
                                  : e.target.value,
                            })
                          }
                        />
                      </TableCell>
                    ),
                  )}
                  <TableCell>
                    <Input
                      aria-label="本次单台年价 SGD"
                      className="financial-numeral h-8 text-right text-xs"
                      type="number"
                      value={row.unitAnnualQuote}
                      onChange={(e) =>
                        update(row.id, {
                          unitAnnualQuote: Number(e.target.value),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label="选价依据及差异（期限、SLA、客户折扣等）"
                      className="h-8 min-w-60 text-xs"
                      value={row.basis}
                      onChange={(e) =>
                        update(row.id, { basis: e.target.value })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        onChange({
                          ...value,
                          boq: value.boq.filter((r) => r.id !== row.id),
                        })
                      }
                    >
                      移除设备行
                    </Button>
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/20 hover:bg-muted/30">
                  <TableCell colSpan={7} className="whitespace-normal">
                    <div className="grid items-center gap-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                      <label className="flex min-w-0 items-center gap-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">
                          同型号的客户历史参考
                        </span>
                        <select
                          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                          value={row.referenceId}
                          onChange={(e) => {
                            const ref = maintenanceCandidates(
                              records,
                              row.model,
                            ).find((x) => x.record.id === e.target.value);
                            update(row.id, {
                              referenceId: e.target.value,
                              unitAnnualQuote: ref?.unitAnnualQuote || 0,
                            });
                          }}
                        >
                          <option value="">选择历史记录</option>
                          {maintenanceCandidates(records, row.model).map(
                            ({ record: r, unitAnnualQuote: q }) => (
                              <option key={r.id} value={r.id}>
                                {r.client} · SGD {q}/台/年 · {r.serviceLevel} ·{' '}
                                {r.quoteDate} · {r.source}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <p className="break-words text-xs text-muted-foreground">
                        来源：{row.source}
                        {row.originalQuantity !== undefined &&
                        (row.originalQuantity !== row.quantity ||
                          row.originalModel !== row.model)
                          ? `（已手工修订，原型号 ${row.originalModel}，原数量 ${row.originalQuantity}）`
                          : ''}
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
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
                <TableHead>期限（月）</TableHead>
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
                    {a.coverageMonths}
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
