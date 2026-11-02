'use client';

import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { formatMoney } from '@/lib/money';
import { ServiceQuoteImport } from './service-quote-import';
import {
  maintenanceVersionCode,
  selectMaintenanceVersion,
  createMaintenanceVersion,
  deleteMaintenanceVersion,
} from './versions';
import { MaintenanceSummary } from './maintenance-summary';
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
import { mergeMaintenanceBulkRows } from './bulk-entry';
/** Keeps BOQ quantities, reference selection and draft actions in one compact workspace. */
export function MaintenanceView({
  projectId,
  canApply,
  onSave,
  value: storedValue,
  onChange,
  records,
  client,
  announce,
}: {
  projectId: string;
  canApply?: () => boolean;
  onSave: () => Promise<boolean>;
  value: MaintenanceWorkspace;
  onChange: React.Dispatch<React.SetStateAction<MaintenanceWorkspace>>;
  records: MaintenancePriceRecord[];
  client: string;
  announce: (s: string) => void;
}) {
  const value = maintenanceGridDraft(storedValue);
  const versionCode = maintenanceVersionCode(value);
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
      if (!(value.deletedVersionCodes ?? []).includes(a.versionCode ?? 'MV1'))
        await archiveProjectFile(projectId, blob, {
          originalName: fileName,
          category: 'maintenance',
          versionCode: a.versionCode ?? 'MV1',
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
    <Surface as="div" variant="page">
      <Surface as="section" variant="panel" className="overflow-hidden">
        <Surface as="div" variant="toolbar" className="justify-between">
          <Text as="h2" tone="primary">
            设备明细 · BOQ 维保配置
          </Text>
          <div className="flex items-center gap-2">
            <SelectField
              aria-label="Maintenance version"
              disabled={busy}
              value={versionCode}
              onChange={(event) => {
                if (canApply && !canApply()) return;
                onChange(selectMaintenanceVersion(value, event.target.value));
                setPreview([]);
              }}
            >
              {[
                versionCode,
                ...(value.versions ?? []).map((version) => version.code),
              ]
                .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
                .map((code) => (
                  <option key={code}>{code}</option>
                ))}
            </SelectField>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                attempt(() => {
                  if (canApply && !canApply()) return;
                  onChange(createMaintenanceVersion(value, true));
                  setPreview([]);
                })
              }
            >
              复制新版本
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                attempt(() => {
                  if (canApply && !canApply()) return;
                  onChange(createMaintenanceVersion(value, false));
                  setPreview([]);
                })
              }
            >
              新建空白版本
            </Button>
            <Button
              variant="outline"
              disabled={busy || !value.versions?.length}
              title={
                !value.versions?.length
                  ? '至少保留一个维保版本'
                  : '删除当前版本及其文件夹'
              }
              onClick={async () => {
                if (busy || (canApply && !canApply())) return;
                if (
                  !window.confirm(
                    `删除 ${versionCode}？保存后将永久删除该版本的上传文件及文件夹，无法恢复。归档金额快照和 Master Data 历史参考保留。`,
                  )
                )
                  return;
                setBusy(true);
                try {
                  if (!(await onSave()))
                    throw new Error('请先保存当前维保版本');
                  if (!mounted.current || (canApply && !canApply())) return;
                  onChange((current) =>
                    deleteMaintenanceVersion(current, versionCode),
                  );
                  setPreview([]);
                  announce('版本已移除；保存成功后同步清理文件及文件夹。');
                } catch (error) {
                  announce(String(error));
                } finally {
                  if (mounted.current) setBusy(false);
                }
              }}
            >
              删除版本
            </Button>
          </div>
          <Surface
            as="label"
            variant="inline-field"
            textRole="body-small"
            className="flex items-center"
          >
            开始年份
            <Input
              aria-label="Maintenance start year"
              type="text"
              inputMode="numeric"
              className="w-24"
              value={value.startYear}
              disabled={busy}
              onChange={(event) => {
                if (canApply && !canApply()) return;
                if (/^\d{0,4}$/.test(event.target.value))
                  onChange({ ...value, startYear: Number(event.target.value) });
              }}
            />
          </Surface>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => addRows([newMaintenanceLine()])}
            >
              添加设备
            </Button>
            <MaintenanceBulkDialog
              disabled={busy}
              rows={value.boq}
              onImport={(edits, expected) => {
                if (
                  busy ||
                  (canApply && !canApply()) ||
                  JSON.stringify(latest.current.boq) !== expected
                )
                  return false;
                try {
                  const boq = mergeMaintenanceBulkRows(
                    latest.current.boq,
                    edits,
                  );
                  calculateComponentMaintenance({ ...latest.current, boq });
                  onChange({ ...latest.current, boq });
                  announce('维保设备已更新。');
                  return true;
                } catch (error) {
                  announce(String(error));
                  return false;
                }
              }}
            />
            <Button
              variant="outline"
              disabled={busy || !!calculationError}
              onClick={() =>
                attempt(() =>
                  announce(
                    `维保总价 SGD ${formatMoney(calculateMaintenance(value, records).quote)}`,
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
                  announce(
                    '已锁定归档；保存成功后自动加入 Master Data 维保历史。',
                  );
                })
              }
            >
              锁定并归档
            </Button>
          </div>
        </Surface>
        <MaintenanceSummary value={value} />
        {calculationError && (
          <Surface
            role="alert"
            as="p"
            variant="body"
            tone="danger"
            textRole="body-small"
          >
            {calculationError}
          </Surface>
        )}
        <Surface as="p" variant="item" tone="muted" textRole="body-small">
          UnitPrice = CT + SPMS（单台年度价格）；Yearly = UnitPrice × QTY；Total
          = Yearly × Duration（年）。各项可留空；History
          仅供价格对比。拖动列边界调整列宽，行末底边调整行高，也可聚焦后使用方向键。
        </Surface>
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
        <Disclosure>
          <DisclosureSummary className="cursor-pointer">
            从产品 BOQ Excel 导入设备
          </DisclosureSummary>
          <Surface
            disabled={busy}
            as="fieldset"
            variant="body"
            className="space-y-2"
          >
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
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                工作表
                <SelectField
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setPreview([]);
                  }}
                  className="block h-8 w-full"
                >
                  {sheets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </SelectField>
              </Surface>
              {[
                [header, setHeader, '表头行'],
                [modelCol, setModelCol, '型号列号'],
                [qtyCol, setQtyCol, '数量列号'],
              ].map(([n, set, label]) => (
                <Surface
                  as="label"
                  variant="field"
                  textRole="body-small"
                  className="block"
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
                </Surface>
              ))}
              <Surface
                as="label"
                variant="field"
                textRole="body-small"
                className="block"
              >
                排除行号
                <Input
                  value={excluded}
                  onChange={(e) => {
                    setExcluded(e.target.value);
                    setPreview([]);
                  }}
                />
              </Surface>
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
                <Surface
                  as="div"
                  textRole="body-main"
                  className="max-h-40 overflow-auto"
                >
                  {preview.map((r) => (
                    <p key={r.id}>
                      {r.model} · {r.quantity} 台
                    </p>
                  ))}
                </Surface>
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
          </Surface>
        </Disclosure>
      </Surface>
      <ServiceQuoteImport
        key={`${projectId}-${versionCode}`}
        projectId={projectId}
        versionCode={versionCode}
        onSave={onSave}
        canApply={canApply}
        onBusy={setBusy}
        announce={announce}
        onImport={(rows, startYear) => {
          if (canApply && !canApply()) throw new Error('项目正在切换');
          onChange({
            ...value,
            versionCode,
            startYear,
            boq: appendBoq(value.boq, rows),
          });
          announce('已导入当前维保版本，原 Excel 已保存至版本文件夹');
        }}
      />

      {value.archives.length > 0 && (
        <Surface as="section" variant="panel" className="overflow-hidden">
          <Surface as="div" variant="toolbar">
            <Text as="h2" tone="primary">
              维保配置历史
            </Text>
            <Text as="span" tone="muted" textRole="body-small">
              {value.archives.length} 条归档
            </Text>
          </Surface>
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead>归档日期</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>客户</TableHead>
                <TableHead>维保期限</TableHead>
                <TableHead variant="numeric" className="text-right">
                  报价 SGD
                </TableHead>
                <TableHead variant="numeric" className="text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...value.archives].reverse().map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    {a.createdAt.slice(0, 10)}
                    {a.deletedAt ? ' · 已删除' : ' · 已锁定'}
                  </TableCell>
                  <TableCell>{a.versionCode ?? 'MV1'}</TableCell>
                  <TableCell>{a.client}</TableCell>
                  <TableCell className="financial-numeral">
                    {a.pricingMode === 'components'
                      ? `${a.startYear} · ${Math.max(0, ...a.lines.map((line) => line.boq.durationYears ?? 0))} 年`
                      : `${a.coverageMonths} 月（旧归档）`}
                  </TableCell>
                  <TableCell
                    variant="numeric"
                    className="financial-numeral text-right"
                  >
                    {formatMoney(a.quote)}
                  </TableCell>
                  <TableCell variant="numeric" className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void download(a.id)}
                    >
                      导出维保草稿 Excel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        if (canApply && !canApply()) return;
                        onChange({
                          ...value,
                          archives: value.archives.map((archive) => {
                            if (archive.id !== a.id) return archive;
                            const next = { ...archive };
                            if (next.deletedAt) delete next.deletedAt;
                            else next.deletedAt = new Date().toISOString();
                            return next;
                          }),
                        });
                      }}
                    >
                      {a.deletedAt ? '恢复归档' : '删除归档'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Surface>
      )}
    </Surface>
  );
}
