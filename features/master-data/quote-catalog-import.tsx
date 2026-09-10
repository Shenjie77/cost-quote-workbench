/** Explicit cross-project reuse without hidden global writes or ID collisions. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getLocalWorkspace,
  listLocalWorkspaces,
} from '@/features/workbench/workspace-client';
import type { LocalWorkspaceIndexItem } from '@/features/workbench/workspace-types';
import { copyQuoteCatalog } from '@/features/quote/catalog-domain';
import type {
  AssumptionDefinition,
  QuoteTemplate,
} from '@/features/quote/types';

export function QuoteCatalogImport({
  projectId,
  onImport,
  announce,
}: {
  projectId: string;
  onImport: (
    library: AssumptionDefinition[],
    templates: QuoteTemplate[],
  ) => void;
  announce: (message: string) => void;
}) {
  const [projects, setProjects] = useState<LocalWorkspaceIndexItem[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Ignore late callbacks when the active project changes or this panel closes.
  useEffect(() => {
    let cancelled = false;
    listLocalWorkspaces()
      .then((rows) => {
        if (!cancelled)
          setProjects(rows.filter((row) => row.projectId !== projectId));
      })
      .catch(() => {
        if (!cancelled) setError('Cannot load projects / 无法载入项目列表');
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  const lifetime = useRef(true);
  useEffect(() => {
    lifetime.current = true;
    return () => {
      lifetime.current = false;
    };
  }, []);
  return (
    <div className="wb-toolbar border-b text-xs">
      <span>Project-owned library / 当前项目库 · Copy from / 复制来源</span>
      <Select
        value={sourceId}
        onValueChange={(value) => value && setSourceId(value)}
      >
        <SelectTrigger className="w-64">
          <SelectValue placeholder="Select source project / 选择项目" />
        </SelectTrigger>
        <SelectContent>
          {projects.map((row) => (
            <SelectItem key={row.projectId} value={row.projectId}>
              {row.name} · {row.client}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        disabled={!sourceId || busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const source = await getLocalWorkspace(sourceId);
            if (!lifetime.current) return;
            if (!source)
              throw new Error('Source project not found / 来源项目不存在');
            const copied = copyQuoteCatalog(
              source.workspace.assumptionLibrary,
              source.workspace.quoteTemplates,
            );
            onImport(copied.library, copied.templates);
            announce(
              `Copied ${copied.library.length} assumptions and ${copied.templates.length} templates; existing data unchanged. / 已复制，未覆盖原数据。`,
            );
          } catch (cause) {
            if (lifetime.current)
              setError(
                cause instanceof Error
                  ? cause.message
                  : 'Copy failed / 复制失败',
              );
          } finally {
            if (lifetime.current) setBusy(false);
          }
        }}
      >
        {busy ? 'Copying…' : 'Copy catalog / 复制假设与模板'}
      </Button>
      {error && (
        <span role="alert" className="text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
