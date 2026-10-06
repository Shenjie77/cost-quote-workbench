# Structured quotation templates

In **Master Data → Quote Templates → Customer Excel layout**, upload an XLSX and select **Structured body (Recommended)**. Existing mappings stay in legacy mode until explicitly converted.

1. Set the original **Body start / Body end** around the entire quotation schedule, including old Mandatory and Optional headings, sample details, subtotals, totals and spacer rows.
2. Select five original style rows inside the body: chapter, category, detail, subtotal and total. Styles repeat as needed. Their sample labels, numbers and formulas are replaced.
3. Map detail columns. Choose hierarchical, continuous or alphabetic numbering; optionally list category order. Categories not listed follow their order in the quotation data.
4. Edit generated heading patterns, for example `Mandatory items for {project}`, `{category}` and `{category} Subtotal`.
5. Add outside-body cell content such as `Date of quotation: {date}`. `{documentTitle}` uses the template's Document title. Footer totals should use `{quoteBeforeTax}` or `{optionalPrice}`, rather than formulas over the replaced body.
6. Use **Sample with Optional** and **Sample without Optional** to review both cases. **Apply mapping** validates both; **Save this tab** publishes the mapping. In an existing project's Pricing & Quote page, select the updated template and click **Apply Template**.

For the supplied Book2 layout, **Use Book2 structured layout** stages body rows **15–32**, chapter row **15**, category row **16**, detail row **17**, and subtotal/total row **25**. Review these coordinates if the original workbook has changed. Save once and reuse the mapping for subsequent quotations.

An empty chapter generates no heading, category, detail or total rows. A zero-priced Optional item is still an item and remains visible. Optional amounts are excluded from the Mandatory total. Service discount is deducted once from Mandatory services. Numbering follows the displayed order after empty chapters are removed.

The original workbook remains immutable. Rows outside the body, including terms, retain their content and move with body expansion/contraction. Use ordinary styled cells, horizontal merges, and distinct detail field cells. Images belong outside the body. Formulas or named ranges outside the body that reference its old sample coordinates are rejected to avoid incorrect totals.

Maintenance Category / Inclusion is edited in the Pricing & Quote **Maintenance** section. The customer-facing item name uses Description verbatim (trimmed); if blank, it uses `Model (quantity unit)`. Start year is not appended. Duration and annual pricing calculations remain unchanged.

## Reuse layouts and customer-facing fields

- In **Saved structured layouts**, enter a Name and choose **Save as new layout**. Saved layouts include body/style rows, column and cell mappings, generated headings, numbering, dates, and company variables. They are stored in the local SQLite database and included in its backups.
- Upload another workbook (for example, with a different logo), choose a saved layout and **Load layout**. Review the target sheet/coordinates, then **Apply mapping** and **Save this tab**. Replacing the current workbook also retains its existing configuration automatically. The workbook itself is separate from the saved layout. **Update layout** changes the selected reusable preset; previously configured customer templates are unchanged until it is loaded into them.
- In **Pricing & Quote**, **Quotation project name** supplies the customer-facing `{project}` value and the generated single service description. Blank falls back to the internal project name. The internal project record stays unchanged; exported history records the name used.
- Template T&C supports the same public field placeholders, e.g. `This quotation for {project} is valid for {validityDays} days from {date}.` Company fields use the layout's company variables. Unknown placeholders are reported before export; `{termsAndConditions}` cannot reference itself. Resolved T&C is saved with export history.
- **Category Subtotals → Include category Subtotals** controls whether each category gets a Subtotal row. The default is enabled. Disabling it preserves Mandatory/Optional totals and the discount; totals sum detail rows directly.

## Chapters, whitespace and internal review

**Mandatory section name / Optional section name** default to `Mandatory` / `Optional`. Use `{section}` in chapter headings, category headings, Subtotals and totals, for example `Total price for {section}`. Renaming a section affects labels only; Optional amounts remain excluded from the Mandatory total. Existing generated default titles are upgraded to this placeholder; authored title text stays intact.

Choose 0–5 blank rows after a section heading, each category, or the whole Mandatory/Optional section. **Category spacing override** targets a named category (case-insensitive), overriding the per-category default. Blank rows do not receive numbers or participate in totals. Empty sections and their spacing disappear together. These settings travel with saved layouts.

Equipment units are editable per BOQ row in **Maintenance BOQ → Unit** and **Pricing & Quote → Maintenance → Equipment unit**. A blank unit adds no default wording. A supplied description is used as written; the model/quantity/unit fallback applies when description is blank.

**Preview → Export Preview XLSX** downloads the current visible preview as a standalone workbook marked `PREVIEW`. It uses the built-in preview layout, never uploads or reads the customer XLSX asset, and creates no formal quotation history or archive. Content follows the quotation name, template document title/T&C and selected assumptions. The visual layout is currently maintained in `features/quote/quote-preview-dialog.tsx` and `features/quote/preview-workbook.ts`; there is no separate preview layout editor. Customer-template layout settings continue to control the customer export.

Assumptions load from saved Master Data when the quotation page opens or **Refresh library** is selected. Unedited library references (including original seeded rows) follow the current text while keeping their Include setting. Local customizations, deleted/inactive references and completed output histories retain their text. Newly added library rows become available to reference; they are not automatically included in a customer's quote. Both library and quotation editors use compact grids.

### Grand Total and discount allocation

Every structured body ends with **Grand Total**, after both section totals. Its title is editable in Generated headings (`grandTotal`) and its style uses the existing Total style row. `{grandTotal}` is also available in mapped cells and T&C. Optional prices remain excluded from this total.

Pricing & Quote → **Apply discount** controls where the existing discount amount is deducted:

- **Once at Grand Total** (default): section totals remain before discount; deduct once from Mandatory at the end. Optional remains unchanged.
- **By Section**: distribute across Mandatory and Optional by their prices, deduct before each section total.
- **By Category**: distribute across category groups within each section; deduct before each category's net Subtotal. The same category name in different sections has an independent share. Discounted categories retain a net Subtotal even when ordinary category Subtotals are hidden.

The compact allocation grid shows gross amount, discount share, allocated discount and net amount. An explicit percentage pins that group's share of the discount; blank shares split the remainder in proportion to current prices. **Reset to price proportions** clears overrides. Switching modes starts a fresh automatic allocation. Renaming or removing a category with a pinned share requires resetting/reviewing its allocation, preventing silent reassignment. Custom section titles do not change allocation keys.

Shares must reconcile to 100%, and no allocation may exceed its group's amount. Cent rounding conserves the discount total. Preview, Preview XLSX and structured customer XLSX share the same schedule; Grand Total never deducts an already allocated discount again. Output history retains the exact allocation snapshot. Existing service pricing/GP calculations and the discount amount limit are unchanged; this controls customer-facing distribution. Legacy fixed-region templates require a Structured body (or built-in customer layout) to show Section/Category discounts.
