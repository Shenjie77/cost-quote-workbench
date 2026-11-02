import { Surface, Text } from '@/components/ui/presentation';
/** Global assumption and customer-template editors; projects keep independent copies. */
import { useState } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import type {
  AssumptionDefinition,
  QuoteTemplate,
} from '@/features/quote/types';
import { matchesClient } from '@/features/quote/catalog-domain';
import { QuoteExcelTemplateEditor } from './quote-excel-template-editor';
type Setter<T> = React.Dispatch<React.SetStateAction<T[]>>;

/** Deletion detaches template defaults but never touches copied quote/history text. */
export function AssumptionLibraryView({
  library,
  setLibrary,
  templates,
  query,
  announce,
}: {
  library: AssumptionDefinition[];
  setLibrary: Setter<AssumptionDefinition>;
  templates: QuoteTemplate[];
  query: string;
  announce: (message: string) => void;
}) {
  const rows = library.filter((row) =>
    [row.name, row.category, row.clientPattern, row.text, row.textZh]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const update = (id: string, patch: Partial<AssumptionDefinition>) =>
    setLibrary((items) =>
      items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  return (
    <>
      <Surface
        as="div"
        variant="toolbar"
        textRole="body-small"
        className="justify-between"
      >
        <Text as="p" tone="muted">
          <Text as="span" tone="default">
            {rows.length} global assumptions · 全局假设库
          </Text>
          <span className="ml-3">
            Client: exact name or * / 客户完整名称，* 通用
          </span>
        </Text>
        <Button
          size="sm"
          onClick={() =>
            setLibrary((items) => [
              ...items,
              {
                id: `library-${crypto.randomUUID()}`,
                name: 'New assumption',
                category: 'General',
                clientPattern: '*',
                text: 'Enter quotation assumption',
                textZh: '',
                active: true,
              },
            ])
          }
        >
          <Plus /> Add / 新增
        </Button>
      </Surface>
      <div className="min-w-0">
        <Table className="min-w-[1000px] [&_th]:h-8">
          <TableHeader>
            <TableRow>
              {[
                'Name / 名称',
                'Category / 分类',
                'Client / 客户',
                'Assumption / 正文',
                'Translation / 译文（可选）',
                'Active / 启用',
                'Action / 操作',
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {(['name', 'category', 'clientPattern'] as const).map(
                  (field) => (
                    <TableCell variant="editable" key={field}>
                      <Input
                        variant="grid"
                        aria-label={`${row.name} ${field}`}
                        maxLength={2000}

                        value={row[field]}
                        onChange={(event) =>
                          update(row.id, { [field]: event.target.value })
                        }
                      />
                    </TableCell>
                  ),
                )}
                {(['text', 'textZh'] as const).map((field) => (
                  <TableCell
                    variant="editable"
                    key={field}
                    className="min-w-64"
                  >
                    <Textarea
                      rows={1}
                      aria-label={`${row.name} ${field}`}
                      maxLength={2000}
                      className="block min-h-8 w-full resize-y [field-sizing:content]"
                      value={row[field]}
                      onChange={(event) =>
                        update(row.id, { [field]: event.target.value })
                      }
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <Checkbox
                    aria-label={`Enable ${row.name}`}
                    checked={row.active}
                    onCheckedChange={(checked) =>
                      update(row.id, { active: checked })
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.name}`}
                    onClick={() => {
                      const linked = templates.filter((item) =>
                        item.defaultAssumptionIds.includes(row.id),
                      ).length;
                      if (linked) {
                        announce(
                          `Delete blocked: ${linked} global template(s) still reference this assumption. Remove their references and save templates first. / 请先移除全局模板引用并保存模板，再删除假设。`,
                        );
                        return;
                      }
                      if (
                        !window.confirm(
                          `Delete "${row.name}" from global data? Project snapshots remain unchanged. / 删除全局假设，已有项目快照不变。`,
                        )
                      )
                        return;
                      setLibrary((items) =>
                        items.filter((item) => item.id !== row.id),
                      );
                      announce(
                        'Assumption deleted; existing quotation copies retained. / 假设已删除，报价引用内容保留。',
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
      {!rows.length && (
        <Surface as="p" variant="body" tone="muted" textRole="body-small">
          No matching assumptions / 暂无匹配假设
        </Surface>
      )}
    </>
  );
}

/** Customer-specific T&C editor; editing a template does not select it in Quote. */
export function QuoteTemplatesView({
  templates,
  setTemplates,
  library,
  query,
  announce,
}: {
  templates: QuoteTemplate[];
  setTemplates: Setter<QuoteTemplate>;
  library: AssumptionDefinition[];
  query: string;
  announce: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState('');
  const template =
    templates.find((item) => item.id === editingId) || templates[0];
  const rows = templates.filter((row) =>
    [row.name, row.clientPattern, row.termsAndConditions]
      .join(' ')
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const update = (patch: Partial<QuoteTemplate>) =>
    setTemplates((items) =>
      items.map((item) =>
        item.id === template.id ? { ...item, ...patch } : item,
      ),
    );
  const add = (source?: QuoteTemplate) => {
    const id = `quote-template-${crypto.randomUUID()}`;
    const item: QuoteTemplate = source
      ? {
          ...structuredClone(source),
          id,
          name: `${source.name.slice(0, 1900)} (copy)`,
        }
      : {
          id,
          name: 'New Client Template',
          clientPattern: '*',
          documentTitle: 'SERVICE QUOTATION',
          validityDays: 30,
          paymentTerms: '30 days from invoice date',
          termsAndConditions: '',
          defaultAssumptionIds: [],
          active: true,
        };
    setTemplates((items) => [...items, item]);
    setEditingId(id);
  };
  return (
    <>
      <Surface
        as="div"
        variant="toolbar"
        textRole="body-small"
        className="justify-between"
      >
        <span>{rows.length} templates</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!template}
            onClick={() => add(template)}
          >
            <Copy /> Duplicate
          </Button>
          <Button size="sm" onClick={() => add()}>
            <Plus /> New template
          </Button>
        </div>
      </Surface>
      <div className="grid min-w-0 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]">
        <Surface as="div" variant="item" className="min-w-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  tone={template?.id === row.id ? 'section' : 'normal'}
                  key={row.id}
                >
                  <TableCell>
                    <Button
                      variant="ghost"
                      type="button"
                      className="text-left underline-offset-4 hover:underline"
                      onClick={() => setEditingId(row.id)}
                    >
                      {row.name}
                      <Text as="small" tone="muted" className="block">
                        {row.active ? 'Active' : 'Inactive'}
                      </Text>
                    </Button>
                  </TableCell>
                  <TableCell>
                    {row.clientPattern === '*' ? 'All' : row.clientPattern}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => {
                        if (templates.length <= 1) {
                          announce('Keep at least one template');
                          return;
                        }
                        if (
                          !window.confirm(
                            `Delete "${row.name}"? Existing history snapshots stay.`,
                          )
                        )
                          return;
                        const remaining = templates.filter(
                          (item) => item.id !== row.id,
                        );
                        setTemplates(remaining);
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && (
            <Surface as="p" variant="empty" textRole="body-small">
              No matching templates
            </Surface>
          )}
        </Surface>
        {template && (
          <Surface as="div" variant="body" className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  ['name', 'Name'],
                  ['clientPattern', 'Client (full name or *)'],
                  ['documentTitle', 'Document title'],
                  ['paymentTerms', 'Payment terms'],
                ] as const
              ).map(([field, label]) => (
                <Surface
                  key={field}
                  as="label"
                  variant="field"
                  tone="muted"
                  textRole="body-small"
                >
                  {label}
                  <Input
                    maxLength={2000}
                    value={template[field]}
                    onChange={(event) =>
                      update({ [field]: event.target.value })
                    }
                  />
                </Surface>
              ))}
              <Surface
                htmlFor="template-validity"
                as="label"
                variant="field"
                tone="muted"
                textRole="body-small"
              >
                Validity days
                <Input
                  id="template-validity"
                  type="number"
                  min={1}
                  max={3650}
                  value={template.validityDays}
                  onChange={(event) =>
                    update({
                      validityDays: Math.min(
                        3650,
                        Math.max(
                          1,
                          Math.floor(Number(event.target.value) || 1),
                        ),
                      ),
                    })
                  }
                />
              </Surface>
            </div>
            <Surface
              htmlFor="template-active"
              as="label"
              variant="inline-field"
              textRole="body-small"
              className="flex items-center"
            >
              <Checkbox
                id="template-active"
                checked={template.active}
                onCheckedChange={(active) => update({ active })}
              />
              Active
            </Surface>
            {/* Excel mappings are staged and validated independently before updating this template draft. */}
            <QuoteExcelTemplateEditor
              templateId={template.id}
              value={template.excel}
              onChange={(excel) => update({ excel })}
            />
            <Surface
              htmlFor="template-tc"
              as="label"
              variant="field"
              textRole="body-small"
              className="block"
            >
              Terms & Conditions
              <Text as="span" tone="muted" className="mt-1 block">
                Supports{' '}
                {
                  '{project} {client} {date} {quoteNumber} {currency} {validityDays} {paymentTerms} {companyName} {companyAddress} {quoteBeforeTax} {maintenancePrice} {optionalPrice} {grandTotal}'
                }
                . Project uses the quotation project name.
              </Text>
              <Textarea
                id="template-tc"
                className="min-h-40"
                maxLength={20000}
                value={template.termsAndConditions}
                placeholder="Enter this customer's original T&C; line breaks are preserved"
                onChange={(event) =>
                  update({ termsAndConditions: event.target.value })
                }
              />
            </Surface>
            <Surface as="fieldset" variant="panel" padded>
              <Surface as="legend" variant="body" textRole="body-small">
                Default assumptions
              </Surface>
              <Surface
                as="div"
                variant="body"
                className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2"
              >
                {library.map((entry) => {
                  const applicable =
                    entry.active &&
                    (entry.clientPattern.trim() === '*' ||
                      (template.clientPattern.trim() !== '*' &&
                        matchesClient(
                          entry.clientPattern,
                          template.clientPattern,
                        )));
                  const checked = template.defaultAssumptionIds.includes(
                    entry.id,
                  );
                  return (
                    <Surface
                      key={entry.id}
                      as="label"
                      variant="inline-field"
                      textRole="body-small"
                      className="flex items-start"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!applicable && !checked}
                        onCheckedChange={(value) =>
                          update({
                            defaultAssumptionIds: value
                              ? [...template.defaultAssumptionIds, entry.id]
                              : template.defaultAssumptionIds.filter(
                                  (id) => id !== entry.id,
                                ),
                          })
                        }
                      />
                      <span>
                        {entry.name}
                        <Text as="small" tone="muted" className="block">
                          {entry.clientPattern}
                          {!applicable ? ' · Unavailable' : ''}
                        </Text>
                      </span>
                    </Surface>
                  );
                })}
              </Surface>
              {!library.length && (
                <Text
                  as="p"
                  tone="muted"
                  textRole="body-small"
                  className="space-y-1"
                >
                  Create library entries in Assumptions first.
                </Text>
              )}
            </Surface>
            <Text
              as="p"
              tone="muted"
              textRole="body-small"
              className="space-y-1"
            >
              Exact client match (case-insensitive); * is common. Changes affect
              future projects. Existing project templates remain unchanged.
            </Text>
          </Surface>
        )}
      </div>
    </>
  );
}
