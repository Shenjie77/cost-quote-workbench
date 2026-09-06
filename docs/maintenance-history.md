# Maintenance price history

The maintenance history page is a searchable, persisted reference dataset. It
supports manual add/edit/delete and controlled JSON/XLSX import.

CLI validation requires a `cost-workbench/v2` request envelope with
`kind: "MaintenancePriceRequest"`; the nested maintenance dataset remains
schema version `1.0.0`. See `tests/fixtures/maintenance-request.valid.json`.

The UI JSON importer accepts the nested `data` object from that fixture:
`{"schemaVersion":"1.0.0","records":[...]}`. The XLSX importer reads the
first worksheet and matches case-insensitive English headers: `Client`,
`Service`, `Product Model`, `Service Level`, `Site`, `Coverage Months`,
`Quantity`, `Cost`, `Quoted`, `Quote Date`, `Outcome`, and `Source`.

Each record captures client, service, product/model, service level, site,
coverage months, quantity, internal cost, quoted amount, quote date, commercial
outcome, currency, and source reference.

Import validation is shared by the browser, CLI and repository. Unknown fields,
duplicate IDs within the import, invalid calendar dates, unsupported currency,
negative/non-numeric amounts and missing required text reject the entire import.
XLSX accepts plain decimals or properly grouped numbers such as `1,000.00`;
blank/malformed amounts and dates do not become zero or today's date. The
optional `Currency` header defaults to SGD when absent; a supplied other currency
is rejected. JSON numbers must be actual JSON numbers.

## Comparison rules

- Compare the same currency unless an explicit FX snapshot is available.
- Compare service level, coverage term, quantity, product/model, and site before
  treating prices as comparable.
- The displayed unit/year quote normalizes both duration and quantity: amount × 12 / months / quantity. Invalid denominators display unavailable; retain the original contract amount.
- `Won`, `Lost`, and `Quoted` are distinct commercial outcomes. A manually
  entered market reference uses `Reference`.
- Imported IDs already present in the project are replaced; new IDs are added.
  XLSX rows receive generated IDs and retain `Source` or the import filename.

Historical records are evidence, not automatic price recommendations. Any
future pricing rule must show its matched records and filters.

The Maintenance BOQ page imports or enters actual equipment quantities, compares exact model matches across customers, records selected SLA/price differences and archives all rows with reference snapshots. It exports a clearly labelled draft; final taxes and legal terms remain part of formal quotation. See the [SSR implementation guide](ssr-implementation-2026-09-07.md).
