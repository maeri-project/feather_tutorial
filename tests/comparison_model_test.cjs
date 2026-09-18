#!/usr/bin/env node
/* Independent arithmetic, physical-PE occupancy, and equal-work checks for
 * the FEATHER / systolic teaching model. No generated result is a golden. */
"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");
const model = require(path.join(__dirname, "../script/feather_comparison_model.js"));
let checks = 0, verifiedMacs = 0, verifiedRuns = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
function ok(value, message) { assert.ok(value, message); checks++; }
function close(actual, expected, message) {
    assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6 * Math.max(1, Math.abs(expected)),
        `${message}: got ${actual}, expected ${expected}`);
    checks++;
}
function flat(values) { return Array.from(values).flat(); }
function oracle(shape, input, weights) {
    const {M, K, N} = shape, a = flat(input), b = flat(weights), output = [];
    equal(a.length, M * K, "input contains exactly M × K real elements");
    equal(b.length, K * N, "weights contain exactly K × N real elements");
    for (let m = 0; m < M; m++) for (let n = 0; n < N; n++) {
        let sum = 0;
        for (let k = 0; k < K; k++) sum += a[m * K + k] * b[k * N + n];
        output.push(sum);
    }
    return output;
}
function verifyRun(layer, run, label) {
    const {M, K, N} = layer.shape, input = flat(layer.input), weights = flat(layer.weights);
    const coverage = new Uint8Array(M * K * N), contributions = new Float64Array(M * N);
    let count = 0, peak = 0;
    ok(Number.isSafeInteger(run.cycles) && run.cycles > 0, `${label}: positive integral timeline`);
    ok(run.frames.length > 0 && run.frames.length <= run.cycles, `${label}: bounded timeline frames`);
    const cycles = new Set();
    for (const frame of run.frames) {
        ok(Number.isInteger(frame.cycle) && frame.cycle >= 0 && frame.cycle < run.cycles,
            `${label}: frame cycle is within the advertised timeline`);
        ok(!cycles.has(frame.cycle), `${label}: cycles are unique`); cycles.add(frame.cycle);
        const occupied = new Set();
        for (const event of frame.macs) {
            for (const [name, limit] of [["row", 16], ["col", 16], ["m", M], ["k", K], ["n", N]]) {
                ok(Number.isInteger(event[name]) && event[name] >= 0 && event[name] < limit,
                    `${label}: ${name} identifies a real PE/logical tensor element`);
            }
            const pe = 16 * event.row + event.col, index = (event.m * K + event.k) * N + event.n;
            ok(!occupied.has(pe), `${label}: no PE performs two MACs in one cycle`); occupied.add(pe);
            equal(coverage[index], 0, `${label}: logical MAC is not duplicated`); coverage[index]++;
            equal(event.a, input[event.m * K + event.k], `${label}: A identity carries its real value`);
            equal(event.b, weights[event.k * N + event.n], `${label}: B identity carries its real value`);
            close(event.after, event.before + event.a * event.b, `${label}: PE accumulator updates numerically`);
            contributions[event.m * N + event.n] += event.a * event.b;
            count++;
        }
        peak = Math.max(peak, occupied.size);
    }
    equal(count, M * K * N, `${label}: architecture executes exactly the useful GEMM MAC count`);
    ok(coverage.every(value => value === 1), `${label}: every logical MAC executes once, including ragged tails`);
    equal(run.macs, count, `${label}: displayed MAC count matches actual timeline events`);
    equal(run.peakActive, peak, `${label}: displayed peak occupancy matches actual physical activity`);
    ok(run.mappedPEs >= peak && run.mappedPEs <= 256, `${label}: mapped capacity is a valid upper bound`);
    close(run.utilization, count / (run.cycles * 256), `${label}: useful utilization includes idle/drain cycles`);
    const expected = oracle(layer.shape, layer.input, layer.weights), output = flat(layer.output);
    equal(output.length, M * N, `${label}: logical output is not padded with fake elements`);
    expected.forEach((value, index) => {
        close(contributions[index], value, `${label}: physical MAC coverage yields independent GEMM output`);
        close(output[index], value, `${label}: public output equals independent GEMM arithmetic`);
        close(run.output[index], value, `${label}: this architecture's actual committed output matches the independent oracle`);
    });
    const finalWrites = run.frames.flatMap(frame => frame.writes).filter(write => write.final);
    equal(finalWrites.length, M * N, `${label}: each real output is committed finally once`);
    equal(new Set(finalWrites.map(write => write.m * N + write.n)).size, M * N, `${label}: final writes address all real outputs without duplicates`);
    for (const write of finalWrites) close(write.value, expected[write.m * N + write.n], `${label}: final packet carries its true output value`);
    if (run.kind !== "feather") {
        const dimensions = run.kind === "os" ? [M, N, K] : run.kind === "ws" ? [K, N, M] : [M, K, N];
        const offsets = new Map(); let start = 0;
        for (let first = 0; first < dimensions[0]; first += 16) for (let second = 0; second < dimensions[1]; second += 16) {
            offsets.set(`${first / 16}/${second / 16}`, start);
            start += dimensions[2] + Math.min(16, dimensions[0] - first) + Math.min(16, dimensions[1] - second) - 1;
        }
        equal(run.cycles, start, `${label}: systolic folds cost temporal + active rows + active columns − 1, including one capture beat`);
        for (const frame of run.frames) for (const event of frame.macs) {
            const [first, second, temporal] = run.kind === "os" ? [event.m, event.n, event.k] :
                run.kind === "ws" ? [event.k, event.n, event.m] : [event.m, event.k, event.n];
            equal([event.row, event.col], [first % 16, second % 16], `${label}: stationary mapping uses the claimed spatial dimensions`);
            equal(frame.cycle, offsets.get(`${Math.floor(first / 16)}/${Math.floor(second / 16)}`) + temporal + event.row + event.col,
                `${label}: useful MAC follows the independently derived unit-hop systolic wave`);
        }
    } else {
        for (const frame of run.frames) for (const event of frame.macs) {
            const [blockIndex, mappingIndex, dot, row, col] = event.key.split("/").map(Number);
            const block = layer.record.blocks[blockIndex], pair = block.mappings[mappingIndex], em = pair.EM, es = pair.ES;
            const localM = es.m_0 + es.s_m * dot + Math.floor(col / em.G_c) % (em.G_r / em.G_c);
            const localN = em.c_0 + em.s_r * row + em.s_c * (col % em.G_c);
            const localK = 16 * (em.r_0 + Math.floor(col / em.G_r)) + event.lane;
            equal([event.row, event.col, event.m, event.k, event.n],
                [row, col, block.origin.m + localM, block.origin.k + localK, block.origin.n + localN],
                `${label}: compiler EM/ES fields determine the actual physical MAC ownership`);
            ok(event.lane < es.vn_size + 1, `${label}: ES encodes VN length minus one`);
            const segment = run.segments.find(item => item.blockIndex === blockIndex && item.mappingIndex === mappingIndex);
            equal(frame.cycle, segment.start + dot * Math.max(16, es.vn_size + 1) + row + event.lane,
                `${label}: row skew and safe column-bus period determine the synthetic MAC cycle`);
        }
        ok(run.frames.some(frame => frame.macs.length && frame.partials.length && frame.network.length),
            `${label}: streaming MACs overlap column-bus capture and BIRRD traffic`);
        const partialAt = new Map();
        for (const frame of run.frames) {
            const busColumns = new Set();
            for (const packet of frame.partials) {
                ok(!busColumns.has(packet.col), `${label}: each column bus carries at most one completed PE result per cycle`);
                busColumns.add(packet.col); partialAt.set(packet.key, frame.cycle);
            }
            for (const write of frame.writes) for (const key of write.keys) {
                equal(frame.cycle - partialAt.get(key), 9, `${label}: output arrives after all eight BIRRD stages and the write beat`);
            }
        }
    }
    for (const cycle of [0, Math.floor((run.cycles - 1) / 2), run.cycles - 1]) {
        const snapshot = model.snapshot(run, cycle);
        equal(snapshot.pe.length, 256, `${label}: snapshot exposes the full 16 × 16 physical array`);
        equal(snapshot.active, snapshot.macs.length, `${label}: snapshot activity is actual MAC count`);
    }
    verifiedMacs += count; verifiedRuns++;
}

const presets = model.presets();
equal(presets.map(preset => preset.id), ["irregular-vector", "irregular-batch", "aligned"],
    "include both irregular connected chains and a non-cherry-picked aligned control");
const generated = require(path.join(__dirname, "../script/feather_comparison_data.js"));
equal(generated.arraySize, 16, "both architecture models target a 16 × 16 array");
ok(generated.provenance.deployedDataflow.includes("WO-S only"), "generated data does not claim undeployed IO-S support");
ok(generated.provenance.timingScope.includes("not vsim"), "synthetic cycles are not presented as RTL verification");

const built = new Map();
for (const preset of presets) {
    const candidates = new Map();
    for (const baseline of ["os", "ws", "is", "best"]) {
        const chain = model.build(preset.id, {baseline, layoutMode: "switch", bandwidth: 16, configCycles: 1, compatible: false});
        candidates.set(baseline, chain);
        equal(chain.layers.length, preset.layers.length, `${preset.id}/${baseline}: every chain layer is retained`);
        for (const [index, layer] of chain.layers.entries()) {
            const label = `${preset.id}/${baseline}/layer${index}`;
            if (index) {
                const previous = chain.layers[index - 1];
                equal(layer.shape.M, previous.shape.M, `${label}: producer and consumer row counts agree`);
                equal(layer.shape.K, previous.shape.N, `${label}: producer output width is consumer reduction width`);
                equal(flat(layer.input), flat(previous.output), `${label}: actual producer data is the consumer input, not a reset fixture`);
            }
            verifyRun(layer, layer.systolic, `${label}/systolic`);
            // FEATHER mapping/arithmetic is baseline-independent, so cover each
            // FEATHER run once and compare all later baseline choices to it.
            if (baseline === "os") verifyRun(layer, layer.feather, `${label}/feather`);
            else {
                const reference = candidates.get("os").layers[index];
                equal(layer.feather.cycles, reference.feather.cycles, `${label}: changing the SA baseline does not alter FEATHER timing`);
                equal(flat(layer.output), flat(reference.output), `${label}: baseline changes do not change operands/results`);
            }
        }
    }
    for (let index = 0; index < candidates.get("best").layers.length; index++) {
        const counts = ["os", "ws", "is"].map(mode => candidates.get(mode).layers[index].systolic.cycles);
        equal(candidates.get("best").layers[index].systolic.cycles, Math.min(...counts),
            `${preset.id}/layer${index}: strongest modeled SA option picks the actual minimum clock`);
    }
    built.set(preset.id, candidates);
}

const first = built.get("irregular-vector").get("os").layers[0];
equal(first.shape, {M: 1, K: 12, N: 32}, "the motivating ragged GEMV-like example is present");
equal([first.systolic.mappedPEs, first.systolic.peakActive], [16, 12], "OS folds N into two waves and never uses padded M rows");
equal([first.feather.mappedPEs, first.feather.peakActive], [32, 24], "compiler-backed FEATHER mapping expands useful spatial placement without claiming all 256 PEs");
const vector = built.get("irregular-vector").get("os");
ok(new Set(vector.layers.map(layer => layer.feather.mappingLabel)).size > 1,
    "irregular chain genuinely changes FEATHER mapping rather than only relabeling shapes");

// Independent Table-II closed forms: do not call the model's rank/address code.
function physical(kind, order, m, n, M, N) {
    const a0 = Math.min(16, M), a1 = Math.ceil(M / a0), a2 = Math.ceil(N / 16);
    const l0 = m % a0, l1 = Math.floor(m / a0), outer = Math.floor(n / 16);
    const forms = kind === "O" ? [l1*a0*a2+l0*a2+outer, l1*a2*a0+outer*a0+l0,
        l0*a1*a2+l1*a2+outer, l0*a2*a1+outer*a1+l1, outer*a1*a0+l1*a0+l0, outer*a0*a1+l0*a1+l1] :
        [outer*a0*a1+l0*a1+l1, outer*a1*a0+l1*a0+l0, l0*a2*a1+outer*a1+l1,
            l0*a1*a2+l1*a2+outer, l1*a2*a0+outer*a0+l0, l1*a0*a2+l0*a2+outer];
    const vn = forms[order];
    return [vn % 16, Math.floor(vn / 16) * 16 + n % 16];
}
for (const preset of presets) {
    for (const bandwidth of [1, 7, 16, 64, 256]) for (const layoutMode of ["switch", "fixed"]) for (const compatible of [false, true]) {
        const configCycles = bandwidth === 7 ? 9 : 1;
        const chain = model.build(preset.id, {baseline: "best", bandwidth, layoutMode, compatible, configCycles});
        equal(chain.boundaries.length, chain.layers.length - 1, "each real producer/consumer pair has one boundary");
        for (const boundary of chain.boundaries) {
            const producer = chain.layers[boundary.from], consumer = chain.layers[boundary.to];
            equal(boundary.elements, producer.shape.M * producer.shape.N, "boundary counts real outputs, not padded allocation");
            equal(boundary.sourceCells.length, boundary.elements, "source layout keeps every real tensor element");
            equal(boundary.targetCells.length, boundary.elements, "target layout keeps every real tensor element");
            let changed = 0;
            for (const [operand, field, order] of [["O", "sourceCells", producer.record.orders.O], ["I", "targetCells", consumer.record.orders.I]]) {
                const occupied = new Set();
                for (const cell of boundary[field]) {
                    const address = physical(operand, order, cell.m, cell.n, producer.shape.M, producer.shape.N);
                    equal([cell.bank, cell.row], address, "buffer bank/row follows the independently derived Table-II order");
                    equal(cell.value, producer.output[cell.m * producer.shape.N + cell.n], "layout movement preserves the actual producer value");
                    occupied.add(address.join("/"));
                }
                equal(occupied.size, boundary.elements, "physical layout is injective even at ragged tensor edges");
            }
            for (let i = 0; i < boundary.elements; i++) {
                const source = boundary.sourceCells[i], target = boundary.targetCells[i];
                equal([source.index, source.m, source.n, source.value], [target.index, target.m, target.n, target.value],
                    "copy changes an address, never a tensor identity/value");
                if (source.bank !== target.bank || source.row !== target.row) changed++;
            }
            equal(boundary.changedElements, changed, "changed-element count is measured from actual source/destination addresses");
            equal(boundary.changed, changed > 0, "an order-code change alone is not treated as data movement");
            const copied = changed > 0 && !compatible ? boundary.elements : 0;
            equal(boundary.copiedElements, copied, "fresh destination scratch initializes all real elements, including unchanged-address cells");
            const expectedCopy = 2 * Math.ceil(copied / bandwidth);
            equal(boundary.saCopyCycles, expectedCopy, "out-of-place conversion separately accounts read and write bandwidth");
            const eligible = producer.record.tile.Mt === consumer.record.tile.Mt && producer.record.tile.Nt === consumer.record.tile.Kt &&
                producer.record.reorderAlternative?.legalSameMapping === true && producer.record.reorderAlternative.orderO === 5 - consumer.record.orders.I;
            equal(Boolean(boundary.routeEligible), Boolean(eligible), "direct switch credit requires matching tile extents and a compiler-checked alternative");
            const switched = changed > 0 && !compatible && layoutMode === "switch" && eligible;
            equal(Boolean(boundary.switched), Boolean(switched), "layout switching does not earn credit on incompatible/unchanged boundaries");
            equal(boundary.featherCopyCycles, switched ? 0 : expectedCopy, "FEATHER pays identical conversion cost whenever direct handoff is unavailable");
            equal(boundary.configCycles, switched ? configCycles : 0, "configuration cost is explicit and charged only when used");
        }
        for (const architecture of ["systolic", "feather"]) {
            const total = chain.totals[architecture], tracks = chain.timeline[architecture];
            const compute = chain.layers.reduce((sum, layer) => sum + layer[architecture].cycles, 0);
            const copies = chain.boundaries.reduce((sum, boundary) => sum + boundary[architecture === "feather" ? "featherCopyCycles" : "saCopyCycles"], 0);
            const configs = architecture === "feather" ? chain.boundaries.reduce((sum, boundary) => sum + boundary.configCycles, 0) : 0;
            equal([total.computeCycles, total.copyCycles, total.configCycles, total.cycles], [compute, copies, configs, compute + copies + configs],
                "whole-chain totals keep compute, layout copying, and configuration separate");
            close(total.utilization, total.macs / (256 * total.cycles), "chain utilization includes modeled boundary time");
            equal(tracks[0].start, 0, "chain timeline starts at zero");
            for (const [index, segment] of tracks.entries()) {
                if (index) equal(segment.start, tracks[index - 1].end, "chain timeline has no hidden gaps/overlaps");
                const located = model.locate(chain, architecture, segment.start);
                equal(located.layerIndex, segment.layerIndex, "shared-cycle lookup selects the real producer/consumer layer");
                if (segment.kind !== "layer") equal(located.snapshot.active, 0, "layout/configuration time does not fabricate compute utilization");
            }
            equal(tracks[tracks.length - 1].end, total.cycles, "timeline endpoint equals reported total");
            const done = model.locate(chain, architecture, total.cycles);
            equal(done.phase, "done", "completed architecture is marked done on the shared clock");
            equal(done.snapshot.active, 0, "completed architecture does not replay its last MAC");
        }
    }
}
for (const bad of [{baseline:"unknown"}, {layoutMode:"pretend"}, {bandwidth:0}, {bandwidth:257}, {bandwidth:1.5}, {configCycles:-1}, {configCycles:65}]) {
    assert.throws(() => model.build("irregular-vector", bad), undefined, "invalid settings fail visibly instead of silently changing assumptions"); checks++;
}
assert.throws(() => model.build("missing-preset")); checks++;

console.log(`PASS ${checks} comparison-model assertions; ${verifiedRuns} independently checked runs; ${verifiedMacs} uniquely covered logical MACs.`);
