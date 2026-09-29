# Local calculation drafts

`Calculation Drafts` in the main navigation (or `/calculations`) opens an English Univer workbook. The `Formula examples` worksheet includes SUM, SUMIF and SUMPRODUCT examples. The scratchpad is independent of project costs.

## Offline operation

Univer 1.0.3 is installed through npm and bundled with the platform, including its styles, English locale, editor and formula engine. No CDN, GitHub checkout, Univer account or remote calculation service is configured. Install dependencies and build while online, or transfer a complete installation prepared for the target operating system. Then run the existing local platform services normally. Loopback HTTP connections to the local web server and SQLite API must remain available.

Drafts are stored in the `calculation_drafts` table in the local workbench SQLite database. Browser storage provides a best-effort recovery copy for interrupted saves. Revision checks prevent one window from silently overwriting another. A database backup includes these drafts; individual project JSON exports do not. Download backup saves the workbook snapshot as JSON, not XLSX. Existing cost Excel exports still use the platform's local export pipeline.

This integration uses the core spreadsheet preset only. Cloud collaboration, AI and server-based file exchange are not configured.

## Subcontract worksheets

Site-type costing has an Overview, a tab for each site type, and Shared / One-off Project Costs. The Overview displays applied annual totals. Each site has a separate persistent formula draft; shared costs use a separate draft with annual quantity columns.

1. Add catalog items using the existing controls.
2. Open the site's worksheet. Edit Unit price and Quantity / site (or annual quantities for shared costs); formulas may refer to extra working columns or worksheets.
3. Choose **Apply to costs** to calculate, validate and copy the numeric prices and quantities to the cost inputs. Autosaving a formula draft does not apply it to costs.
4. The platform's existing annual uplift, site counts and rounding rules calculate official totals. The worksheet Base amount is before annual uplift.

Use **Item details** to change metadata or remove items. Keep the worksheet's headers and item identifiers intact. Invalid formulas, negative or nonnumeric inputs, fractional `pcs` quantities, and incomplete item rows cannot be applied. A locked cost version cannot accept changes.

If catalog items, applied inputs or annual rate factors change outside the worksheet, its basis becomes stale. Download a backup if needed, then use **Reload from costs** to replace that draft from current inputs. This intentionally replaces its formulas. Drafts are scoped to project, cost version and site identity; copying a cost version starts worksheets from the copied numeric inputs.

## Missing `rxjs` in an offline installation

Univer declares RxJS as a peer dependency. The platform explicitly pins `rxjs` to `7.8.2` so installation does not depend on automatically installing peers. Transfer the updated `package.json` and lockfile together with a complete matching dependency installation. An existing offline `node_modules` directory is not updated by copying source files alone.

If Vite reports `Failed to resolve import "rxjs"` under `node_modules/.vite/deps`, stop the platform and check `node -p "require.resolve('rxjs')"` and `npm ls rxjs`. If resolution fails, restore the complete `node_modules/rxjs` directory and its `tslib` dependency from a prepared dependency bundle. If resolution succeeds, clear only `node_modules/.vite` and restart to rebuild the dependency cache; then hard-refresh the browser. Do not delete the whole `node_modules` folder on an offline machine without a complete replacement ready.

For a connected machine or an internal npm mirror containing the package, `npm install --save-exact rxjs@7.8.2` installs the missing dependency. `npm ci --offline` only works when the npm cache already contains all required packages and metadata; source code or a lockfile alone is insufficient.
