"use strict";
const assert = require("node:assert/strict");
const data = require("../script/reconfigurable_compute_data.js");
const model = require("../script/reconfigurable_compute_model.js");
let macs = 0;
for (const stage of data.stages) {
    const phase=stage.id, records=stage.records;
    for (const [policy, record] of Object.entries(records)) {
        const seen = new Set(), sums = Array(record.tile.M * record.tile.N).fill(0);
        let count = 0;
        for (let t = 0; t <= model.end(record); t++) {
            for (const cell of model.frame(record, t)) {
                if (!cell.active) continue;
                const {m, n, k} = cell;
                assert.ok(m >= 0 && m < record.tile.M && n >= 0 && n < record.tile.N && k >= 0 && k < record.tile.K);
                const key = `${m}/${k}/${n}`;
                assert.ok(!seen.has(key), `No repeated MAC: ${phase}/${policy}/${key}`);
                seen.add(key);
                const value = model.input(m, k) * model.weight(k, n);
                sums[m * record.tile.N + n] += value;
                count++;
            }
        }
        assert.equal(count, record.tile.M * record.tile.K * record.tile.N, "Exact useful MAC coverage");
        assert.equal(count, record.verifiedTileMacs, "Matches independent Python coverage");
        for (let m = 0; m < record.tile.M; m++) for (let n = 0; n < record.tile.N; n++) {
            let expected = 0;
            for (let k = 0; k < record.tile.K; k++) expected += model.input(m, k) * model.weight(k, n);
            assert.equal(sums[m * record.tile.N + n], expected, "Physical PE contributions equal direct GEMM");
        }
        for (let col = 0; col < 16; col++) {
            for (let row = 1; row < 16; row++) {
                const upstream = model.at(record, row - 1, col, 15 + row - 1);
                const downstream = model.at(record, row, col, 15 + row);
                assert.deepEqual([upstream.m, upstream.k, upstream.input], [downstream.m, downstream.k, downstream.input], "Same scalar forwarded to next row one step later");
                assert.notEqual(upstream.n, downstream.n, "Each PE uses its own stationary weight vector");
            }
            const a = model.owner(record, 0, col, 0), b = model.owner(record, 0, col, record.ES.T - 1);
            assert.deepEqual([a.n, a.kStart], [b.n, b.kStart], "Resident weights persist across input dots");
        }
        const cost = record.cost;
        assert.equal(cost.total_cycles, ["load_w_cycles", "load_in_cycles", "weight_preload_cycles", "stream_cycles", "gap_cycles", "drain_cycles", "prime_cycles", "dispatch_cycles", "store_cycles"].reduce((sum, key) => sum + cost[key], 0));
        assert.equal(record.mappedPEs, model.frame(record, 15).filter(c => c.active).length);
        macs += count;
    }
}
for(const stage of data.stages) {
    const chosen=stage.records[stage.preferred];
    assert.equal(chosen.cost.total_cycles,stage.search.cyclesPerProgram*stage.programs);
    assert.equal(stage.programN*stage.programs,stage.shape.N,"N shards exactly cover the full operation");
    assert.ok(Object.values(stage.records).every(r=>r.cost.total_cycles>=chosen.cost.total_cycles));
    assert.deepEqual([chosen.tile.M,chosen.tile.K,chosen.tile.N],stage.search.tile);
}
assert.equal(data.stages[0].preferred,"reuse");
assert.equal(data.stages[1].previous,"down");
assert.equal(data.stages[1].preferred,"outputs");
assert.equal(data.stages[1].rowOffset,767);
assert.equal(data.stages[2].previous,"head");
assert.equal(data.stages[2].preferred,"outputs");
let addresses=0;
for(const layouts of Object.values(data.layouts)) for(const l of Object.values(layouts)) {
    const unique=new Set();
    for(const v of l.vectors) for(let lane=0;lane<16;lane++) {
        const a=model.address(l,...v.logical,lane);
        assert.deepEqual(a,{linear:v.linear,bank:v.bank,rowBase:v.rowBase,row:v.rowBase+lane},"JS agrees with exported Python layout for every scalar");
        const key=a.bank+"/"+a.row;assert.ok(!unique.has(key));unique.add(key);addresses++;
        assert.ok(a.row < (l.spec.operand==="W"?128:64),"Fits physical buffer depth");
    }
}
const head=data.stages[1];
const a=model.at(head.records.reuse,0,2,15),b=model.at(head.records.outputs,0,2,15);
assert.deepEqual([a.m,a.n,a.valid],[1,0,false]);
assert.deepEqual([b.m,b.n,b.valid],[0,32,true]);
const aa=model.peAddresses(data,head.records.reuse,0,2,15),bb=model.peAddresses(data,head.records.outputs,0,2,15);
assert.equal(aa.I,null);assert.equal(aa.O,null);
assert.equal(bb.W.bank,2);assert.equal(bb.I.bank,0);assert.equal(bb.O.bank,2);
console.log(`PASS: nine mappings, ${macs.toLocaleString()} exact tile MACs, compiler winners, graph lineage and ${addresses.toLocaleString()} Python-checked scalar addresses.`);
