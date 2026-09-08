# Assumption library and customer quotation templates

## User workflow

Master Data maintains the global assumption library and customer template defaults
for future projects. It has no selected project. Each tab saves with its own
revision; use **Save** on the tab after edits. Quote's Manage buttons open the
corresponding global page. Maintaining it does not change the current project.

1. **Master Data → Assumptions**: create reusable assumptions with name,
   category, client, body, optional translation and active flag. Body may be
   Chinese or English; preserve supplied legal and business text.
2. **Master Data → Quote Templates**: maintain customer, title, validity,
   payment terms, multiline Terms & Conditions and default global assumption IDs.
   Multiple templates may serve one customer. Keep referenced assumptions valid.
3. A new project captures the global catalog. Existing projects keep their
   adopted catalog until the user explicitly applies a newer global snapshot.
   Reference data is not changed just by opening or returning to Quote.
4. **Pricing & Quote → Quotation Template**: choose a template from this
   project's captured catalog, then use **Apply Template**. Choosing a dropdown
   item alone is not application. Applying selects the template and appends
   eligible default assumptions without replacing user-edited copies.
5. **Quote Assumptions → Reference library** references entries from the
   project's captured library. **Add for this quote** creates a quotation-specific
   row, never a global library entry. Edit/exclude/delete copied rows freely.
6. Confirm the cost version and resolve validation errors, then generate XLSX.
   The workbook uses the adopted T&C and included assumptions. Quotation History
   retains original template and clause snapshots; no current global values are
   substituted into historical output.

## Scope and safety rules

- Global catalogs are independent sources for future projects. New projects
  receive detached snapshots. Global updates do not alter any existing project,
  including Draft. Explicit `project apply-masterdata` can capture newer
  assumptions/templates for a project; recheck current quotation and review
  validity afterward. Archived quotations retain their original terms.
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
- Before deleting a global library row, remove its global template default links
  and save those templates first. The related global tabs have separate
  revisions. Project copies and historical text are not deleted. Keep at least
  one valid template for future project creation; changing a global selection
  does not select or apply a template for any existing quotation.
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

Global maintenance uses `masterdata get/update --tab assumptions|quote-templates`
without a project ID and with the selected tab's revision. Normal existing rows
allow partial upserts; new entries and migration conflicts require complete
records. When deleting a referenced assumption, first update global template
defaults with the template tab revision, then delete the assumption with the
assumptions tab revision. Existing project/history copies stay independent.

Quotation preparation reads `quote get --project-id ID --section templates|library`
for adopted catalogs, and `--section settings|assumptions` for current output
choices. Update only the current quote settings or copied assumption rows with
`quote update` and the project revision. Do not fetch the latest global catalog
as a substitute for the project's captured values.

Explicit adoption uses `project apply-masterdata --project-id ID --tab TAB`
with the project revision and an unlocked active Draft. Supported tabs include
assumptions and quote-templates;
apply assumptions first when required by template default references. Check the
new project revision after each step. Adopting new current commercial inputs may
invalidate previous reviews; old quote-history snapshots remain unchanged.

Use [narrow resource commands](../skills/cost-workbench/references/resources.md)
for daily work. A deliberate project workspace backup remains available, but it
is not a global catalog maintenance interface. Standard customer output is
available through `quote export`; `cost export` produces the internal workbook.
Catalog templates control terms/content in the built-in layout. Arbitrary company
Excel layouts use the separate template-mapping export workflow.

## Module map and tests

- `features/quote/types.ts`: persisted contracts and library migration seed.
- `features/quote/catalog-domain.ts`: matching and independent, idempotent quote-row copies.
- `features/master-data/quote-catalog-view.tsx`: assumption/template editors.
- `features/master-data/global-master-data-page.tsx`: global tab editing and conflict resolution.
- `server/global-master-data.mjs`: tab revisions, reference validation and migration provenance.
- `features/quote/assumption-picker.tsx`: eligible library search/reference UI.
- `features/quote/template-picker.tsx`: always-visible named template selection
  and explicit application; pending selection stays local to the current page.
- `features/quote/export-quote-workbook.ts`: client guard and paginated output.
- `server/workspace-document.mjs`: migration and cross-record validation.
- Quote catalog/workbook, workspace repository and CLI tests cover matching,
  independent copies, invalid references, old documents and long multilingual T&C.
