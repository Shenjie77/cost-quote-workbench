import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableFooter,
} from '@/components/ui/table';
import {
  GROUP_COST_NOTE,
  type GroupCostSummaryRow,
} from '../group-cost-summary';
import { formatSgd } from '@/lib/formatters';
import { roundMoney, roundQuantity } from '../domain';

const measures = [
  ['mandays', 'Mandays'],
  ['personnel', 'Personnel'],
  ['travel', 'HQ Travel'],
  ['subcontract', 'Subcontract'],
  ['ehs', 'EHS'],
  ['risk', 'Risk'],
  ['other', 'Other'],
  ['total', 'Total Cost'],
  ['share', 'Share'],
] as const;
const display = (key: (typeof measures)[number][0], value: number) =>
  key === 'mandays'
    ? roundQuantity(value).toLocaleString('en-SG')
    : key === 'share'
      ? `${(value * 100).toFixed(1)}%`
      : formatSgd(roundMoney(value));

export function GroupCostTable({ items }: { items: GroupCostSummaryRow[] }) {
  return (
    <>
      <Table aria-label="Group cost summary" className="min-w-[1400px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-56">Group / Account</TableHead>
            <TableHead>Level</TableHead>
            {measures.map(([key, label]) => (
              <TableHead key={key} className="text-right">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow
              key={item.key}
              className={item.kind === 'Project' ? 'bg-muted/20' : ''}
            >
              <TableCell className="font-medium">{item.label}</TableCell>
              <TableCell>{item.kind}</TableCell>
              {measures.map(([key]) => (
                <TableCell
                  key={key}
                  className={`text-right tabular-nums ${key === 'total' ? 'font-semibold' : ''}`}
                >
                  {display(key, item[key])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={2}>Total Cost with Risk</TableCell>
            {measures.map(([key]) => (
              <TableCell key={key} className="text-right tabular-nums">
                {display(
                  key,
                  items.reduce((sum, item) => sum + item[key], 0),
                )}
              </TableCell>
            ))}
          </TableRow>
        </TableFooter>
      </Table>
      <p className="border-t px-3 py-2 text-xs leading-5 text-muted-foreground">
        {GROUP_COST_NOTE}
      </p>
    </>
  );
}
