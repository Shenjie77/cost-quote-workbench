# Structured quotation templates

In **Master Data → Quote Templates → Customer Excel layout**, upload an XLSX and select **Structured body (Recommended)**. Existing mappings stay in legacy mode until explicitly converted.

1. Set the original **Body start / Body end** around the entire quotation schedule, including old Mandatory and Optional headings, sample details, subtotals, totals and spacer rows.
2. Select five original style rows inside the body: chapter, category, detail, subtotal and total. Styles repeat as needed. Their sample labels, numbers and formulas are replaced.
3. Map detail columns. Choose hierarchical, continuous or alphabetic numbering; optionally list category order. Categories not listed follow their order in the quotation data.
4. Edit generated heading patterns, for example `Mandatory items for {project}`, `{category}` and `{category} subtotal`.
5. Add outside-body cell content such as `Date of quotation: {date}`. `{documentTitle}` uses the template's Document title. Footer totals should use `{quoteBeforeTax}` or `{optionalPrice}`, rather than formulas over the replaced body.
6. Use **Sample with Optional** and **Sample without Optional** to review both cases. **Apply mapping** validates both; **Save this tab** publishes the mapping. In an existing project's Pricing & Quote page, select the updated template and click **Apply Template**.

For the supplied Book2 layout, **Use Book2 structured layout** stages body rows **15–32**, chapter row **15**, category row **16**, detail row **17**, and subtotal/total row **25**. Review these coordinates if the original workbook has changed. Save once and reuse the mapping for subsequent quotations.

An empty chapter generates no heading, category, detail or total rows. A zero-priced Optional item is still an item and remains visible. Optional amounts are excluded from the Mandatory total. Service discount is deducted once from Mandatory services. Numbering follows the displayed order after empty chapters are removed.

The original workbook remains immutable. Rows outside the body, including terms, retain their content and move with body expansion/contraction. Use ordinary styled cells, horizontal merges, and distinct detail field cells. Images belong outside the body. Formulas or named ranges outside the body that reference its old sample coordinates are rejected to avoid incorrect totals.

Maintenance Category / Inclusion is edited in the Pricing & Quote **Maintenance** section. The customer-facing item name uses Description verbatim (trimmed); if blank, it uses `Model (quantity node/NE)`. Start year is not appended. Duration and annual pricing calculations remain unchanged.
