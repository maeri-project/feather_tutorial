/* MINISA tutorial address identities, not a numerical or cycle-accurate simulator.
 * Equations follow minisa/layout.py:LayoutSpec, minisa_config_gen.v and
 * minisa_ob_ctrl.v in FEATHER_GEMM. No tensor values or BIRRD commands exist in
 * this tutorial's editable trace, so output writes remain partial-sum previews.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FeatherBufferModel = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const KINDS = ['streaming', 'stationary', 'output'];
  const SPECS = {
    streaming: {op: 'I', fields: ['M_L0', 'M_L1', 'J_L1'], names: ['mL0', 'mL1', 'jL1'], bytes: 1, fraction: 'frac_stream'},
    stationary: {op: 'W', fields: ['N_L0', 'N_L1', 'K_L1'], names: ['nL0', 'nL1', 'kL1'], bytes: 1, fraction: 'frac_stationary'},
    output: {op: 'O', fields: ['P_L0', 'P_L1', 'Q_L1'], names: ['pL0', 'pL1', 'qL1'], bytes: 4, fraction: 'frac_output'}
  };
  const PERMS = {
    I: [[2,0,1], [2,1,0], [0,2,1], [0,1,2], [1,2,0], [1,0,2]],
    W: [[2,0,1], [2,1,0], [0,2,1], [0,1,2], [1,2,0], [1,0,2]],
    O: [[1,0,2], [1,2,0], [0,1,2], [0,2,1], [2,1,0], [2,0,1]]
  };
  const MAX_FIELD = 65536;
  const LIMIT = 4096;
  const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const error = (message, extra) => Object.assign({valid: false, label: 'Unmapped', diagnostics: [message]}, extra || {});
  const distinct = values => [...new Set(values)];

  function layout(hw, kind, params, dataflow) {
    const spec = SPECS[kind];
    if (!spec) return error('Unknown buffer kind.');
    if (!hw || ![4,8,16].includes(hw.AH) || hw.AH !== hw.AW) return error('Unsupported tutorial hardware dimensions.');
    const result = {kind, operand: spec.op, AH: hw.AH, AW: hw.AW, params: {...params}, dataflow: dataflow === 0 ? 0 : 1,
      label: {streaming: 'Streaming buffer (IVN)', stationary: 'Stationary buffer (WVN)', output: 'Output buffer (OVN)'}[kind],
      valid: false, diagnostics: [], totalVNs: 0, vnCount: 0, extentRows: 0, scalarRows: 0, capacityRows: null,
      capacityScalarRows: null, scalarElements: 0, bytesPerScalar: spec.bytes};
    if (!params) { result.diagnostics.push('No ' + spec.op + 'VN layout has been configured.'); return result; }
    const dims = spec.fields.map(field => params[field]);
    if (!integer(params.order, 0, 5)) result.diagnostics.push('Layout order must be an integer from 0 to 5.');
    dims.forEach((value, i) => {
      if (!integer(value, 1, i === 0 ? hw.AW : MAX_FIELD)) result.diagnostics.push(spec.fields[i] + ' is outside the supported positive integer range.');
    });
    if (result.diagnostics.length) return result;
    const count = dims[0] * dims[1] * dims[2];
    if (!Number.isSafeInteger(count * hw.AH)) { result.diagnostics.push('Layout extent exceeds exact integer address arithmetic.'); return result; }
    Object.assign(result, {valid: true, order: params.order, dims, a0: dims[0], a1: dims[1], a2: dims[2],
      totalVNs: count, vnCount: count, extentRows: Math.ceil(count / hw.AW) * hw.AH, scalarElements: count * hw.AH,
      permutation: PERMS[spec.op][params.order].map(rank => spec.names[rank]), ranks: PERMS[spec.op][params.order].slice()});
    const sram = hw.sram_mb, fraction = hw[spec.fraction];
    result.capacityRows = Number.isFinite(sram) && sram > 0 && Number.isFinite(fraction) && fraction >= 0 && fraction <= 1
      ? Math.floor(sram * 1024 * 1024 * fraction / (hw.AW * spec.bytes)) : null;
    result.scalarRows = result.extentRows;
    result.capacityScalarRows = result.capacityRows;
    if (result.capacityRows !== null && result.extentRows > result.capacityRows) result.diagnostics.push('Configured layout exceeds the tutorial buffer allocation.');
    if (count > hw.AW && count % hw.AW !== 0) result.diagnostics.push('Ragged final bank group: the maintained RTL uniform-lane DMA does not support this extent.');
    return result;
  }

  function withFlow(layouts, dataflow) {
    return Object.fromEntries(KINDS.map(kind => [kind, {...layouts[kind], dataflow: dataflow === 0 ? 0 : 1}]));
  }

  function create(hw, instructions) {
    const diagnostics = [];
    if (!hw || ![4,8,16].includes(hw.AH) || ![4,8,16].includes(hw.AW) || hw.AH !== hw.AW) {
      return {valid: false, snapshots: [], final: null, diagnostics: ['The tutorial supports square 4, 8 and 16 PE arrays.']};
    }
    if (!Array.isArray(instructions) || instructions.length > LIMIT) {
      return {valid: false, snapshots: [], final: null, diagnostics: ['The trace must contain at most 4,096 instructions.']};
    }
    let layouts = Object.fromEntries(KINDS.map(kind => [kind, layout(hw, kind, null, 1)]));
    let em = null, emIndex = -1, dataflow = 1;
    const snapshots = [];
    const types = {SetIVNLayout: 'streaming', SetWVNLayout: 'stationary', SetOVNLayout: 'output'};
    instructions.forEach((instruction, index) => {
      if (!instruction || typeof instruction !== 'object') { diagnostics.push('Instruction ' + (index + 1) + ' is malformed.'); return; }
      const params = instruction.params;
      if (types[instruction.type]) {
        const kind = types[instruction.type];
        layouts = {...layouts, [kind]: layout(hw, kind, params, dataflow)};
      } else if (instruction.type === 'ExecuteMapping') {
        if (em) {
          snapshots.push({index: snapshots.length, AH: hw.AH, AW: hw.AW, layouts: withFlow(layouts, dataflow), em: {...em}, es: null, emIndex, esIndex: -1,
            dataflow, diagnostics: ['ExecuteMapping has no following ExecuteStreaming.']});
        }
        em = {...params}; emIndex = index;
      } else if (instruction.type === 'ExecuteStreaming') {
        dataflow = params && params.dataflow === 0 ? 0 : 1;
        const warnings = [];
        if (!em) warnings.push('ExecuteStreaming has no preceding ExecuteMapping.');
        if (dataflow === 0) warnings.push('IO-S labels use transposed operands; the maintained FP16 RTL wrapper does not implement IO-S.');
        snapshots.push({index: snapshots.length, AH: hw.AH, AW: hw.AW, layouts: withFlow(layouts, dataflow), em: em ? {...em} : null,
          es: {...params}, emIndex, esIndex: index, dataflow, diagnostics: warnings});
        em = null; emIndex = -1;
      }
    });
    if (em) snapshots.push({index: snapshots.length, AH: hw.AH, AW: hw.AW, layouts: withFlow(layouts, dataflow), em: {...em}, es: null, emIndex, esIndex: -1,
      dataflow, diagnostics: ['ExecuteMapping has no following ExecuteStreaming.']});
    const final = {AH: hw.AH, AW: hw.AW, layouts: withFlow(layouts, dataflow), em: null, es: null, emIndex: -1, esIndex: -1, dataflow, diagnostics: []};
    return {valid: true, snapshots, final, diagnostics};
  }

  function logicalCell(layoutInfo, ranks, lane, vnIndex) {
    const {kind, AH, AW, a0, dataflow} = layoutInfo;
    const combined = ranks[0] + a0 * ranks[1];
    const first = kind === 'stationary' ? ranks[2] : combined;
    const second = kind === 'stationary' ? combined : ranks[2];
    let logical, label, vnLabel;
    if (kind === 'streaming') {
      const k = second * AH + lane;
      logical = dataflow === 0 ? {operand: 'B', k, n: first} : {operand: 'A', m: first, k};
      label = dataflow === 0 ? `B[${k},${first}]` : `A[${first},${k}]`;
      vnLabel = `IVN(${first},${second})`;
    } else if (kind === 'stationary') {
      const k = first * AH + lane;
      logical = dataflow === 0 ? {operand: 'A', m: second, k} : {operand: 'B', k, n: second};
      label = dataflow === 0 ? `A[${second},${k}]` : `B[${k},${second}]`;
      vnLabel = `WVN(${first},${second})`;
    } else {
      const n = second * AH + lane;
      logical = dataflow === 0 ? {operand: 'C', m: n, n: first} : {operand: 'C', m: first, n};
      label = dataflow === 0 ? `C[${n},${first}]` : `C[${first},${n}]`;
      vnLabel = `OVN(${first},${second})`;
    }
    const bank = vnIndex % AW, vnRow = Math.floor(vnIndex / AW), scalarRow = vnRow * AH + lane;
    const outOfCapacity = layoutInfo.capacityRows !== null && scalarRow >= layoutInfo.capacityRows;
    return {valid: true, kind, bank, scalarRow, address: scalarRow, vnRow, lane, vnIndex, linearIndex: vnIndex,
      first, second, label, identity: label, logical, vnLabel, ranks: ranks.slice(), value: null, numericValueAvailable: false,
      outOfCapacity, diagnostics: outOfCapacity ? ['This address exceeds the tutorial buffer allocation.'] : []};
  }

  function scalar(layoutInfo, bank, scalarRow) {
    if (!layoutInfo || !layoutInfo.valid) return error('No valid configured layout.', {bank, scalarRow});
    const {AH, AW, totalVNs, dims, ranks: permutation} = layoutInfo;
    if (!integer(bank, 0, AW - 1) || !integer(scalarRow, 0, Number.MAX_SAFE_INTEGER)) return error('Bank or scalar row is outside the supported range.', {bank, scalarRow});
    const vnRow = Math.floor(scalarRow / AH), lane = scalarRow % AH;
    if (vnRow >= Math.ceil(totalVNs / AW)) return error('Address is outside the configured layout.', {bank, scalarRow, vnRow, lane});
    const vnIndex = vnRow * AW + bank;
    if (vnIndex >= totalVNs) return error('Unused bank in the final VN row.', {bank, scalarRow, vnRow, lane});
    let remaining = vnIndex;
    const ranks = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      const rank = permutation[i];
      ranks[rank] = remaining % dims[rank]; remaining = Math.floor(remaining / dims[rank]);
    }
    return logicalCell(layoutInfo, ranks, lane, vnIndex);
  }

  function encode(layoutInfo, coordinate) {
    if (!layoutInfo || !layoutInfo.valid) return error('No valid configured layout.');
    const {first, second, lane} = coordinate || {};
    const {kind, a0, a1, a2, AH, dims, ranks: permutation} = layoutInfo;
    const maxFirst = kind === 'stationary' ? a2 : a0 * a1;
    const maxSecond = kind === 'stationary' ? a0 * a1 : a2;
    if (!integer(first, 0, maxFirst - 1) || !integer(second, 0, maxSecond - 1) || !integer(lane, 0, AH - 1)) {
      return error('Logical VN or lane is outside the configured layout; this is a masked/padded access.', {kind, first, second, lane, masked: true});
    }
    const combined = kind === 'stationary' ? second : first;
    const ranks = [combined % a0, Math.floor(combined / a0), kind === 'stationary' ? first : second];
    let vnIndex = 0;
    for (const rank of permutation) vnIndex = vnIndex * dims[rank] + ranks[rank];
    return logicalCell(layoutInfo, ranks, lane, vnIndex);
  }

  function page(layoutInfo, startRow, rowCount) {
    const requested = rowCount === undefined ? 16 : rowCount;
    if (!integer(startRow, 0, Number.MAX_SAFE_INTEGER) || !integer(requested, 1, 64)) return error('Pages require a nonnegative start row and 1–64 rows.');
    if (!layoutInfo || !layoutInfo.valid) return error('No valid configured layout.');
    const count = Math.min(requested, Math.max(0, layoutInfo.extentRows - startRow));
    const rows = [];
    for (let offset = 0; offset < count; offset++) {
      rows.push({scalarRow: startRow + offset, cells: Array.from({length: layoutInfo.AW}, (_, bank) => scalar(layoutInfo, bank, startRow + offset))});
    }
    return {valid: true, startRow, rowCount: count, extentRows: layoutInfo.extentRows, rows};
  }

  function mappingErrors(snapshot) {
    if (!snapshot || !snapshot.em || !snapshot.es) return ['An ExecuteMapping/ExecuteStreaming pair is required for transfers.'];
    const {em, es, AH, AW} = snapshot, errors = [];
    for (const key of ['r0', 'c0', 'sr', 'sc']) if (!integer(em[key], 0, MAX_FIELD)) errors.push('Invalid ExecuteMapping ' + key + '.');
    if (!integer(em.Gr, 1, AW) || !integer(em.Gc, 1, AW) || em.Gc > em.Gr || em.Gr % em.Gc !== 0 || AW % em.Gr !== 0) errors.push('Mapping groups must divide AW, with G_c dividing G_r.');
    for (const key of ['m_0', 's_m', 'T', 'vn_size']) if (!integer(es[key], key === 's_m' || key === 'T' ? 1 : 0, key === 'vn_size' ? AH - 1 : MAX_FIELD)) errors.push('Invalid ExecuteStreaming ' + key + '.');
    if (![0,1].includes(es.dataflow)) errors.push('Unsupported dataflow encoding.');
    return errors;
  }

  function pe(snapshot, row, col, t, lane) {
    const diagnostics = mappingErrors(snapshot);
    if (diagnostics.length) return {valid: false, diagnostics, row, col, t, lane};
    const {AH, AW, em, es, layouts} = snapshot;
    if (!integer(row, 0, AH - 1) || !integer(col, 0, AW - 1) || !integer(t, 0, es.T - 1) || !integer(lane, 0, AH - 1)) return error('PE, streaming step or lane is outside its configured range.', {row, col, t, lane, masked: true});
    const kg = em.r0 + Math.floor(col / em.Gr);
    const rep = Math.floor(col / em.Gc) % (em.Gr / em.Gc);
    const m = es.m_0 + es.s_m * t + rep;
    const n = em.c0 + em.sr * row + em.sc * (col % em.Gc);
    const streaming = encode(layouts.streaming, {first: m, second: kg, lane});
    const stationary = encode(layouts.stationary, {first: kg, second: n, lane});
    const output = encode(layouts.output, {first: m, second: Math.floor(n / AH), lane: n % AH});
    const masked = lane > es.vn_size;
    if (masked) diagnostics.push('Lane exceeds vn_size and is inactive for this dot product.');
    for (const cell of [streaming, stationary, output]) diagnostics.push(...cell.diagnostics);
    return {valid: !masked && streaming.valid && stationary.valid, row, col, t, lane, kg, rep, m, n,
      streaming, stationary, output, masked, diagnostics: distinct(diagnostics), preview: true, committed: false};
  }

  function transfers(snapshot, frame) {
    const result = {streaming: [], stationary: [], output: [], diagnostics: mappingErrors(snapshot)};
    if (result.diagnostics.length || !frame) return result;
    const {AH, AW} = snapshot;
    function read(kind, row, col, t, lane) {
      const access = pe(snapshot, row, col, t, lane), cell = access[kind];
      if (access.masked || !cell || !cell.valid || cell.outOfCapacity) {
        result.diagnostics.push(...(access.diagnostics || []), ...((cell && cell.diagnostics) || [])); return;
      }
      result[kind].push({kind, operation: 'read', cell, peRow: row, peCol: col, t, lane, label: cell.label, preview: true});
    }
    const annotated = frame.bufferReads;
    if (Array.isArray(annotated)) {
      for (const item of annotated.slice(0, AW * AH * 2)) {
        if (item && (item.kind === 'streaming' || item.kind === 'stationary')) read(item.kind, item.row, item.col, item.t, item.lane);
      }
    } else {
      for (const row of (Array.isArray(frame.aWR) ? frame.aWR : []).slice(0, AH)) {
        for (let col = 0; col < AW; col++) read('stationary', row, col, 0, frame.pLE && frame.pLE[`${row},${col}`]);
      }
      for (let col = 0; col < AW; col++) {
        const key = `0,${col}`, count = frame.pMC && frame.pMC[key], status = frame.pp && frame.pp[key];
        if (integer(count, 1, MAX_FIELD * AH) && ['computing', 'dp_done', 'outputting'].includes(status)) read('streaming', 0, col, Math.floor((count - 1) / AH), (count - 1) % AH);
      }
    }
    for (const item of (Array.isArray(frame.bufferArrivals) ? frame.bufferArrivals : []).slice(0, AW)) {
      if (!item || typeof item !== 'object') { result.diagnostics.push('Malformed output-arrival annotation.'); continue; }
      const access = pe(snapshot, item.row, item.col, item.t, 0), cell = access.output;
      if (!access.valid || !cell || !cell.valid || cell.outOfCapacity) {
        result.diagnostics.push(...(access.diagnostics || []), ...((cell && cell.diagnostics) || [])); continue;
      }
      result.output.push({kind: 'output', operation: 'preview-write', cell, peRow: item.row, peCol: item.col, port: item.port,
        t: item.t, lane: cell.lane, label: 'partial for ' + cell.label, preview: true, committed: false,
        note: 'PASS topology preview: this is the intended OVN address, not a verified reduced GEMM result.'});
    }
    for (const kind of ['streaming', 'stationary']) {
      const rows = distinct(result[kind].map(event => event.cell.scalarRow));
      if (rows.length > 1) result.diagnostics.push(kind + ' reads require different scalar rows; the maintained RTL single-row SRAM interface would report an address conflict.');
    }
    const outputBanks = result.output.map(event => event.cell.bank);
    if (distinct(outputBanks).length !== outputBanks.length) result.diagnostics.push('Multiple preview results target the same output bank in this step; this is not a verified legal simultaneous write.');
    result.diagnostics = distinct(result.diagnostics);
    return result;
  }

  function layoutAt(snapshot, kind) {
    return snapshot && snapshot.layouts && snapshot.layouts[kind] || error('No layout is available for this buffer.');
  }

  return {create, layout, layoutAt, scalar, encode, page, pe, transfers, mappingErrors, MAX_FIELD,
    note: 'Exact configured address identities; symbolic data and illustrative timing. PASS packets show partial-sum destinations, not verified final GEMM values.'};
});
