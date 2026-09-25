/** Select the cost scopes behind a custom quotation line without exposing internal costs to customers. */
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

/** Opening captures a fresh draft; cancelling leaves all saved scope allocations untouched. */
export function QuoteScopeDialog({
  lineNumber,
  amount,
  scopes,
  selectedKeys,
  disabled,
  onSave,
}: {
  lineNumber: number;
  amount: number;
  scopes: Array<{ key: string; description: string; amount: number }>;
  selectedKeys: string[];
  disabled: boolean;
  onSave: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  /** Reset temporary selections and search whenever the dialog is opened. */
  const changeOpen = (next: boolean) => {
    if (next) {
      setSelected(selectedKeys);
      setSearch('');
    }
    setOpen(next);
  };
  const visible = scopes.filter((scope) =>
    scope.description.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const total = scopes
    .filter((scope) => selected.includes(scope.key))
    .reduce((sum, scope) => sum + scope.amount, 0);
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
      <DialogContent className="sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Line {lineNumber} cost scopes / 成本 Scope</DialogTitle>
          <DialogDescription>
            选择该行包含的 Scope，成本含分摊风险。已在其他行选择的 Scope
            会移至本行；剩余成本分摊到未指定 Scope 的行。仍可手动调整 Weight。
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Search cost scopes"
          placeholder="Search Scope / 搜索 Scope"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex items-center gap-2">
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
        <div className="max-h-[45vh] overflow-y-auto border divide-y">
          {visible.map((scope) => (
            <label
              key={scope.key}
              className="flex cursor-pointer items-start gap-3 p-3 text-sm hover:bg-muted"
            >
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
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                {scope.description}
              </span>
              <span className="financial-numeral">
                {formatSgd(scope.amount)}
              </span>
            </label>
          ))}
          {!visible.length && (
            <p className="p-3 text-sm text-muted-foreground">
              No matching scopes / 无匹配 Scope
            </p>
          )}
        </div>
        <p className="text-right text-sm">
          {selected.length} selected · {formatSgd(total)}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => changeOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              onSave(selected);
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
