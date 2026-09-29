'use client';
/** Upload source evidence first, then require explicit confirmation before changing maintenance prices. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableCell,
  TableRow,
} from '@/components/ui/table';
import { ProjectFileDropzone } from '../projects/project-files-panel';
import {
  archiveProjectFile,
  listProjectFiles,
  openArchiveFolder,
  projectFileDownloadUrl,
  type ProjectFileRecord,
} from '../projects/project-files';
import {
  inspectServiceQuote,
  mergeServiceQuoteItems,
  inferredNodeCounts,
  serviceQuoteGroups,
  serviceQuoteLines,
  type ServiceQuotePreview,
  type ServiceQuotePart,
} from './import-service-quote';
import type { BoqLine } from './domain';
import { roundMoney } from '../cost/domain';
export function ServiceQuoteImport({
  projectId,
  versionCode,
  onSave,
  canApply,
  onImport,
  onBusy,
  announce,
}: {
  projectId: string;
  versionCode: string;
  onSave: () => Promise<boolean>;
  canApply?: () => boolean;
  onImport: (rows: BoqLine[], startYear: number) => void;
  onBusy: (value: boolean) => void;
  announce: (message: string) => void;
}) {
  const [files, setFiles] = useState<ProjectFileRecord[]>([]),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ServiceQuotePreview | null>(null),
    [parts, setParts] = useState<ServiceQuotePart[]>([]),
    [duration, setDuration] = useState(1),
    [startYear, setStartYear] = useState(new Date().getFullYear()),
    [yearsConfirmed, setYearsConfirmed] = useState(false),
    [discountConfirmed, setDiscountConfirmed] = useState(false),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [error, setError] = useState('');
  const [mergeRows, setMergeRows] = useState<number[]>([]);
  const [groupEditing, setGroupEditing] = useState(false);
  const [platformName, setPlatformName] = useState('');
  const [platformQuantity, setPlatformQuantity] = useState('');
  const [mergeUndo, setMergeUndo] = useState<
    { parts: ServiceQuotePart[]; counts: Record<string, number> }[]
  >([]);
  const picker = useRef<HTMLInputElement>(null),
    mounted = useRef(true),
    uploading = useRef(false);
  /** List evidence belonging to this independent maintenance version. */
  const refresh = useCallback(async () => {
    try {
      const archive = await listProjectFiles(projectId, {
        category: 'maintenance',
      });
      if (mounted.current)
        setFiles(
          archive.files.filter(
            (file) => (file.versionCode ?? 'MV1') === versionCode,
          ),
        );
    } catch (error) {
      if (mounted.current) setError(String(error));
    }
  }, [projectId, versionCode]);
  useEffect(() => {
    mounted.current = true;
    void Promise.resolve().then(refresh);
    return () => {
      mounted.current = false;
    };
  }, [refresh]);
  /** An uploaded file remains available as evidence even when its contents need correction. */
  const upload = async (selected: File[]) => {
    if (uploading.current || (canApply && !canApply())) return;
    if (
      selected.length !== 1 ||
      !selected[0].name.toLowerCase().endsWith('.xlsx')
    ) {
      setError('每次请上传一个 .xlsx 报价文件');
      return;
    }
    const file = selected[0];
    uploading.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (!(await onSave())) throw new Error('请先保存当前维保版本');
      if (!mounted.current || (canApply && !canApply())) return;
      await archiveProjectFile(projectId, file, {
        category: 'maintenance',
        versionCode,
        requestId: crypto.randomUUID(),
      });
      if (!mounted.current) return;
      await refresh();
      const parsed = await inspectServiceQuote(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
      );
      if (!mounted.current || (canApply && !canApply())) return;
      setPreview(parsed);
      setParts(parsed.parts);
      setMergeRows([]);
      setGroupEditing(false);
      setPlatformName('');
      setPlatformQuantity('');
      setMergeUndo([]);
      setDuration(parsed.years.length || 1);
      setStartYear(new Date().getFullYear());
      setCounts(inferredNodeCounts(parsed.parts));
      setYearsConfirmed(false);
      setDiscountConfirmed(false);
      setOpen(true);
    } catch (error) {
      if (mounted.current) setError(String(error));
    } finally {
      uploading.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  const groups = serviceQuoteGroups(parts),
    hasDifference = parts.some(
      (part) =>
        part.lpb !== null &&
        part.customer !== null &&
        Math.abs(part.lpb - part.customer) > 0.011,
    );
  const total = (key: 'lpb' | 'customer' | 'computed') =>
    parts.reduce((sum, part) => sum + (part[key] ?? 0), 0).toFixed(2);
  return (
    <>
      <input
        type="file"
        ref={picker}
        accept=".xlsx"
        aria-label="Maintenance service quotation Excel"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) void upload(Array.from(event.target.files));
          event.target.value = '';
        }}
      />
      <ProjectFileDropzone
        title="导入 CT / SPMS 报价 Excel"
        target={`Maintenance / ${versionCode}`}
        versionCode={versionCode}
        dragging={dragging}
        uploading={busy}
        onDraggingChange={setDragging}
        onFiles={(selected) => void upload(selected)}
        onBrowse={() => picker.current?.click()}
        onRefresh={() => void refresh()}
      >
        <p className="text-xs text-muted-foreground">
          拖入报价文件，自动核对 LPB 与 Customer
          金额；确认年数、实际年份、设备型号和 Node 数量后导入。采用 Customer
          实际报价。
        </p>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
        {files.map((file) => (
          <div
            key={file.id}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <a
              className="underline"
              href={projectFileDownloadUrl(projectId, file.id)}
            >
              {file.originalName}
            </a>
            <span>{file.createdAt.slice(0, 10)}</span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void openArchiveFolder(projectId, file.id).catch((error) =>
                  announce(String(error)),
                )
              }
            >
              文件夹
            </Button>
          </div>
        ))}
      </ProjectFileDropzone>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-6xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>确认维保报价识别结果</DialogTitle>
            <DialogDescription>
              {preview?.fileName} · {preview?.sheet} · 识别年份：
              {preview?.years.join(', ') || '未识别'}（
              {preview?.years.length || 0} 年）。子项 Quantity 不等于实际 Node
              台数。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label>
              实际开始年份
              <Input
                aria-label="Confirmed maintenance start year"
                type="number"
                value={startYear}
                onChange={(event) => {
                  setStartYear(Number(event.target.value));
                  setYearsConfirmed(false);
                }}
              />
            </label>
            <label>
              实际年数
              <Input
                aria-label="Confirmed maintenance duration"
                type="number"
                value={duration}
                onChange={(event) => {
                  setDuration(Number(event.target.value));
                  setYearsConfirmed(false);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={yearsConfirmed}
                onChange={(event) => setYearsConfirmed(event.target.checked)}
              />{' '}
              已确认实际年份与年数
            </label>
          </div>
          <p className="text-xs">
            LPB 单价 × 数量：{total('computed')} · LPB 总额：{total('lpb')} ·
            Customer 总额：{total('customer')}
          </p>
          {hasDifference && (
            <label className="text-xs text-amber-800">
              <input
                type="checkbox"
                checked={discountConfirmed}
                onChange={(event) => setDiscountConfirmed(event.target.checked)}
              />{' '}
              已核对折扣／金额差异，采用 Customer 实际报价
            </label>
          )}
          <Table className="min-w-[1000px] text-xs">
            <TableHeader>
              <TableRow>
                {[
                  'Row',
                  'Node / Item',
                  'Node Info',
                  'Model',
                  'Service',
                  'Qty',
                  'LPB U/P',
                  'LPB Total',
                  'Customer',
                  'Diff %',
                  'Check',
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {parts.map((part, index) => (
                <TableRow key={part.row}>
                  <TableCell>{part.row}</TableCell>
                  <TableCell>{part.node}</TableCell>
                  <TableCell className="max-w-48 whitespace-pre-wrap">
                    {part.nodeInfo}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Model source row ${part.row}`}
                      value={part.model}
                      onChange={(event) =>
                        setParts((current) =>
                          current.map((row, i) =>
                            i === index
                              ? { ...row, model: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Service source row ${part.row}`}
                      value={part.service ?? ''}
                      disabled={preview?.parts[index]?.service != null}
                      onChange={(event) =>
                        setParts((current) =>
                          current.map((row, i) =>
                            i === index
                              ? {
                                  ...row,
                                  service: event.target.value as 'CT' | 'SPMS',
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      <option value="">请选择</option>
                      <option>CT</option>
                      <option>SPMS</option>
                    </select>
                  </TableCell>
                  <TableCell>{part.quantity}</TableCell>
                  <TableCell>{part.unitPrice?.toFixed(2) ?? '—'}</TableCell>
                  <TableCell>{part.lpb?.toFixed(2) ?? '—'}</TableCell>
                  <TableCell>{part.customer?.toFixed(2) ?? '—'}</TableCell>
                  <TableCell>
                    {part.lpb && part.customer !== null
                      ? ((1 - part.customer / part.lpb) * 100).toFixed(2)
                      : '—'}
                  </TableCell>
                  <TableCell className="whitespace-normal text-destructive">
                    {part.issue}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <fieldset className="space-y-2 rounded border p-3">
            <legend className="px-1 text-xs font-medium">
              合并识别条目 / 平台维保
            </legend>
            <p className="text-xs text-muted-foreground">
              在下方设备名前勾选，再点击 Group。所选设备的 CT、SPMS
              分别汇总；组名作为 Model 导入，原始成员写入
              Desc.，平台数量必须重新确认。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={
                  groups.filter((group) =>
                    group.rows.every((row) => mergeRows.includes(row)),
                  ).length < 2
                }
                onClick={() => setGroupEditing(true)}
              >
                Group / 分组
              </Button>
              {groupEditing && (
                <>
                  <Input
                    aria-label="合并后的平台名称"
                    placeholder="平台名称"
                    value={platformName}
                    onChange={(event) => setPlatformName(event.target.value)}
                    className="w-60"
                  />
                  <Input
                    aria-label="合并后的平台数量"
                    placeholder="平台 QTY（必填）"
                    inputMode="numeric"
                    value={platformQuantity}
                    onChange={(event) =>
                      setPlatformQuantity(event.target.value)
                    }
                    className="w-40"
                  />
                  <Button
                    variant="outline"
                    disabled={mergeRows.length < 2}
                    onClick={() => {
                      try {
                        const merged = mergeServiceQuoteItems(
                          parts,
                          mergeRows,
                          platformName,
                          Number(platformQuantity),
                        );
                        setMergeUndo((current) => [
                          ...current,
                          {
                            parts: structuredClone(parts),
                            counts: { ...counts },
                          },
                        ]);
                        setParts(merged.parts);
                        setCounts((current) => ({
                          ...current,
                          [merged.key]: merged.quantity,
                        }));
                        setMergeRows([]);
                        setGroupEditing(false);
                        setPlatformName('');
                        setPlatformQuantity('');
                        setError('');
                      } catch (error) {
                        setError(String(error));
                      }
                    }}
                  >
                    确认分组
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                disabled={!mergeUndo.length}
                onClick={() => {
                  const previous = mergeUndo.at(-1)!;
                  setParts(previous.parts);
                  setCounts(previous.counts);
                  setMergeUndo((current) => current.slice(0, -1));
                  setMergeRows([]);
                  setError('');
                }}
              >
                撤销合并
              </Button>
            </div>
          </fieldset>
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                {[
                  '选择',
                  'Model',
                  'CT',
                  'SPMS',
                  'U/P',
                  'QTY',
                  'Yearly',
                  'Dur.',
                  'Total',
                ].map((label) => (
                  <TableHead key={label}>{label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => {
                const quantity = counts[group.key];
                const valid =
                  Number.isInteger(quantity) && quantity > 0 && duration > 0;
                const ct = valid
                  ? roundMoney(group.ct / duration / quantity)
                  : 0;
                const spms = valid
                  ? roundMoney(group.spms / duration / quantity)
                  : 0;
                const unit = roundMoney(ct + spms);
                const yearly = roundMoney(unit * (quantity || 0));
                const members = [
                  ...new Set(
                    parts
                      .filter(
                        (part) =>
                          group.rows.includes(part.row) && part.originalModel,
                      )
                      .map((part) => `${part.service}: ${part.originalModel}`),
                  ),
                ];
                return (
                  <TableRow key={group.key}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Group ${group.model}`}
                        checked={group.rows.every((row) =>
                          mergeRows.includes(row),
                        )}
                        onChange={(event) => {
                          setGroupEditing(false);
                          setMergeRows((current) =>
                            event.target.checked
                              ? [...new Set([...current, ...group.rows])]
                              : current.filter(
                                  (row) => !group.rows.includes(row),
                                ),
                          );
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {group.model}
                      {members.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-xs">
                            组合成员 ({members.length})
                          </summary>
                          <div className="whitespace-pre-line text-xs">
                            {members.join('\n')}
                          </div>
                        </details>
                      )}
                    </TableCell>
                    <TableCell>{valid ? ct.toFixed(2) : '—'}</TableCell>
                    <TableCell>{valid ? spms.toFixed(2) : '—'}</TableCell>
                    <TableCell>{valid ? unit.toFixed(2) : '—'}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Node quantity ${group.model}`}
                        inputMode="numeric"
                        value={counts[group.key] ?? ''}
                        onChange={(event) =>
                          setCounts((current) => ({
                            ...current,
                            [group.key]: Number(event.target.value),
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>{valid ? yearly.toFixed(2) : '—'}</TableCell>
                    <TableCell>{duration}</TableCell>
                    <TableCell>
                      {valid ? roundMoney(yearly * duration).toFixed(2) : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            年度单台价格向上取整到两位小数；由此产生的分差不会改写原
            Excel。确认导入将追加到当前版本。Node
            数量仅在各年度子项一致时预填；请核实后再确认。
          </p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!yearsConfirmed || busy || !preview}
              onClick={() => {
                try {
                  if (canApply && !canApply()) return;
                  if (
                    !Number.isInteger(startYear) ||
                    startYear < 1900 ||
                    startYear + duration - 1 > 9999
                  )
                    throw new Error('实际年份不正确');
                  const rows = serviceQuoteLines(
                    preview!,
                    parts,
                    duration,
                    counts,
                    discountConfirmed,
                  );
                  onImport(rows, startYear);
                  setOpen(false);
                } catch (error) {
                  setError(String(error));
                }
              }}
            >
              确认并导入
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
