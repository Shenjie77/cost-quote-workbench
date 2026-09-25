/** Shared tag catalog uses the same draft/save lifecycle as other master-data grids. */
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import type { ProjectTagDefinition } from './global-types';

/** Stable catalog IDs stay internal; deactivate labels to stop new assignment while preserving existing projects. */
export function ProjectTagsEditor({
  items,
  onChange,
  query = '',
}: {
  items: ProjectTagDefinition[];
  onChange: (items: ProjectTagDefinition[]) => void;
  query?: string;
}) {
  const update = (id: string, patch: Partial<ProjectTagDefinition>) =>
    onChange(
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          统一创建标签，项目编辑中多选分配。停用或改名不会改写项目已有标签。
        </p>
        <Button
          size="sm"
          onClick={() =>
            onChange([
              ...items,
              { id: crypto.randomUUID(), name: '', active: true },
            ])
          }
        >
          Add tag
        </Button>
      </div>
      <Table aria-label="Project tag catalog">
        <TableHeader>
          <TableRow>
            <TableHead>Tag / 标签</TableHead>
            <TableHead>Active / 启用</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items
            .filter((item) =>
              item.name
                .toLocaleLowerCase()
                .includes(query.trim().toLocaleLowerCase()),
            )
            .map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <Input
                    aria-label={`Tag name ${item.id}`}
                    value={item.name}
                    maxLength={40}
                    onChange={(event) =>
                      update(item.id, { name: event.target.value })
                    }
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`Active tag ${item.name || 'new tag'}`}
                    checked={item.active}
                    onChange={(event) =>
                      update(item.id, { active: event.target.checked })
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </section>
  );
}
