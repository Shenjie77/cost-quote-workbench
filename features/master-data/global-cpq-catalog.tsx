import { Surface } from '@/components/ui/presentation';
import { SelectField } from '@/components/ui/select-field';
import { CheckInput } from '@/components/ui/check-input';
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
      <Surface
        as="div"
        variant="toolbar"
        textRole="body-small"
        className="justify-between"
      >
        <span>{rows.length} records / 条记录 · 项目配置保存独立副本</span>
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
      </Surface>
      <div className="min-w-0">
        <Table className="min-w-[1500px]">
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
                      className={
                        field === 'scope' ? 'min-w-64' : 'h-8 min-w-24'
                      }
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
                    money
                    className="financial-numeral min-w-24"
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
                  <SelectField
                    className="h-8"
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
                  </SelectField>
                </TableCell>
                <TableCell>
                  <CheckInput
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
                        className="financial-numeral min-w-20 text-right"
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
                      className="financial-numeral min-w-24"
                      aria-label={`${row.code} ${field}`}
                      value={row[field]}
                      onChange={(e) =>
                        update(row.code, { [field]: e.target.value })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <CheckInput
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
      <Surface as="p" variant="footer" tone="muted" textRole="body-small">
        Equipment quantities are fixed to actual BOQ. Only adjustable service
        items participate in allocation. / 设备数量按实际
        BOQ，只有可调服务项参与数量匹配。
      </Surface>
    </>
  );
}
