---
name: cost-workbench
description: Operate the local SSR Cost & Quote Workbench through its CLI for TD/PM Excel imports, service costs, semi-automatic CPQ configuration, SSR review evidence and reminders, maintenance BOQ, historical scope references, and quotation Excel outputs. Use for this personal work platform; company approvals remain in the company system.
---

# Cost Workbench

Use the repository's `cost-cli` and shared domain functions. Find the repository containing `cli/cost-cli.mjs` in the current project. Do not invent a repository path, automate the visual UI when a command exists, or reproduce financial calculations in prompts.

Start with `npm run --silent cost-cli -- system capabilities`. Run `schema show` for the data being changed; the schema is authoritative. See [operations](references/operations.md) for command sequences and request examples.

Read `workspace get` before changing project data. Retain unrelated fields and inactive cost versions. Save using the exact returned revision; on a conflict, read again and merge the intended change. Top-level cost editors are the active version's source. Internal labour cost is recalculated using that version's resource rates. `Confirmed` is an editable working-state label; SSR submission snapshots, CPQ archives and maintenance archives are immutable.

Use current user authorization for requested reversible work. Do not repeatedly ask for permission to inspect, map, validate, calculate, save drafts, or export new local files. Ask only for a missing fact that materially affects the requested result, or the explicit CPQ item selection required below. Do not fabricate company review evidence or send messages to PM/others without authorization.

## Brief scope to CPQ

Accept a rough TD description or an SSR sentence. Detailed TD scope and per-scope costs are not prerequisites. Keep the original brief and distinguish known facts from suggestions.

Read existing catalog codes, scope, unit cost, quantity rules and tags. `cpq match` supplies keyword candidates; use the actual catalog to interpret and rerank them. Show the recommended existing codes, matching reasons, optional items and unknowns to the user. Similarity scores are not confidence and never become budget weights.

Let the user select/confirm the items. Record this selection in `cpq.draft.selections` and use `cpq confirm` only after that confirmation exists in the conversation or recorded workflow. Do not claim the agent is the user's confirmer. A change in selected items, catalog terms or locked quantities requires renewed item confirmation.

For calculation, record the target cost and its basis. Obtain actual equipment/fixed quantities from the brief, BOQ or user; never reverse-calculate equipment counts from money. Only selected, confirmed, adjustable service items can vary. Prefer applicable historical/reference quantities, then catalog defaults. Otherwise explain a suggested budget allocation; if there is too little information to infer priorities, use the explicit equal-service-budget assumption. CPQ quantities are configuration quantities and do not replace TD labour estimates.

Use `cpq solve`. Explain actual quantities, locked equipment, total, difference, tolerance and allocation basis. A bounded search with `searchComplete=false` does not prove infeasibility. Keep unresolved differences as drafts. Archive a current acceptable result with its cost version; do not edit an archive to fit later prices or costs.

## Excel and quotations

Inspect source sheets first, propose column mappings from actual headers, and preview imports before applying. Exclude totals/subtotals explicitly. Formula cells need cached results from Excel. Direct mandays and Sites × MD/Site are mutually exclusive. Preserve file hash, row, mapping and original imported values; distinguish subsequent edits from the original TD/PM input. Changing rates or target project/version requires a new preview.

Use the standard exporters or the explicit company `.xlsx` template mapping. Quote outputs must not contain internal costs, rates or margin; map approved payment terms, validity, T&C and included assumptions. Original-template formulas require Excel recalculation. Real company templates must be mapped and verified from the files actually provided; do not claim a fixture validates the company's layout.

Maintenance BOQ uses actual device quantities and exact normalized model matches. Compare customer, SLA, site, term, date and outcome, then select a reference and record price differences. Unit/year references divide by both quantity and duration. Missing/invalid denominators are unavailable, never a free price. Maintenance exports are labelled drafts and do not constitute a final approved quotation.

## SSR evidence and reminders

Record Proposal, scope/material version, required professional domains and the company record address in `workspace.ssr`; enable SSR checks for that project. Register actual company application numbers and evidence with `ssr submit`. Track DTRB → DRB → budget and professional reviews in parallel → quote decision; tender decisions also require a complete bid-response review. Cost, scope, customer, T&C, pricing or prerequisite changes can invalidate earlier results.

Use `ssr result`, `ssr close` and `ssr followup` to append actual evidence. A local operation does not submit or approve anything in the company system. An approved result with open conditions cannot clear a gate. Do not overwrite old results to hide a rejection.

The local API scans reminders every minute while running and catches up when restarted. `reminders ack` means read, not resolved. Resolution comes from source records. Do not claim this skill runs continuously or that the PM has been contacted. If asked for monitoring while this app is closed, arrange a separately authorized scheduler.

After mutations, verify the returned revision/data. For exports, report the returned artifact path and disclose any failure to persist history even if the file was written. Use CLI error codes and violations rather than inferring success from prose.
