'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { inspectCostWorkbook } from '@/features/cost/import-workbook';
import type { MaintenancePriceRecord } from '@/features/master-data/domain';
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
export function MaintenanceView({
  value,
  onChange,
  records,
  client,
  announce,
}: {
  value: MaintenanceWorkspace;
  onChange: (v: MaintenanceWorkspace) => void;
  records: MaintenancePriceRecord[];
  client: string;
  announce: (s: string) => void;
}) {
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
      const a = value.archives.find((x) => x.id === id)!;
      const bytes = await buildMaintenanceWorkbook(a);
      const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes).buffer], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          }),
        ),
        link = document.createElement('a');
      link.href = url;
      link.download = `Maintenance_${id}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      announce(String(e));
    }
  };
  return (
    <div className="space-y-4">
      <section className="space-y-3 rounded border bg-card p-5">
        <h2 className="font-semibold">BOQ 维保配置</h2>
        <p className="text-sm text-muted-foreground">
          按同型号查看各客户历史单台年价，选择参考后填写本次
          SLA、年价与选价依据。输出为维保报价草稿，正式报价仍需整理税费、T&C
          并完成公司决策。
        </p>
        <label className="text-sm">
          维保期限（月）
          <Input
            type="number"
            className="w-40"
            value={value.coverageMonths}
            onChange={(e) =>
              onChange({ ...value, coverageMonths: Number(e.target.value) })
            }
          />
        </label>
        <details>
          <summary className="cursor-pointer text-sm">
            从产品 BOQ Excel 导入设备
          </summary>
          <fieldset disabled={busy} className="space-y-2 pt-3">
            <Input
              type="file"
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
            <div className="grid gap-2 md:grid-cols-5">
              <label>
                工作表
                <select
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setPreview([]);
                  }}
                  className="block h-9 w-full border"
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
                <label key={String(label)}>
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
              <label>
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
                  onClick={() =>
                    attempt(() => {
                      if (
                        preview.some((r) =>
                          value.boq.some(
                            (x) => x.source === r.source || x.id === r.id,
                          ),
                        )
                      )
                        throw new Error('这些BOQ行已经导入');
                      onChange({
                        ...value,
                        boq: appendBoq(value.boq, preview),
                      });
                      setPreview([]);
                    })
                  }
                >
                  导入已预览的设备
                </Button>
              </>
            )}
          </fieldset>
        </details>
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
      </section>
      {value.boq.map((row) => (
        <section key={row.id} className="space-y-3 rounded border bg-card p-4">
          <div className="grid gap-3 md:grid-cols-4">
            {(['model', 'quantity', 'serviceLevel', 'site'] as const).map(
              (k, i) => (
                <label className="text-sm" key={k}>
                  {['设备型号', 'BOQ 实际数量', '本次 SLA', '站点'][i]}
                  <Input
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
                </label>
              ),
            )}
          </div>
          <label className="block text-sm">
            同型号的客户历史参考
            <select
              className="mt-1 block h-9 w-full border bg-background"
              value={row.referenceId}
              onChange={(e) => {
                const ref = maintenanceCandidates(records, row.model).find(
                  (x) => x.record.id === e.target.value,
                );
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
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              本次单台年价 SGD
              <Input
                type="number"
                value={row.unitAnnualQuote}
                onChange={(e) =>
                  update(row.id, { unitAnnualQuote: Number(e.target.value) })
                }
              />
            </label>
            <label className="text-sm md:col-span-2">
              选价依据及差异（期限、SLA、客户折扣等）
              <Input
                value={row.basis}
                onChange={(e) => update(row.id, { basis: e.target.value })}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            来源：{row.source}
            {row.originalQuantity !== undefined &&
            (row.originalQuantity !== row.quantity ||
              row.originalModel !== row.model)
              ? `（已手工修订，原型号 ${row.originalModel}，原数量 ${row.originalQuantity}）`
              : ''}
          </p>
          <Button
            variant="ghost"
            onClick={() =>
              onChange({
                ...value,
                boq: value.boq.filter((r) => r.id !== row.id),
              })
            }
          >
            移除设备行
          </Button>
        </section>
      ))}
      <div className="flex gap-2">
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
      {value.archives.length > 0 && (
        <section className="space-y-2 rounded border bg-card p-4">
          <h2 className="font-semibold">维保配置历史</h2>
          {[...value.archives].reverse().map((a) => (
            <div
              key={a.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span>
                {a.createdAt.slice(0, 10)} · {a.client} · {a.coverageMonths} 月
                · SGD {a.quote.toFixed(2)}
              </span>
              <Button variant="outline" onClick={() => void download(a.id)}>
                导出维保草稿 Excel
              </Button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
