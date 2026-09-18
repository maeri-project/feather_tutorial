#!/usr/bin/env node
/* Dependency-free whole-array teaching-model checks. Optional: --html PATH. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const argument = process.argv.indexOf("--html");
const html = argument < 0 ? path.resolve(__dirname, "../QWEN3_MINISA_VISUALIZER.html") : process.argv[argument + 1];
const published = fs.readFileSync(html, "utf8");
const match = published.match(/<script id="case-data" type="application\/json">([\s\S]*?)<\/script>/);
assert(match, "Published HTML must contain the compiler data export");
const data = JSON.parse(match[1]), originalData = JSON.stringify(data);
const blocks = [...published.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
const context = vm.createContext({});
function embedded(header, signature, filename) {
    const candidates = blocks.filter(block => block.trimStart().startsWith(header) && block.includes(signature));
    assert.equal(candidates.length, 1, `Expected exactly one embedded ${filename} model`);
    // Run only the maintained numerical models and shared scheduler, never the page's DOM,
    // controller, navigation, data payload, or third-party script blocks.
    vm.runInContext(candidates[0], context, {filename, timeout: 3000});
}
embedded("/* Numerical teaching frames for the unified FEATHER drawing.", "global.FeatherAnimation = api", "animation.js");
embedded("/* Shared, deliberately simplified timing for the numerical teaching views.", "global.FeatherPipeline = api", "pipeline.js");
embedded("/* Whole-tile numerical teaching model for the existing", "global.FeatherArrayAnimation = api", "array_animation.js");
const scalar = context.FeatherAnimation, array = context.FeatherArrayAnimation;
let assertions = 0;
// Normalize cross-realm arrays/objects without losing FP32 values or signed zero.
function local(value) { return value && typeof value === "object" ? structuredClone(value) : value; }
function equal(actual, expected, message) { assert.deepEqual(local(actual), local(expected), message); assertions++; }
function check(value, message) { assert(value, message); assertions++; }
function rejects(action, message) { assert.throws(action, message); assertions++; }
const float = new Float32Array(1), word = new Uint32Array(float.buffer);
function bits(value) { float[0] = value; return word[0]; }

const trace = array.build(data);
equal(array.build(data), trace, "same selection reuses the cached compact snapshots");
check(array.build(data) === trace, "cache returns the same trace identity");
equal(trace.explanationFrames.length, 332, "the numerical explanation retains its 332 arithmetic/routing snapshots");
check(trace.frames.some(frame => frame.phase === "pipeline"), "public playback uses the overlapping pipeline timeline");
equal(trace.teachingOnly, true, "synthetic operands labeled as teaching data");
equal(trace.rtlCycleAccurate, false, "no RTL timing claim");
equal(trace.groups.length, 8, "all eight output dot groups");
equal(trace.owners.length, 256, "all 16×16 physical PEs");
equal(trace.frames.slice(0, 3).map(frame => frame.phase), ["load_input", "load_weight", "preload"], "load/preload ordering");
equal(trace.frames.at(-1).phase, "store", "single K tile finishes with Store");
equal(trace.frames[0].progress, 0, "first frame progress");
equal(trace.frames.at(-1).progress, 1, "last frame progress");
check(trace.frames.slice(0, -1).every(frame => !frame.storeEnabled), "no early Store");
equal(trace.frames.at(-1).storeEnabled, true, "final Store gate");
const covered = new Set(), committed = new Set();
const route = data.birrd.commands.find(command => command.reduction_width === 2);
for (let t = 0; t < 8; t++) {
    const group = trace.groups[t];
    equal(group.lanes.length, 16, "all 16 VN elements reach every PE");
    equal(group.outputs.length, 128, "128 committed outputs per dot group");
    const accumulators = Array(256).fill(0);
    for (let lane = 0; lane < 16; lane++) {
        const step = group.lanes[lane];
        equal(step.lane, lane, "lane snapshot index");
        equal(step.before, accumulators, "all PE accumulators before this lane");
        for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
            const index = row * 16 + col, m = t * 4 + Math.floor((col % 8) / 2);
            const n = row + 16 * (col % 2), k = 16 * Math.floor(col / 8) + lane;
            const a = scalar.sample("I", m, k), b = scalar.sample("W", k, n);
            equal(step.a[index], a.value, "A coordinate/value for every PE");
            equal(step.b[index], b.value, "B coordinate/value for every PE");
            equal(step.aBits[index], a.bits, "A remains FP16");
            equal(step.bBits[index], b.bits, "B remains FP16");
            const product = Math.fround(a.value * b.value);
            equal(step.product[index], product, "FP32 product at every PE");
            accumulators[index] = Math.fround(accumulators[index] + product);
            equal(step.after[index], accumulators[index], "sequential FP32 accumulation at every PE");
        }
        equal(step.after, accumulators, "complete accumulator snapshot");
    }
    equal(group.partials, accumulators, "all 256 final NEST partials");
    for (let row = 0; row < 16; row++) {
        const network = group.networks[row];
        let previous = accumulators.slice(row * 16, row * 16 + 16);
        for (let stage = 0; stage < 8; stage++) {
            const snapshot = network.stages[stage];
            equal(snapshot.stage, stage, "network stage ID");
            equal(snapshot.before, previous, "all row-wave inputs at every stage");
            const after = Array(16);
            for (const node of route.stages[stage].nodes) {
                const [a, b] = node.input_ports.map(port => previous[port]);
                // Direct opcode semantics are independent of the model's use
                // of exported dependency arrays and compiled prior-K replay.
                const outputs = [[a, b], [Math.fround(a + b), b], [a, Math.fround(a + b)], [b, a]][node.command];
                node.output_ports.forEach((port, side) => { after[port] = outputs[side]; });
            }
            equal(snapshot.after, after, "exact values for every actual BIRRD switch");
            previous = after;
        }
        equal(network.outputs, previous, "all 16 raw network outputs retained");
        for (let port = 0; port < 8; port++) {
            const output = group.outputs[row * 8 + port], m = t * 4 + Math.floor(port / 2), n = row + 16 * (port % 2);
            equal([output.row, output.port, output.colPair], [row, port, [port, port + 8]], "actual reduction pair");
            equal([output.localM, output.localN, output.m, output.n, output.index], [m, n, m, n, m * 32 + n], "C coordinate ownership");
            check(!covered.has(output.index), "each C element is produced exactly once");
            covered.add(output.index);
            const expected = Math.fround(accumulators[row * 16 + port] + accumulators[row * 16 + port + 8]);
            equal(output.partial, expected, "committed port reduces both K-group partials");
            equal(output.prior, 0, "first K tile has zero prior OB value");
            equal(output.after, expected, "OB accumulation after first K tile");
            equal(trace.partial[output.index], expected, "tile partial indexed by C coordinate");
            equal(trace.outputFP32[output.index], expected, "tile OB value indexed by C coordinate");
        }
    }
    // Preserve independent arithmetic/routing checks on explanation snapshots;
    // the pipeline browser regression checks simultaneous public playback.
    const frames = trace.explanationFrames.slice(3 + 41 * t, 3 + 41 * (t + 1));
    equal(frames.slice(0, 16).map(frame => frame.phase), Array(16).fill("mac"), "whole-array MAC phase order");
    equal(frames.slice(16).map(frame => frame.phase), Array(25).fill("route"), "25 pipelined logical routing ticks");
    equal(frames.slice(0, 16).map(frame => frame.lane), Array.from({length: 16}, (_, lane) => lane), "every lane in order");
    const injected = new Set(), stageRows = Array.from({length: 8}, () => new Set()), obRows = new Set();
    for (const frame of frames) {
        equal(frame.t, t, "every frame belongs to its dot group");
        if (frame.phase === "mac") {
            equal(frame.committedCount, t * 128, "no new C values before reduction");
            continue;
        }
        if (frame.injectRow !== null) {
            equal(frame.injectRow, frame.tick, "one row injected on each initial tick");
            check(!injected.has(frame.injectRow), "row injected once");
            injected.add(frame.injectRow);
        }
        for (const wave of frame.stages) {
            equal(wave.row, frame.tick - 1 - wave.stage, "registered stage-row position");
            check(wave.row >= 0 && wave.row < 16, "stage wave has a valid PE row");
            check(!stageRows[wave.stage].has(wave.row), "row traverses each stage exactly once");
            stageRows[wave.stage].add(wave.row);
        }
        if (frame.obRow !== null) {
            equal(frame.obRow, frame.tick - 9, "OB follows all eight BIRRD stages");
            check(!obRows.has(frame.obRow), "each row commits once per dot group");
            obRows.add(frame.obRow);
            for (let port = 0; port < 8; port++) {
                const index = group.outputs[frame.obRow * 8 + port].index;
                check(!committed.has(index), "C output committed once in the whole logical timeline");
                committed.add(index);
            }
        }
        equal(frame.committedCount, committed.size, "cumulative output count matches actual committed coordinates");
    }
    equal(injected.size, 16, "all rows injected");
    equal(obRows.size, 16, "all rows reach OB");
    for (const rows of stageRows) equal(rows.size, 16, "every row traverses every BIRRD stage");
}
equal(covered.size, 1024, "all 32×32 tile outputs covered");
equal(committed.size, 1024, "all 32×32 tile outputs committed");
equal(trace.frames.at(-1).committedCount, 1024, "Store only after the complete tile");
equal(trace.fp16Bits, trace.outputFP32.map(scalar.toFP16), "all final FP16 casts");
equal(trace.fp16Values, trace.fp16Bits.map(scalar.fromFP16), "all final Store values");

// Independent reference: direct matrix coordinates, two 16-term scalar dot
// products, then pair reduction and sequential cross-K OB accumulation. It
// never uses the model's PE ownership traversal or BIRRD implementation.
function reference(options) {
    const firstK = options.origins.k - options.kTile * 32;
    const result = Array(1024).fill(0);
    let prior = null, partial = null;
    for (let tile = 0; tile <= options.kTile; tile++) {
        const kOrigin = firstK + tile * 32;
        const a = Array.from({length: 1024}, (_, index) => scalar.sample("I", options.origins.m + Math.floor(index / 32), kOrigin + index % 32).value);
        const b = Array.from({length: 1024}, (_, index) => scalar.sample("W", kOrigin + Math.floor(index / 32), options.origins.n + index % 32).value);
        if (tile === options.kTile) { prior = result.slice(); partial = Array(1024); }
        for (let m = 0; m < 32; m++) for (let n = 0; n < 32; n++) {
            const halves = [0, 0];
            for (let k = 0; k < 32; k++) halves[k >> 4] = Math.fround(halves[k >> 4] + Math.fround(a[m * 32 + k] * b[k * 32 + n]));
            const index = m * 32 + n, contribution = Math.fround(halves[0] + halves[1]);
            result[index] = Math.fround(result[index] + contribution);
            if (partial) partial[index] = contribution;
        }
    }
    return {prior, partial, result};
}
for (const options of [
    {origins: {m: 64, n: 192, k: 96}, kTile: 3, kTiles: 4},
    {origins: {m: 32, n: 2048, k: 160}, kTile: 5, kTiles: 96},
    {origins: {m: 96, n: 992, k: 3040}, kTile: 95, kTiles: 96},
    {origins: {m: 32, n: 64, k: 352}, kTile: 2, kTiles: 3},
    {origins: {m: 0, n: 0, k: 0}, kTile: 0, kTiles: 2},
]) {
    const actual = array.build(data, options), expected = reference(options);
    equal(actual.prior, expected.prior, "all 1,024 previous-K values match direct matrix reference");
    equal(actual.partial, expected.partial, "all 1,024 current-tile partials match direct matrix reference");
    equal(actual.outputFP32, expected.result, "all 1,024 FP32 output accumulations match direct matrix reference");
    const store = options.kTile === options.kTiles - 1;
    equal(actual.stored, store, "cross-K Store gate");
    equal(actual.frames.at(-1).phase, store ? "store" : "hold", "unfinished K keeps FP32 in OB");
    equal(actual.fp16Bits, store ? expected.result.map(scalar.toFP16) : null, "no FP16 cast before final K");
    equal(actual.fp16Values, store ? expected.result.map(value => scalar.fromFP16(scalar.toFP16(value))) : null, "no stored values before final K");
    const output = actual.groups[7].outputs[127];
    equal([output.m, output.n], [options.origins.m + 31, options.origins.n + 31], "global output coordinates retain tile origins");
    if (options.kTile === 95) {
        equal(bits(actual.prior[1023]), 1159512140, "maximum-K prior matches independent numpy/BIRRD fixture");
        equal(bits(actual.outputFP32[1023]), 1159529214, "maximum-K output matches independent numpy/BIRRD fixture");
        equal(actual.fp16Bits[1023], 26856, "maximum-K Store matches independent numpy fixture");
    }
}
equal(JSON.stringify(data), originalData, "animation leaves compiler data unchanged");
for (const options of [{kTiles: 0}, {kTile: -1}, {kTile: 2, kTiles: 2},
    {kTile: 1, kTiles: 2, origins: {k: 0}}, {origins: {m: -1}}, {origins: {n: 0.5}}, {designId: "missing"}]) {
    rejects(() => array.build(data, options), "reject invalid tile selection");
}
for (const mutate of [
    value => { value.hardware.AH = 8; },
    value => { value.tile_designs[0].tile.Kt = 16; },
    value => { value.tile_designs[0].mapping_pairs[0].EM.G_r = 4; },
    value => { value.tile_designs[0].mapping_pairs[0].ES.T = 4; },
    value => { value.birrd.commands.find(command => command.reduction_width === 2).committed_output_ports.pop(); },
    value => { value.birrd.commands.find(command => command.reduction_width === 2).outputs[3].source_columns = [3, 12]; },
    value => { value.birrd.commands.find(command => command.reduction_width === 2).outputs[8].committed_to_ob = true; },
]) {
    const invalid = JSON.parse(originalData); mutate(invalid);
    rejects(() => array.build(invalid), "reject unsupported or malformed exported profile");
}
console.log(`PASS: ${assertions.toLocaleString()} whole-array assertions; 32,768 MACs, 128 row waves, all 1,024 outputs, actual BIRRD commands and 96-K-tile accumulation`);
