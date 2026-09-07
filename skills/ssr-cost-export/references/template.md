# 公司 Excel 模板映射

先 inspect 用户提供的真实 .xlsx，核对实际 sheet、单元格和可用容量。当前 workbook fill-template 使用 activeVersion，不能带 --version；mapping.version 是版式映射修订号，不是成本版本。用户指定版本与 activeVersion 不同则不能生成错版文件。标准 cost export 支持 --version。

使用 OperationRequest 信封，data 含 schemaVersion:"1.0.0"、operation:"workbook.fill-template"、version、purpose、cells:[{sheet,cell,field}]、tables:[{sheet,startRow,capacity,dataset,columns}]。columns 把字段映射到从1起算的列号。

```sh
cost-cli workbook inspect --file Company.xlsx
cost-cli workbook fill-template --project-id ID --file Company.xlsx --input mapping.json --output outputs/Filled-new.xlsx
```

capacity 是可写行数，映射列在容量内会清空重填；容量不足须先调整真实模板。不要覆盖页脚、原模板或其文件别名。原模板其他内容保留，原公式缓存会清除并标记 Excel 重算，仍须核对其内容、版式及适用性。没有实际模板不能声称符合公司格式。文件成功而历史保存失败属于部分完成。

成本文件设 purpose:"cost"。允许标量 project.id/name/client/currency、proposalNumber、cost.version/total/service/subcontract/mandays。costRows 字段 scope/bu/resource/inputMode/mandays/cost/source，以及 Y1.sites/mandays/cost 至 Y5。年度 Cost 已含选中的3%，不再追加金额或层级。内部成本模板允许成本数据，不用作客户报价。
