# Cost calculation rules

## Annual allocation

- Y1 is derived from the TD delivery start year.
- If Y1 equals the base year, Y1 uplift is zero.
- Later years compound each configured annual uplift.
- Each row contains exactly Y1–Y5 in that explicit order. There is no Y0.
- A row with sites, direct mandays or cost requires a TD delivery start year.

## Sites and mandays

The default site mode uses, for every annual bucket:

```text
Mandays = Sites × MD per Site
```

`inputMode: "mandays"` instead reads `years[].mandays`; all sites and MD/site fields must be zero. It does not create artificial site counts.

Total sites, mandays, and cost sum Y1 through Y5. Internal annual cost is
derived as `Mandays × version MD rate × cumulative uplift`. Changing direct mandays, sites,
MD/site or delivery/uplift assumptions recalculates it immediately. The same
normalization runs on workspace saves. Packaged subcontract costs remain
manually entered monetary inputs.

Each version captures RE Type rates, MD/month, hours/MD and HQ designation.
Editing the master catalogue leaves existing version snapshots unchanged.
**Apply Master Rates** refreshes only the selected version. Cost exports reject
stale supplied labour amounts instead of exporting a contradictory calculation.

## Money normalization

Every annual and manual monetary leaf rounds upward to two decimal places
before roll-up. Parent totals sum normalized leaves, so displayed detail always
reconciles to the displayed total. For example, `18848.282` becomes
`18848.29`. JSON keeps amounts as numbers; `.00` is presentation format only.

## HQ travel

Only an internal resource type with `hqTravel=true` creates travel cost.

```text
HQ months       = sum(HQ mandays / resource MD per month)
Allowance cost  = HQ months × monthly allowance
Airfare cost    = user-entered trips × airfare per trip
HQ travel total = allowance cost + airfare cost
```

The number of trips is never inferred. HQ travel enters statement account
`2.3.1.3` exactly once.

## Cost statement

```text
2.3.1 Labour Cost
  = 2.3.1.1 In-house Labour
  + 2.3.1.2 Non-in-house Labour
  + 2.3.1.3 Travelling Expense

2.3.4 Other Service Costs
  = 2.3.4.1 Car Fee
  + 2.3.4.2 Other Service Costs

2.3 Service Cost
  = 2.3.1 Labour Cost
  + 2.3.2 Subcontract Cost
  + 2.3.3 Settlement Cost
  + 2.3.4 Other Service Costs

2 Sales Cost
  = 2.1.2 Local Purchased Equipment
  + 2.2 Period Cost
  + 2.3 Service Cost

Total Cost with Risk = 2 Sales Cost + 15 Risk Contingency
```

Parent rows are always calculated and cannot be entered directly.

## Double-count controls

- Time-and-material external people belong in Non-in-house Labour.
- Fixed-price or deliverable-based packages belong in Subcontract Cost.
- One contract line must not post to both paths.
- Supplier totals that already include travel, logistics, or vehicles must not
  be posted again to those leaves.
- Export validation warns when non-house labour and subcontract values coexist;
  the future contract model will enforce this using contract-line IDs.
