# Quotation history in Master Data

Master Data contains two independent reference catalogs: **Maintenance History** and **Service History**. Both use the shared compact grid, column resizing, search, per-tab save, Excel template and Bulk Entry actions.

Service History stores Client, Project, Service / Scope, Quantity, Unit, Unit Price, Cost, Quoted Year and Reference. Amounts are in SGD. Cost is the total cost for the row, not a unit cost. Quoted Amount is Quantity × Unit Price, rounded to cents. GP% is (Quoted Amount − Cost) / Quoted Amount; a zero quotation displays a dash. These are reference records, not issued customer quotation archives, and do not modify project snapshots or current prices.

Maintenance History imports Model, Client, CT, SPMS, U/P, Quoted Year and Project in the same order as its grid. CT and SPMS represent per-device annual prices; U/P is calculated. Existing historical dates, quantities, coverage periods and other evidence remain intact when exported and re-imported unchanged. Editing CT/SPMS adopts the current per-device annual basis, matching the grid editor.

The shared definitions in `features/master-data/history-fields.ts` drive history grid headers, bulk sheets and XLSX columns. Calculated columns may be left blank during import; an explicitly supplied value must match the calculation. Record ID is an optional final import column: retain it to update an existing record, or leave it blank to create one. All rows are validated before a batch can be imported.

Download the current history template rather than reusing the former maintenance template containing Service, SLA, Site, Coverage Months and Quote Date. Unsupported old headers produce an error instead of silently placing values into different fields. Bulk Entry opens current saved/draft catalog rows and their IDs each time; old applied paste workbooks are not restored. Existing catalogs gain an empty service history catalog with independent revision checks; no project migration is required.

Bulk Entry uses compact protected column headers with detailed input rules and samples in Column guide; downloaded XLSX templates include their own guide. Current records and IDs are populated from the catalog. Calculated cells start blank and are regenerated when validating; keep existing IDs to edit history without duplicating it. Unlisted records stay unchanged, and optional text can be cleared in the editor. New records still require the fields specified by their catalog. Workflow/status XLSX and separate imported-file blank-cell rules are unchanged.

## 从成本更新分类

自动生成的报价布局继承成本 Category，相同 Scope / Group 的不同 Category 分开生成。已有报价选择 **Refresh from Cost** 可更新当前布局：唯一匹配的行保留 GP、固定价格、数量/单位、remark 和显式报价分类覆盖；新增或拆分的行默认 GP 为 45%。确认前会显示匹配和替换数量。Scope 合并或移除时，风险比例按保留的相对份额重新分配，避免旧来源阻塞刷新。自定义明细继续由用户维护，不会被自动改写。
