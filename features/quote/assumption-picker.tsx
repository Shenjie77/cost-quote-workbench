/** Search eligible library text and reference a detached copy into this quote. */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
  TableBody,
} from '@/components/ui/table';
import { matchesClient, referenceAssumptions } from './catalog-domain';
import type { AssumptionDefinition, QuoteAssumption } from './types';

export function AssumptionPicker({
  library,
  client,
  assumptions,
  setAssumptions,
}: {
  library: AssumptionDefinition[];
  client: string;
  assumptions: QuoteAssumption[];
  setAssumptions: React.Dispatch<React.SetStateAction<QuoteAssumption[]>>;
}) {
  const [query, setQuery] = useState('');
  const entries = library.filter(
    (row) =>
      row.active &&
      matchesClient(row.clientPattern, client) &&
      [row.name, row.category, row.text, row.textZh]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <details className="border-b bg-muted/10">
      <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">
        Reference library / 引用假设库 · {entries.length} matches / 条适用
      </summary>
      <div className="px-5 pb-4">
        <Input
          aria-label="Search assumption library"
          placeholder="Search name, category or text / 搜索名称、分类、内容"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="max-h-72 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name / 名称</TableHead>
              <TableHead>Assumption / 内容</TableHead>
              <TableHead>Action / 操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => {
              const referenced =
                referenceAssumptions(
                  assumptions,
                  [entry],
                  [entry.id],
                  client,
                  () => 'preview',
                ).length === assumptions.length;
              return (
                <TableRow key={entry.id}>
                  <TableCell>
                    {entry.name}
                    <small className="block text-muted-foreground">
                      {entry.category} · {entry.clientPattern}
                    </small>
                  </TableCell>
                  <TableCell className="max-w-xl whitespace-pre-wrap">
                    {entry.text}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={referenced}
                      onClick={() =>
                        setAssumptions((rows) =>
                          referenceAssumptions(
                            rows,
                            library,
                            [entry.id],
                            client,
                          ),
                        )
                      }
                    >
                      {referenced ? 'Referenced / 已引用' : 'Reference / 引用'}
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!entries.length && (
        <p className="px-3 pb-3 text-xs text-muted-foreground">
          No applicable assumptions. Maintain them in Master Data → Assumptions.
          / 无适用假设，请在基础数据中维护。
        </p>
      )}
    </details>
  );
}
