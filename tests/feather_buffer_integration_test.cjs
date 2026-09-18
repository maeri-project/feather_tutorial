'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../script/feather_buffer_model.js');
const bufferView = require('../script/feather_buffer_view.js');
const source = fs.readFileSync(path.join(__dirname, '../script/feather_buffer_integration.js'), 'utf8');
let checks = 0;
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function equal(actual, expected, message) { assert.deepEqual(plain(actual), plain(expected), message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }

function fixture(width) {
  const hardware = {AH:width,AW:width,sram_mb:4,frac_stream:0.4,frac_stationary:0.4,frac_output:0.2};
  const mapping = {r0:0,c0:0,Gr:width/2,Gc:1,sr:1,sc:0};
  const streaming = {dataflow:1,m_0:0,s_m:width/2,T:4,vn_size:width-1};
  const instructions = [
    {type:'SetIVNLayout',params:{order:5,M_L0:width,M_L1:2,J_L1:2}},
    {type:'SetWVNLayout',params:{order:2,N_L0:width,N_L1:2,K_L1:2}},
    {type:'SetOVNLayout',params:{order:0,P_L0:width,P_L1:2,Q_L1:2}},
    {type:'ExecuteMapping',params:{...mapping}},
    {type:'ExecuteStreaming',params:{...streaming}},
    {type:'ExecuteMapping',params:{...mapping}},
    {type:'ExecuteStreaming',params:{...streaming}},
    {type:'SetOVNLayout',params:{order:1,P_L0:width,P_L1:2,Q_L1:2}},
    {type:'ExecuteMapping',params:{...mapping}},
    {type:'ExecuteStreaming',params:{...streaming}}
  ];
  const stages = width === 4 ? 3 : 2 * Math.log2(width);
  const frames = Array.from({length:stages+5}, (_,index) => ({
    snapshotIndex:index<stages+3?0:index===stages+3?1:2,
    iteration:index<stages+3?0:index===stages+3?1:2,
    aOR:index<2?index:-1, outputDot:index===0?1:0, aWR:[], aIR:[], pMC:{}, pp:{},
    phase:'Teaching frame '+index
  }));
  // The queued result belongs to outputDot, even if the PE already advanced.
  for (let col=0;col<width;col++) {
    frames[0].pMC['0,'+col] = width * 8;
    frames[1].pMC['1,'+col] = width;
  }
  let index=0, progress=1, playing=false, redraws=0, refreshes=0, opened=null, popupOptions;
  const listeners = {};
  const geometry = {bufferRegions:[
    {operand:'I',x:0,y:10,width:240,height:72},
    {operand:'W',x:250,y:10,width:240,height:72},
    {operand:'O',x:0,y:500,width:490,height:72}
  ]};
  const canvas = {width:1000,height:1000,style:{},addEventListener:(name,fn)=>{listeners[name]=fn;},
    getBoundingClientRect:()=>({left:10,top:20,width:500,height:500})};
  const opener = {id:'opener'};
  const context = {FeatherBufferModel:model, FeatherBufferView:bufferView, document:{getElementById:()=>opener},
    FeatherBufferPopup:{create:options=>{popupOptions=options;return {
      refresh(){refreshes++;},open(operand,element){opened={operand,element};}
    };}}};
  context.window=context;
  vm.runInNewContext(source,context,{filename:'feather_buffer_integration.js'});
  const host = {
    hardware:()=>hardware,instructions:()=>instructions,signature:()=>JSON.stringify(instructions),
    frames:()=>frames,frame:()=>frames[index],index:()=>index,progress:()=>progress,
    playing:()=>playing,reduced:()=>false,
    // Independently solvable non-identity wiring: stage s rotates inputs by
    // (s mod 3)+1. This checks composition and preserves source-column identity.
    birrdInputs:(stage,sw)=>[0,1].map(side=>(2*sw+side+(stage%3)+1)%width),
    canvas:()=>canvas,geometry:()=>geometry,playPause:()=>{playing=!playing;},
    step:delta=>{index=Math.max(0,Math.min(frames.length-1,index+delta));progress=1;},
    redraw:()=>{redraws++;}
  };
  const api = context.FeatherBufferIntegration.create(host);
  return {api,hardware,instructions,frames,stages,geometry,listeners,canvas,host,
    popup:()=>popupOptions,go:(frame,fraction=1)=>{index=frame;progress=fraction;return api.prepare(frames[index],fraction);},
    setIndex:value=>{index=value;},setProgress:value=>{progress=value;},
    counters:()=>({redraws,refreshes,opened,playing})};
}

for (const width of [4,8,16]) {
  const f=fixture(width), {api,stages}=f;
  const destination={bank:0,row:width};
  let rotation=0;
  for(let stage=0;stage<stages;stage++)rotation+=(stage%3)+1;
  for(let age=0;age<=stages+1;age++) {
    const state=f.go(age,0.5);
    const packets=state.events.filter(event=>event.operand==='O'&&event.age===age);
    equal(packets.length,width);
    for(let col=0;col<width;col++) {
      const packet=api.result(age,col),rep=col%(width/2),m=width/2+rep;
      const L=m*2;
      equal([packet.peRow,packet.peCol,packet.t,packet.label], [0,col,1,`C[${m},0]`]);
      equal([packet.bank,packet.scalarRow,packet.vnIndex], [L%width,Math.floor(L/width)*width,L]);
      equal(packet.sourcePort,((col-rotation)%width+width)%width);
      equal([packet.partial,packet.preview,packet.committed], [true,true,false]);
      equal(packets.find(item=>item.peCol===col).status,'in-flight');
      equal(packet.arriving,age===stages+1);
    }
    equal(api.getCell('O',destination.bank,destination.row).written,false,'No output cell is marked written before arrival completes.');
  }
  const arrived=f.go(stages+1,1);
  equal(arrived.events.filter(event=>event.operand==='O'&&event.age===stages+1).every(event=>event.status==='preview-written'),true);
  equal(api.getCell('O',0,width).written,true);
  equal(api.getCell('O',0,width).label,`C[${width/2},0]`);
  equal(api.getCell('O',0,1).written,false,'A second result arriving next frame must remain unwritten.');
  f.go(stages+2,1);
  equal(api.getCell('O',0,1).written,true);
  f.go(stages+3,1);
  equal(api.getCell('O',0,width).written,true,'A new EM does not clear output SRAM.');
  equal(api.current().snapshot.index,1);
  f.go(stages+4,1);
  equal(api.current().snapshot.index,2);
  equal(api.getCell('O',0,width).written,true,'Changing OVN interpretation does not clear physical SRAM.');
  equal(api.getCell('O',0,width).label,`C[0,${width}]`,'The new OVN layout interprets the same physical location differently.');

  f.go(stages,1);
  equal(api.getCell('O',0,width).written,false,'Backward scrubbing hides future writes again.');
  f.go(stages+1,0.999);
  equal(api.getCell('O',0,width).written,false);
  f.go(stages+1,1);
  equal(api.getCell('O',0,width).written,true);
  f.go(0,1);
  equal(api.getCell('O',0,width).written,false);

  // Simulate inspector stepping while the architecture canvas is not drawn.
  f.setIndex(stages+3);
  equal(api.current().index,stages+3);
  equal(f.popup().getState().frame,stages+3);
  equal(api.getCell('O',0,width).written,true);
  f.popup().onStep(-1);
  equal(api.current().index,stages+2);
  equal(f.popup().getState().frame,stages+2);
  f.go(stages+1,0.25);
  f.setProgress(1);
  equal(api.current().progress,0.25,'An explicit canvas draw fraction remains authoritative until the next prepare call.');
  api.prepare(f.host.frame(),1);
  equal(api.current().progress,1);

  // Replacing a frame object invalidates cache even at an unchanged index.
  f.go(0,1);
  f.frames[0]={...f.frames[0],outputDot:0};
  equal(api.current().resultTargets.get('0:0').label,'C[0,0]');
  f.frames[0]={...f.frames[0],outputDot:1};
  api.current();

  const oldProgram=api.getProgram();
  f.hardware.sram_mb=0.000001;
  const small=api.getLayout('O');
  ok(api.getProgram()!==oldProgram,'Hardware capacity changes must rebuild the model without a canvas draw.');
  equal(small.capacityScalarRows,0);
  equal(api.getCell('O',0,width).valid,false);
  equal(api.current().events.filter(event=>event.operand==='O').length,0,'Out-of-capacity destinations never become active writes.');
  ok(small.diagnostics.some(message=>message.includes('allocation')));
  f.go(stages+4,1);
  equal(api.getCell('O',0,width).written,false,'Rebuilding with zero capacity discards old valid-write history.');
  f.hardware.sram_mb=4;
  equal(api.getCell('O',0,width).valid,true);
  equal(api.getCell('O',0,width).written,true);

  const previousProgram=api.getProgram();
  f.instructions[1]={type:'SetWVNLayout',params:{order:2,N_L0:width,N_L1:2,K_L1:0}};
  ok(api.getProgram()!==previousProgram);
  f.go(stages+1,1);
  equal(api.current().events.filter(event=>event.operand==='O').length,0);
  equal(api.getCell('O',0,width).written,false,'An invalid source mapping cannot populate the output preview.');
  ok(api.current().diagnostics.some(message=>message.includes('valid configured layout')));
}

// Read-versus-forward ownership: lower-row hops do not generate SRAM reads.
const f=fixture(4),api=f.api;
f.instructions[1].params.order=0;
f.frames[0]={snapshotIndex:0,iteration:0,aOR:-1,aWR:[1],aIR:[0,1],
  pLE:Object.fromEntries([0,1,2,3].map(col=>['1,'+col,2])),
  pMC:Object.fromEntries([0,1].flatMap(row=>[0,1,2,3].map(col=>[row+','+col,6-row]))),
  pp:Object.fromEntries([0,1].flatMap(row=>[0,1,2,3].map(col=>[row+','+col,'computing'])))};
const reads=f.go(0,0.5);
equal(reads.events.filter(event=>event.operand==='I').length,4);
equal(reads.events.filter(event=>event.operand==='W').length,4);
equal(reads.forwarded.length,4);
equal(api.read('I',0,2).label,'A[2,5]');
equal(api.read('W',1,2).label,'B[6,1]');
equal(api.forward(1,2).label,'A[2,4]');
equal(api.forward(1,2).phase,'forward');
equal(api.read('I',1,2),undefined);
equal(f.popup().getTransfers('I').every(event=>event.phase==='read'),true);
equal(f.popup().getTransfers('I').every(event=>event.status==='reading'),true);
const revisionBefore=f.popup().getState().revision;
f.go(0,1);
ok(f.popup().getState().revision!==revisionBefore,'Completion must refresh popup transfer styling.');
equal(f.popup().getTransfers('I').every(event=>event.status==='arrived'),true);

// Both buffer views use complete VN rows, with every simultaneous scalar
// destination represented. Undisplayed locations never fall back to an edge.
const drawCalls=[];
const context={fillText:(...args)=>drawCalls.push(args),fillRect(){},strokeRect(){},save(){},restore(){}};
for(const region of f.geometry.bufferRegions)
  region.height=bufferView.height(api.getLayout(region.operand),api.windowFor(region.operand));
api.drawMini(context,f.geometry);
for(const operand of ['I','W','O'])equal(f.geometry.bufferCells[operand].length,
  f.geometry.bufferWindows[operand].vnRows.length*f.hardware.AW*f.hardware.AH);
ok(drawCalls.some(call=>String(call[0]).includes('each VN = 4 scalar lanes')));
const sourceCell=api.read('W',1,0).cell,visible=f.geometry.bufferCells.W.find(cell=>cell.bank===sourceCell.bank&&cell.scalarRow===sourceCell.scalarRow);
equal(api.point('W',sourceCell,f.geometry),[visible.x,visible.y]);
const formerlyOffscreen=api.read('W',1,2).cell;
const addressed=f.geometry.bufferCells.W.find(cell=>cell.bank===formerlyOffscreen.bank&&cell.scalarRow===formerlyOffscreen.scalarRow);
equal(api.point('W',formerlyOffscreen,f.geometry),[addressed.x,addressed.y]);
equal(api.point('W',{bank:0,scalarRow:Number.MAX_SAFE_INTEGER},f.geometry),null);

// Popup delegates share the host clock; selecting a scalar requests redraw.
f.popup().onPlayPause();
equal(f.counters().playing,true);
ok(f.counters().refreshes>0);
const selection={operand:'I',bank:1,scalarRow:2};
f.popup().onSelectCell(selection);
equal(api.selection(),selection);
equal(f.counters().redraws,1);
api.open('W',{id:'trigger'});
equal(f.counters().opened.operand,'W');
equal(f.counters().opened.element.id,'trigger');
f.listeners.click({clientX:35,clientY:40});
equal(f.counters().opened.operand,'I','Canvas clicks are transformed from rendered pixels to backing coordinates.');
f.listeners.mousemove({clientX:35,clientY:40});
equal(f.canvas.style.cursor,'pointer');
f.listeners.mousemove({clientX:499,clientY:499});
equal(f.canvas.style.cursor,'default');

console.log(JSON.stringify({passed:true,assertions:checks}));
