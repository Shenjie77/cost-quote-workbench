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

Maintenance Category / Inclusion is edited in the Pricing & Quote **Maintenance** section. The customer-facing item name uses Description verbatim (trimmed); if blank, it uses `Model (quantity node/NE)`. Start year is not appended. Duration and annual pricing calculations remain unchanged.

## Reuse layouts and customer-facing fields

- In **Saved structured layouts**, enter a Name and choose **Save as new layout**. Saved layouts include body/style rows, column and cell mappings, generated headings, numbering, dates, and company variables. They are stored in the local SQLite database and included in its backups.
- Upload another workbook (for example, with a different logo), choose a saved layout and **Load layout**. Review the target sheet/coordinates, then **Apply mapping** and **Save this tab**. Replacing the current workbook also retains its existing configuration automatically. The workbook itself is separate from the saved layout. **Update layout** changes the selected reusable preset; previously configured customer templates are unchanged until it is loaded into them.
- In **Pricing & Quote**, **Quotation project name** supplies the customer-facing `{project}` value and the generated single service description. Blank falls back to the internal project name. The internal project record stays unchanged; exported history records the name used.
- Template T&C supports the same public field placeholders, e.g. `This quotation for {project} is valid for {validityDays} days from {date}.` Company fields use the layout's company variables. Unknown placeholders are reported before export; `{termsAndConditions}` cannot reference itself. Resolved T&C is saved with export history.
- **Category Subtotals → Include category Subtotals** controls whether each category gets a Subtotal row. The default is enabled. Disabling it preserves Mandatory/Optional totals and the discount; totals sum detail rows directly.
