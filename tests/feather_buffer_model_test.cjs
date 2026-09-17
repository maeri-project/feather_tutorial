'use strict';
const assert = require('node:assert/strict');
const model = require('../script/feather_buffer_model.js');
let checks = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function ok(actual, message) { assert.ok(actual, message); checks++; }
const hardware = width => ({AH: width, AW: width, sram_mb: 4, frac_stream: 0.4, frac_stationary: 0.4, frac_output: 0.2});
const fields = {streaming: ['M_L0', 'M_L1', 'J_L1'], stationary: ['N_L0', 'N_L1', 'K_L1'], output: ['P_L0', 'P_L1', 'Q_L1']};
const params = (kind, order, a0, a1, a2) => Object.fromEntries([['order', order], ...fields[kind].map((name, i) => [name, [a0, a1, a2][i]])]);

// Independent closed forms transcribed from the six minisa_vn_addr cases.
function goldenIndex(kind, order, first, second, a0, a1, a2) {
  const combined = kind === 'stationary' ? second : first;
  const l0 = combined % a0, l1 = Math.floor(combined / a0), outer = kind === 'stationary' ? first : second;
  if (kind === 'output') return [l1*a0*a2+l0*a2+outer, l1*a2*a0+outer*a0+l0,
    l0*a1*a2+l1*a2+outer, l0*a2*a1+outer*a1+l1,
    outer*a1*a0+l1*a0+l0, outer*a0*a1+l0*a1+l1][order];
  return [outer*a0*a1+l0*a1+l1, outer*a1*a0+l1*a0+l0,
    l0*a2*a1+outer*a1+l1, l0*a1*a2+l1*a2+outer,
    l1*a2*a0+outer*a0+l0, l1*a0*a2+l0*a2+outer][order];
}

for (const width of [4,8,16]) {
  for (const kind of Object.keys(fields)) {
    for (let order = 0; order < 6; order++) {
      const layout = model.layout(hardware(width), kind, params(kind, order, width, 3, 2), 1);
      equal(layout.valid, true);
      equal(layout.totalVNs, width * 6);
      equal(layout.scalarRows, width * 6);
      const maxFirst = kind === 'stationary' ? 2 : width * 3;
      const maxSecond = kind === 'stationary' ? width * 3 : 2;
      const occupied = new Set();
      for (let first = 0; first < maxFirst; first++) {
        for (let second = 0; second < maxSecond; second++) {
          for (let lane = 0; lane < width; lane++) {
            const cell = model.encode(layout, {first, second, lane});
            const L = goldenIndex(kind, order, first, second, width, 3, 2);
            const bank = L % width, scalarRow = Math.floor(L / width) * width + lane;
            equal([cell.valid, cell.vnIndex, cell.bank, cell.scalarRow, cell.vnRow, cell.lane], [true, L, bank, scalarRow, Math.floor(L / width), lane]);
            const inverse = model.scalar(layout, bank, scalarRow);
            equal([inverse.first, inverse.second, inverse.lane, inverse.label], [first, second, lane, cell.label]);
            equal(cell.value, null, 'The generic ISA trace contains identities, not tensor values.');
            equal(cell.numericValueAvailable, false);
            const label = kind === 'stationary' ? `B[${first * width + lane},${second}]`
              : kind === 'streaming' ? `A[${first},${second * width + lane}]` : `C[${first},${second * width + lane}]`;
            equal(cell.label, label);
            equal(cell.identity, label);
            occupied.add(bank + ':' + scalarRow);
          }
        }
      }
      equal(occupied.size, layout.scalarElements, 'Every configured scalar has one unique physical address.');
      equal(model.scalar(layout, width, 0).valid, false);
      equal(model.scalar(layout, 0, layout.scalarRows).valid, false);
      equal(model.encode(layout, {first: maxFirst, second: 0, lane: 0}).valid, false);
      equal(model.encode(layout, {first: 0, second: maxSecond, lane: 0}).valid, false);
      equal(model.encode(layout, {first: 0, second: 0, lane: width}).valid, false);
    }
  }
}

const hw = hardware(4);
const trace = [
  {type: 'SetOVNLayout', params: {order:0, P_L0:4, P_L1:4, Q_L1:2}},
  {type: 'SetIVNLayout', params: {order:5, M_L0:4, M_L1:4, J_L1:3}},
  {type: 'SetWVNLayout', params: {order:2, N_L0:4, N_L1:2, K_L1:3}},
  {type: 'ExecuteMapping', params: {r0:0, c0:0, Gr:2, Gc:2, sr:1, sc:4}},
  {type: 'ExecuteStreaming', params: {dataflow:1, m_0:0, s_m:1, T:16, vn_size:3}},
  {type: 'ExecuteMapping', params: {r0:2, c0:0, Gr:4, Gc:2, sr:1, sc:4}},
  {type: 'ExecuteStreaming', params: {dataflow:1, m_0:0, s_m:2, T:8, vn_size:3}}
];
const state = model.create(hw, trace), first = state.snapshots[0], second = state.snapshots[1];
equal(state.snapshots.length, 2);
equal([first.index, first.emIndex, first.esIndex, second.emIndex, second.esIndex], [0,3,4,5,6]);
equal(model.layoutAt(first, 'streaming').order, 5);
equal(model.layoutAt(null, 'streaming').valid, false);
const sampleI = model.encode(first.layouts.streaming, {first:3, second:2, lane:1});
equal([sampleI.label, sampleI.vnIndex, sampleI.bank, sampleI.scalarRow], ['A[3,9]',11,3,9]);
const sampleW = model.encode(first.layouts.stationary, {first:2, second:5, lane:1});
equal([sampleW.label, sampleW.vnIndex, sampleW.bank, sampleW.scalarRow], ['B[9,5]',11,3,9]);
const sampleO = model.encode(first.layouts.output, {first:3, second:1, lane:3});
equal([sampleO.label, sampleO.vnIndex, sampleO.bank, sampleO.scalarRow], ['C[3,7]',7,3,7]);
const access = model.pe(first, 1, 2, 3, 1);
equal([access.kg, access.rep, access.m, access.n], [1,0,3,1]);
equal([access.streaming.label, access.stationary.label, access.output.label], ['A[3,5]','B[5,1]','C[3,1]']);
const duplicated = model.pe(second, 3, 3, 2, 0);
equal([duplicated.kg, duplicated.rep, duplicated.m, duplicated.n], [2,1,5,7]);
equal([duplicated.streaming.label, duplicated.stationary.label, duplicated.output.label], ['A[5,8]','B[8,7]','C[5,7]']);
equal(duplicated.committed, false);
equal(model.pe(first, 0, 0, 16, 0).valid, false);
equal(model.pe(first, -1, 0, 0, 0).valid, false);

// Layouts are chronological snapshots, not the last layout repeated over all EMs.
const changed = model.create(hw, [...trace.slice(0,5), {type:'SetIVNLayout', params:{order:0,M_L0:4,M_L1:4,J_L1:3}}, ...trace.slice(5)]);
equal([changed.snapshots[0].layouts.streaming.order, changed.snapshots[1].layouts.streaming.order, changed.final.layouts.streaming.order], [5,0,0]);
equal(model.pe(changed.snapshots[0],0,0,3,0).streaming.vnIndex, 9);
equal(model.pe(changed.snapshots[1],0,0,1,0).streaming.vnIndex, 40);
const ioTrace = trace.map(item => item.type === 'ExecuteStreaming' ? {...item, params:{...item.params,dataflow:0}} : item);
const io = model.create(hw, ioTrace);
const ioAccess = model.pe(io.snapshots[0],1,2,3,1);
equal([ioAccess.streaming.label, ioAccess.stationary.label, ioAccess.output.label], ['B[5,3]','A[1,5]','C[1,3]']);
ok(io.snapshots[0].diagnostics.some(text => text.includes('does not implement IO-S')));
equal([ioAccess.streaming.bank,ioAccess.streaming.scalarRow], [access.streaming.bank,access.streaming.scalarRow]);

// Transfer identity follows the actual scalar lane, not only its containing VN.
const frame = {aWR:[1],pLE:{'1,0':2,'1,1':2,'1,2':2,'1,3':2},
  pMC:{'0,0':6,'0,1':6,'0,2':6,'0,3':6},pp:{'0,0':'computing','0,1':'computing','0,2':'computing','0,3':'computing'}};
const transfer = model.transfers(first, frame);
equal(transfer.stationary.length, 4);
equal(transfer.streaming.length, 4);
equal(transfer.output.length, 0, 'Issuing a PE result does not write OB until the BIRRD packet arrives.');
equal(transfer.stationary.map(event => event.cell.label), ['B[2,1]','B[2,5]','B[6,1]','B[6,5]']);
equal(transfer.streaming.map(event => event.cell.label), ['A[1,1]','A[1,1]','A[1,5]','A[1,5]']);
equal(transfer.stationary[0].cell.scalarRow, 6);
ok(transfer.diagnostics.some(text => text.includes('different scalar rows')));
const arrival = model.transfers(first, {bufferArrivals:[{row:1,col:2,t:3,port:0}]});
equal(arrival.output.length, 1);
equal([arrival.output[0].label,arrival.output[0].cell.label,arrival.output[0].operation,arrival.output[0].committed], ['partial for C[3,1]','C[3,1]','preview-write',false]);
equal([arrival.output[0].peCol,arrival.output[0].port], [2,0], 'Retain source column even when PASS wiring permutes output ports.');
const short = {...first, es:{...first.es,vn_size:1}};
equal(model.pe(short,0,0,0,2).valid, false);
equal(model.transfers(short, {bufferReads:[{kind:'streaming',row:0,col:0,t:0,lane:2}]}).streaming.length, 0);

// A huge descriptor must allocate only the requested bounded page.
const huge = model.layout(hardware(16), 'streaming', params('streaming',5,16,65536,65536),1);
equal(huge.valid, true);
equal(huge.totalVNs, 68719476736);
equal(huge.scalarRows, 68719476736);
const last = model.encode(huge, {first:1048575,second:65535,lane:15});
equal([last.bank,last.vnIndex,last.scalarRow], [15,68719476735,68719476735]);
equal(last.outOfCapacity, true);
const bounded = model.page(huge, huge.scalarRows - 16, 16);
equal(bounded.rows.length, 16);
equal(bounded.rows.reduce((sum,row) => sum + row.cells.length, 0), 256);
equal(model.page(huge, 0, 65).valid, false);
equal(model.page(huge, Number.MAX_SAFE_INTEGER, 16).rows.length, 0);

// A final partially-used bank group is shown explicitly, never modulo-wrapped.
const ragged = model.layout(hw, 'streaming', params('streaming',0,3,1,3),1);
equal(ragged.valid,true);
equal(model.scalar(ragged,0,8).valid,true);
equal(model.scalar(ragged,1,8).valid,false);
ok(ragged.diagnostics.some(text => text.includes('Ragged')));

for (const bad of [NaN,Infinity,-1,0,1.5,65537,'4',null]) {
  equal(model.layout(hw,'streaming',params('streaming',0,4,bad,3),1).valid,false);
}
for (const bad of [NaN,Infinity,-1,1.5,6,'0',null]) equal(model.layout(hw,'streaming',params('streaming',bad,4,4,3),1).valid,false);
for (const bad of [NaN,Infinity,-1,1.5,Number.MAX_SAFE_INTEGER,'0']) equal(model.scalar(first.layouts.streaming,bad,0).valid,false);
equal(model.create({AH:3,AW:3},trace).valid,false);
equal(model.create(hw,new Array(4097)).valid,false);
equal(model.create(hw,[]).final.layouts.streaming.valid,false);
equal(model.create(hw,[{type:'ExecuteStreaming',params:trace[4].params}]).snapshots[0].em,null);
ok(model.mappingErrors({...first,em:{...first.em,Gr:3,Gc:2}}).length > 0);
ok(model.mappingErrors({...first,es:{...first.es,dataflow:2}}).length > 0);
equal(model.transfers(null,frame).streaming.length,0);
equal(model.layout(null,'streaming',null,1).valid,false);
console.log(JSON.stringify({passed:true,assertions:checks}));
