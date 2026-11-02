import { Text, Surface } from '@/components/ui/presentation';
import { Table } from '@/components/ui/table';
import { TableHeader } from '@/components/ui/table';
import { TableRow } from '@/components/ui/table';
import { TableHead } from '@/components/ui/table';
import { TableBody } from '@/components/ui/table';
import { TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/select-field';
import { CheckInput } from '@/components/ui/check-input';
import { Button } from '@/components/ui/button';
import type { QuoteBodyLayout } from '@/features/quote/excel-template-types';
import { defaultBodyTitles } from '@/features/quote/structured-body';

export function emptyBodyLayout(): QuoteBodyLayout {
  return {
    startRow: 0,
    endRow: 0,
    styles: { chapter: 0, category: 0, detail: 0, subtotal: 0, total: 0 },
    numbering: 'hierarchical',
    categoryOrder: [],
    titles: {
      ...defaultBodyTitles,
      section: '{section}',
      sectionTotal: 'Total price for {section} items',
    },
  };
}
const titleLabels = {
  section: 'Section heading',
  category: 'Category heading',
  subtotal: 'Category Subtotal',
  sectionTotal: 'Section total',
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
      <Text as="p" tone="muted" textRole="body-small">
        Select the entire original quotation body, including all sample
        headings, details, subtotals and totals. The system replaces it with
        actual categories and items. Empty chapters and their totals disappear
        together. Header and terms outside this range are retained.
      </Text>
      <Surface as="div" variant="panel" className="overflow-x-auto">
        <Table className="w-full min-w-[440px] text-left">
          <TableHeader>
            <TableRow>
              <TableHead>Layout setting</TableHead>
              <TableHead>Original row / value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(['startRow', 'endRow'] as const).map((key) => (
              <TableRow key={key}>
                <TableHead className="w-44">
                  {key === 'startRow' ? 'Body start' : 'Body end'}
                </TableHead>
                <TableCell>
                  <Input
                    variant="grid"
                    className="w-full min-w-0"
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
                </TableCell>
              </TableRow>
            ))}
            {(
              [
                'chapter',
                'category',
                'detail',
                'subtotal',
                'total',
                'grandTotal',
              ] as const
            ).map((role) => (
              <TableRow key={role}>
                <TableHead className="capitalize">
                  {role === 'grandTotal' ? 'Grand Total' : role} style row
                </TableHead>
                <TableCell>
                  <Input
                    variant="grid"
                    className="w-full min-w-0"
                    aria-label={`${role === 'grandTotal' ? 'Grand Total' : role} style row`}
                    type="number"
                    min={1}
                    max={20000}
                    value={
                      value.styles[role] ??
                      (role === 'grandTotal' ? value.styles.total : '')
                    }
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
                </TableCell>
              </TableRow>
            ))}
            {(
              [
                ['chapterHeading', 'After section heading'],
                ['category', 'After category block (default)'],
                ['section', 'After section block (default)'],
              ] as const
            ).map(([key, label]) => (
              <TableRow key={key}>
                <TableHead>{label}</TableHead>
                <TableCell>
                  <SelectField
                    variant="grid"
                    className="h-8 w-full min-w-0"
                    aria-label={`${label} blank rows`}
                    value={
                      value.spacing?.[key] ??
                      (key === 'section'
                        ? (value.spacing?.mandatory ?? value.spacing?.optional)
                        : 0) ??
                      0
                    }
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
                  </SelectField>
                </TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableHead>Category Subtotals</TableHead>
              <TableCell>
                <label className="flex h-8 items-center gap-2">
                  <CheckInput
                    type="checkbox"
                    checked={value.showSubtotals !== false}
                    onChange={(e) =>
                      onChange({ ...value, showSubtotals: e.target.checked })
                    }
                  />
                  Include category Subtotals
                </label>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableHead>Item numbering</TableHead>
              <TableCell>
                <SelectField
                  variant="grid"
                  aria-label="Item numbering"
                  className="h-8 w-full min-w-0"
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
                </SelectField>
              </TableCell>
            </TableRow>
            <TableRow>
              <TableHead>Category order</TableHead>
              <TableCell>
                <Input
                  variant="grid"
                  aria-label="Category order"
                  className="w-full min-w-0"
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
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Surface>
      <Surface as="div" variant="panel" className="overflow-x-auto">
        <Surface as="p" variant="item" tone="muted" textRole="body-small">
          Section spacing exceptions (optional). Match the Section in Pricing
          &amp; Quote, not its Category or printed heading. For example,
          Implementation = 2 replaces the default with 2 blank rows after
          Implementation; 0 removes its spacing.
        </Surface>
        <Table className="w-full text-left">
          <TableHeader>
            <TableRow>
              <TableHead>Section name</TableHead>
              <TableHead>Blank rows after this section block</TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  type="button"

                  onClick={() =>
                    onChange({
                      ...value,
                      sectionSpacing: [
                        ...(value.sectionSpacing ?? []),
                        { section: '', rows: 1 },
                      ],
                    })
                  }
                >
                  Add section spacing rule
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!value.sectionSpacing?.length && (
              <TableRow>
                <TableCell colSpan={3}>
                  No section exceptions. Every section uses After section block
                  (default).
                </TableCell>
              </TableRow>
            )}
            {value.sectionSpacing?.map((rule, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Input
                    variant="grid"
                    aria-label={`Spacing section ${index + 1}`}
                    className="w-full min-w-0"
                    maxLength={120}
                    placeholder="e.g. Implementation"
                    value={rule.section}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        sectionSpacing: value.sectionSpacing!.map((row, i) =>
                          i === index
                            ? { ...row, section: event.target.value }
                            : row,
                        ),
                      })
                    }
                  />
                </TableCell>
                <TableCell>
                  <SelectField
                    variant="grid"
                    aria-label={`Section spacing rows ${index + 1}`}
                    className="h-8 w-full min-w-0"
                    value={rule.rows}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        sectionSpacing: value.sectionSpacing!.map((row, i) =>
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
                  </SelectField>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    type="button"

                    aria-label={`Remove section spacing rule ${index + 1}`}
                    onClick={() =>
                      onChange({
                        ...value,
                        sectionSpacing: value.sectionSpacing!.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Surface>
      <Surface as="div" variant="panel" className="overflow-x-auto">
        <Surface as="p" variant="item" tone="muted" textRole="body-small">
          Category spacing exceptions (optional). Match the Category in Pricing
          &amp; Quote, not its Section or printed heading. For example,
          Maintenance = 2 replaces the default with 2 blank rows after
          Maintenance; 0 removes its spacing.
        </Surface>
        <Table className="w-full text-left">
          <TableHeader>
            <TableRow>
              <TableHead>Category name</TableHead>
              <TableHead>Blank rows after this category block</TableHead>
              <TableHead>
                <Button
                  variant="ghost"
                  type="button"

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
                </Button>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!value.categorySpacing?.length && (
              <TableRow>
                <TableCell colSpan={3}>
                  No exceptions. Every category uses After category block
                  (default).
                </TableCell>
              </TableRow>
            )}
            {value.categorySpacing?.map((rule, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Input
                    variant="grid"
                    aria-label={`Spacing category ${index + 1}`}
                    className="w-full min-w-0"
                    maxLength={120}
                    placeholder="e.g. Maintenance"
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
                </TableCell>
                <TableCell>
                  <SelectField
                    variant="grid"
                    aria-label={`Category spacing rows ${index + 1}`}
                    className="h-8 w-full min-w-0"
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
                  </SelectField>
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    type="button"

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
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Surface>
      <Surface as="div" variant="panel" className="overflow-x-auto">
        <Table className="w-full min-w-[440px] text-left">
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">Generated heading</TableHead>
              <TableHead>Text / placeholders</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(Object.keys(titleLabels) as Array<keyof typeof titleLabels>).map(
              (key) => (
                <TableRow key={key}>
                  <TableHead>{titleLabels[key]}</TableHead>
                  <TableCell>
                    <Input
                      variant="grid"
                      aria-label={`${titleLabels[key]} text`}
                      className="w-full min-w-0"
                      value={
                        value.titles[key] ??
                        (key === 'section'
                          ? value.titles.mandatory
                          : key === 'sectionTotal'
                            ? value.titles.mandatoryTotal
                            : defaultBodyTitles[key])
                      }
                      onChange={(e) =>
                        onChange({
                          ...value,
                          titles: { ...value.titles, [key]: e.target.value },
                        })
                      }
                    />
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      </Surface>
      <Text as="p" tone="muted" textRole="body-small">
        Headings support {'{section}, {project}, {category}, {chapterNumber}'}{' '}
        and the cell placeholders below. Style rows must be inside the body.
        Cell content mappings must be outside it. Section titles are edited on
        Pricing &amp; Quote, not in the template. Grand Total style row controls
        its font, fill, borders, alignment and number format independently of
        section totals. Heading spacing inserts rows before the first category.
        Section block spacing inserts rows after its total. Named section rules
        match the Section in Pricing &amp; Quote. Category block spacing inserts
        rows after its details and Subtotal. A named category override replaces
        the default category block spacing (including 0); it applies wherever
        that category appears.
      </Text>
    </section>
  );
}
