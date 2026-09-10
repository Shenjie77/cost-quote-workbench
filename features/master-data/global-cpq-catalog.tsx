import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
  TableHead,
} from '@/components/ui/table';
import type { CatalogItem } from '@/features/cpq/domain';

/** Global CPQ definitions contain no project scope selections or allocations. */
export function GlobalCpqCatalog({
  items,
  setItems,
  query,
}: {
  items: CatalogItem[];
  setItems: React.Dispatch<React.SetStateAction<CatalogItem[]>>;
  query: string;
}) {
  const update = (code: string, patch: Partial<CatalogItem>) =>
    setItems((rows) =>
      rows.map((row) => (row.code === code ? { ...row, ...patch } : row)),
    );
  const rows = items.filter((row) =>
    [row.code, row.scope, row.tags]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <>
      <div className="wb-toolbar justify-between border-b text-xs">
        <span>Global CPQ catalog / 全局 CPQ 目录 · 项目配置保存独立副本</span>
        <Button
          size="sm"
          onClick={() =>
            setItems((current) => [
              ...current,
              {
                code: `CPQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
                scope: 'New service scope',
                unit: 'MD',
                unitCost: 0.01,
                kind: 'service',
                adjustable: true,
                active: true,
                step: 1,
                minQty: 0,
                maxQty: 10000,
                referenceQty: 1,
                tags: '',
                revision: '1',
              },
            ])
          }
        >
          <Plus /> Add / 新增
        </Button>
      </div>
      <div className="wb-table-scroll">
        <Table className="min-w-[1500px] text-xs">
          <TableHeader>
            <TableRow>
              {[
                'Code / 编码',
                'Scope / 服务范围',
                'Unit / 单位',
                'Unit cost / 成本',
                'Kind / 类型',
                'Adjustable / 可调',
                'Step',
                'Min qty',
                'Max qty',
                'Reference qty',
                'Tags',
                'Revision',
                'Active',
                'Action',
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.code}>
                {(['code', 'scope', 'unit'] as const).map((field) => (
                  <TableCell key={field}>
                    <Input
                      className={field === 'scope' ? 'min-w-64' : 'min-w-24'}
                      aria-label={`${row.code} ${field}`}
                      value={row[field]}
                      onChange={(e) =>
                        update(row.code, { [field]: e.target.value })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Input
                    className="min-w-24"
                    type="number"
                    min={0.01}
                    step="0.01"
                    aria-label={`${row.code} unit cost`}
                    value={row.unitCost}
                    onChange={(e) =>
                      update(row.code, {
                        unitCost: Math.max(
                          0.01,
                          Number(e.target.value) || 0.01,
                        ),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2"
                    aria-label={`${row.code} kind`}
                    value={row.kind}
                    onChange={(e) =>
                      update(row.code, {
                        kind: e.target.value as CatalogItem['kind'],
                        ...(e.target.value === 'equipment'
                          ? { adjustable: false }
                          : {}),
                      })
                    }
                  >
                    <option value="service">Service / 服务</option>
                    <option value="equipment">Equipment / 设备</option>
                  </select>
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`${row.code} adjustable`}
                    checked={row.adjustable}
                    disabled={row.kind === 'equipment'}
                    onChange={(e) =>
                      update(row.code, { adjustable: e.target.checked })
                    }
                  />
                </TableCell>
                {(['step', 'minQty', 'maxQty', 'referenceQty'] as const).map(
                  (field) => (
                    <TableCell key={field}>
                      <Input
                        className="min-w-20"
                        type="number"
                        min={field === 'step' ? 0.0001 : 0}
                        step="any"
                        aria-label={`${row.code} ${field}`}
                        value={row[field]}
                        onChange={(e) =>
                          update(row.code, {
                            [field]: Math.max(
                              field === 'step' ? 0.0001 : 0,
                              Number(e.target.value) || 0,
                            ),
                          })
                        }
                      />
                    </TableCell>
                  ),
                )}
                {(['tags', 'revision'] as const).map((field) => (
                  <TableCell key={field}>
                    <Input
                      className="min-w-24"
                      aria-label={`${row.code} ${field}`}
                      value={row[field]}
                      onChange={(e) =>
                        update(row.code, { [field]: e.target.value })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`${row.code} active`}
                    checked={row.active}
                    onChange={(e) =>
                      update(row.code, { active: e.target.checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.code}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete global ${row.code}? Existing project catalogs remain unchanged. / 删除全局条目，项目副本保留。`,
                        )
                      )
                        setItems((current) =>
                          current.filter((item) => item.code !== row.code),
                        );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="border-t p-3 text-xs text-muted-foreground">
        Equipment quantities are fixed to actual BOQ. Only adjustable service
        items participate in allocation. / 设备数量按实际
        BOQ，只有可调服务项参与数量匹配。
      </p>
    </>
  );
}
