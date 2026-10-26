import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createDocx} from '../app/src/main/assets/www/export-docx.js';
import {layoutPages} from '../app/src/main/assets/www/table-layout.js';

globalThis.window = {};
const {saveFile} = await import('../app/src/main/assets/www/native-export.js');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const data = new Uint8Array(350001).map((_, i) => i % 251);
let chunks = [], cancelled = false, id = 0, status = 'success';
window.InventoryAndroid = {
  startExport: () => String(++id),
  appendExport: (_, base64) => {
    const bytes = Buffer.from(base64, 'base64');
    assert.ok(bytes.length <= 128 * 1024);
    chunks.push(bytes);
    return true;
  },
  finishExport: id => {
    queueMicrotask(() => window.inventoryNativeExportResult({id, status}));
    return true;
  },
  cancelExport: () => {cancelled = true;},
};
assert.equal(await saveFile(new Blob([data], {type: DOCX}), '清冊.docx'), true);
assert.ok(chunks.length > 1);
assert.deepEqual(Buffer.concat(chunks), Buffer.from(data));
status = 'cancel';
assert.equal(await saveFile(new Blob(['{}'], {type:'application/json'}), '備份.json'), false);
status = 'error';
await assert.rejects(saveFile(new Blob(['{}'], {type:'application/json'}), '備份.json'), /無法儲存/);
window.InventoryAndroid.appendExport = () => false;
await assert.rejects(saveFile(new Blob(['{}'], {type:'application/json'}), '備份.json'), /傳輸中斷/);
assert.equal(cancelled, true);
window.InventoryAndroid.finishExport = () => false;
window.InventoryAndroid.appendExport = () => true;
await assert.rejects(saveFile(new Blob(['{}'], {type:'application/json'}), '備份.json'), /儲存視窗/);
await assert.rejects(saveFile(new Blob(['x'], {type:'text/html'}), 'x.html'), /不支援/);

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6j5sAAAAASUVORK5CYII=';
const columns = [
  {id:'notes',label:'備註',width:250}, {id:'photo',label:'照片',width:145},
  {id:'name',label:'名稱',width:210}, {id:'serial',label:'序號',width:48},
  {id:'quantity',label:'數量',width:80}, {id:'checked',label:'驗收',type:'checkbox',width:70},
];
const rows = Array.from({length: 12}, (_,i) => ({
  name:'測試物品 '+i, quantity:'2', notes:'<完整 & 備註>',
  height:i%2 ? 240 : 104, values:{checked:true}, photo:{dataUrl:png},
})).reverse();
function entriesFromStoredZip(bytes) {
  const entries = new Map();
  for (let offset=0; bytes.readUInt32LE(offset)===0x04034b50;) {
    assert.equal(bytes.readUInt16LE(offset+8), 0);
    const length = bytes.readUInt32LE(offset+18);
    const nameLength=bytes.readUInt16LE(offset+26), extraLength=bytes.readUInt16LE(offset+28);
    const name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8');
    const start=offset+30+nameLength+extraLength;
    entries.set(name,bytes.subarray(start,start+length));
    offset=start+length;
  }
  return entries;
}
for (const orientation of ['portrait','landscape']) {
  const options={title:'測試清冊',columns,rows,headerPng:png,headerHeightPx:150,rowsPerPage:7,orientation};
  const layout=layoutPages(options);
  assert.ok(layout.pages.length>=2);
  assert.equal(layout.widths.reduce((a,b)=>a+b,0), layout.contentW);
  assert.deepEqual(layout.pages.flatMap(p=>p.rows), rows);
  for (const page of layout.pages) assert.ok(page.heights.reduce((a,b)=>a+b,0)<=layout.availableRowH);
  const blob=await createDocx(options);
  assert.equal(blob.type,DOCX);
  const entries=entriesFromStoredZip(Buffer.from(await blob.arrayBuffer()));
  const xml=entries.get('word/document.xml').toString('utf8');
  assert.equal([...entries.keys()].filter(p=>p.startsWith('word/media/')).length,13);
  assert.ok(xml.indexOf('備註')<xml.indexOf('照片'));
  assert.ok(xml.indexOf('測試物品 11')<xml.indexOf('測試物品 10'));
  assert.ok(xml.includes('&lt;完整 &amp; 備註&gt;'));
  assert.ok(xml.includes('☑'));
  assert.ok(xml.includes(`<w:gridCol w:w="${layout.widths[0]}"/>`));
  assert.equal((xml.match(/<w:br w:type="page"\/>/g)||[]).length,layout.pages.length-1);
}
const app=await fs.readFile(new URL('../app/src/main/assets/www/app.js',import.meta.url),'utf8');
assert.ok(app.includes('await saveFile(blob,name)'));
assert.ok(app.includes('return saveFile(blob,name)'));
assert.ok(app.includes('window.inventoryNativeFlush'));
console.log('Passed: chunked export integrity, save/cancel/errors, Word photos/order/size/page breaks in both orientations.');
