/* Equal-work teaching model, not a cycle-accurate RTL or SCALE-Sim result.
 * Every event executes one real GEMM MAC. Weights/setup/DMA are outside the
 * logical compute clock for BOTH machines; no frequency/area equivalence is
 * implied by equal PE counts. Mapping records come from the MINISA compiler.
 */
(function (root) {
    "use strict";
    const data = typeof module !== "undefined" && module.exports ? require("./feather_comparison_data.js") : root.FeatherComparisonData;
    const SIZE = 16, PE_COUNT = 256;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const ceil = (n, d) => Math.ceil(n / d);
    const cases = new Map(data.cases.map(item => [item.id, item]));
    const runCache = new Map();
    const defaults = Object.freeze({baseline: "os", layoutMode: "switch", bandwidth: 16, configCycles: 1, compatible: false});

    function optionsOf(options = {}) {
        const value = {...defaults, ...options};
        check(["os", "ws", "is", "best"].includes(value.baseline), "Unknown systolic dataflow");
        check(["switch", "fixed"].includes(value.layoutMode), "Unknown layout policy");
        check(Number.isInteger(value.bandwidth) && value.bandwidth >= 1 && value.bandwidth <= 256, "Bandwidth must be 1–256 scalar transfers per logical cycle");
        check(Number.isInteger(value.configCycles) && value.configCycles >= 0 && value.configCycles <= 64, "Configuration cost must be 0–64 logical cycles");
        value.compatible = Boolean(value.compatible);
        return value;
    }
    function makeRun(kind, shape) {
        return {kind, name: kind === "feather" ? "FEATHER · compiler WO-S mapping" : `Systolic · ${kind.toUpperCase()}`,
            shape, frames: [], segments: [], mappedPEs: 0, mappingLabel: "", macs: 0, peakActive: 0, cycles: 0, utilization: 0};
    }
    function ensure(run, cycle) {
        while (run.frames.length <= cycle) run.frames.push({cycle: run.frames.length, phase: "drain", macs: [], partials: [], network: [], writes: []});
        return run.frames[cycle];
    }
    function addMac(run, cycle, event, layer) {
        const frame = ensure(run, cycle);
        frame.phase = "compute";
        frame.macs.push({...event, a: layer.input[event.m * layer.shape.K + event.k], b: layer.weights[event.k * layer.shape.N + event.n]});
    }
    function finish(run, layer) {
        const accumulators = new Map(), partialTerms = new Map(), outputs = Array(layer.shape.M * layer.shape.N).fill(0);
        const writtenTerms = Array(outputs.length).fill(0);
        for (const frame of run.frames) {
            const occupied = new Set();
            for (const event of frame.macs) {
                const pe = event.row * SIZE + event.col, index = event.m * layer.shape.N + event.n;
                check(!occupied.has(pe), "Overlapping work assigned to one PE"); occupied.add(pe);
                const key = run.kind === "feather" ? event.key : index;
                event.before = accumulators.get(key) || 0;
                event.after = Math.fround(event.before + Math.fround(event.a * event.b));
                accumulators.set(key, event.after);
                partialTerms.set(key, (partialTerms.get(key) || 0) + 1);
            }
            for (const partial of frame.partials) partial.value = accumulators.get(partial.key) || 0;
            for (const write of frame.writes) {
                const index = write.m * layer.shape.N + write.n;
                if (run.kind === "feather") {
                    write.partial = write.keys.reduce((sum, key) => Math.fround(sum + (accumulators.get(key) || 0)), 0);
                    write.before = outputs[index];
                    outputs[index] = Math.fround(outputs[index] + write.partial);
                    writtenTerms[index] += write.keys.reduce((sum, key) => sum + (partialTerms.get(key) || 0), 0);
                    write.final = writtenTerms[index] === layer.shape.K;
                } else {
                    outputs[index] = accumulators.get(index) || 0;
                    write.final = partialTerms.get(index) === layer.shape.K;
                }
                write.index = index; write.value = outputs[index];
            }
            if (!frame.macs.length && (frame.partials.length || frame.network.length || frame.writes.length)) frame.phase = "route / write";
            run.macs += frame.macs.length; run.peakActive = Math.max(run.peakActive, frame.macs.length);
        }
        run.cycles = run.frames.length;
        run.utilization = run.macs / (PE_COUNT * run.cycles);
        run.output = outputs;
        check(run.macs === layer.shape.M * layer.shape.K * layer.shape.N, "Mapping does not cover the exact GEMM work");
        return run;
    }

    function systolic(layer, kind) {
        const {M, K, N} = layer.shape, run = makeRun(kind, layer.shape);
        const spatial = kind === "os" ? [M, N] : kind === "ws" ? [K, N] : [M, K];
        const temporal = kind === "os" ? K : kind === "ws" ? M : N;
        let start = 0;
        // Each fold uses a rectangular, unpartitioned mesh. Ragged edges are
        // shortened, not charged as fictitious padded MACs. Fold reload costs
        // are omitted rather than adding a penalty to the systolic baseline.
        for (let a = 0; a < spatial[0]; a += SIZE) for (let b = 0; b < spatial[1]; b += SIZE) {
            const rows = Math.min(SIZE, spatial[0] - a), cols = Math.min(SIZE, spatial[1] - b), mapped = [];
            for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
                const owner = kind === "os" ? {m: a + row, n: b + col} : kind === "ws" ? {k: a + row, n: b + col} : {m: a + row, k: b + col};
                mapped.push({row, col, ...owner});
                for (let t = 0; t < temporal; t++) {
                    const m = kind === "ws" ? t : a + row;
                    const k = kind === "os" ? t : kind === "ws" ? a + row : b + col;
                    const n = kind === "is" ? t : b + col;
                    const cycle = start + t + row + col;
                    addMac(run, cycle, {row, col, m, k, n}, layer);
                    if (k === K - 1) ensure(run, cycle + 1).writes.push({row, col, m, n});
                }
            }
            const end = start + temporal + rows + cols - 2;
            // One logical output handoff beat is retained for all folds,
            // including K-partial folds; weights/DMA are not in this axis.
            ensure(run, end);
            const mappingLabel = kind === "os" ? "M → rows, N → columns, K → time" :
                kind === "ws" ? "K → rows, N → columns, M → time" : "M → rows, K → columns, N → time";
            run.segments.push({start, end, mapped, mappingLabel});
            run.mappedPEs = Math.max(run.mappedPEs, mapped.length);
            run.mappingLabel = mappingLabel; start = end + 1;
        }
        return finish(run, layer);
    }

    function feather(layer, record) {
        const run = makeRun("feather", layer.shape);
        let start = 0, group = 0;
        for (let blockIndex = 0; blockIndex < record.blocks.length; blockIndex++) {
            const block = record.blocks[blockIndex], {origin, shape} = block;
            for (let mappingIndex = 0; mappingIndex < block.mappings.length; mappingIndex++) {
                const {EM: em, ES: es} = block.mappings[mappingIndex], vn = es.vn_size + 1;
                check(es.dataflow === 1, "Only compiler-supported WO-S is shown");
                const mappingStart = start, mapped = [], groups = [], mappingLabel = `WO-S · Gr${em.G_r}/Gc${em.G_c} · ${SIZE / em.G_r}-way K reduction · VN${vn}`;
                for (let dot = 0; dot < es.T; dot++, group++) {
                    const launch = mappingStart + dot * Math.max(SIZE, vn), owners = [];
                    for (let row = 0; row < SIZE; row++) {
                        const destinations = new Map();
                        for (let col = 0; col < SIZE; col++) {
                            const m = origin.m + es.m_0 + es.s_m * dot + Math.floor((col % em.G_r) / em.G_c);
                            const n = origin.n + em.c_0 + em.s_r * row + em.s_c * (col % em.G_c);
                            const kStart = origin.k + SIZE * (em.r_0 + Math.floor(col / em.G_r));
                            if (m >= origin.m + shape.M || n >= origin.n + shape.N || kStart >= origin.k + shape.K) continue;
                            const key = `${blockIndex}/${mappingIndex}/${dot}/${row}/${col}`;
                            const owner = {row, col, m, n, k: kStart, kStart, kEnd: Math.min(kStart + vn, origin.k + shape.K), group};
                            owners.push(owner);
                            if (!destinations.has(n + "/" + m)) destinations.set(n + "/" + m, {row, col: col % em.G_r, m, n, keys: []});
                            destinations.get(n + "/" + m).keys.push(key);
                            for (let lane = 0; lane < vn && kStart + lane < origin.k + shape.K; lane++) {
                                addMac(run, launch + row + lane, {row, col, m, n, k: kStart + lane, key, group, lane}, layer);
                            }
                            ensure(run, launch + row + vn).partials.push({row, col, m, n, key, group});
                        }
                        if (destinations.size) {
                            for (let stage = 0; stage < 8; stage++) ensure(run, launch + row + vn + stage + 1).network.push({stage, row, group});
                            for (const output of destinations.values()) ensure(run, launch + row + vn + 9).writes.push({...output, group});
                        }
                    }
                    run.mappedPEs = Math.max(run.mappedPEs, owners.length);
                    groups.push({start: launch, owners});
                    if (!dot) mapped.push(...owners);
                }
                const end = run.frames.length - 1;
                run.segments.push({start: mappingStart, end, mapped, groups, mappingLabel, EM: em, ES: es, blockIndex, mappingIndex});
                run.mappingLabel = mappingLabel; start = end + 1;
            }
        }
        return finish(run, layer);
    }

    function buildLayer(caseId, options = {}, input = null, index = 0) {
        const record = cases.get(caseId), config = optionsOf(options);
        check(record, "Unknown GEMM workload");
        const {M, K, N} = record.shape;
        const values = input ? Array.from(input) : Array.from({length: M * K}, (_, i) => (i * 7 + Math.floor(i / K) * 3) % 5 - 2);
        check(values.length === M * K && values.every(Number.isFinite), "The preceding output must match the next input shape");
        const key = JSON.stringify([caseId, index, values]);
        let layer = runCache.get(key);
        if (!layer) {
            layer = {id: caseId, index, name: record.name, shape: record.shape, record, input: values,
                weights: Array.from({length: K * N}, (_, i) => ((Math.floor(i / N) * 3 + i % N * 7 + index) % 5) - 2)};
            layer.feather = feather(layer, record);
            layer.baselines = Object.fromEntries(["os", "ws", "is"].map(mode => [mode, systolic(layer, mode)]));
            layer.output = layer.feather.output.slice();
            for (const run of Object.values(layer.baselines)) check(run.output.every((value, i) => value === layer.output[i]), "The two architectures disagree on GEMM arithmetic");
            if (runCache.size >= 48) runCache.clear();
            runCache.set(key, layer);
        }
        const best = Object.values(layer.baselines).reduce((a, b) => b.cycles < a.cycles ? b : a);
        const selected = config.baseline === "best" ? best : layer.baselines[config.baseline];
        return {...layer, systolic: selected};
    }

    function snapshot(run, requestedCycle) {
        const cycle = Math.max(0, Math.min(run.cycles - 1, Math.floor(requestedCycle)));
        const frame = run.frames[cycle], segment = run.segments.find(item => cycle >= item.start && cycle <= item.end) || run.segments[run.segments.length - 1];
        const pe = Array.from({length: PE_COUNT}, (_, i) => ({row: Math.floor(i / SIZE), col: i % SIZE, active: false, mapped: false, value: 0}));
        // During group overlap each physical row can have a different owner.
        // Mask exhausted M replicas in the new group instead of retaining the
        // previous group's occupancy just because its weights are resident.
        const mapped = segment.groups ? Array.from({length: SIZE}, (_, row) => {
            let group = segment.groups[0];
            for (const candidate of segment.groups) if (cycle >= candidate.start + row) group = candidate;
            return group.owners.filter(owner => owner.row === row);
        }).flat() : segment.mapped;
        for (const owner of mapped) Object.assign(pe[owner.row * SIZE + owner.col], owner, {mapped: true});
        for (let t = segment.start; t <= cycle; t++) for (const event of run.frames[t].macs) {
            Object.assign(pe[event.row * SIZE + event.col], {m: event.m, k: event.k, n: event.n, value: event.after, a: event.a, b: event.b});
        }
        for (const event of frame.macs) Object.assign(pe[event.row * SIZE + event.col], {active: true});
        const completed = new Map();
        for (let t = 0; t <= cycle; t++) for (const write of run.frames[t].writes) if (write.final) completed.set(write.index, write);
        return {...frame, pe, active: frame.macs.length, mapped,
            mappingLabel: segment.mappingLabel, completedOutputs: [...completed.values()]};
    }

    function cells(layer, operand, order) {
        const {M, N} = layer.shape, a0 = Math.min(SIZE, M), a1 = ceil(M, a0), a2 = ceil(N, SIZE);
        const ranks = data.layoutRanks?.[operand]?.[order];
        check(ranks, "Missing compiler layout rank order");
        const dimensions = operand === "O" ? {pL0: a0, pL1: a1, qL1: a2} : {mL0: a0, mL1: a1, jL1: a2};
        return layer.output.map((value, index) => {
            const m = Math.floor(index / N), n = index % N;
            const coordinates = operand === "O" ? {pL0: m % a0, pL1: Math.floor(m / a0), qL1: Math.floor(n / SIZE)} :
                {mL0: m % a0, mL1: Math.floor(m / a0), jL1: Math.floor(n / SIZE)};
            const linear = ranks.reduce((linear, rank) => linear * dimensions[rank] + coordinates[rank], 0);
            return {index, m, n, bank: linear % SIZE, row: Math.floor(linear / SIZE) * SIZE + n % SIZE, value};
        });
    }
    function boundaryFor(layer, next, index, options) {
        const sourceCells = cells(layer, "O", layer.record.orders.O), targetCells = cells(layer, "I", next.record.orders.I);
        const changedCells = sourceCells.filter((cell, i) => cell.bank !== targetCells[i].bank || cell.row !== targetCells[i].row);
        const changed = changedCells.length > 0;
        const sameTiles = layer.record.tile.Mt === next.record.tile.Mt && layer.record.tile.Nt === next.record.tile.Kt;
        const alternative = layer.record.reorderAlternative;
        const routeEligible = sameTiles && alternative?.legalSameMapping === true && alternative.orderO === 5 - next.record.orders.I;
        // This is an incremental layout sensitivity experiment, not the current
        // FP16 wrapper's cost. A fresh scratch buffer makes the address copy
        // out-of-place: read and write phases are separate, hence two ceilings.
        // A fresh destination must also receive cells whose addresses stay
        // unchanged. Counting only displaced cells would leave holes in it.
        const copiedElements = changed && !options.compatible ? layer.output.length : 0;
        const copyCycles = 2 * ceil(copiedElements, options.bandwidth);
        const switched = changed && !options.compatible && options.layoutMode === "switch" && routeEligible;
        const note = !changed ? "Actual addresses already agree: no layout-copy credit." : options.compatible ?
            "A layout-aware systolic writer (or compatible producer) removes the extra copy for both arrays." : !sameTiles ?
                "Different tile extents require retiling; direct RIR reuse is not credited here." : !routeEligible ?
                    "A same-mapping target-layout alternative is not verified; both arrays retain conversion cost." :
                    "Compiler-checked output order can target the consumer banks; direct handoff remains an architectural what-if, not current RTL reuse.";
        return {index, from: layer.index, to: next.index, elements: layer.output.length, changed, changedElements: changedCells.length, copiedElements,
            sourceLayout: `OVN order ${layer.record.orders.O}`, targetLayout: `IVN order ${next.record.orders.I}`,
            sourceCells, targetCells, changedCells, routeEligible, switched,
            saCopyCycles: copyCycles, featherCopyCycles: switched ? 0 : copyCycles,
            configCycles: switched ? options.configCycles : 0, note};
    }
    function build(presetId, options = {}) {
        const config = optionsOf(options), preset = data.presets.find(item => item.id === presetId);
        check(preset, "Unknown workload chain");
        const layers = [];
        for (const [index, id] of preset.layers.entries()) {
            const prior = layers[index - 1];
            const layer = buildLayer(id, config, prior?.output, index);
            if (prior) check(prior.shape.M === layer.shape.M && prior.shape.N === layer.shape.K, "Broken GEMM-chain dependency");
            layers.push(layer);
        }
        const boundaries = layers.slice(0, -1).map((layer, i) => boundaryFor(layer, layers[i + 1], i, config));
        const totals = {}, timeline = {};
        for (const architecture of ["systolic", "feather"]) {
            const total = {cycles: 0, computeCycles: 0, copyCycles: 0, configCycles: 0, macs: 0}, track = [];
            for (const layer of layers) {
                const run = layer[architecture];
                track.push({kind: "layer", layerIndex: layer.index, start: total.cycles, end: total.cycles + run.cycles});
                total.cycles += run.cycles; total.computeCycles += run.cycles; total.macs += run.macs;
                const boundary = boundaries[layer.index];
                if (boundary) {
                    const copy = architecture === "feather" ? boundary.featherCopyCycles : boundary.saCopyCycles;
                    const configCost = architecture === "feather" ? boundary.configCycles : 0;
                    if (copy) track.push({kind: "layout copy", layerIndex: layer.index, boundary, start: total.cycles, end: total.cycles + copy});
                    total.cycles += copy; total.copyCycles += copy;
                    if (configCost) track.push({kind: "configure RIR", layerIndex: layer.index, boundary, start: total.cycles, end: total.cycles + configCost});
                    total.cycles += configCost; total.configCycles += configCost;
                }
            }
            total.utilization = total.macs / (PE_COUNT * total.cycles);
            totals[architecture] = total; timeline[architecture] = track;
        }
        return {preset, options: config, layers, boundaries, totals, timeline, cycles: Math.max(totals.systolic.cycles, totals.feather.cycles)};
    }
    function locate(chain, architecture, requestedCycle) {
        check(["systolic", "feather"].includes(architecture), "Unknown architecture");
        const cycle = Math.max(0, Math.floor(requestedCycle)), track = chain.timeline[architecture];
        const event = track.find(item => cycle >= item.start && cycle < item.end);
        if (!event) {
            const layer = chain.layers[chain.layers.length - 1], run = layer[architecture];
            const final = snapshot(run, run.cycles - 1);
            return {layerIndex: layer.index, phase: "done", localCycle: run.cycles - 1,
                snapshot: {...final, active: 0, macs: [], partials: [], network: [], writes: [], pe: final.pe.map(pe => ({...pe, active: false}))}, boundary: null, progress: 1};
        }
        const localCycle = cycle - event.start, layer = chain.layers[event.layerIndex];
        const final = snapshot(layer[architecture], event.kind === "layer" ? localCycle : layer[architecture].cycles - 1);
        return {layerIndex: event.layerIndex, phase: event.kind === "layer" ? final.phase : event.kind, localCycle,
            snapshot: event.kind === "layer" ? final : {...final, active: 0, macs: [], partials: [], network: [], writes: [], pe: final.pe.map(pe => ({...pe, active: false}))},
            boundary: event.boundary || null, progress: localCycle / Math.max(1, event.end - event.start - 1)};
    }
    const api = {data, defaults, presets: () => data.presets, build, buildLayer, snapshot, locate};
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.FeatherComparisonModel = api;
})(typeof window !== "undefined" ? window : globalThis);
