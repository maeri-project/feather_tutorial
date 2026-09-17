'use strict';
const assert = require('node:assert/strict');
const model = require('../script/feather_buffer_model.js');
const view = require('../script/feather_buffer_view.js');
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }
const fields = {streaming: ['M_L0','M_L1','J_L1'], stationary: ['N_L0','N_L1','K_L1'], output: ['P_L0','P_L1','Q_L1']};
const hardware = width => ({AH: width, AW: width, sram_mb: 4, frac_stream: .4, frac_stationary: .4, frac_output: .2});
function layout(width, kind, order, dims = [width, 3, 2], hw = hardware(width)) {
  return model.layout(hw, kind, Object.fromEntries([['order',order], ...fields[kind].map((name,index) => [name,dims[index]])]), 1);
}
const context = () => ({save() {}, restore() {}, fillText() {}, fillRect() {}, strokeRect() {}});
for (const width of [4,8,16]) for (const kind of Object.keys(fields)) for (let order = 0; order < 6; order++) {
  const descriptor = layout(width,kind,order), projection = view.window(descriptor);
  equal(projection.vnRows,[0,1,2,3]);
  equal(projection.totalVNRows,6);
  const activeCell = model.scalar(descriptor,width-1,5*width+width-1);
  const focused = view.window(descriptor,[activeCell]);
  equal(focused.vnRows,[4,5]);
  const region = {x:30,y:40,width:width*50+58,height:view.height(descriptor,focused)};
  const events = [{...activeCell,status:'preview-written'}];
  const cells = view.draw(context(),descriptor,focused,region,{events,cellAt:(bank,row)=>({...model.scalar(descriptor,bank,row),written:true})});
  equal(cells.length,2*width*width);
  const other = view.draw(context(),descriptor,focused,{...region,x:800,y:20,width:width*70+58},{events});
  for (let index=0; index<cells.length; index++) {
    const cell=cells[index], exact=model.scalar(descriptor,cell.bank,cell.scalarRow), peer=other[index];
    equal([cell.vnRow,cell.vnIndex,cell.lane,cell.label],[exact.vnRow,exact.vnIndex,exact.lane,exact.label]);
    equal([cell.bank,cell.scalarRow,cell.label,cell.status],[peer.bank,peer.scalarRow,peer.label,peer.status]);
    equal(view.point(cells,cell.bank,cell.scalarRow),[cell.x,cell.y]);
    ok(cell.bounds.x>=region.x && cell.bounds.y>=region.y &&
      cell.bounds.x+cell.bounds.width<=region.x+region.width &&
      cell.bounds.y+cell.bounds.height<=region.y+region.height,'Every scalar bound is inside the buffer card.');
    ok(cell.y+20<=region.y+region.height,'The existing 20px token badge fits beneath the final scalar lane.');
    ok(cell.x-40>=region.x && cell.x+40<=region.x+region.width,'An 80px badge fits across either edge bank.');
    equal(cell.written,true);
  }
  equal(view.point(cells,0,0),null,'Undisplayed rows never become a fake edge destination.');
  equal(view.point(cells,width,5*width),null);
  equal(cells.find(cell=>cell.bank===activeCell.bank&&cell.scalarRow===activeCell.scalarRow).status,'preview-written');
}

const ragged=layout(4,'output',0,[3,3,1]), raggedView=view.window(ragged);
equal(raggedView.vnRows,[0,1,2]);
const raggedCells=view.draw(context(),ragged,raggedView,{x:0,y:0,width:258,height:view.height(ragged,raggedView)});
equal(raggedCells.filter(cell=>cell.valid).length,36);
equal(view.point(raggedCells,1,8),null,'A ragged final bank slot has no scalar destination.');
const capped={...ragged,capacityRows:2};
equal(view.window(capped,[{bank:0,scalarRow:8,vnRow:2,valid:true}]).vnRows,[0,1,2],
  'An out-of-capacity event must not shift the default layout window.');
const cappedCells=view.draw(context(),capped,view.window(capped),{x:0,y:0,width:258,height:view.height(capped,view.window(capped))});
equal(view.point(cappedCells,0,2),null,'An out-of-capacity scalar is not an animated destination.');

const huge=layout(16,'streaming',0,[16,65536,65536],{AH:16,AW:16});
const live=Array.from({length:16},(_,bank)=>({bank,scalarRow:(1024+bank*1000000)*16,vnRow:1024+bank*1000000,valid:true}));
const sparse=view.window(huge,live);
ok(sparse.vnRows.length<=20,'Huge buffers use a bounded sparse projection.');
for(const item of live)ok(sparse.vnRows.includes(item.vnRow),'Every simultaneous active VN row remains visible.');
equal(sparse.totalVNRows,4294967296);
const missing=model.layout(hardware(4),'streaming',null,1);
equal(view.window(missing).vnRows,[]);
equal(view.draw(context(),missing,view.window(missing),{x:0,y:0,width:258,height:80}),[]);
console.log('Buffer view tests: '+checks+' assertions passed.');
