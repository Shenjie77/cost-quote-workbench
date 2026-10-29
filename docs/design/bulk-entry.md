# Bulk Entry workspace

Personnel, Subcontract and ordinary Master Data share a full-screen spreadsheet editor. Each opening starts from the current cost version or catalog values, including their stable record IDs. Bulk Entry edits current data; Calculation Draft remains a separate persistent formula scratchpad.

## Edit and save

1. Open **Bulk Entry** and select the sheet to update. Native workbook tabs switch the editing view; the sheet selectors determine which sheets will be applied.
2. Edit existing values or enter new rows below them. Keep **Row ID / Record ID** when updating an existing row. Leave the ID empty for new personnel or history records. For catalog-based records, an existing unique business key can still match an update.
3. Choose **Validate**, review errors and the change summary, then **Apply changes**. All selected sheets must pass validation before changes are applied.
4. Reopen to see the saved values. Reapplying unchanged rows updates the same IDs and does not add a second copy.

Rows absent from the edited sheet remain in the destination. Clearing a whole spreadsheet row is not a delete operation. Use the normal row-delete action when deletion is intended. **Reload current data** discards only edits in the open Bulk Entry window and reads the current values again. Back asks before discarding edited cells.

Old saved bulk drafts and browser import receipts are no longer restored or used to block updates. Unsaved Bulk Entry edits are not persisted as a separate calculation draft. Applying personnel or Subcontract changes uses the normal cost autosave; Master Data uses its revision-checked save API.

## Fields

- Personnel MD: Category, Group, Scope, BU, RE Type, Y1–Y5 MD and Row ID.
- Personnel Sites: the same fields, MD / Site and Y1–Y5 Sites.
- Subcontract Shared / One-off: Category, Item Code, Description, Y1–Y5 Quantity and Row ID. Each site type has its own sheet with Quantity / Site.
- Master Data: the catalog's fixed editable fields and identity. Existing rows are populated; calculated columns are left blank and recomputed on validation. Optional text/list fields can be cleared directly. New rows still require the fields defined by the catalog. Workflow and Status retain their XLSX import/publish controls.

**Category** is a commercial quotation category, separate from personnel **Group** and the RE Type's `internal/subcontract` classification. Category is optional and limited to 120 characters. It carries into generated quotation grouping; the name `Optional` does not itself exclude an item from quotation totals.

Personnel Row IDs identify the exact editable row, so duplicate Scope names remain independent. Unknown or repeated IDs block the update. Copying a spreadsheet row requires clearing its ID; **Copy Group** in Cost Input is the dedicated whole-group copy action.

Subcontract first resolves an existing Row ID. Without one, a unique adopted catalog item can match an update. Ambiguous existing items require their Row ID. Quantity/category updates retain the adopted description, unit, BU, currency and price snapshot; they do not silently apply a newer catalog price. A new item requires a unique active catalog Code or Description and copies its current master attributes. Missing or conflicting identifiers block the batch.

## Validation and concurrency

Paste literal values below the protected first row, up to 1,000 rows per sheet. Keep text codes as text to retain leading zeros. Formula cells, changed headers, extra columns, invalid identities and invalid values block the complete selected update. Errors link to the relevant sheet and cell; Column guide contains detailed rules and examples.

Validation captures selected cell values and destination state. Changes after validation require validation again. If destination data changes while the window is open, reload current data before editing. Cost-version locks, source revisions and business parsers remain authoritative.

## Maintenance

The Maintenance Bulk Entry dialog loads Model, CT, SPMS, QTY, Duration, Remark, Description and Row ID as TSV. Keep the eighth-column Row ID to update the same device, or explicitly clear it to add a device. A seven-column paste can update a unique model; duplicate models require the intended ID. Existing source/history metadata and unlisted devices are retained. Prices are rounded by the shared maintenance rules; invalid rows or concurrent changes block the batch.

File-based TD/PM import, BOQ XLSX mapping and service-quote XLSX import are separate source-document workflows. Their append/source-deduplication behavior is unchanged; they must not be described as the Bulk Entry editor.

## Regression coverage

`tests/bulk-entry-update.test.mjs` checks current-row seeding, repeated apply/reopen, stable identities, new rows, omitted-row preservation, category propagation into inputs, Subcontract snapshot prices, Master Data edits and Maintenance metadata. Existing bulk parsers continue to check atomic validation and locks. Browser acceptance is recorded with the release validation rather than inferred from these model tests.
