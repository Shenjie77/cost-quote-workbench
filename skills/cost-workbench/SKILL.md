---
name: cost-workbench
description: Operate and inspect the local Cost & Quote Workbench through cost-cli for cost validation, calculation, Excel export, schemas, and maintenance history data. Use when a request concerns this personal quotation platform; do not automate the company quotation system itself.
---

# Cost Workbench

Use the repository's `cost-cli` as the system interface. Do not parse the visual
UI or reproduce cost formulas in prompts or scripts.

## Required workflow

1. Run `npm run --silent cost-cli -- system capabilities` from the repository
   root. Keep `--silent` so stdout remains one JSON envelope.
2. Before sending data, run `schema show` for the applicable schema.
3. Preserve user Scope exactly; do not create a translated companion value.
4. Validate cost or maintenance input before calculation/export.
5. Read `error.code` and `error.violations`; do not infer success from prose.
6. After export, return the CLI-provided path, SHA-256, and size.

Use explicit project and version identifiers whenever the command supports
them. Never edit a frozen cost version; clone it when that capability becomes
available. Do not parse display-formatted amounts such as `S$ 1,804,000` into
machine inputs.

For command order and error handling, read
[references/operations.md](references/operations.md). For calculation or field
meaning, read the canonical project docs and schemas reported by the CLI.
