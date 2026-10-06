import type { QuoteBodyLayout } from '@/features/quote/excel-template-types';
import { defaultBodyTitles } from '@/features/quote/structured-body';

export function emptyBodyLayout(): QuoteBodyLayout {
  return {
    startRow: 0,
    endRow: 0,
    styles: { chapter: 0, category: 0, detail: 0, subtotal: 0, total: 0 },
    numbering: 'hierarchical',
    categoryOrder: [],
    titles: { ...defaultBodyTitles },
  };
}
const cellControl =
  'h-8 w-full min-w-0 border-0 bg-transparent px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring';
const titleLabels: Record<keyof QuoteBodyLayout['titles'], string> = {
  mandatory: 'Mandatory chapter',
  optional: 'Optional chapter',
  category: 'Category heading',
  subtotal: 'Category Subtotal',
  mandatoryTotal: 'Mandatory total',
  optionalTotal: 'Optional total',
  discount: 'Discount',
  grandTotal: 'Grand Total',
};
/** Style prototypes repeat for every category; fixed sample wording never becomes business data. */
export function QuoteBodyLayoutEditor({
  value,
  onChange,
}: {
  value: QuoteBodyLayout;
  onChange: (value: QuoteBodyLayout) => void;
}) {
  return (
    <section aria-label="Structured quotation body" className="space-y-2">
      <p className="text-xs leading-5 text-muted-foreground">
        Select the entire original quotation body, including all sample
        headings, details, subtotals and totals. The system replaces it with
        actual categories and items. Empty chapters and their totals disappear
        together. Header and terms outside this range are retained.
      </p>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[440px] text-left text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-2 py-2 font-medium">Layout setting</th>
              <th className="px-2 py-2 font-medium">Original row / value</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(['startRow', 'endRow'] as const).map((key) => (
              <tr key={key}>
                <th className="w-44 px-2 font-normal">
                  {key === 'startRow' ? 'Body start' : 'Body end'}
                </th>
                <td>
                  <input
                    className={cellControl}
                    aria-label={
                      key === 'startRow' ? 'Body start row' : 'Body end row'
                    }
                    type="number"
                    min={1}
                    max={20000}
                    value={value[key] || ''}
                    onChange={(e) =>
                      onChange({ ...value, [key]: Number(e.target.value) })
                    }
                  />
                </td>
              </tr>
            ))}
            {(
              ['chapter', 'category', 'detail', 'subtotal', 'total'] as const
            ).map((role) => (
              <tr key={role}>
                <th className="px-2 font-normal capitalize">
                  {role} style row
                </th>
                <td>
                  <input
                    className={cellControl}
                    aria-label={`${role} style row`}
                    type="number"
                    min={1}
                    max={20000}
                    value={value.styles[role] || ''}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        styles: {
                          ...value.styles,
                          [role]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
            {(['mandatory', 'optional'] as const).map((key) => (
              <tr key={key}>
                <th className="px-2 font-normal">
                  {key === 'mandatory' ? 'Mandatory' : 'Optional'} section name
                </th>
                <td>
                  <input
                    className={cellControl}
                    aria-label={`${key} section name`}
                    maxLength={120}
                    value={
                      value.sectionNames?.[key] ??
                      (key === 'mandatory' ? 'Mandatory' : 'Optional')
                    }
                    onChange={(e) =>
                      onChange({
                        ...value,
                        sectionNames: {
                          mandatory: 'Mandatory',
                          optional: 'Optional',
                          ...value.sectionNames,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
            {(
              [
                ['chapterHeading', 'After each section heading'],
                ['category', 'After each category'],
                ['mandatory', 'After Mandatory section'],
                ['optional', 'After Optional section'],
              ] as const
            ).map(([key, label]) => (
              <tr key={key}>
                <th className="px-2 font-normal">{label}</th>
                <td>
                  <select
                    className={cellControl}
                    aria-label={`${label} blank rows`}
                    value={value.spacing?.[key] ?? 0}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        spacing: {
                          ...value.spacing,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option value={n} key={n}>
                        {n} blank {n === 1 ? 'row' : 'rows'}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            <tr>
              <th className="px-2 font-normal">Category Subtotals</th>
              <td className="px-2">
                <label className="flex h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={value.showSubtotals !== false}
                    onChange={(e) =>
                      onChange({ ...value, showSubtotals: e.target.checked })
                    }
                  />
                  Include category Subtotals
                </label>
              </td>
            </tr>
            <tr>
              <th className="px-2 font-normal">Item numbering</th>
              <td>
                <select
                  aria-label="Item numbering"
                  className={cellControl}
                  value={value.numbering}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      numbering: e.target.value as QuoteBodyLayout['numbering'],
                    })
                  }
                >
                  <option value="hierarchical">Hierarchical · 1.1.1</option>
                  <option value="continuous">Continuous · 1, 2, 3</option>
                  <option value="alphabetic">Per category · a, b, c</option>
                </select>
              </td>
            </tr>
            <tr>
              <th className="px-2 font-normal">Category order</th>
              <td>
                <input
                  aria-label="Category order"
                  className={cellControl}
                  placeholder="Professional Service, Maintenance (remaining categories follow data order)"
                  value={value.categoryOrder.join(',')}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      categoryOrder: e.target.value.split(','),
                    })
                  }
                  onBlur={() =>
                    onChange({
                      ...value,
                      categoryOrder: value.categoryOrder
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-xs text-left">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-2 py-2 font-medium">
                Category spacing override
              </th>
              <th className="px-2 font-medium">Blank rows after category</th>
              <th>
                <button
                  type="button"
                  className="h-8 px-2 text-primary focus-visible:outline-2 focus-visible:outline-ring"
                  onClick={() =>
                    onChange({
                      ...value,
                      categorySpacing: [
                        ...(value.categorySpacing ?? []),
                        { category: '', rows: 1 },
                      ],
                    })
                  }
                >
                  Add spacing rule
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {value.categorySpacing?.map((rule, index) => (
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Spacing category ${index + 1}`}
                    className={cellControl}
                    maxLength={120}
                    value={rule.category}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        categorySpacing: value.categorySpacing!.map((row, i) =>
                          i === index
                            ? { ...row, category: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <select
                    aria-label={`Category spacing rows ${index + 1}`}
                    className={cellControl}
                    value={rule.rows}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        categorySpacing: value.categorySpacing!.map((row, i) =>
                          i === index
                            ? { ...row, rows: Number(event.target.value) }
                            : row,
                        ),
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="h-8 px-2 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                    aria-label={`Remove spacing rule ${index + 1}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        categorySpacing: value.categorySpacing!.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full min-w-[440px] text-left text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className="w-44 px-2 py-2 font-medium">Generated heading</th>
              <th className="px-2 py-2 font-medium">Text / placeholders</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {(Object.keys(titleLabels) as Array<keyof typeof titleLabels>).map(
              (key) => (
                <tr key={key}>
                  <th className="px-2 font-normal">{titleLabels[key]}</th>
                  <td>
                    <input
                      aria-label={`${titleLabels[key]} text`}
                      className={cellControl}
                      value={value.titles[key] ?? defaultBodyTitles[key]}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          titles: { ...value.titles, [key]: e.target.value },
                        })
                      }
                    />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Headings support {'{section}, {project}, {category}, {chapterNumber}'}{' '}
        and the cell placeholders below. Style rows must be inside the body.
        Cell content mappings must be outside it.
      </p>
    </section>
  );
}
