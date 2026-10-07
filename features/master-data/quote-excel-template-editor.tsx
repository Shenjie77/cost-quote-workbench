'use client';

import { editableSectionLayout } from '@/features/quote/structured-body';
import { categoryKey } from '@/features/quote/quotation-groups';

import { QuoteLayoutLibrary } from './quote-layout-library';
import {
  applySavedLayout,
  reusableLayout,
} from '@/features/quote/layout-presets';

import {
  book2ExampleMapping,
  book2StructuredMapping,
} from '@/features/quote/book2-example-mapping';

import {
  QuoteBodyLayoutEditor,
  emptyBodyLayout,
} from './quote-body-layout-editor';

import { useEffect, useRef, useState } from 'react';
import { contentKey } from '@/features/cpq/domain';
import {
  Download,
  FileSpreadsheet,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_QUOTE_TEMPLATE_BYTES,
  inspectQuoteExcelTemplate,
  loadQuoteExcelTemplate,
  uploadQuoteExcelTemplate,
} from '@/features/quote/excel-template-client';
import {
  MAX_QUOTE_TEMPLATE_ROW,
  validateQuoteExcelMapping,
} from '@/features/quote/excel-template-mapping';
import type {
  QuoteExcelAsset,
  QuoteExcelColumns,
  QuoteExcelTemplate,
} from '@/features/quote/excel-template-types';

/** Strings preserve incomplete row input locally until the user explicitly applies a valid mapping. */
type MappingDraft = Omit<QuoteExcelTemplate, 'detailRow'> & {
  detailRow: string;
};
type EditorProps = {
  templateId: string;
  value?: QuoteExcelTemplate;
  onChange: (mapping: QuoteExcelTemplate | undefined) => void;
};

/** Customer-visible line fields are distinct from internal cost and resource-rate inputs. */
const columnLabels: Array<[keyof QuoteExcelColumns, string]> = [
  ['description', 'Description column *'],
  ['amount', 'Amount column *'],
  ['number', 'Line number column'],
  ['quantity', 'Quantity column'],
  ['unit', 'Unit column'],
  ['unitPrice', 'Unit price column'],
];

/** Start with one sample detail row; the workbook stays immutable while this mapping is edited. */
function initialDraft(asset: QuoteExcelAsset): MappingDraft {
  return {
    assetId: asset.assetId,
    fileName: asset.fileName,
    sheetName: asset.sheets[0]?.name || '',
    detailRow: '12',
    body: emptyBodyLayout(),
    columns: { description: 'B', amount: 'F' },
    cells: {},
  };
}

/** Existing mappings are cloned so editing this form cannot mutate published template snapshots. */
function editableMapping(value?: QuoteExcelTemplate): MappingDraft | undefined {
  if (!value) return undefined;
  const copy = structuredClone(value);
  if (copy.body) copy.body = editableSectionLayout(copy.body);
  const textCells = [...(copy.textCells ?? [])];
  const cells: QuoteExcelTemplate['cells'] = {};
  for (const [field, address] of Object.entries(copy.cells)) {
    // Preserve legacy tax clearing while exposing all supported mappings as editable placeholders.
    if (field === 'gstPercent' || field === 'gstAmount') {
      cells[field] = address;
    } else if (
      address &&
      !textCells.some(
        (cell) => cell.address.toUpperCase() === address.toUpperCase(),
      )
    ) {
      textCells.push({ address, content: '{' + field + '}' });
    }
  }
  return { ...copy, cells, textCells, detailRow: String(copy.detailRow) };
}

/** Blank optional fields are omitted; uppercase coordinates are canonical for validation and export. */
function mappingFromDraft(draft: MappingDraft): QuoteExcelTemplate {
  const columns = Object.fromEntries(
    Object.entries(draft.columns)
      .map(([key, value]) => [key, value.trim().toUpperCase()])
      .filter(
        ([key, value]) => value || key === 'description' || key === 'amount',
      ),
  ) as QuoteExcelColumns;
  const cells = Object.fromEntries(
    Object.entries(draft.cells)
      .map(([key, value]) => [key, value.trim().toUpperCase()])
      .filter(([, value]) => value),
  );
  const { body, regions, ...base } = draft;
  return {
    ...base,
    ...(body ? { body } : {}),
    ...(regions ? { regions } : {}),
    columns,
    cells,
    ...(draft.textCells
      ? {
          textCells: draft.textCells.map((cell) => ({
            ...cell,
            address: cell.address.trim().toUpperCase(),
          })),
        }
      : {}),
    detailRow: Number(draft.detailRow),
  };
}

/** Synthetic lines exercise configured categories without reading or archiving any project. */
async function sampleWorkbook(
  mapping: QuoteExcelTemplate,
  includeOptional = true,
) {
  const [
    { buildQuoteWorkbookBuffer },
    { calculatePricing, initialPricingSettings },
  ] = await Promise.all([
    import('@/features/quote/export-quote-workbook'),
    import('@/features/quote/domain'),
  ]);
  const seenCategories = new Set(
    ['Professional Service', 'Custom category'].map(categoryKey),
  );
  const spacingCategories = (mapping.body?.categorySpacing ?? [])
    .map((rule) => rule.category.trim())
    .filter((category) => {
      const key = categoryKey(category);
      if (!key || seenCategories.has(key)) return false;
      seenCategories.add(key);
      return true;
    });
  const spacingLines = spacingCategories.map((category, index) => ({
    id: `sample-spacing-${index + 1}`,
    description: `Sample ${category} item`,
    quantity: 1,
    unit: 'lot',
    unitPrice: 100,
    amount: 100,
  }));
  const seenSections = new Set([
    'mandatory',
    ...(includeOptional ? ['optional'] : []),
  ]);
  const spacingSections = (mapping.body?.sectionSpacing ?? [])
    .map((rule) => rule.section.trim())
    .filter((section) => {
      const key = categoryKey(section);
      if (!key || seenSections.has(key)) return false;
      seenSections.add(key);
      return true;
    });
  const sectionLines = spacingSections.map((section, index) => ({
    id: `sample-section-${index + 1}`,
    description: `Sample ${section} service`,
    quantity: 1,
    unit: 'lot',
    unitPrice: 100,
    amount: 100,
  }));
  return buildQuoteWorkbookBuffer({
    project: {
      id: 'SAMPLE',
      name: 'Sample Project',
      client: 'Sample Customer',
      currency: 'SGD',
    },
    quoteNumber: 'SAMPLE-NOT-A-QUOTATION',
    costVersion: 'SAMPLE',
    template: {
      id: 'sample-template',
      name: 'Sample layout test',
      clientPattern: '*',
      active: true,
      documentTitle: 'SAMPLE — NOT A QUOTATION',
      validityDays: 30,
      paymentTerms: 'Sample payment terms only.',
      termsAndConditions: '',
      defaultAssumptionIds: [],
      excel: mapping,
    },
    assumptions: [],
    pricing: calculatePricing(
      1200 + (spacingLines.length + sectionLines.length) * 80,
      {
        ...initialPricingSettings,
        targetGrossMargin: 20,
        ...(mapping.body
          ? {
              lineGroups: {
                ...Object.fromEntries(
                  sectionLines.map((line, index) => [
                    line.id,
                    {
                      category: 'Professional Service',
                      section: spacingSections[index],
                      inclusion: 'mandatory' as const,
                    },
                  ]),
                ),
                ...Object.fromEntries(
                  spacingLines.map((line, index) => [
                    line.id,
                    {
                      category: spacingCategories[index],
                      inclusion: 'mandatory' as const,
                    },
                  ]),
                ),
                'sample-1': {
                  category: 'Professional Service',
                  inclusion: 'mandatory' as const,
                },
                'sample-2': {
                  category: 'Custom category',
                  inclusion: 'mandatory' as const,
                },
                'sample-3': {
                  category: 'Professional Service',
                  inclusion: includeOptional
                    ? ('optional' as const)
                    : ('mandatory' as const),
                },
              },
            }
          : {}),
        ...(mapping.regions?.length
          ? {
              lineGroups: Object.fromEntries(
                ['sample-1', 'sample-2', 'sample-3'].map((id) => [
                  id,
                  {
                    category:
                      mapping.regions![0].source === 'category'
                        ? mapping.regions![0].category!
                        : mapping.regions![0].source === 'maintenance'
                          ? 'Maintenance'
                          : 'Professional Service',
                    inclusion:
                      mapping.regions![0].source === 'optional'
                        ? ('optional' as const)
                        : (mapping.regions![0].inclusion ?? 'mandatory'),
                  },
                ]),
              ),
            }
          : {}),
      },
    ),
    lineMode: 'item',
    lines: [
      {
        id: 'sample-1',
        description: 'Sample planning service',
        quantity: 1,
        unit: 'lot',
        unitPrice: 300,
        amount: 300,
      },
      {
        id: 'sample-2',
        description: 'Sample configuration service',
        quantity: 2,
        unit: 'unit',
        unitPrice: 250,
        amount: 500,
      },
      {
        id: 'sample-3',
        description: 'Sample testing and handover',
        quantity: 1,
        unit: 'lot',
        unitPrice: 700,
        amount: 700,
      },
      ...spacingLines,
      ...sectionLines,
    ],
  });
}

/** The keyed session isolates asynchronous uploads and staged edits when another template is selected. */
export function QuoteExcelTemplateEditor(props: EditorProps) {
  return (
    <QuoteExcelTemplateEditorSession
      key={`${props.templateId}:${JSON.stringify(props.value ?? null)}`}
      {...props}
    />
  );
}

/** Uploads are local assets; only Apply or Remove updates the caller's unsaved template draft. */
function QuoteExcelTemplateEditorSession({ value, onChange }: EditorProps) {
  const [draft, setDraft] = useState(() => editableMapping(value));
  const [asset, setAsset] = useState<QuoteExcelAsset | null>(null);
  const [busy, setBusy] = useState(!!value);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(!!value);
  const assetId = value?.assetId;

  // A closed or switched editor must never apply a late response to another template.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current += 1;
    };
  }, []);

  // Keyed mappings initialize state once; this effect only inspects the immutable local source.
  useEffect(() => {
    if (!assetId) return;
    const token = ++request.current;
    void inspectQuoteExcelTemplate(assetId)
      .then((result) => {
        if (alive.current && token === request.current) setAsset(result);
      })
      .catch((failure) => {
        if (alive.current && token === request.current)
          setError(
            failure instanceof Error
              ? failure.message
              : 'Cannot load the local workbook.',
          );
      })
      .finally(() => {
        if (alive.current && token === request.current) {
          inFlight.current = false;
          setBusy(false);
        }
      });
    return () => {
      request.current += 1;
    };
  }, [assetId]);

  /** Stage a newly uploaded asset; valid existing mappings remain unchanged until Apply is chosen. */
  async function upload(file: File) {
    if (inFlight.current) return;
    if (
      !/\.xlsx$/i.test(file.name) ||
      file.size > MAX_QUOTE_TEMPLATE_BYTES ||
      file.size === 0
    ) {
      setError('Choose a non-empty .xlsx file no larger than 10 MB.');
      return;
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadQuoteExcelTemplate(file);
      if (!alive.current || token !== request.current) return;
      setAsset(result);
      setDraft(
        draft
          ? editableMapping(
              applySavedLayout(
                reusableLayout(mappingFromDraft(draft)),
                result,
                draft.sheetName,
              ),
            )
          : initialDraft(result),
      );
      setNotice(
        'Workbook uploaded locally. Existing layout settings are retained; check the original coordinates and apply the mapping.',
      );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Workbook upload failed.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Validate coordinates and an actual three-row fill before updating the master-data draft; nothing is archived. */
  async function apply() {
    if (!draft || !asset || inFlight.current) return;
    const mapping = mappingFromDraft(draft);
    const errors = validateQuoteExcelMapping(mapping, asset.sheets);
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      // Building without a download catches merge and formula conflicts while leaving the source untouched.
      await sampleWorkbook(mapping);
      if (mapping.body) await sampleWorkbook(mapping, false);
      if (!alive.current || token !== request.current) return;
      onChange(mapping);
      setNotice(
        'Mapping validated and applied to this draft. Save this master-data tab to publish it.',
      );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'The mapping could not be validated against this workbook.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Download the original or a synthetic fill; neither path creates project archive/history records. */
  async function downloadWorkbook(sample = false) {
    if (!draft || inFlight.current) return;
    const mapping = mappingFromDraft(draft);
    if (sample) {
      if (!asset) return;
      const errors = validateQuoteExcelMapping(mapping, asset.sheets);
      if (errors.length) {
        setError(errors.join(' '));
        return;
      }
    }
    const token = ++request.current;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const bytes = sample
        ? await sampleWorkbook(mapping)
        : await loadQuoteExcelTemplate(mapping.assetId);
      if (!alive.current || token !== request.current) return;
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes).buffer], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = sample ? `SAMPLE_${mapping.fileName}` : mapping.fileName;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (sample)
        setNotice(
          'Sample workbook downloaded with synthetic quotation sections and items. Check its layout in Excel; no project or quotation history was changed.',
        );
    } catch (failure) {
      if (alive.current && token === request.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Cannot download the workbook.',
        );
    } finally {
      if (alive.current && token === request.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }

  /** Removing an association restores the standard layout; immutable assets and project copies are retained. */
  function remove() {
    if (inFlight.current) return;
    request.current += 1;
    setDraft(undefined);
    setAsset(null);
    setError('');
    setNotice(
      'Standard quotation layout selected. Save this master-data tab to publish it.',
    );
    if (value) onChange(undefined);
  }

  const changed =
    draft && contentKey(mappingFromDraft(draft)) !== contentKey(value);
  return (
    <section
      className="space-y-3 rounded-md border bg-muted/10 p-3"
      aria-label="Customer Excel template"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <FileSpreadsheet className="size-4" /> Customer Excel layout
        </h3>
        {changed && (
          <span className="text-xs font-medium text-amber-700">
            Mapping not applied
          </span>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Upload a plain .xlsx workbook (up to 10 MB). Files stay in this
        workbench&apos;s local database. Without an Excel mapping, quotations
        use the standard layout. Apply validates the local workbook; save this
        master-data tab to publish the mapping.
      </p>
      <label className="block space-y-1 text-xs font-medium">
        <span className="flex items-center gap-1.5">
          <Upload className="size-3.5" /> Upload or replace workbook
        </span>
        <Input
          type="file"
          accept=".xlsx"
          disabled={busy}
          aria-label="Upload customer Excel template"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
      </label>
      {draft && (
        <fieldset disabled={busy} className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
            <span className="break-all text-xs font-medium">
              {draft.fileName}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void downloadWorkbook()}
            >
              <Download /> Download original
            </Button>
          </div>
          {asset && (
            <QuoteLayoutLibrary
              mapping={mappingFromDraft(draft)}
              disabled={busy}
              onApply={(layout) =>
                setDraft(
                  editableMapping(
                    applySavedLayout(layout, asset, draft.sheetName),
                  ),
                )
              }
              validate={async () => {
                const mapping = mappingFromDraft(draft),
                  errors = validateQuoteExcelMapping(mapping, asset.sheets);
                if (errors.length) throw new Error(errors.join(' '));
                await sampleWorkbook(mapping);
                await sampleWorkbook(mapping, false);
              }}
            />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-xs">
              Worksheet
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                aria-label="Template worksheet"
                value={draft.sheetName}
                onChange={(event) =>
                  setDraft({ ...draft, sheetName: event.target.value })
                }
              >
                {!asset && (
                  <option value={draft.sheetName}>{draft.sheetName}</option>
                )}
                {asset?.sheets.map((sheet) => (
                  <option key={sheet.name} value={sheet.name}>
                    {sheet.name} ({sheet.rowCount} rows × {sheet.columnCount}{' '}
                    columns)
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              Output mode
              <select
                aria-label="Quotation output mode"
                className="h-9 w-full rounded-md border bg-background px-2"
                value={draft.body ? 'body' : 'legacy'}
                onChange={(event) => {
                  if (event.target.value === 'body') {
                    setDraft({
                      ...draft,
                      body: emptyBodyLayout(),
                      regions: undefined,
                    });
                    setNotice(
                      'Set the full body range, including all old headings and totals. Move cell placeholders outside that range.',
                    );
                  } else setDraft({ ...draft, body: undefined });
                }}
              >
                <option value="body">Structured body (Recommended)</option>
                <option value="legacy">Legacy rows / regions</option>
              </select>
            </label>
          </div>
          {draft.body ? (
            <>
              <QuoteBodyLayoutEditor
                value={draft.body}
                onChange={(body) => setDraft({ ...draft, body })}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft(
                    editableMapping(
                      book2StructuredMapping(mappingFromDraft(draft)),
                    ),
                  )
                }
              >
                Use Book2 structured layout
              </Button>
            </>
          ) : (
            <label className="block max-w-xs space-y-1 text-xs">
              Repeatable detail row *
              <Input
                aria-label="Repeatable detail row"
                type="number"
                min={1}
                max={MAX_QUOTE_TEMPLATE_ROW}
                value={draft.detailRow}
                onChange={(event) =>
                  setDraft({ ...draft, detailRow: event.target.value })
                }
              />
            </label>
          )}
          <p className="text-xs leading-5 text-muted-foreground">
            Use original workbook coordinates. Content below the generated rows
            moves automatically. Column mappings apply to detail rows; style
            rows supply formatting only.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {columnLabels.map(([field, label]) => (
              <label key={field} className="block space-y-1 text-xs">
                {label}
                <Input
                  aria-label={label}
                  placeholder={
                    field === 'description'
                      ? 'B'
                      : field === 'amount'
                        ? 'F'
                        : 'Optional'
                  }
                  maxLength={3}
                  value={draft.columns[field] || ''}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      columns: {
                        ...draft.columns,
                        [field]: event.target.value,
                      },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {!draft.body && (
            <>
              <details
                open
                className="space-y-3 rounded-md border bg-background p-3"
              >
                <summary className="cursor-pointer text-xs font-medium">
                  Dynamic quotation modules
                </summary>
                <p className="text-xs text-muted-foreground">
                  Use original row numbers. Rows before/after the sample detail
                  rows are retained as headings/subtotals. Actual items replace
                  all sample detail rows. An empty module removes its entire
                  region, including headings. Put project-wide totals outside
                  module regions.
                </p>
                {(draft.regions ?? []).map((region, index) => (
                  <div
                    key={index}
                    className="grid gap-2 border-b pb-2 sm:grid-cols-6"
                  >
                    <label className="text-xs">
                      Module
                      <select
                        aria-label={`Module ${index + 1} source`}
                        className="h-9 w-full border bg-background px-1"
                        value={region.source}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            regions: draft.regions!.map((r, i) =>
                              i === index
                                ? {
                                    ...r,
                                    source: e.target.value as typeof r.source,
                                  }
                                : r,
                            ),
                          })
                        }
                      >
                        <option value="service">Professional Service</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="optional">
                          All Optional categories
                        </option>
                        <option value="category">Custom category</option>
                      </select>
                    </label>
                    {region.source === 'category' && (
                      <label className="text-xs">
                        Category title
                        <Input
                          aria-label={`Module ${index + 1} category`}
                          placeholder="Same category as quotation lines"
                          maxLength={120}
                          value={region.category ?? ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              regions: draft.regions!.map((r, i) =>
                                i === index
                                  ? { ...r, category: e.target.value }
                                  : r,
                              ),
                            })
                          }
                        />
                      </label>
                    )}
                    {region.source !== 'optional' && (
                      <label className="text-xs">
                        Inclusion
                        <select
                          aria-label={`Module ${index + 1} inclusion`}
                          className="h-9 w-full border bg-background px-1"
                          value={region.inclusion ?? 'mandatory'}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              regions: draft.regions!.map((r, i) =>
                                i === index
                                  ? {
                                      ...r,
                                      inclusion: e.target.value as
                                        | 'mandatory'
                                        | 'optional',
                                    }
                                  : r,
                              ),
                            })
                          }
                        >
                          <option value="mandatory">Mandatory</option>
                          <option value="optional">Optional</option>
                        </select>
                      </label>
                    )}
                    {(
                      [
                        ['startRow', 'Region start'],
                        ['detailRow', 'First detail'],
                        ['detailEndRow', 'Last detail'],
                        ['endRow', 'Region end'],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key} className="text-xs">
                        {label}
                        <Input
                          aria-label={`Module ${index + 1} ${label}`}
                          type="number"
                          min={1}
                          max={20000}
                          value={region[key] || ''}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              regions: draft.regions!.map((r, i) =>
                                i === index
                                  ? { ...r, [key]: Number(e.target.value) }
                                  : r,
                              ),
                            })
                          }
                        />
                      </label>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          regions: draft.regions!.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(draft.regions?.length ?? 0) >= 50}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        regions: [
                          ...(draft.regions ?? []),
                          {
                            source: !draft.regions?.length
                              ? 'service'
                              : draft.regions.length === 1
                                ? 'maintenance'
                                : 'category',
                            startRow: 0,
                            endRow: 0,
                            detailRow: 0,
                            detailEndRow: 0,
                          },
                        ],
                      })
                    }
                  >
                    Add module region
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setDraft(
                        editableMapping(
                          book2ExampleMapping(mappingFromDraft(draft)),
                        ),
                      )
                    }
                  >
                    Use Book2 example mapping
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Match category titles to quotation lines (case-insensitive).
                  Each Category / Inclusion group must map to exactly one
                  region. Empty groups are removed. The Book2 example stages
                  coordinates only; review them before applying.
                </p>
              </details>
            </>
          )}
          <details
            open
            className="space-y-3 rounded-md border bg-background p-3"
          >
            <summary className="cursor-pointer text-xs font-medium">
              Cell content and placeholders
            </summary>
            <p className="text-xs text-muted-foreground">
              Combine fixed text and fields, e.g. Date of quotation: {'{date}'},
              Quotation for {'{project}'}. A lone amount token stays numeric.
              Add only the cells you want to fill. All placeholders are
              optional; unmapped cells retain their existing content or
              formulas.
            </p>
            <p className="text-xs text-muted-foreground">
              Fields:{' '}
              {
                '{date} {quoteNumber} {client} {project} {costVersion} {currency} {documentTitle} {companyName} {companyAddress} {quoteBeforeTax} {quoteAfterTax} {servicePrice} {maintenancePrice} {optionalPrice} {grandTotal} {discount} {validityDays} {paymentTerms} {termsAndConditions} {assumptions} {documentStatus}'
              }
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-xs">
                Date format
                <select
                  aria-label="Quotation date format"
                  className="h-9 w-full border bg-background px-2"
                  value={draft.dateFormat ?? 'dd-mmm-yyyy'}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      dateFormat: e.target
                        .value as QuoteExcelTemplate['dateFormat'],
                    })
                  }
                >
                  <option value="dd-mmm-yyyy">30-Sep-2026</option>
                  <option value="yyyy-mm-dd">2026-09-30</option>
                  <option value="dd/mm/yyyy">30/09/2026</option>
                </select>
              </label>
              {(['companyName', 'companyAddress'] as const).map((key) => (
                <label key={key} className="text-xs">
                  {key === 'companyName' ? 'Company name' : 'Company address'}
                  <Input
                    aria-label={key}
                    value={draft.variables?.[key] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        variables: {
                          ...draft.variables,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {(draft.textCells ?? []).map((cell, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  aria-label={`Text cell ${index + 1} address`}
                  className="w-24 shrink-0"
                  placeholder="B12"
                  value={cell.address}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      textCells: draft.textCells!.map((c, i) =>
                        i === index ? { ...c, address: e.target.value } : c,
                      ),
                    })
                  }
                />
                <Input
                  aria-label={`Text cell ${index + 1} content`}
                  placeholder="Date of quotation: {date}"
                  value={cell.content}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      textCells: draft.textCells!.map((c, i) =>
                        i === index ? { ...c, content: e.target.value } : c,
                      ),
                    })
                  }
                />
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Remove text cell ${index + 1}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      textCells: draft.textCells!.filter((_, i) => i !== index),
                    })
                  }
                >
                  Remove
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDraft({
                  ...draft,
                  textCells: [
                    ...(draft.textCells ?? []),
                    { address: '', content: '' },
                  ],
                })
              }
            >
              Add cell content
            </Button>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={apply} disabled={!asset}>
              Apply mapping
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!asset}
              onClick={() => void downloadWorkbook(true)}
            >
              <Download />{' '}
              {draft.body ? 'Sample workbook' : 'Test with sample rows'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!asset}
              onClick={() => {
                if (!asset) return;
                setDraft(initialDraft(asset));
                setError('');
                setNotice(
                  'Default coordinates restored locally. Apply the mapping when ready.',
                );
              }}
            >
              <RotateCcw /> Reset mapping
            </Button>
            <Button size="sm" variant="ghost" onClick={remove}>
              <Trash2 /> Remove Excel layout
            </Button>
          </div>
          {draft.body && (
            <p className="text-xs text-muted-foreground">
              Samples include the sections and categories named in the spacing
              rules so you can check their blank rows.
            </p>
          )}
        </fieldset>
      )}
      {busy && (
        <output className="block text-xs text-muted-foreground">
          Reading local workbook…
        </output>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <output className="block text-xs leading-5 text-muted-foreground">
          {notice}
        </output>
      )}
    </section>
  );
}
