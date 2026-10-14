# CLI command reference

Generated from cost-cli 0.11.0 help. Do not edit this inventory by hand.
Run `node scripts/update-cli-reference.mjs` after changing commands or package version.

Use `npm run --silent cost-cli -- <command>`. Options use separate tokens
(`--name value`); unknown options are rejected. See [the control manual](cli-control-manual.md)
for request envelopes, revisions and errors, and [platform coverage](cli-platform-coverage.md)
for supported fields and UI-only features. The inventory describes command discovery;
per-command validation remains authoritative.

```text
files settings [--root PATH --expected-revision N] [--db FILE]
files list --project-id ID [--node-code CODE --version Vn --category CATEGORY] [--db FILE]
files upload --project-id ID --input FILE [--node-code CODE --version Vn --category CATEGORY] [--compact] [--db FILE]
files download --project-id ID --file-id ID --output FILE [--overwrite] [--db FILE]
project workflow-action --project-id ID --input REQUEST --expected-revision REVISION [--db FILE]
workflow preview --input REQUEST --expected-revision REVISION [--db FILE]
workflow publish --input REQUEST --expected-revision REVISION [--db FILE]
project create --input REQUEST [--db FILE]
cost create --project-id ID --mode blank|clone [--source-version V1] --expected-revision REVISION [--db FILE]
cost delete --project-id ID --version V1 --expected-revision REVISION [--db FILE]
project get --project-id ID [--section settings|metadata|workflow-tracking|workflow-history|workflow-plan|workflow|status|reviews|subcontract|supplemental] [--id ID --query TEXT --limit N --offset N] [--db FILE]
project update --project-id ID [--section settings|metadata|workflow-tracking] --input REQUEST --expected-revision REVISION [--db FILE]
cost get --project-id ID [--section rows|subcontract|settings|resources|travel|summary|versions|workflow|deleted-versions|archive] [--version V1] [--id ID --query TEXT --limit N --offset N] [--db FILE]
cost update --project-id ID [--section rows|subcontract|settings|travel] [--version V1] --input REQUEST --expected-revision REVISION [--db FILE]
masterdata get --tab TAB [--id ID --query TEXT --limit N --offset N] [--db FILE]
masterdata update --tab TAB --input REQUEST --expected-revision REVISION [--db FILE]
cpq get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]
cpq update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]
quote get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]
quote update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]
ssr get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]
ssr update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]
boq get --project-id ID [--section SECTION] [--id ID --query TEXT --limit N --offset N] [--db FILE]
boq update --project-id ID [--section SECTION] --input REQUEST --expected-revision REVISION [--db FILE]
project delete --project-id ID --expected-revision REVISION [--db FILE]
project restore --project-id ID --expected-revision REVISION [--db FILE]
project apply-masterdata --project-id ID --tab TAB --expected-revision REVISION [--db FILE]
cost apply-rates --project-id ID --expected-revision REVISION --version V1 [--db FILE]
project list [--deleted] [--db FILE]
boq import --project-id ID --file FILE --input REQUEST [--apply --expected-revision REVISION] [--compact] [--db FILE]
maintenance archive --project-id ID --expected-revision REVISION [--compact] [--db FILE]
maintenance export --project-id ID --archive-id ID --output FILE.xlsx [--db FILE]
workbook inspect --file FILE.xlsx [--header-row N]
cost import --project-id ID [--version V1] --file FILE.xlsx --input REQUEST [--apply --expected-revision REVISION] [--compact] [--db FILE]
ssr submit --project-id ID [--version Vn] --input REQUEST --expected-revision REVISION [--compact] [--db FILE]
ssr result --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]
ssr close --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]
ssr followup --project-id ID --input REQUEST --expected-revision REVISION [--compact] [--db FILE]
workbook fill-template --project-id ID --file TEMPLATE.xlsx --input MAPPING --output FILE.xlsx [--db FILE]
reminders scan [--as-of YYYY-MM-DD] [--db FILE]
reminders list [--db FILE]
reminders ack --id ID --fingerprint FINGERPRINT [--db FILE]
history search --scope TEXT [--client CUSTOMER] [--db FILE]
version
help
system capabilities
system doctor
schema list
schema show --name NAME [--schema-version VERSION]
cost validate (--input FILE|- | --project-id ID [--version V1]) [--db FILE]
cost calculate (--input FILE|- | --project-id ID [--version V1]) [--db FILE]
cost export (--input FILE|- | --project-id ID [--version V1]) --output FILE.xlsx [--format full|simple] [--db FILE] [--overwrite]
maintenance validate --input FILE|-
digest generate [--as-of YYYY-MM-DD] [--db FILE]
workspace list [--db FILE]
workspace get --project-id ID [--db FILE]
workspace save --input FILE|- --expected-revision REVISION|none [--db FILE]
cpq match --project-id ID --scope TEXT [--db FILE]
cpq confirm --project-id ID --confirmed-by NAME --expected-revision REVISION [--compact] [--db FILE]
cpq solve --project-id ID --expected-revision REVISION [--compact] [--db FILE]
cpq archive --project-id ID --expected-revision REVISION [--compact] [--db FILE]
cpq export --project-id ID --archive-id ID --output FILE.xlsx [--db FILE]
quote export --project-id ID --output FILE.xlsx [--db FILE]
```
