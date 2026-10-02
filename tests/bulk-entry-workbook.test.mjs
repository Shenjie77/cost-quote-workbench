import assert from 'node:assert/strict';
import test from 'node:test';
import { entryWorkbook,readEntrySheet,entryTsv } from '../features/bulk-entry/workbook.ts';
import { parsePersonnelBulkEntry } from '../features/cost/personnel-bulk-entry.ts';
import { initialRateSettings } from '../features/cost/demo-data.ts';
import { initialResourceTypes } from '../features/master-data/demo-data.ts';
import { bulkTabSpec,previewBulkImport } from '../features/master-data/bulk-import-model.ts';
const spec={id:'personnel',name:'Personnel',columns:[{key:'scope',label:'Scope',kind:'text',required:true},{key:'bu',label:'BU',kind:'text',required:true},{key:'reType',label:'RE Type',kind:'text',required:true},{key:'mandays:0',label:'Y1 MD',kind:'number'}]};
function fill(doc,id,row,values){doc.workbook.sheets[id].cellData[row]=Object.fromEntries(values.map((v,c)=>[c,{v,t:typeof v==='number'?2:1}]));}
test('fixed workbook preserves named sheets, frozen headers, multiline paste and personnel cost rules',()=>{
 const doc=entryWorkbook([spec]);fill(doc,spec.id,1,['Install\nand test','Network','LOCAL-L1',2.5]);
 const read=readEntrySheet(doc,spec);assert.deepEqual(read.issues,[]);
 const preview=parsePersonnelBulkEntry(entryTsv(spec,read.rows),{resources:initialResourceTypes,rates:initialRateSettings,defaultMode:'mandays',defaultYear:0,hasHeader:true,mapping:Object.fromEntries(spec.columns.map((c,i)=>[i,c.key]))});
 assert.equal(preview.canConfirm,true,JSON.stringify(preview));assert.equal(preview.rows.length,1);assert.equal(preview.rows[0].scope,'Install\nand test');assert.ok(preview.totalCost>0);
 assert.equal(doc.workbook.sheets.personnel.freeze.ySplit,1);
});
test('layout damage, formula errors and data outside fixed columns block import at exact cells',()=>{
 const doc=entryWorkbook([spec]);fill(doc,spec.id,1,['Setup','Network','LOCAL-L1',2]);doc.workbook.sheets.personnel.cellData[0][0].v='Wrong';doc.workbook.sheets.personnel.cellData[1][3]={f:'=1+1',v:2,t:2};doc.workbook.sheets.personnel.cellData[1][8]={v:'unexpected'};
 const {issues}=readEntrySheet(doc,spec);assert.ok(issues.some(i=>i.row===1&&i.column===1));assert.ok(issues.some(i=>i.row===2&&i.column===4));assert.ok(issues.some(i=>i.column===9));
 delete doc.workbook.sheets.personnel;assert.match(readEntrySheet(doc,spec).issues[0].message,/missing/);
});
test('master catalog keys remain text and field-only updates retain existing fields',()=>{
 const raw=bulkTabSpec('project-tags');const sheet={id:'project-tags',name:'Project Tags',columns:raw.columns.map(c=>({...c,required:false}))};const doc=entryWorkbook([sheet]);
 const data={id:'001',name:'Updated tag'};fill(doc,sheet.id,1,sheet.columns.map(c=>data[c.key]??''));
 const read=readEntrySheet(doc,sheet);assert.deepEqual(read.issues,[]);
 const preview=previewBulkImport('project-tags',read.rows,[{id:'001',name:'Old tag',active:true}]);assert.deepEqual(preview.issues,[]);assert.equal(preview.items[0].id,'001');assert.equal(preview.items[0].name,'Updated tag');
 const idColumn=sheet.columns.findIndex(c=>c.key==='id');doc.workbook.sheets[sheet.id].cellData[1][idColumn].v=1;assert.ok(readEntrySheet(doc,sheet).issues.some(i=>i.column===idColumn+1));
});
