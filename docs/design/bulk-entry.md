# Bulk Entry workspace

The Personnel, Subcontract and ordinary Master Data bulk buttons open one shared full-screen spreadsheet workspace. Returning restores the source view. Calculation Draft remains a separate free-form scratchpad.

## Interface

The UI/UX Pro Max skill's **Data-Dense Dashboard** guidance is applied within `workbench-ui-system.md`: English labels, existing navy/neutral/teal palette and system font, compact controls, fixed grid headers and restrained borders. No remote assets or new dependencies are needed.

The destination appears beside Back and Bulk Entry. Sheet selectors specify what will be imported; native workbook tabs switch the editing sheet. New batch, Validate and Import share the spreadsheet menu row with Save draft and Download backup. Wide spreadsheets and the toolbar scroll inside their containers. The source page is inert while editing, avoiding nested page/grid scroll capture. Back saves the draft and restores focus.

## Input formats and writes

- Personnel MD: Group, Scope, BU, RE Type, five annual MD columns.
- Personnel Sites: the same identity fields, MD / Site and five annual Sites columns.
- Subcontract: Shared / One-off uses five annual quantities; each site type has a separate sheet with Quantity / Site. Code or matching description resolves the active catalog item. Price, unit and BU come from Master Data.
- Master Data: fixed fields from existing catalog import specifications; one catalog imported at a time. Existing keys update, new records append. Missing rows do not delete records. The import saves current catalog draft edits as well as imported changes, as stated in the destination line. Workflow and Status keep their existing import/publishing flow.

Paste values below the protected first row. Up to 1,000 rows per sheet are accepted. Text codes must remain text so leading zeros are not silently lost. Formula cells, changed headers, extra populated columns, unknown references and invalid values block the whole selected import. Errors link to the affected sheet and row/cell. Column guide lists field rules and available personnel/subcontract reference codes.

Validation captures the selected cell values and destination state. Import re-reads the saved draft and rejects changes made after validation. Cost-version locks, source revisions and business parsers remain authoritative. Cost imports append to the existing version and use its normal autosave; Master Data uses its revision-checked save API.

Drafts use the existing local calculation storage and recovery mechanism. New batch saves the current draft before creating a blank one. Successful import records a browser-local receipt for each selected sheet in that batch; retrying the same sheet requires New batch. Receipts are not a cross-browser/server idempotency guarantee. Failed imports retain their draft and release receipts. A committed Master Data write remains successful if only the subsequent refresh fails.

## Verification (2026-10-02)

- Full suite: 1,074 tests passed. Workbook and entry UI regression subset: 27 passed.
- TypeScript, lint and production build passed.
- Isolated SQLite database and separate preview/API ports; real business data untouched.
- Browser checks: personnel paste/import and persisted values; duplicate import blocked; project-tag creation saved in Master Data; Shared and site-type subcontract rows imported together using catalog price 125; unknown RE Type blocked.
- Visual checks at 1500 × 1000 and 375 × 812; narrow document width stayed 375px. Spreadsheet/toolbar scroll locally. No browser page errors in these checks.
