"use strict";
const assert = require("node:assert/strict");
const data = require("../script/reconfigurable_compute_data.js");
const model = require("../script/reconfigurable_compute_model.js");
let macs = 0;
for (const [phase, records] of Object.entries(data.records)) {
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
const {prefill: p, decode: d} = data.records;
assert.equal(p.reuse.mappedPEs, 256); assert.equal(p.outputs.mappedPEs, 256);
assert.equal(d.reuse.mappedPEs, 64); assert.equal(d.outputs.mappedPEs, 128);
assert.equal(p.outputs.cost.bytes_w, 2 * p.reuse.cost.bytes_w);
assert.equal(d.outputs.cost.bytes_w, d.reuse.cost.bytes_w);
assert.equal(d.reuse.cost.mapping_count, 2 * d.outputs.cost.mapping_count);
assert.ok(p.reuse.cost.total_cycles < p.outputs.cost.total_cycles);
assert.ok(d.outputs.cost.total_cycles < d.reuse.cost.total_cycles);
console.log(`PASS: four mappings, ${macs.toLocaleString()} unique MACs, independent GEMM outputs, forwarding and cost accounting.`);

for (const phase of ["prefill", "decode"]) for (const baseline of ["reuse", "outputs"]) {
    const c = model.comparison(data, phase, baseline);
    const matching = (phase === "prefill" && baseline === "reuse") || (phase === "decode" && baseline === "outputs");
    assert.equal(c.saved === 0, matching, "A matching fixed policy ties switching");
    assert.equal(c.recovered, phase === "decode" && baseline === "reuse" ? 64 : 0);
    assert.equal(c.saved, matching ? 0 : phase === "prefill" ? 1572864 : 373056);
    assert.equal(c.fixed.shape.M * c.fixed.shape.K * c.fixed.shape.N,
        c.adaptive.shape.M * c.adaptive.shape.K * c.adaptive.shape.N, "Race compares identical work");
    const atStart = model.finishTimes(c, -1);
    assert.equal(atStart.fixed.elapsed, 0); assert.equal(atStart.adaptive.elapsed, 0);
    const atFinish = model.finishTimes(c, c.adaptive.cost.total_cycles);
    assert.equal(atFinish.adaptive.done, true);
    assert.equal(atFinish.fixed.done, matching);
    assert.equal(atFinish.fixed.total - atFinish.fixed.elapsed, c.saved);
    assert.equal(atFinish.adaptive.width, c.adaptive.cost.total_cycles / c.maxCycles,
        "Finish bars share a clock and scale; the faster bar is shorter");
    const atEnd = model.finishTimes(c, c.maxCycles + 1);
    assert.ok(atEnd.fixed.done && atEnd.adaptive.done);
    assert.equal(atEnd.fixed.elapsed, c.fixed.cost.total_cycles);
    assert.equal(atEnd.adaptive.elapsed, c.adaptive.cost.total_cycles);
}
console.log("PASS: fixed-versus-switching comparisons, equal-work accounting, recovered PEs, common finish-time scale, and ties.");
