/** Select live Scope shares and a separate Risk Cost share for one quotation line. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { formatSgd } from '@/lib/formatters';
import type { ScopeAllocation } from './scope-allocation';

/** Draft percentages remain local until Apply; reopening restores the persisted source allocation rules. */
export function QuoteScopeDialog({
  lineNumber,
  amount,
  scopes,
  selectedKeys,
  allocations,
  riskAmount = 0,
  riskPercentage,
  disabled,
  onSave,
}: {
  lineNumber: number;
  amount: number;
  scopes: Array<{ key: string; description: string; amount: number }>;
  selectedKeys: string[];
  allocations?: ScopeAllocation[];
  riskAmount?: number;
  riskPercentage?: number;
  disabled: boolean;
  onSave: (
    keys: string[],
    percentages?: Record<string, number>,
    risk?: number,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [percentages, setPercentages] = useState<Record<string, string>>({});
  const [risk, setRisk] = useState('');
  const [search, setSearch] = useState('');
  /** Snapshot current selections without writing commercial data when opening or cancelling. */
  const changeOpen = (next: boolean) => {
    if (next) {
      setSelected(allocations?.map((item) => item.key) ?? selectedKeys);
      setPercentages(
        Object.fromEntries(
          (
            allocations ?? selectedKeys.map((key) => ({ key, percentage: 100 }))
          ).map((item) => [item.key, item.percentage.toFixed(2)]),
        ),
      );
      setRisk(riskPercentage === undefined ? '' : riskPercentage.toFixed(2));
      setSearch('');
    }
    setOpen(next);
  };
  const visible = scopes.filter((scope) =>
    scope.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const valid = (text: string) =>
    text.trim() !== '' &&
    Number.isFinite(Number(text)) &&
    Number(text) >= 0 &&
    Number(text) <= 100;
  const invalid =
    selected.some((key) => !valid(percentages[key] ?? '100')) ||
    (risk !== '' && !valid(risk));
  const total =
    scopes
      .filter((scope) => selected.includes(scope.key))
      .reduce(
        (sum, scope) =>
          sum + (scope.amount * Number(percentages[scope.key] ?? 100)) / 100,
        0,
      ) + (risk === '' ? 0 : (riskAmount * Number(risk)) / 100);
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            disabled={disabled}
            className="h-8 w-full justify-end px-1 text-xs underline decoration-dotted underline-offset-4"
          />
        }
        aria-label={`Select cost scopes for line ${lineNumber}`}
      >
        {formatSgd(amount)}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[780px]">
        <DialogHeader>
          <DialogTitle>Line {lineNumber} cost scopes / 成本 Scope</DialogTitle>
          <DialogDescription>
            选择 Scope
            并输入该行承担的比例，成本更新后自动按原选项和比例重算。Risk
            单独分配；自动余额按未指定行的成本占比分摊。超出余额时会相应减少其他行的同项比例。手动改
            Weight 会解除绑定。
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search cost scopes"
          placeholder="Search Scope / 搜索 Scope"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setSelected([
                ...new Set([...selected, ...visible.map((scope) => scope.key)]),
              ])
            }
          >
            Select visible / 全选搜索结果
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSelected([])}>
            Clear / 清空
          </Button>
        </div>
        <div className="max-h-[42vh] overflow-y-auto divide-y border">
          <div className="grid grid-cols-[1fr_100px_90px_100px] gap-2 bg-muted p-2 text-xs font-semibold">
            <span>Scope</span>
            <span>Cost</span>
            <span>Share %</span>
            <span>Allocated</span>
          </div>
          {visible.map((scope) => (
            <div
              key={scope.key}
              className="grid grid-cols-[1fr_100px_90px_100px] items-center gap-2 p-2 text-xs"
            >
              <label className="flex min-w-0 items-start gap-2">
                <input
                  type="checkbox"
                  aria-label={`Include scope ${scope.description}`}
                  checked={selected.includes(scope.key)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, scope.key]
                        : current.filter((key) => key !== scope.key),
                    )
                  }
                />
                <span className="break-words">{scope.description}</span>
              </label>
              <span className="financial-numeral">
                {formatSgd(scope.amount)}
              </span>
              <Input
                aria-label={`Scope percentage ${scope.description}`}
                type="text"
                inputMode="decimal"
                disabled={!selected.includes(scope.key)}
                value={percentages[scope.key] ?? '100.00'}
                onChange={(event) =>
                  setPercentages((current) => ({
                    ...current,
                    [scope.key]: event.target.value,
                  }))
                }
                onBlur={() => {
                  const value = percentages[scope.key];
                  if (value && valid(value))
                    setPercentages((current) => ({
                      ...current,
                      [scope.key]: Number(value).toFixed(2),
                    }));
                }}
                className="text-right"
              />
              <span className="financial-numeral">
                {formatSgd(
                  selected.includes(scope.key) &&
                    valid(percentages[scope.key] ?? '100')
                    ? (scope.amount * Number(percentages[scope.key] ?? 100)) /
                        100
                    : 0,
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded border bg-muted/40 p-3 text-sm">
          <span className="font-medium">Risk Cost {formatSgd(riskAmount)}</span>
          <Input
            aria-label="Risk cost percentage"
            type="text"
            inputMode="decimal"
            placeholder="Auto"
            value={risk}
            onChange={(event) => setRisk(event.target.value)}
            onBlur={() => {
              if (valid(risk)) setRisk(Number(risk).toFixed(2));
            }}
            className="w-24 text-right"
          />
          <span>%</span>
          <Button variant="ghost" size="sm" onClick={() => setRisk('')}>
            Auto / 自动余额
          </Button>
        </div>
        <p className="text-right text-sm">
          {selected.length} selected · {invalid ? '—' : formatSgd(total)}
          {risk === '' ? ' + Auto Risk' : ''}
        </p>
        {invalid && (
          <p role="alert" className="text-sm text-destructive">
            Enter a percentage from 0 to 100 / 比例必须为 0–100。
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={disabled || invalid}
            onClick={() => {
              if (disabled || invalid) return;
              onSave(
                selected,
                Object.fromEntries(
                  selected.map((key) => {
                    const original = allocations?.find(
                      (item) => item.key === key,
                    )?.percentage;
                    const text = percentages[key] ?? '100';
                    return [
                      key,
                      original !== undefined && text === original.toFixed(2)
                        ? original
                        : Number(text),
                    ];
                  }),
                ),
                risk === ''
                  ? undefined
                  : riskPercentage !== undefined &&
                      risk === riskPercentage.toFixed(2)
                    ? riskPercentage
                    : Number(risk),
              );
              setOpen(false);
            }}
          >
            Apply scopes / 应用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
