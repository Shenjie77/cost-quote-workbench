/** Search eligible library text and reference a detached copy into this quote. */
import { useEffect, useRef, useState } from 'react';
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
  onSync,
  disabled = false,
}: {
  onSync?: (library: AssumptionDefinition[]) => void;
  disabled?: boolean;
  library: AssumptionDefinition[];
  client: string;
  assumptions: QuoteAssumption[];
  setAssumptions: React.Dispatch<React.SetStateAction<QuoteAssumption[]>>;
}) {
  const [query, setQuery] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [loaded, setLoaded] = useState<{
    generation: number;
    client: string;
    error: string;
  } | null>(null);
  const sync = useRef(onSync);
  useEffect(() => {
    sync.current = onSync;
  }, [onSync]);
  const canSync = Boolean(onSync);
  const loading =
    canSync &&
    !disabled &&
    (loaded?.generation !== refresh || loaded?.client !== client);
  const error = loading ? '' : (loaded?.error ?? '');
  useEffect(() => {
    if (!canSync || disabled) return;
    let cancelled = false;
    void import('../master-data/global-client')
      .then(({ getGlobalMasterData }) =>
        getGlobalMasterData<AssumptionDefinition>('assumptions'),
      )
      .then((record) => {
        if (cancelled) return;
        if (record.conflicts.length)
          throw new Error(
            'Resolve assumption conflicts in Master Data before refreshing.',
          );
        sync.current?.(record.items);
        setLoaded({ generation: refresh, client, error: '' });
      })
      .catch((cause) => {
        if (!cancelled)
          setLoaded({
            generation: refresh,
            client,
            error:
              cause instanceof Error
                ? cause.message
                : 'Unable to refresh assumptions.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [canSync, refresh, client, disabled]);
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
    <div>
      {canSync && (
        <div className="flex items-center gap-2 border-b px-3 py-1 text-xs">
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh library
          </Button>
          <span className="text-muted-foreground">
            {loading
              ? 'Refreshing assumptions…'
              : 'Library references sync automatically; quote-specific edits are retained.'}
          </span>
        </div>
      )}
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <details className="border-b bg-muted/10">
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring">
          Reference library / 引用假设库 · {entries.length} matches / 条适用
        </summary>
        <div className="px-3 pb-3">
          <Input
            aria-label="Search assumption library"
            placeholder="Search name, category or text / 搜索名称、分类、内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-72 overflow-auto">
          <Table className="text-xs [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:h-8">
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
                        disabled={referenced || disabled || loading}
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
                        {referenced
                          ? 'Referenced / 已引用'
                          : 'Reference / 引用'}
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
            No applicable assumptions. Maintain them in Master Data →
            Assumptions. / 无适用假设，请在基础数据中维护。
          </p>
        )}
      </details>
    </div>
  );
}
