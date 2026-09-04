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

## Comparison rules

- Compare the same currency unless an explicit FX snapshot is available.
- Compare service level, coverage term, quantity, product/model, and site before
  treating prices as comparable.
- Use annualized quote only for term normalization; retain the original amount.
- `Won`, `Lost`, and `Quoted` are distinct commercial outcomes. A manually
  entered market reference uses `Reference`.
- Imported IDs already present in the project are replaced; new IDs are added.
  XLSX rows receive generated IDs and retain `Source` or the import filename.

Historical records are evidence, not automatic price recommendations. Any
future pricing rule must show its matched records and filters.
