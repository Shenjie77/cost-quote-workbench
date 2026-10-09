# Quotation history in Master Data

Master Data contains two independent reference catalogs: **Maintenance History** and **Service History**. Both use the shared compact grid, column resizing, search, per-tab save, Excel template and Bulk Entry actions.

Service History stores Client, Project, Service / Scope, Quantity, Unit, Unit Price, Cost, Quoted Year and Reference. Amounts are in SGD. Cost is the total cost for the row, not a unit cost. Quoted Amount is Quantity × Unit Price, rounded to cents. GP% is (Quoted Amount − Cost) / Quoted Amount; a zero quotation displays a dash. These are reference records, not issued customer quotation archives, and do not modify project snapshots or current prices.

Maintenance History imports Model, Client, CT, SPMS, U/P, Quoted Year and Project in the same order as its grid. CT and SPMS represent per-device annual prices; U/P is calculated. Existing historical dates, quantities, coverage periods and other evidence remain intact when exported and re-imported unchanged. Editing CT/SPMS adopts the current per-device annual basis, matching the grid editor.

The shared definitions in `features/master-data/history-fields.ts` drive history grid headers, bulk sheets and XLSX columns. Calculated columns may be left blank during import; an explicitly supplied value must match the calculation. Record ID is an optional final import column: retain it to update an existing record, or leave it blank to create one. All rows are validated before a batch can be imported.

Download the current history template rather than reusing the former maintenance template containing Service, SLA, Site, Coverage Months and Quote Date. Unsupported old headers produce an error instead of silently placing values into different fields. The updated Master Data paste workbook uses its own draft version; previous draft records are retained in storage. Existing catalogs gain an empty service history catalog with independent revision checks; no project migration is required.

Bulk Entry and downloaded XLSX templates display the field name, input description and `Sample` inside the frozen first row. An asterisk marks required fields; conditional requirements are written in the description, including fields required only for new Master Data records. Paste actual data starting at row 2. Samples are part of the header and are never imported as records. Recognized older draft headers are upgraded without changing pasted data rows.
