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

`inputMode: "mandays"` instead reads `years[].mandays`; all sites and MD/site fields must be zero. It does not create artificial site counts. The personnel toolbar switches the whole grid between Sites and Direct MD. Sites-to-MD keeps every year's actual effort; converting populated Direct MD rows back to Sites requires one confirmation before clearing their allocations. Bulk conversion validates all rows and rejects concurrent effort or row-membership changes atomically. Existing mixed-mode data stays unchanged until the user explicitly selects a mode; new rows follow the selected mode.

Total sites, mandays, and cost sum Y1 through Y5. Internal annual cost is
derived as `Mandays × version MD rate × cumulative uplift`. Changing direct mandays, sites,
MD/site or delivery/uplift assumptions recalculates it immediately. The same
normalization runs on workspace saves. New package costs use the version-owned
Subcon BOQ: project annual quantities × unit prices, or site-type BOQ per-site
cost × annual site counts, plus shared project items. The result feeds 2.3.2 once.
Legacy RE subcontract rows retain their stored amounts for historical reads;
they cannot be newly entered or repriced through Cost Input. See
[Subcontract costing](subcontract-cost-design.md).

The **3% Allowance** selector in Cost Input chooses personnel Pools through
`rateSettings.allowancePools`: LOCAL, ARP, HQ and OTHER. All internal RE Types in
a selected Pool receive the allowance; an explicit empty array disables it.
Each applicable annual Cost uses `Mandays × version MD rate × cumulative uplift
× 1.03`, rounded upward once to cents. Recalculation starts from effort and rates,
so it never compounds a previously calculated Cost. Unselected personnel,
subcontract, travel and manual costs do not receive this uplift.

Summary, history, quotation and Excel sum these final annual costs; there is no
separate allowance row or second addition. Selection belongs to the cost version
and is protected by that version's lock. New blank versions start with no Pools
selected; clones retain their source settings. Historical snapshots without
`allowancePools` retain their exact `allowanceResourceTypeIds` selection, or the
older `localArpAllowanceEnabled` LOCAL/ARP behavior when neither array is stored.
Reading a historical version never expands its selected RE Types to an entire
Pool. An explicit Pool change applies the chosen Pool categories to that editable
version. Global RE rates are never changed to implement the allowance.

Each version captures RE Type rates, MD/month, hours/MD and HQ designation.
Editing the global master catalogue leaves every existing version snapshot
unchanged, including Draft. A blank new version captures current global rates;
a clone retains the source rates. **Apply Master Rates** explicitly captures
current global resources for only the selected unlocked version. The rates are
SGD/MD; the platform has no independent FX conversion engine. Cost exports reject
stale supplied labour amounts instead of exporting a contradictory calculation.

## Money normalization

Every annual and manual monetary leaf rounds upward to two decimal places
before roll-up. Parent totals sum normalized leaves, so displayed detail always
reconciles to the displayed total. For example, `18848.282` becomes
`18848.29`. JSON keeps amounts as numbers; `.00` is presentation format only.

## HQ travel

New cost versions explicitly start with `travelSettings.enabled:false`. **Include
HQ Travel** must be selected to include travel. With `enabled:true`, only internal
resources whose pool is HQ contribute effort; an HQ RE Type alone does not enable
travel. Disabled travel costs zero, including airfare, while entered monthly
allowance, trips and airfare prices remain saved for reuse. The panel can still
show HQ effort as a reference while disabled.

Historical snapshots without `enabled` retain their saved legacy calculation using
`hqTravel=true`, so archived amounts do not change. Reading or cloning them does
not rewrite their settings. Users can explicitly enable or disable travel in an
unlocked version.

```text
HQ months       = sum(HQ mandays / resource MD per month)
Allowance cost  = HQ months × monthly allowance
Airfare cost    = user-entered trips × airfare per trip
HQ travel total = allowance cost + airfare cost
```

The number of trips is never inferred. HQ travel enters statement account
`2.3.1.3` exactly once. No HQ effort means zero HQ travel, even when enabled.
Neither labour uplift nor the 3% personnel allowance applies to travel expenses.

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

## Other service cost (2.3.4.2)

New blank costs default to 1% of 2.3.1 Labour Cost: in-house labour + non-in-house labour + HQ travel, excluding subcontract. Round the labour subtotal and the calculated charge to SGD cents. 2.3.1 remains an automatic subtotal. The optional `manualCosts.otherServiceRate` is a fraction (0.01 = 1%); when absent, `otherService` is the saved manual amount. Historical snapshots are not backfilled. Clones retain their source mode. Editing the 2.3.4.2 amount switches to manual; Use 1% restores automatic calculation. Cost totals, dimension residuals, pricing and both workbook exports use the shared statement calculation.
