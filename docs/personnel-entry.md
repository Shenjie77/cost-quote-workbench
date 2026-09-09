# Cost entry

Open **Cost Workspace → Cost Input**. The compact grid keeps
the Y1–Y5 / All Years selector and the Sites / Direct MD mode buttons.

**Groups**, beside Mode, shows a heading and row count for each custom group.
The editable **Group** column is separate from **Scope**. For example, the group
`Network Design & Planning` can contain `HLD design` (1 MD), `LLD design` (3 MD)
and `Network planning` (3 MD). Identical Scope names need not share a group.

Enter a group name in a row's Group cell, or edit a group heading and choose
**Save** to rename all its members. Choosing an existing group name merges those
groups. Names are trimmed, case-sensitive and limited to 200 characters; blank
or absent names appear under **Unassigned Group**. Existing rows are not grouped
automatically by Scope.

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

**Simple Export** uses the current Cost Input layout for its **Cost Detail**
sheet: Group headings when enabled, row order, visible columns in their chosen
order, and the selected Y1–Y5 / All Years view. These settings remain available
when switching between Input Sheet and Summary. Group names are also included
as a normal column if that column is visible. Action buttons, checks, record IDs,
RE codes and source-file metadata are not exported.

The detail's Total columns still mean all years, matching the grid. The other
summary sheets and Cost Statement retain the complete five-year project totals;
the exported detail states its year view and this summary scope. Structured
Subcon sheets remain included, and legacy subcontract entries appear separately
from personnel so their costs remain visible. Hiding all business columns for
the selected year blocks Simple Export until a data column is shown.

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

## Paste several rows

1. Choose **Bulk Entry** beside Groups.
2. Choose **Auto-detect headers**, **Scope + MD · no header**, or
   **Group + Scope + MD · no header**. Paste a table copied from Excel, or use
   **Copy template**. Common Chinese and English headers are recognized;
   review the detected column mappings.
3. Check Group, Scope, BU, RE Type, mode, MD/Site and annual quantities. Select defaults
   for omitted BU/RE Type fields and resolve unmatched or ambiguous resources.
4. Review the calculated preview, then confirm to append the rows to the
   current editable cost version. Existing rows remain in place.

Example for Sites mode (copy as tab-separated cells):

```text
Group	Scope	BU	RE Type	MD/Site	Y1 Sites	Y2 Sites
Deployment	Router rollout	Networks	YOUR_RE_CODE	2	10	5
Support	Remote support	Services	YOUR_RE_CODE	0.5	4	4
```

For a short TD description, choose **Group + Scope + MD · no header** and paste:

```text
Network Design & Planning	HLD design	1 MD
Network Design & Planning	LLD design	3days
Network Design & Planning	Network planning	3天
```

Choose the default BU, RE Type and delivery year before previewing. The two
fixed formats use Direct MD and do not require a header. **Scope + MD** uses
only the last two columns of the example. The general format defaults to Direct
MD and also supports Man-day/Man-days/人天 headings, paired year labels such as
`Y1 · 2026`, and supported two-row Excel year headers. Ambiguous years and invalid
effort values require correction instead of silently importing them.

Markdown tables can include alignment separators, a complete Markdown code
fence, and bold or backtick-wrapped headers. Business descriptions are preserved;
formatting around numeric values is not treated as a number. An unclosed fence
must be corrected before confirmation.

Use an actual active personnel RE Type code, ID or name from the cost version.
If more than one resource matches, select the intended record in the preview.
For Direct MD, use `Mode` = `Direct MD` and `Y1 MD` through `Y5 MD` columns.
Calendar-year headers map to the version's project years. An unqualified `Sites`
or `MD` column uses the chosen delivery year (Y1 when opened from All Years).
`Group`, `Group Name`, `分组` and `组名` headers map to the independent group field.
The **Fill blank Group** option repeats the preceding group in the pasted table;
Scope fill-down has its own separate option.

The preview calculates costs from the version's captured RE rates, annual
uplifts and selected Pool allowance. Supplied cost/price columns are ignored
and reported, not used as authoritative costs. Invalid values block confirmation.
Changing the table, mapping or cost basis requires a fresh preview before entry.
The limit is 1,000 input rows per paste. Bulk Entry is unavailable for locked
versions; create a new Draft to revise those estimates.

File-based **Import** remains a separate path for importing a workbook with
source-file records. Manually pasted rows are ordinary editable personnel rows.
