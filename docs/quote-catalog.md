# Assumption library and customer quotation templates

## User workflow

Master Data is the only catalog maintenance page; the former Templates & Settings
alias has been removed. Quote's **Manage templates** and **Manage library** buttons
open the respective Master Data tab directly without changing project. Use
**Open Quote / 返回报价** to return. The current project/client and project-owned
scope are visible above all eight Master Data tabs. **Add for this quote** only
adds a quotation-specific assumption, never a reusable library entry.

1. **Master Data → Assumptions**: create reusable assumptions with name,
   category, client, body, optional translation and active flag. Body may be
   Chinese or English. Existing project assumptions seed the library once
   during upgrade; their original quote text stays untouched.
2. **Master Data → Quote Templates**: create, duplicate or edit templates.
   Set customer, title, validity, payment terms, multiline **Terms & Conditions**
   and default library assumptions. Multiple templates may serve one customer.
3. **Pricing & Quote → Quotation Template** at the top of the page: choose a
   matching template by name, then click **Apply Template / 引用模板**. Customer
   templates appear before common ones. Choosing from the dropdown alone does
   not change the preview or export; the **Applied** line identifies the template
   currently in use. Applying updates the selection and appends eligible defaults.
   Reapply the same template to fill missing defaults without overwriting edits.
4. **Quote Assumptions → Reference library**: search name, category or content
   and reference individual entries. Edit/exclude/delete the copied rows freely.
5. Confirm the cost version and resolve validation errors, then generate XLSX.
   The workbook includes selected T&C and included assumptions. Long terms use
   more rows/pages rather than forced single-page scaling. In Quotation History,
   expand **Saved T&C & assumptions** to inspect the original text snapshot.

## Scope and safety rules

- Catalogs are **project-owned**, not globally shared. **Copy catalog** in either
  Master Data tab copies assumptions and templates from another saved local
  project. New IDs are assigned and default links remapped; destination records
  are never overwritten and the source is not changed. Subsequent edits are
  independent. Repeating a copy creates another set of records. Save source
  changes before copying.
- `clientPattern` is a trimmed, case-insensitive **exact customer name**.
  `*` alone means all customers. No regex, partial match or wildcard expressions:
  `Acme` does not match `Acme Other`. Inactive/mismatched templates cannot
  generate a new quotation. An old selection is shown as unavailable until a
  valid template is chosen, without silently substituting another customer's T&C.
- Default assumption IDs must exist. When applied they must also be active and
  match the quote customer; ineligible rows are skipped. Already copied rows
  remain under user control.
- References are **copies, not live links**. Repeated references do not duplicate
  the same source or identical bilingual text (ignoring case/edge whitespace).
  Edited/excluded rows are not reset. Remove an existing copy to reference anew.
- Deleting a library row removes its template default links, not quoted copies
  or historical text. At least one template must remain. Deleting the selected
  template selects an applicable survivor when possible, but does not append
  defaults until an explicit **Apply Template** action.
- Old/manual history may lack text snapshots: never reconstruct historical
  clauses from today's template. Snapshots preserve content, not an XLSX binary,
  digital signature or immutable legal ledger.

## Durable contract

Canonical schema: `workspace-state/1.0.0` (additive extension). Refresh the CLI
schema hash after upgrading. New callers should supply all fields below;
migration fills **absent** fields only, preserving deliberately empty arrays.

`assumptionLibrary[]` record:

```json
{
  "id": "library-site-access",
  "name": "Site access",
  "category": "Delivery",
  "clientPattern": "*",
  "text": "Customer provides access to the agreed sites.",
  "textZh": "",
  "active": true
}
```

IDs follow the common identifier format (maximum 160 characters), unique in
each collection. Name, customer and body must be nonblank. Category/translation
may be empty. Text fields allow 2,000 characters; library size is 0–10,000.

Additional fields on each existing `quoteTemplates[]` record:

```json
{
  "termsAndConditions": "1. Customer-specific clause.\n2. Another clause.",
  "defaultAssumptionIds": ["library-site-access"]
}
```

This is a field fragment, not a complete template. T&C allows 0–20,000 characters
of plain text, with line breaks preserved. HTML, Markdown and formulas are not
executed. The platform does not invent legal clauses. Default IDs must be unique
and reference the library. Templates: 1–1,000 records; validity: integer 1–3,650.

`quoteAssumptions[]` keeps `id`, `text`, `textZh`, `included`, plus optional
`sourceAssumptionId` (provenance only, not a required live foreign key). Agents
must copy the text and create a new quote-row ID themselves. Setting a source ID
alone does not fetch or synchronize content. Setting `selectedQuoteTemplateId`
through CLI alone does not expand defaults: append copies in the same save.
The UI's pure matching/copy rules are in `features/quote/catalog-domain.ts`.

New browser-generated `quoteHistory[]` records add `templateSnapshot` (complete
template) and `assumptionSnapshots` (included quote rows). They are detached from
live catalog references; old/manual records may omit them.

## Agent read-modify-save procedure

Prefer [narrow resource updates](../skills/cost-workbench/references/resources.md):
read `masterdata get --project-id ID --tab assumptions|quote-templates` and
`quote get --project-id ID --section settings|assumptions`, then send only changed
rows with the corresponding `update` command and exact revision. Read only the
next relevant section after a conflict. Before removing a referenced library
record, update template defaults first, then remove the record using the new
revision; quote/history copies remain independent.

For an intentional atomic edit spanning multiple sections, the legacy
`workspace get/save` request remains available. Preserve unrelated fields,
archives and inactive versions, and never use it to rewrite a locked cost version. New Drafts may be created from locked versions, but existing approval snapshots do not transfer to the new estimate.

Use existing CLI commands; no generated Skill or model invocation is needed.
Customer quotation XLSX is currently generated in the browser; `cost export`
creates the internal cost workbook, not a customer quotation. Templates control
content and terms in the built-in layout, not arbitrary uploaded Excel layouts.

## Module map and tests

- `features/quote/types.ts`: persisted contracts and library migration seed.
- `features/quote/catalog-domain.ts`: matching, idempotent copies, cross-project IDs.
- `features/master-data/quote-catalog-view.tsx`: assumption/template editors.
- `features/master-data/quote-catalog-import.tsx`: explicit local-project copying.
- `features/quote/assumption-picker.tsx`: eligible library search/reference UI.
- `features/quote/template-picker.tsx`: always-visible named template selection
  and explicit application; pending selection stays local to the current page.
- `features/quote/export-quote-workbook.ts`: client guard and paginated output.
- `server/workspace-document.mjs`: migration and cross-record validation.
- Quote catalog/workbook, workspace repository and CLI tests cover matching,
  independent copies, invalid references, old documents and long multilingual T&C.
