# Cost entry

Open **Cost Workspace → Cost Input**. The compact grid keeps
the Y1–Y5 / All Years selector and the Sites / Direct MD mode buttons.

BU fields select from saved, active entries in **Master Data → Profit Share**.
This directory is shared by personnel rows, bulk and Excel import defaults,
subcontract items and travel rows. Company BU codes are displayed beside names;
costs continue to store the BU name. Historical or inactive names remain visible
as **Saved value** and are never cleared when opening a cost version. New choices
come from the active directory, and confirmed/locked versions remain read-only.
Editing the directory does not apply new profit-share rates to existing quotes.

**Groups**, beside Mode, shows a heading and row count for each custom group.
The editable **Group** column is separate from **Scope**. For example, the group
`Network Design & Planning` can contain `HLD design` (1 MD), `LLD design` (3 MD)
and `Network planning` (3 MD). Identical Scope names need not share a group.

Enter a group name in a row's Group cell, or edit a group heading and choose
**Save** to rename all its members. Choosing an existing group name merges those
groups. Names are trimmed, case-sensitive and limited to 200 characters; blank
or absent names appear under **Unassigned Group**. Existing rows are not grouped
automatically by Scope.

Use **Copy Group** in the cost toolbar or a group heading to copy every member
into a new named group. The copy is inserted after the source group's last row,
keeps Scope, Category, BU, RE Type, input mode and all five years of effort, and
receives new row IDs. The copied rows are independent manual inputs; source-file
identity remains on the originals. Costs and HQ travel allocations are recalculated.
The new group name must be nonempty and different from existing group names.
Copying is unavailable for locked versions.

The editable **Category** column is independent of Group and RE Type. It is an
optional commercial label of at most 120 characters, carried into generated
quotation categories. Blank categories use the ordinary quotation default;
calling a category `Optional` does not automatically exclude its price. Group
still organizes related cost activities; RE Type still selects personnel rates.

Use **Action → Up / Down**, or drag a row by its handle to the upper/lower half
of another row. In grouped view, moving into another group also changes the
row's Group. Dropping on a group heading places the row at that group's end.
In flat view, moving rows changes only their order. Groups appear in order of
their first row. Group names and row order are saved with the cost version;
amounts, Scope descriptions and import-source records are preserved.

**Columns** lets you show/hide fields and move them left/right, including each
year's Sites, MD and Cost. **Action** stays pinned at the right while scrolling. The Y1–Y5 /
All Years selection still filters the year columns. Use the cost toolbar's
**Save** or the workspace's top **Save** while in Costing to save both costs and
the current view. The selected year, group visibility and column visibility/order
are saved in this browser separately for each project and cost version, and
restored after refresh. **View not saved** marks layout edits awaiting Save.
Existing global column preferences are used only as initial defaults.
**Reset** restores the default columns; use **Save** to retain the reset.
Group view, year selection and column preferences
remain available on locked versions; changing group names or row order requires
an editable Draft.

The 3% allowance Pool selection, HQ Travel option, quantities, group names and
row order are cost-version data saved in the local database. Save flushes these
changes before saving the view. A failed cost save or conflict is reported and
must be resolved; saving a view does not unlock a cost version.

## Export the current table

**Simple Export** opens a worksheet picker, defaulting to all available tabs.
Select at least one tab and confirm to export; cancelling produces no file.
For selected **Cost Detail**, it uses the current Cost Input layout:
Group headings when enabled, row order, visible columns in their chosen
order, and the selected Y1–Y5 / All Years view. These settings remain available
when switching between Input Sheet and Summary. Group names are also included
as a normal column if that column is visible. Action buttons, checks, record IDs,
RE codes and source-file metadata are not exported.

The detail's Total columns still mean all years, matching the grid. The other
summary sheets and Cost Statement retain the complete five-year project totals;
the exported detail states its year view and this summary scope. Structured
Subcon sheets are available when applicable, and legacy subcontract entries
can be exported separately from personnel. Hiding all business columns for
the selected year blocks exporting **Cost Detail** until a data column is shown;
exporting only other sheets remains available.

**Full Export** and CLI `cost export --format simple` retain their standard
layouts; the browser's display preferences do not alter those paths. Exporting
never changes the saved costs, and remains available for locked versions.

## Summaries

**Cost Statement** is the first and default summary tab. Scope, BU and RE Type
summaries use named statement accounts for amounts without an input-row dimension:
Logistics, external labour, Travel, Settlement, EHS and Risk. Parent subtotals are
included once, so their children are not counted twice. **Subcon** shows the
breakdown of legacy subcontract rows and structured BOQ costs, reconciled to
statement account **2.3.2**.

UI and Simple Export summaries (including CLI simple export) include Risk and
reconcile to Total Cost with Risk. Simple Export also includes **Summary Subcon**.
Full Export keeps its existing Sales Cost audit/reconciliation sheets, and the
CLI calculate summaries retain their Sales Cost basis.

## Edit several rows

1. Choose **Bulk Entry** beside the cost toolbar controls. The Personnel MD and
   Personnel Sites sheets contain the current version's rows and their Row IDs.
2. Edit Category, Group, Scope, BU, RE Type and annual effort directly. Keep the
   Row ID for an update; enter new rows with a blank ID to add them. Use the
   fixed columns and Column guide rather than pasting an unrelated header layout.
3. Select the sheets to apply, choose **Validate**, and then **Apply changes**.
   Unlisted rows are kept. Reopening loads saved values, so a previous successful
   update does not create duplicates or trigger an “already imported” error.
4. Use **Reload current data** to discard edits and start from current values.
   If another operation changes the destination while the editor is open,
   reload before applying. Leaving edited cells prompts before discarding them.

Personnel costs are recalculated from the version's captured RE rates, annual
uplifts and allowance settings. The grid accepts literal values, not pasted
formulas or authoritative cost amounts. Unknown/repeated Row IDs, missing fields
and invalid effort block the entire selected update. There is a 1,000-row limit
per sheet. Locked versions remain read-only.

File-based **Import** is a separate TD/PM workbook mapping workflow with source
records and duplicate-source protection. Its append semantics are unchanged;
use explicit row updates or a new working version for revised source files.
See [the shared Bulk Entry rules](design/bulk-entry.md).

Cost Input 的表格随行数自然撑高，不设置内部纵向滚动区。鼠标在表格上滚动时由页面上下滚动；年度列仍保留横向滚动。
