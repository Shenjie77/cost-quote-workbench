import { Surface } from '@/components/ui/presentation';
import { Plus, Trash2 } from 'lucide-react';
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
import { roundMoney } from '../cost/domain';
import {
  serviceHistoryColumns,
  historyFieldValue,
  type ServicePriceRecord,
} from './history-fields';

export function ServiceHistoryEditor({
  rows,
  setRows,
  query,
}: {
  rows: ServicePriceRecord[];
  setRows: React.Dispatch<React.SetStateAction<ServicePriceRecord[]>>;
  query: string;
}) {
  const visible = rows.filter((row) =>
    [row.client, row.project, row.service, row.source, row.quotedYear]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const update = (id: string, key: string, value: string | number) =>
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [key]: value };
        return {
          ...next,
          quotedAmount: roundMoney(next.quantity * next.unitPrice),
        };
      }),
    );
  return (
    <section aria-label="Service quotation history">
      <Surface
        as="div"
        variant="toolbar"
        tone="muted"
        textRole="body-small"
        className="justify-between"
      >
        <span>
          {visible.length} records · SGD · Quoted Amount = Quantity × Unit Price
          · GP% = (Quoted Amount − Cost) / Quoted Amount
        </span>
        <Button
          size="sm"

          onClick={() =>
            setRows((current) => [
              ...current,
              {
                id: crypto.randomUUID(),
                client: 'New Client',
                project: 'New Project',
                service: 'Service description',
                quantity: 1,
                unit: 'lot',
                unitPrice: 0,
                costAmount: 0,
                quotedAmount: 0,
                quotedYear: new Date().getFullYear(),
                source: '',
                currency: 'SGD',
              },
            ])
          }
        >
          <Plus /> Add row
        </Button>
      </Surface>
      <Table aria-label="Service history grid" className="min-w-[1500px]">
        <TableHeader>
          <TableRow>
            {serviceHistoryColumns.map((column) => (
              <TableHead
                key={column.key}
                style={{
                  width:
                    column.key === 'service'
                      ? 240
                      : ['client', 'project', 'source'].includes(column.key)
                        ? 170
                        : 115,
                }}
              >
                {column.label}
              </TableHead>
            ))}
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.id}>
              {serviceHistoryColumns.map((column) => {
                const value = historyFieldValue(
                  'service-history',
                  column.key,
                  row as unknown as Record<string, unknown>,
                );
                return (
                  <TableCell
                    variant="editable"
                    key={column.key}
                    className={
                      column.kind === 'text'
                        ? ''
                        : 'financial-numeral text-right'
                    }
                  >
                    {column.computed ? (
                      value === undefined ? (
                        '—'
                      ) : (
                        Number(value).toLocaleString('en-SG', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }) + (column.key === 'grossMargin' ? '%' : '')
                      )
                    ) : (
                      <Input
                        variant="grid"
                        aria-label={`${row.id} ${column.label}`}
                        className={`h-8 min-w-0 w-full ${column.kind === 'text' ? '' : 'text-right'}`}
                        type={column.kind === 'text' ? 'text' : 'number'}
                        min={column.min}
                        max={column.max}
                        step={column.kind === 'integer' ? 1 : 'any'}
                        value={
                          typeof value === 'string' || typeof value === 'number'
                            ? value
                            : ''
                        }
                        onChange={(event) =>
                          update(
                            row.id,
                            column.key,
                            column.kind === 'text'
                              ? event.target.value
                              : Number(event.target.value),
                          )
                        }
                      />
                    )}
                  </TableCell>
                );
              })}
              <TableCell>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete service history ${row.project}`}
                  onClick={() =>
                    setRows((current) =>
                      current.filter((item) => item.id !== row.id),
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}
