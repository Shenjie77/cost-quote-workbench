# Data contracts

Canonical machine-readable contracts are Draft 2020-12 JSON Schemas in
`schemas/`. The CLI compiles them with Ajv before running business validation.

## General rules

- Every document carries `schemaVersion`.
- Requests reject unknown fields with `additionalProperties: false`.
- IDs are stable integration keys; display names may change.
- User-entered Scope text is stored exactly as entered and is not translated.
- Money, sites, mandays, percentages, and rates are numeric values. Currency is
  a separate ISO 4217 code. Never send formatted values such as
  `"S$ 1,804,000"`.
- `0` means a confirmed zero. Missing optional data uses an omitted field or
  documented `null`; it must not be converted silently to zero.
- Dates use `YYYY-MM-DD`; timestamps use RFC 3339 UTC.

## Cost snapshot

`schemas/cost-export.schema.json` is the browser/CLI workbook input. Its
`costRows[].years` contains exactly five items. Every item carries a mandatory
`bucket` discriminator, and the array order must be Y1, Y2, Y3, Y4, Y5. Each
item has `{bucket, sites, cost}`; mandays and totals are calculated outputs and
are not accepted as inputs. Y0 is not part of v2.

There is no independent Grade field. `reTypeId` points to the consolidated RE
Type master: HQ L1–L4, Local L1–L4, or ARP L0–L4. Each internal RE Type stores
its SGD/MD rate plus MD/month and hours/MD conversion factors. Subcontract rows
point to the `SUBCON` RE Type.

CLI file/stdin input wraps this snapshot in
`schemas/command-request.schema.json`; raw snapshots are not CLI requests.

## Maintenance history

`schemas/maintenance-price.schema.json` accepts:

```json
{
  "schemaVersion": "1.0.0",
  "records": [
    {
      "id": "mh-001",
      "client": "Xinglan Retail",
      "service": "Storage hardware maintenance",
      "productModel": "Storage X9000",
      "serviceLevel": "24x7 · 4-hour onsite",
      "site": "Singapore DC1",
      "coverageMonths": 12,
      "quantity": 2,
      "costAmount": 16400,
      "quotedAmount": 22000,
      "currency": "SGD",
      "quoteDate": "2026-05-16",
      "outcome": "Won",
      "source": "QT-2026-006"
    }
  ]
}
```

Annualized quote is calculated as `quotedAmount / coverageMonths × 12` and
must not be supplied by callers.

## Local project workspace extensions

`schemas/workspace-state.schema.json` is the atomic browser/CLI document. The
local repository expands older compatible documents with these fields:

- `projectStatus`: user-controlled status code displayed in Project List and
  referencing `projectStatusDefinitions[].code`;
- `projectStatusDefinitions[]`: project-specific status options with stable
  machine `code`, editable `name`/`nameZh`, and an `active` availability flag;
- `currentWorkflowStepCode`: stable code selected in the Project List workflow
  column and referencing one item in `processSteps[]`;
- `processSteps[]`: the project-specific editable workflow-node list used as
  the selector source;
- `activeVersion`: the viewed cost version, such as `V1` or `V12`;
- `workflowVersion`: the version whose workflow round is currently being handled;
- `versionWorkflows`: per-version workflow progress retained by the platform;
- `costVersions[]`: complete independent cost-input snapshots;
- `pricing`: project quotation parameters.
- `reviewGates[]`: project review checkpoints and their follow-up log;
- `quoteTemplates[]`, `selectedQuoteTemplateId`, and `quoteAssumptions[]`:
  governed customer-output configuration;
- `quoteHistory[]`: generated or manually entered quotation snapshots.

`assumptionLibrary[]` stores reusable project assumptions. Customer templates
also contain `termsAndConditions` and `defaultAssumptionIds`. Quotation copies
may retain a `sourceAssumptionId`, while generated history stores detached
`templateSnapshot` and `assumptionSnapshots`. See [quote catalog contract](quote-catalog.md)
for matching, migration, field limits and safe deletion/copy behavior.

New and migrated projects start with `input_preparation`, `solution_review`,
`delivery_review`, `costing`, `cost_review`, `pricing`, `quote_review`,
`completed`, and `on_hold`. Users may rename, add, deactivate, or delete status
definitions. The selected value is not silently derived from workflow gates.

Every `costVersions[]` item stores `code`, `state`, `createdAt`,
`sourceVersion`, `costRows`, `rateSettings`, `travelSettings`, `travelRows`,
`travelUplift`, `manualCosts`, and `resourceTypes` (independent rate snapshot).
Legacy inputs may omit the last field; migration captures the available project
catalogue and may add `calculationNote` when correcting stale labour values.
New Version clones these fields into a Draft, selects it as activeVersion and
workflowVersion, and starts its independent DTRB round. Viewing a historical
activeVersion does not move the current workflow round. workflowVersion and
versionWorkflows are platform-managed metadata, not fields for agent workspace
patches. Cost must be explicitly confirmed by the user before that version can
enter, submit or complete DRB; Confirmed finalizes cost but is not DRB approval.
SSR submissions and dependency checks use the target version, not another
version's approvals. Other master-data arrays remain project-level shared masters.

`pricing` contains numeric `targetGrossMargin`, `discount`, and `gstPercent`.
The pre-tax quote is calculated as:

```text
listPrice = totalCostWithRisk / (1 - targetGrossMargin / 100)
quoteBeforeTax = max(0, listPrice - discount)
actualGrossMargin = (quoteBeforeTax - totalCostWithRisk) / quoteBeforeTax
```

All money results still use ceiling-to-cent normalization.

`reviewGates[].status` is one of `not_started`, `awaiting_material`,
`in_review`, `blocked`, `completed`, or `cancelled`. The linked
`workflowStepCode` is optional, but when present it must reference one project
workflow code. Setting the project current workflow node and setting a review
gate status are intentionally separate actions.

`digest generate` returns a `DigestResult` described in
`command-envelope.schema.json`. It accepts no JSON input and derives every item
from current workspace-list projections and review records.

Project List projections use these definitions:

- `serviceCost = service statement subtotal - subcontractCost` so the service
  and subcontract columns do not double-count one another;
- `totalCost = sales cost + risk contingency`;
- `totalMandays = sum(sites × MD/site)` across all cost rows and years;
- `totalQuote = quoteBeforeTax`;
- `grossMarginPercent` is the actual margin after discount.
