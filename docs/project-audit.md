# Project structure audit and remediation

Reviewed against the project workflow: TD labour input, subcontract cost,
versioned costing, multi-dimensional Excel output, pricing, editable master
data, project/review tracking, maintenance references, and Agent CLI contracts.

## Structure

The existing feature-based layout is suitable for a local personal workbench.
It does not need a framework replacement. The main risks were shared mutable
session state and values calculated only inside page event handlers.

| Boundary                                     | Responsibility                                |
| -------------------------------------------- | --------------------------------------------- |
| `features/workbench/workspace-factories.ts`  | Detached project/version defaults             |
| `features/workbench/workspace-types.ts`      | Durable workspace and API types               |
| `features/workbench/workspace-client.ts`     | HTTP envelopes and transport errors           |
| `features/workbench/save-queue.ts`           | Ordered writes and per-session revisions      |
| `features/workbench/local-persistence.ts`    | Hydration/autosave lifecycle                  |
| `features/cost/domain.ts`                    | Canonical cost arithmetic and quantities      |
| `server/workspace-document.mjs`              | Compatibility migration and integrity checks  |
| `server/workspace-repository.mjs`            | SQLite transactions, projections and archives |
| `features/master-data/maintenance-import.ts` | Import validation and number parsing          |
| `features/quote/manual-history-form.tsx`     | Actual historical quote entry                 |

## Corrected findings

| Priority | Observed failure                                                      | Correction                                                          |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| P1       | Switching projects discarded failed writes or reused another revision | Queued writes, awaited flush, session isolation, dirty-page warning |
| P1       | Labour cost remained stale after rate/uplift changes                  | Shared recalculation for UI/save; stale external export rejected    |
| P1       | Master-data edits changed historical HQ travel                        | Independent version rate/conversion snapshots; explicit refresh     |
| P1       | Valid input factors could create out-of-range stored amounts          | Revalidation after calculation, before transaction                  |
| P1       | Missing/duplicate version or resource references were accepted        | Repository relation/uniqueness checks                               |
| P1       | Invalid maintenance import blocked all subsequent autosaves           | All-or-nothing shared import validation                             |
| P1       | Confirmed status alone allowed an invalid client quotation            | Cost and pricing checks before customer output                      |
| P2       | Workflow deletion broke linked reviews                                | Block deletion until linked reviews are reassigned                  |
| P2       | Save buttons only announced success                                   | Actual persistence result controls feedback                         |
| P2       | Portfolio reverted to stale values after switching                    | Outgoing projection retained; hydrated project metadata restored    |
| P2       | Manual history merely copied today's price                            | Actual date, quote number, cost, price and tax entry                |
| P2       | Version delta used adjacent array position                            | Compare against the recorded source version                         |
| P2       | Explicit follow-up dates did not trigger reminders                    | Latest promised follow-up date included in digest                   |
| P2       | Repository input errors appeared as CLI internal failures             | Typed business-validation response and exit code                    |
| P2       | Concurrent exports could replace a file without overwrite             | Exclusive file creation                                             |

## Legacy data

Database schema 2 records the exact pre-migration workspace JSON in
`workspace_migration_archive` before changing a live snapshot. Migration runs
atomically and only once. Versions without captured rate data use the catalogue
available at migration; stale labour amounts are corrected and marked with a
`calculationNote` visible on Cost. Review those baselines before quoting.
Rates that were never recorded cannot be recovered from historical totals.

## Validation and scope

Regression coverage includes delayed writes, conflict/offline recovery, independent
project revisions, rate refresh, historical rates, invalid references, derived
overflow, migration archives/idempotence, maintenance validation, actual Excel
serialization, CLI error envelopes and explicit follow-up reminders.
Lint, TypeScript, the test suite and the production build are the acceptance checks.
This review did not perform browser interaction or visual acceptance testing.

## Remaining boundaries

- Master catalogues are project-scoped. A company-wide shared catalogue with
  explicit adoption/versioning is not implemented.
- The master-data view and composition root still contain sizeable UI sections.
  Further table-level splitting can follow feature work; transport, persistence,
  factories and validation no longer need to be changed inside those pages.
- Maintenance history is reference data; no pricing rule automatically converts
  imported equipment contracts into a unified customer quotation.
- Digest generation is available through CLI/UI; scheduled execution and company
  model integration are not installed by this audit.
- Optional non-HQ travel rows remain experimental and outside governed totals.
  HQ allowance and airfare are included.
- The old `skills/cost-workbench/` files are deferred prototype material, not
  current operating instructions. Use the CLI control manual and live schemas;
  this audit does not generate or install a Skill.
- Row-level event sourcing, electronic signatures, and automatic company-system
  entry remain outside the current platform.
