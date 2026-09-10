'use client';
/** Reusable workbook-column mapping; no changes are applied until preview succeeds. */
import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { BusinessUnitSelect } from '@/features/master-data/business-unit-select';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  applyCostImport,
  inspectCostWorkbook,
  previewCostImport,
  type CostImportMapping,
  type ImportPreview,
} from '../import-workbook';
import type { CostInputRow, RateSettings, ResourceType } from '../domain';
import { archiveProjectFile } from '@/features/projects/project-files';
const fields = [
  'scope',
  'bu',
  'resource',
  'mandays',
  'sites',
  'mdPerSite',
  'cost',
] as const;
export function CostImportPanel({
  projectId,
  versionCode,
  announce,
  canApply,
  rows,
  setRows,
  resources,
  rates,
  onClose,
}: {
  projectId?: string;
  versionCode?: string;
  announce?: (message: string) => void;
  canApply?: () => boolean;
  rows: CostInputRow[];
  setRows: React.Dispatch<React.SetStateAction<CostInputRow[]>>;
  resources: ResourceType[];
  rates: RateSettings;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [info, setInfo] = useState<Awaited<
      ReturnType<typeof inspectCostWorkbook>
    > | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [excludeText, setExcludeText] = useState('');
  const requestSeq = useRef(0);
  const importing = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ rows, resources, rates });
  useEffect(() => {
    latest.current = { rows, resources, rates };
  }, [rows, resources, rates]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [mapping, setMapping] = useState<CostImportMapping>({
    sheet: '',
    headerRow: 1,
    role: 'TD',
    mode: 'mandays',
    year: 'Y1',
    columns: {
      scope: 1,
      bu: 0,
      resource: 0,
      mandays: 2,
      sites: 0,
      mdPerSite: 0,
      cost: 0,
    },
    defaultBu: '',
    defaultResource: '',
  });
  const change = (patch: Partial<CostImportMapping>) => {
    requestSeq.current++;
    setMapping({ ...mapping, ...patch });
    setPreview(null);
  };
  return (
    <section className="space-y-3 rounded-lg border p-4 text-sm">
      <div className="flex justify-between">
        <h3 className="font-semibold">TD / PM Excel Import · 字段映射与预览</h3>
        <Button variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </div>
      <Input
        type="file"
        accept=".xlsx"
        disabled={busy}
        onChange={async (e) => {
          const selected = e.target.files?.[0];
          if (!selected) return;
          setFile(selected);
          setPreview(null);
          setBusy(true);
          setError('');
          try {
            const parsed = await inspectCostWorkbook(
              new Uint8Array(await selected.arrayBuffer()),
            );
            setInfo(parsed);
            setMapping({ ...mapping, sheet: parsed.sheets[0]?.name || '' });
          } catch (err) {
            setError(String(err));
          } finally {
            setBusy(false);
          }
        }}
      />
      {info && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <label>
              Worksheet / 工作表
              <Select
                value={mapping.sheet}
                onValueChange={(v) => change({ sheet: v || '' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {info.sheets.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label>
              Header row / 表头行
              <Input
                type="number"
                min="1"
                value={mapping.headerRow}
                onChange={(e) => change({ headerRow: Number(e.target.value) })}
              />
            </label>
            <label>
              最后数据行（留空到表尾）
              <Input
                type="number"
                value={mapping.endRow || ''}
                onChange={(e) =>
                  change({
                    endRow: e.target.value ? Number(e.target.value) : undefined,
                  })
                }
              />
            </label>
            <label>
              排除行号（合计等，用逗号分隔）
              <Input
                value={excludeText}
                onChange={(e) => {
                  setExcludeText(e.target.value);
                  requestSeq.current++;
                  setPreview(null);
                }}
                onBlur={() =>
                  change({
                    excludeRows: excludeText
                      .split(/[,，]/)
                      .filter((x) => x.trim())
                      .map(Number),
                  })
                }
              />
            </label>
            <label>
              Source / 来源
              <Select
                value={mapping.role}
                onValueChange={(v) => change({ role: v as 'TD' | 'PM' })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TD">TD</SelectItem>
                  <SelectItem value="PM">PM</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label>
              Effort mode / 人天模式
              <Select
                value={mapping.mode}
                onValueChange={(v) =>
                  change({ mode: v as 'sites' | 'mandays' })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mandays">总人天 / Direct MD</SelectItem>
                  <SelectItem value="sites">Sites × MD/Site</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label>
              Year / 分配年度
              <Select
                value={mapping.year}
                onValueChange={(v) =>
                  change({ year: v as CostImportMapping['year'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {['Y1', 'Y2', 'Y3', 'Y4', 'Y5'].map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label
              htmlFor={`cost-import-bu-${projectId || 'local'}-${versionCode || 'draft'}`}
            >
              Default BU / 默认领域
              <BusinessUnitSelect
                aria-label="Import default BU"
                id={`cost-import-bu-${projectId || 'local'}-${versionCode || 'draft'}`}
                value={mapping.defaultBu}
                disabled={busy}
                onChange={(e) => change({ defaultBu: e.target.value })}
              />
            </label>
            <label>
              Default RE Type / 默认资源
              <Select
                value={mapping.defaultResource}
                onValueChange={(v) => change({ defaultResource: v || '' })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择资源" />
                </SelectTrigger>
                <SelectContent>
                  {resources
                    .filter((r) => r.active)
                    .map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.code}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </label>
          </div>
          <p className="text-muted-foreground">
            使用列编号（A=1，B=2）；0 表示未映射。原表有公式时需先在 Excel
            计算并保存。内部人力按当前版本费率计算，分包保留原表成本。
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {fields.map((key, i) => (
              <label key={key}>
                {
                  [
                    'Scope',
                    'BU',
                    'RE Type code',
                    '总人天 MD',
                    'Sites',
                    'MD/Site',
                    'Cost',
                  ][i]
                }
                <Input
                  type="number"
                  min="0"
                  max="200"
                  value={mapping.columns[key]}
                  onChange={(e) =>
                    change({
                      columns: {
                        ...mapping.columns,
                        [key]: Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <p className="text-muted-foreground">
            最近预览表头列名：
            {info.sheets
              .find((s) => s.name === mapping.sheet)
              ?.columns.map((c) => `${c.column}: ${c.header}`)
              .join(' · ')}
          </p>
          <Button
            disabled={busy || !file}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              setError('');
              const seq = ++requestSeq.current;
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                const next = await previewCostImport(
                  bytes,
                  file.name,
                  mapping,
                  resources,
                  rates,
                );
                if (seq === requestSeq.current) {
                  setPreview(next);
                  setInfo(await inspectCostWorkbook(bytes, mapping.headerRow));
                }
              } catch (err) {
                setError(String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Preview / 预览导入
          </Button>
        </>
      )}
      {preview && (
        <div className="space-y-2">
          <p>
            {preview.rows.length} 行 · 成本{' '}
            {preview.rows
              .reduce(
                (sum, row) => sum + row.years.reduce((a, y) => a + y.cost, 0),
                0,
              )
              .toFixed(2)}
          </p>
          <div className="max-h-52 overflow-auto">
            {preview.rows.map((row) => (
              <p key={row.id}>
                {row.source?.row} · {row.scope} · {row.bu} ·{' '}
                {row.years.reduce(
                  (sum, y) => sum + (y.mandays ?? y.sites * row.mdPerSite),
                  0,
                )}{' '}
                MD
              </p>
            ))}
            {preview.issues.map((issue) => (
              <p className="text-red-700" key={issue}>
                {issue}
              </p>
            ))}
          </div>
          <Button
            disabled={busy || preview.issues.length > 0}
            onClick={async () => {
              if (importing.current || !file) return;
              importing.current = true;
              const seq = requestSeq.current;
              setBusy(true);
              setError('');
              try {
                if (canApply && !canApply())
                  throw new Error(
                    'Wait for the current project operation before importing.',
                  );
                applyCostImport(rows, preview, { resources, rates });
                if (projectId)
                  await archiveProjectFile(projectId, file, {
                    category: 'source',
                    versionCode,
                  });
                if (!mounted.current) return;
                if (canApply && !canApply())
                  throw new Error(
                    'Source file archived. Project or version is switching; reopen the import after switching to apply its rows.',
                  );
                if (seq !== requestSeq.current)
                  throw new Error(
                    'The table mapping changed. The source file is archived; refresh the preview before importing.',
                  );
                const current = latest.current;
                setRows((currentRows) => {
                  try {
                    if (canApply && !canApply())
                      throw new Error(
                        'Project or version changed before the import could be applied.',
                      );
                    return applyCostImport(currentRows, preview, {
                      resources: current.resources,
                      rates: current.rates,
                    });
                  } catch (error) {
                    queueMicrotask(() =>
                      announce?.(
                        `Source file archived; cost import was not applied: ${error instanceof Error ? error.message : String(error)}`,
                      ),
                    );
                    return currentRows;
                  }
                });
                onClose();
              } catch (err) {
                if (mounted.current) {
                  setError(String(err));
                  announce?.(err instanceof Error ? err.message : String(err));
                }
              } finally {
                importing.current = false;
                if (mounted.current) setBusy(false);
              }
            }}
          >
            Import all rows / 整批导入
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
