# TD / PM 导入

从仓库根目录使用主 skill 说明的 cost-cli 前缀。

```
cost-cli workbook inspect --file TD.xlsx --header-row 1
cost-cli cost import --project-id ID --version Vn --file TD.xlsx --input mapping.json
cost-cli cost import --project-id ID --version Vn --file TD.xlsx --input mapping.json --apply --expected-revision REVISION --compact
```

Example `mapping.json`:

```json
{
  "apiVersion": "cost-workbench/v2",
  "kind": "OperationRequest",
  "requestId": "import-1",
  "data": {
    "schemaVersion": "1.0.0",
    "operation": "cost.import",
    "mapping": {
      "sheet": "TD",
      "headerRow": 1,
      "role": "TD",
      "mode": "mandays",
      "year": "Y1",
      "columns": {
        "scope": 1,
        "bu": 0,
        "resource": 0,
        "mandays": 2,
        "sites": 0,
        "mdPerSite": 0,
        "cost": 0
      },
      "defaultBu": "Delivery",
      "defaultResource": "RE-TYPE-ID-FROM-WORKSPACE",
      "excludeRows": []
    }
  }
}
```

Select real sheet, columns, BU and an active internal RE Type for personnel effort. `0` means unmapped. `endRow` limits data; `excludeRows` removes known total/footer rows. PM subcontract BOQs use [structured subcontract](subcontract.md): inspect the workbook, map items/prices/quantities/site types and annual counts, then update `cost --section subcontract`; do not map package totals to a subcontract RE Type. `tdStart` must identify a real Y1. Personnel import appends rows. For a revised TD/PM file, use a new working cost version or explicitly replace the intended previous rows; a changed file hash does not mean the old cost disappeared. Same source row can be imported for different years, but overlapping source years are rejected. Never count the same packaged service in two separate costs.

预览和应用均指定同一版本；省略 --version 会使用 activeVersion。预览返回 revision/version，应用使用该 revision。文件、映射或目标版本日期/资源变化后必须重新预览。若源成本列未包含该人员 Pool 已选用的 3%，请只映射实际人天、不映射基础成本列；映射成本列时须与平台年度成本一致。
