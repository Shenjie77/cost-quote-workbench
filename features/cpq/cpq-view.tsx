'use client';

import { Surface, Text } from '@/components/ui/presentation';
import { formatMoney } from '@/lib/money';
/** Human-selected catalog mapping, deterministic allocation and local archive. */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CostVersionSnapshot } from '../cost/domain';
import {
  archiveCpq,
  calculationKey,
  confirmMapping,
  mappingKey,
  matchCatalog,
  solveCpq,
  type CatalogItem,
  type CpqWorkspace,
} from './domain';
import { downloadCpqArchive } from './export-workbook';

const money = formatMoney;
export function CpqView({
  projectId,
  value,
  onChange,
  baseline,
  totalCost,
  proposalNumber = '',
  onOpenCatalog,
  onApplyCatalog,
  catalogRevision,
  catalogApplyDisabled,
  announce,
}: {
  projectId: string;
  value: CpqWorkspace;
  onChange: (next: CpqWorkspace) => void;
  baseline: CostVersionSnapshot;
  totalCost: number;
  proposalNumber?: string;
  onOpenCatalog?: () => void;
  onApplyCatalog?: () => void;
  catalogRevision?: number;
  catalogApplyDisabled?: boolean;
  announce: (message: string) => void;
}) {
  const [showCatalog, setShowCatalog] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [confirmer, setConfirmer] = useState('SSR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const draft = value.draft;
  const update = (patch: Partial<typeof draft>) =>
    onChange({ ...value, draft: { ...draft, ...patch } });
  const run = (action: () => void) => {
    try {
      setError('');
      action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed');
    }
  };
  const candidates = useMemo(
    () => matchCatalog(value.catalog, draft.brief),
    [value.catalog, draft.brief],
  );
  const display = showAll
    ? value.catalog
        .filter((row) => row.active)
        .map((row) => ({ item: row, reason: 'Catalog / 手动选择', score: 0 }))
    : candidates;
  let confirmed = false,
    fresh = false;
  try {
    confirmed = draft.confirmation?.key === mappingKey(value);
    fresh = draft.result?.inputKey === calculationKey(value, baseline);
  } catch {
    /* Missing selected entries are shown in the selection table. */
  }
  const toggle = (catalog: CatalogItem, checked: boolean, reason: string) => {
    update({
      selections: checked
        ? [
            ...draft.selections,
            {
              code: catalog.code,
              quantity: catalog.referenceQty,
              locked: !catalog.adjustable || catalog.kind === 'equipment',
              weight:
                catalog.referenceQty > 0
                  ? catalog.unitCost * catalog.referenceQty
                  : 1,
              reason,
            },
          ]
        : draft.selections.filter((s) => s.code !== catalog.code),
    });
  };
  const selectionChange = (
    code: string,
    patch: Partial<(typeof draft.selections)[number]>,
  ) =>
    update({
      selections: draft.selections.map((s) =>
        s.code === code ? { ...s, ...patch } : s,
      ),
    });
  return (
    <Surface as="div" variant="page" textRole="body-main">
      <Surface as="div" variant="toolbar" className="justify-between">
        <Text as="p" tone="muted" textRole="body-small">
          输入简短范围，筛选条目后计算服务数量。设备数量保持固定。
        </Text>
        <Button variant="outline" onClick={() => setShowCatalog(!showCatalog)}>
          Catalog / 条目目录 ({value.catalog.length})
        </Button>
      </Surface>
      {showCatalog && (
        <Surface as="section" variant="panel" padded className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Text as="h2">
              Captured CPQ catalog / 项目采用的 CPQ 目录快照
            </Text>
            {onOpenCatalog && (
              <Button variant="outline" onClick={onOpenCatalog}>
                Maintain global catalog / 维护全局目录
              </Button>
            )}
          </div>
          <Text as="p" tone="muted" textRole="body-small">
            当前配置使用本项目保存的目录
            {catalogRevision === undefined
              ? ''
              : `（全局来源版本 r${catalogRevision}）`}
            ；全局维护不会自动改变该目录、配置数量或归档结果。
          </Text>
          {onApplyCatalog && (
            <Button
              variant="outline"
              disabled={catalogApplyDisabled}
              onClick={onApplyCatalog}
            >
              Apply global catalog to this draft / 将全局目录应用到本草稿
            </Button>
          )}
          <div className="min-w-0">
            <Table>
              <TableHeader>
                <TableRow>
                  {[
                    'Code / 编码',
                    'Scope / 范围',
                    'Unit',
                    'Unit cost',
                    'Kind',
                    'Adjustable',
                    'Revision',
                  ].map((label) => (
                    <TableHead key={label}>{label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {value.catalog.map((row) => (
                  <TableRow key={row.code}>
                    <TableCell>{row.code}</TableCell>
                    <TableCell
                      variant="label"
                      className="max-w-xl whitespace-normal"
                    >
                      {row.scope}
                    </TableCell>
                    <TableCell>{row.unit}</TableCell>
                    <TableCell
                      variant="numeric"
                      className="financial-numeral text-right"
                    >
                      {money(row.unitCost)}
                    </TableCell>
                    <TableCell>{row.kind}</TableCell>
                    <TableCell>{row.adjustable ? 'Yes' : 'No'}</TableCell>
                    <TableCell>{row.revision}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Surface>
      )}
      {/* Keep selection and calculation side by side on desktop, in process order on smaller screens. */}
      <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1.65fr)_minmax(340px,1fr)]">
        <div className="min-w-0 space-y-3">
          <Surface as="section" variant="panel" padded className="space-y-3">
            <Text as="h2">
              1. Brief & candidates / 简述与候选
            </Text>
            <Textarea
              aria-label="Brief scope"
              placeholder="例如：10 台设备部署，含联调和验收"
              value={draft.brief}
              onChange={(e) => update({ brief: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setShowAll(!showAll)}>
                {showAll
                  ? 'Recommended / 返回候选'
                  : 'Browse catalog / 浏览全部目录'}
              </Button>
              <Text
                as="span"
                tone="muted"
                textRole="body-small"
                className="self-center"
              >
                按范围推荐条目，也可浏览目录自行选择。
              </Text>
            </div>
            <Surface as="div" className="min-w-0">
              <Table
                className="min-w-[680px]"
                containerClassName="max-h-80"
                aria-label="CPQ candidates / 候选条目"
              >
                <TableHeader>
                  <TableRow>
                    <TableHead>选择</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead variant="numeric" className="text-right">
                      Unit cost
                    </TableHead>
                    <TableHead>Qty rule</TableHead>
                    <TableHead>Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {display.map(({ item: row, reason }) => (
                    <TableRow key={row.code}>
                      <TableCell>
                        <Checkbox
                          checked={draft.selections.some(
                            (s) => s.code === row.code,
                          )}
                          onCheckedChange={(v) =>
                            toggle(row, Boolean(v), reason)
                          }
                          aria-label={`Select ${row.code}`}
                        />
                      </TableCell>
                      <TableCell>{row.code}</TableCell>
                      <TableCell
                        variant="label"
                        className="max-w-md whitespace-normal"
                      >
                        {row.scope}
                      </TableCell>
                      <TableCell
                        variant="numeric"
                        className="financial-numeral text-right"
                      >
                        {money(row.unitCost)} / {row.unit}
                      </TableCell>
                      <TableCell>
                        {row.kind === 'equipment' || !row.adjustable
                          ? 'Fixed / 固定'
                          : 'Service / 可调服务'}
                      </TableCell>
                      <TableCell
                        variant="label"
                        className="max-w-sm whitespace-normal"
                      >
                        {reason}
                      </TableCell>
                    </TableRow>
                  ))}
                  {!display.length && (
                    <TableRow>
                      <TableCell colSpan={6}>
                        {value.catalog.length
                          ? '没有匹配候选，可浏览目录手动选择。'
                          : '请先录入条目目录，也可通过 Skill 导入。'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Surface>
          </Surface>
          <Surface as="section" variant="panel" padded className="space-y-3">
            {/* Confirmation stays next to the selected rows, including on long lists. */}
            <Surface
              as="div"
              variant="toolbar"
              className="-mx-3 -mt-3 justify-between"
            >
              <Text as="h2">
                2. Confirm items / 确认条目与固定数量
              </Text>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-40"
                  aria-label="Confirmed by"
                  placeholder="Confirmed by / 确认人"
                  value={confirmer}
                  onChange={(e) => setConfirmer(e.target.value)}
                />
                <Button
                  disabled={!draft.selections.length}
                  onClick={() =>
                    run(() => onChange(confirmMapping(value, confirmer)))
                  }
                >
                  Confirm selected items / 确认所选条目
                </Button>
                <span className="self-center">
                  {confirmed
                    ? `已确认 · ${draft.confirmation?.by}`
                    : '待用户确认'}
                </span>
              </div>
            </Surface>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code / Scope</TableHead>
                  <TableHead>Fixed / 锁定</TableHead>
                  <TableHead>实际固定 / 参考 qty</TableHead>
                  <TableHead>预算权重</TableHead>
                  <TableHead>依据</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.selections.map((s) => {
                  const row = value.catalog.find((c) => c.code === s.code);
                  const fixed = !row?.adjustable || row?.kind === 'equipment';
                  return (
                    <TableRow key={s.code}>
                      <TableCell
                        variant="label"
                        className="max-w-xs whitespace-normal"
                      >
                        <strong>{s.code}</strong> ·{' '}
                        {row?.scope || 'Missing catalog item / 条目缺失'}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            update({
                              selections: draft.selections.filter(
                                (x) => x.code !== s.code,
                              ),
                            })
                          }
                        >
                          移除
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Checkbox
                          checked={fixed || s.locked}
                          disabled={fixed}
                          onCheckedChange={(v) =>
                            selectionChange(s.code, { locked: Boolean(v) })
                          }
                          aria-label={`Lock ${s.code}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Quantity ${s.code}`}
                          className="financial-numeral min-w-24 text-right"
                          type="number"
                          min="0"
                          step={row?.step || 1}
                          value={s.quantity}
                          onChange={(e) =>
                            selectionChange(s.code, {
                              quantity: Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Weight ${s.code}`}
                          type="number"
                          min="0.0001"
                          disabled={fixed || s.locked}
                          value={s.weight}
                          onChange={(e) =>
                            selectionChange(s.code, {
                              weight: Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Reason ${s.code}`}
                          value={s.reason}
                          onChange={(e) =>
                            selectionChange(s.code, { reason: e.target.value })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Surface>
        </div>
        <Surface
          as="section"
          variant="panel"
          padded
          className="min-w-0 space-y-3"
        >
          <Text as="h2">
            3. Calculate & archive / 计算与归档
          </Text>
          {/* Calculation and archive actions remain visible while candidates are reviewed alongside them. */}
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button
              className="max-w-full whitespace-normal"
              disabled={!confirmed || busy}
              onClick={() =>
                run(() => {
                  const result = solveCpq(value, baseline);
                  update({ result });
                })
              }
            >
              Calculate service quantities / 计算服务数量
            </Button>
            {draft.result && (
              <Button
                className="max-w-full whitespace-normal"
                disabled={!fresh || !draft.result.acceptable}
                onClick={() =>
                  run(() => {
                    onChange(archiveCpq(value, baseline, proposalNumber));
                    announce('配置已加入本地归档队列，请查看保存状态。');
                  })
                }
              >
                Archive with cost / 随成本版本归档
              </Button>
            )}
          </div>
          {error && (
            <Surface
              role="alert"
              as="p"
              variant="notice"
              tone="danger"
              textRole="body-small"
            >
              {error}
            </Surface>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Surface
              as="label"
              variant="inline-field"
              textRole="body-small"
              className="col-span-2 flex min-w-0 flex-wrap items-center"
            >
              Cost version / 成本版本
              <Input readOnly value={draft.costVersion} className="w-16" />
              <Button
                className="max-w-full whitespace-normal"
                size="sm"
                variant="outline"
                onClick={() =>
                  update({
                    costVersion: baseline.code,
                    targetCost: totalCost,
                    targetBasis: `整合成本 ${baseline.code}`,
                  })
                }
              >
                Use {baseline.code} · {money(totalCost)}
              </Button>
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
              Target cost / 目标成本
              <Input
                money
                type="number"
                step="0.01"
                min="0"
                value={draft.targetCost}
                onChange={(e) => update({ targetCost: Number(e.target.value) })}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
              Tolerance / 允许差额
              <Input
                type="number"
                step="0.01"
                min="0"
                value={draft.tolerance}
                onChange={(e) => update({ tolerance: Number(e.target.value) })}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="col-span-2 block"
            >
              Target basis / 目标口径
              <Input
                value={draft.targetBasis}
                onChange={(e) => update({ targetBasis: e.target.value })}
              />
            </Surface>
            <Surface
              as="label"
              variant="field"
              textRole="body-small"
              className="col-span-2 block"
            >
              Allocation basis / 数量分配依据
              <Input
                value={draft.allocationBasis}
                onChange={(e) => update({ allocationBasis: e.target.value })}
              />
            </Surface>
          </div>
          <Surface
            as="div"
            variant="inset"
            textRole="body-small"
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <Button
              className="max-w-full whitespace-normal"
              variant="outline"
              onClick={() =>
                update({
                  selections: draft.selections.map((s) => ({
                    ...s,
                    weight: Math.max(
                      0.0001,
                      s.quantity *
                        (value.catalog.find((c) => c.code === s.code)
                          ?.unitCost || 0),
                    ),
                  })),
                  allocationBasis:
                    '按参考数量的成本比例分配 / Reference quantity cost weights',
                })
              }
            >
              Use reference qty weights / 使用参考数量比例
            </Button>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={draft.rounding === 'half-up-cent'}
                onCheckedChange={(v) =>
                  update({ rounding: v ? 'half-up-cent' : 'ceil-cent' })
                }
              />
              按行四舍五入到分（默认向上到分）
            </label>
          </Surface>

          {draft.result && (
            <div className="space-y-3">
              <Text as="p" tone={fresh ? 'inherit' : 'warning'} className="">
                {!fresh
                  ? '输入或成本已变化，需要重算。'
                  : draft.result.difference === 0
                    ? '金额精确匹配'
                    : `差额 ${money(draft.result.difference)} · ${draft.result.acceptable ? '在容差内' : '待处理'}`}
                {!draft.result.searchComplete &&
                  ' · 已到搜索上限，未证明分配最优或无精确解'}
              </Text>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead variant="numeric" className="text-right">
                      Unit cost
                    </TableHead>
                    <TableHead variant="numeric" className="text-right">
                      Cost
                    </TableHead>
                    <TableHead>Fixed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.result.lines.map((line) => (
                    <TableRow key={line.item.code}>
                      <TableCell>{line.item.code}</TableCell>
                      <TableCell>
                        {line.quantity} {line.item.unit}
                      </TableCell>
                      <TableCell
                        variant="numeric"
                        className="financial-numeral text-right"
                      >
                        {money(line.item.unitCost)}
                      </TableCell>
                      <TableCell
                        variant="numeric"
                        className="financial-numeral text-right"
                      >
                        {money(line.amount)}
                      </TableCell>
                      <TableCell>{line.locked ? '固定' : '可调'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p>
                Total / 合计：{money(draft.result.totalCost)} · Difference /
                差额：{money(draft.result.difference)}
              </p>
            </div>
          )}
        </Surface>
      </div>
      <Surface as="section" variant="panel" padded className="space-y-3">
        <Text as="h2">
          Archived configurations / 历史配置 ({value.archives.length})
        </Text>
        {value.archives
          .slice()
          .reverse()
          .map((archive) => (
            <Surface
              key={archive.id}
              as="div"
              variant="toolbar"
              textRole="body-small"
              className="justify-between"
            >
              <span>
                {archive.costVersion} · {archive.draft.brief} ·{' '}
                {money(archive.result.totalCost)} ·{' '}
                {archive.createdAt.slice(0, 10)}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await downloadCpqArchive(archive, projectId);
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Excel
              </Button>
            </Surface>
          ))}
      </Surface>
    </Surface>
  );
}
