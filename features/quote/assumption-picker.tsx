import {
  Surface,
  Text,
  Disclosure,
  DisclosureSummary,
} from '@/components/ui/presentation';
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
        <Surface
          as="div"
          variant="item"
          textRole="body-small"
          className="flex items-center gap-2"
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            Refresh library
          </Button>
          <Text as="span" tone="muted">
            {loading
              ? 'Refreshing assumptions…'
              : 'Library references sync automatically; quote-specific edits are retained.'}
          </Text>
        </Surface>
      )}
      {error && (
        <Surface
          role="alert"
          as="p"
          variant="body"
          tone="danger"
          textRole="body-small"
        >
          {error}
        </Surface>
      )}
      <Disclosure>
        <DisclosureSummary className="cursor-pointer">
          Reference library / 引用假设库 · {entries.length} matches / 条适用
        </DisclosureSummary>
        <Surface as="div" variant="body">
          <Input
            aria-label="Search assumption library"
            placeholder="Search name, category or text / 搜索名称、分类、内容"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Surface>
        <div className="max-h-72 overflow-auto">
          <Table className="[&_th]:h-8">
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
                      <Text as="small" tone="muted" className="block">
                        {entry.category} · {entry.clientPattern}
                      </Text>
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
          <Surface as="p" variant="body" tone="muted" textRole="body-small">
            No applicable assumptions. Maintain them in Master Data →
            Assumptions. / 无适用假设，请在基础数据中维护。
          </Surface>
        )}
      </Disclosure>
    </div>
  );
}
