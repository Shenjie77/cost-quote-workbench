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

const cellClass =
  'h-8 rounded-none border-0 bg-transparent shadow-none focus-visible:bg-white';
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
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2 text-xs">
        <p>{rows.length} global assumptions · 全局假设库</p>
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
      </div>
      <p className="border-b px-3 py-2 text-xs text-muted-foreground">
        Client: exact name or * for all. Quotes keep independent copies. /
        客户填完整名称，* 通用；引用后独立保存，可输入任意语言。
      </p>
      <div className="overflow-x-auto">
        <Table className="min-w-[1000px]">
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
                    <TableCell key={field} className="p-0">
                      <Input
                        aria-label={`${row.name} ${field}`}
                        maxLength={2000}
                        className={cellClass}
                        value={row[field]}
                        onChange={(event) =>
                          update(row.id, { [field]: event.target.value })
                        }
                      />
                    </TableCell>
                  ),
                )}
                {(['text', 'textZh'] as const).map((field) => (
                  <TableCell key={field} className="min-w-64 p-0">
                    <Textarea
                      aria-label={`${row.name} ${field}`}
                      maxLength={2000}
                      className="min-h-16 rounded-none border-0 bg-transparent text-xs shadow-none"
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
        <p className="p-4 text-xs text-muted-foreground">
          No matching assumptions / 暂无匹配假设
        </p>
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
    [row.name, row.nameZh, row.clientPattern, row.termsAndConditions]
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
          nameZh: '',
          clientPattern: '*',
          documentTitle: 'SERVICE QUOTATION',
          documentTitleZh: '',
          validityDays: 30,
          paymentTerms: '30 days from invoice date',
          paymentTermsZh: '',
          termsAndConditions: '',
          defaultAssumptionIds: [],
          active: true,
        };
    setTemplates((items) => [...items, item]);
    setEditingId(id);
  };
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs">
        <span>{rows.length} templates · 客户模板</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!template}
            onClick={() => add(template)}
          >
            <Copy /> Duplicate / 复制
          </Button>
          <Button size="sm" onClick={() => add()}>
            <Plus /> New template / 新建
          </Button>
        </div>
      </div>
      <div className="grid min-w-0 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.7fr)]">
        <div className="overflow-x-auto border-r">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name / 模板</TableHead>
                <TableHead>Client / 客户</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={template?.id === row.id ? 'bg-[#edf4f3]' : ''}
                >
                  <TableCell>
                    <button
                      type="button"
                      className="text-left underline-offset-4 hover:underline"
                      onClick={() => setEditingId(row.id)}
                    >
                      {row.name}
                      <small className="block text-muted-foreground">
                        {row.active ? 'Active / 启用' : 'Inactive / 停用'}
                      </small>
                    </button>
                  </TableCell>
                  <TableCell>
                    {row.clientPattern === '*'
                      ? 'All / 通用'
                      : row.clientPattern}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${row.name}`}
                      onClick={() => {
                        if (templates.length <= 1) {
                          announce(
                            'Keep at least one template / 至少保留一个模板',
                          );
                          return;
                        }
                        if (
                          !window.confirm(
                            `Delete "${row.name}"? Existing history snapshots stay. / 删除模板，历史快照保留。`,
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
            <p className="p-3 text-xs">No matching templates / 无匹配模板</p>
          )}
        </div>
        {template && (
          <div className="space-y-3 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(
                [
                  ['name', 'Name / 模板名称'],
                  ['nameZh', 'Translation / 译名（可选）'],
                  ['clientPattern', 'Client / 完整客户名或 *'],
                  ['documentTitle', 'Document title / 报价标题'],
                  ['documentTitleZh', 'Title translation / 标题译文（可选）'],
                  ['paymentTerms', 'Payment terms / 付款条款'],
                  ['paymentTermsZh', 'Payment translation / 条款译文（可选）'],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="text-xs text-muted-foreground">
                  {label}
                  <Input
                    maxLength={2000}
                    value={template[field]}
                    onChange={(event) =>
                      update({ [field]: event.target.value })
                    }
                  />
                </label>
              ))}
              <label
                htmlFor="template-validity"
                className="text-xs text-muted-foreground"
              >
                Validity days / 有效天数
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
              </label>
            </div>
            <label
              htmlFor="template-active"
              className="flex items-center gap-2 text-xs"
            >
              <Checkbox
                id="template-active"
                checked={template.active}
                onCheckedChange={(active) => update({ active })}
              />
              Active / 启用模板
            </label>
            <label htmlFor="template-tc" className="block text-xs">
              Terms & Conditions / 客户 T&C
              <Textarea
                id="template-tc"
                className="mt-1 min-h-40 text-xs"
                maxLength={20000}
                value={template.termsAndConditions}
                placeholder="Enter this customer's T&C in any language / 按原文输入客户条款，保留换行"
                onChange={(event) =>
                  update({ termsAndConditions: event.target.value })
                }
              />
            </label>
            <fieldset className="border p-2">
              <legend className="px-1 text-xs">
                Default assumptions / 选择模板时引用的假设
              </legend>
              <div className="grid max-h-48 gap-2 overflow-y-auto py-1 sm:grid-cols-2">
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
                    <label
                      key={entry.id}
                      className="flex items-start gap-2 text-xs"
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
                        <small className="block text-muted-foreground">
                          {entry.clientPattern}
                          {!applicable ? ' · Unavailable / 不适用' : ''}
                        </small>
                      </span>
                    </label>
                  );
                })}
              </div>
              {!library.length && (
                <p className="text-xs text-muted-foreground">
                  Create library entries in Assumptions first. /
                  请先在假设库添加内容。
                </p>
              )}
            </fieldset>
            <p className="text-xs text-muted-foreground">
              Exact client match (case-insensitive); * is common. Changes affect
              future projects. Existing project templates remain unchanged. /
              客户完整名称匹配，不区分大小写；修改作为未来项目数据来源，已有项目模板不变。
            </p>
          </div>
        )}
      </div>
    </>
  );
}
