#!/usr/bin/env node
/* Offline visual regression for concurrent NEST input and column-bus/BIRRD
 * packets. --html accepts the standalone page or tutorial wrapper. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const args = process.argv.slice(2), option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const html = path.resolve(option("--html", path.join(__dirname, "../QWEN3_MINISA_VISUALIZER.html")));
let assertions = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function check(value, label) { assert(value, label); assertions++; }
function sample(kind, first, second) {
    const h = (Math.imul(first + 1, 1103515245) ^ Math.imul(second + 1, 12345) ^ (kind === "I" ? 0x13579bdf : 0x2468ace0)) >>> 0;
    return ((h >>> 5) & 1 ? -1 : 1) * (1 + ((h >>> 8) & 1023) / 1024) * 2 ** (12 + ((h >>> 20) % 6) - 15);
}
function partial(row, col, group, lane) {
    const m = 4 * group + Math.floor(col % 8 / 2), n = row + 16 * (col % 2), firstK = 16 * Math.floor(col / 8);
    let result = 0;
    for (let k = firstK; k <= firstK + lane; k++) result = Math.fround(result + Math.fround(sample("I", m, k) * sample("W", k, n)));
    return result;
}
(async () => {
    const output = option("--out", await fs.mkdtemp(path.join(os.tmpdir(), "feather-pipeline-browser-")));
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, reducedMotion: "no-preference"});
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await context.route(/^https?:\/\//, route => route.abort());
    const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
    const click = id => page.locator(`#${id}`).click();
    const run = ms => page.clock.runFor(ms);
    const seekCycle = (cycle, fraction = 1) => page.evaluate(({cycle, fraction}) => {
        const frames = FeatherACTTeaching.inspect().trace.frames;
        FeatherACTTeaching.seek(frames.findIndex(frame => frame.phase === "pipeline" && frame.cycle === cycle), fraction);
    }, {cycle, fraction});
    const snapshot = () => page.evaluate(() => {
        const s = FeatherACTTeaching.inspect();
        return {index: s.index, fraction: s.fraction, playing: s.playing, frame: s.frame, tokens: s.tokens,
            residentWeights: s.residentWeights, rowValues: s.rowValues, committedIndices: s.committedIndices,
            reducedMotion: s.reducedMotion, effectiveFraction: s.effectiveFraction};
    });
    const digest = () => page.locator("#act-teach-canvas").evaluate(canvas => {
        const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        return hash;
    });
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href);
        await page.waitForFunction(() => window.FeatherACTTeaching && window.FeatherPipeline);
        const route = await page.locator("#case-data").evaluate(node => JSON.parse(node.textContent).birrd.commands.find(command => command.reduction_width === 2));
        function networkBefore(row, group, stage) {
            let values = Array.from({length: 16}, (_, col) => partial(row, col, group, 15));
            for (let s = 0; s < stage; s++) {
                const next = Array(16);
                for (const node of route.stages[s].nodes) {
                    const [a, b] = node.input_ports.map(port => values[port]);
                    const output = [[a, b], [Math.fround(a + b), b], [a, Math.fround(a + b)], [b, a]][node.command];
                    node.output_ports.forEach((port, side) => { next[port] = output[side]; });
                }
                values = next;
            }
            return values;
        }
        await select("act-teach-case", "prefill_q_proj_N320"); await select("act-teach-mode", "array");
        await seekCycle(15);
        let state = await snapshot();
        equal(state.tokens.filter(token => token.operand === "I").length, 256, "cycle 15 streams one distinct lane into each of 256 PEs");
        equal(state.frame.completed, [{row: 0, group: 0}], "first row completes at cycle 15 while other rows still compute");
        equal(state.tokens.filter(token => token.path === "column-bus").length, 0, "registered column bus does not capture an unfinished accumulator");
        for (const token of state.tokens.filter(token => token.operand === "I")) {
            const m = Math.floor(token.col % 8 / 2), k = 16 * Math.floor(token.col / 8) + 15 - token.row;
            equal([token.group, token.lane, token.identity, token.value], [0, 15 - token.row, `A[${m},${k}]`, sample("I", m, k)],
                "drawn source identity/value follows the exact row's skewed MAC lane");
            equal(token.previousRow, token.row > 0 ? token.row - 1 : null, "each input records its immediate upstream PE row");
            equal(token.bufferSource, {x: 54 + (token.bank + .5) * 478 / 16, y: 78 + (token.scalarRow + .5) * 74 / 64},
                "propagated input retains the exact original physical streaming-buffer position");
            if (token.row > 0) {
                const x = 72 + token.col * 60 + 19;
                equal(token.source, {x, y: 220 + (token.row - 1) * 22 + 16}, "lower-row input starts at the preceding PE bottom, not a fresh buffer fanout");
                equal(token.destination, {x, y: 220 + token.row * 22 + 8}, "input propagates vertically into the current PE");
            } else equal(token.source, token.bufferSource, "row zero begins the stream at the actual buffer cell");
        }
        for (const cell of state.rowValues) equal(cell.value, partial(cell.row, cell.col, 0, 15 - cell.row), "PE text contains its independently accumulated row-specific value");

        await seekCycle(16, 0.8); state = await snapshot();
        const firstBus = state.tokens.filter(token => token.path === "column-bus");
        equal(firstBus.length, 16, "first completed row occupies all 16 column buses");
        for (const token of firstBus) equal([token.row, token.group, token.value], [0, 0, partial(0, token.col, 0, 15)],
            "bus carries the captured completed group rather than the concurrently reset PE accumulator");
        check(state.tokens.some(token => token.operand === "I" && token.row === 0 && token.group === 1 && token.lane === 0),
            "same physical row starts its next dot product while its previous partial exits");
        check(state.tokens.some(token => token.operand === "I" && token.row === 15 && token.group === 0 && token.lane === 1),
            "last row still consumes the prior dot product while row zero advances");

        await seekCycle(25, .2); const before = await snapshot(), beforePixels = await digest();
        await seekCycle(25, .55); const after = await snapshot();
        for (const kind of ["I", "P", "O"]) {
            const left = before.tokens.filter(token => token.operand === kind), right = after.tokens.filter(token => token.operand === kind);
            check(left.length > 0, `same frame contains moving ${kind} packets`);
            equal(left.map(token => token.identity), right.map(token => token.identity), `${kind} packet identity remains stable during motion`);
            check(left.some((token, index) => token.x !== right[index].x || token.y !== right[index].y), `${kind} packet physically travels while other paths are active`);
        }
        check(await digest() !== beforePixels, "concurrent input/bus/network/output movement changes the actual canvas pixels");
        equal(before.residentWeights, after.residentWeights, "all stationary weight markers/values stay fixed within a MAC beat");
        equal(before.committedIndices, [], "OB has not written before the first result arrives");
        equal(after.committedIndices, [], "first result remains in flight until arrival threshold");
        equal([...new Set(after.tokens.filter(token => token.path === "birrd").map(token => token.stage))],
            [0, 1, 2, 3, 4, 5, 6, 7], "all eight BIRRD stages concurrently carry different row waves");
        for (let stage = 0; stage < 8; stage++) equal([...new Set(after.tokens.filter(token => token.stage === stage).map(token => token.row))],
            [8 - stage], "stage wave has the correct registered row identity");
        for (const token of after.tokens.filter(token => token.path === "birrd")) equal(token.value,
            networkBefore(token.row, token.group, token.stage)[token.port], "each moving BIRRD token carries the independently routed row/group value");
        for (const token of after.tokens.filter(token => token.path === "output-write")) equal(token.value,
            Math.fround(partial(token.row, token.port, token.group, 15) + partial(token.row, token.port + 8, token.group, 15)),
            "concurrent output packet is the correct K-split reduction, not a newer in-flight group");
        await seekCycle(25, .8); state = await snapshot();
        equal(state.committedIndices.length, 8, "exactly the first row's eight real output addresses become visible on arrival");
        for (const token of state.tokens.filter(token => token.path === "output-write")) {
            equal([token.x, token.y], [token.destination.x, token.destination.y], "completed result is inside its exact physical buffer cell");
            check(token.x >= 90 && token.x <= 1038 && token.y >= 966 && token.y <= 1066, "result does not exceed the output buffer rectangle");
        }
        await page.locator("#act-teaching").screenshot({path: path.join(output, "parallel-streaming-birrd.png")});
        await seekCycle(32); state = await snapshot();
        equal(state.frame.inject, {row: 0, group: 1}, "next completed row-zero wave takes the column bus at cycle 32");
        for (const cell of state.rowValues) {
            const expectedGroup = cell.row === 0 ? 2 : 1, expectedLane = cell.row === 0 ? 0 : 16 - cell.row;
            equal([cell.group, cell.lane, cell.value], [expectedGroup, expectedLane, partial(cell.row, cell.col, expectedGroup, expectedLane)],
                "per-row accumulator display does not adopt row zero's newer group prematurely");
        }
        await select("act-teach-mode", "single"); await seekCycle(16, .5); state = await snapshot();
        check(state.tokens.some(token => token.operand === "I" && token.focused), "spotlight still shows the selected row's next input");
        check(state.tokens.some(token => token.path === "column-bus" && token.focused), "spotlight simultaneously shows that row's prior completed output");
        check(state.tokens.some(token => token.operand === "I" && !token.focused && token.opacity < 1), "spotlight preserves background concurrent-row streaming");

        const cases = await page.locator("#case-data").evaluate(node => JSON.parse(node.textContent).act_cases.cases.map(item => item.id));
        for (const id of cases) {
            await select("operator", `act:${id}`);
            await page.evaluate(() => {
                const frames = FeatherFullWorkloads.inspect().teaching.trace.frames;
                const index = frames.findIndex(frame => frame.phase === "pipeline" && frame.macs.length && frame.inject && frame.stages.length);
                const range = document.getElementById("full-teach-scrub"); range.value = String(index); range.dispatchEvent(new Event("input", {bubbles: true}));
            });
            const full = await page.evaluate(() => {
                const s = FeatherFullWorkloads.inspect().teaching;
                return {phase: s.frame.phase, tokens: s.tokens, cycle: s.frame.cycle};
            });
            equal(full.phase, "pipeline", `${id}: full-workload public animation uses the overlapping timeline`);
            check(full.tokens.some(token => token.operand === "I") && full.tokens.some(token => token.path === "column-bus") && full.tokens.some(token => token.path === "birrd"),
                `${id}: input, column bus and BIRRD packets coexist in one rendered frame`);
        }
        await select("act-teach-case", "decode_attention_pv_L769"); await click("act-teach-last-k"); await select("act-teach-mode", "array");
        await seekCycle(1); state = await snapshot();
        check(state.tokens.some(token => token.operand === "I" && token.row === 1 && token.lane === 0), "one-lane K tail still staggers row-one input after row zero");
        check(state.tokens.some(token => token.path === "column-bus" && token.row === 0), "one-lane tail overlaps next row's MAC and completed prior-row output");

        await select("operator", "0"); await select("dataflow-mode", "array");
        await page.locator("#array-frame").evaluate(node => { node.value = "28"; node.dispatchEvent(new Event("input", {bubbles: true})); });
        const legacy = await page.locator("#nest").evaluate(node => ({phase: node.dataset.arrayPhase, cycle: Number(node.dataset.arrayCycle),
            tokens: JSON.parse(node.dataset.arrayTokens), rows: JSON.parse(node.dataset.arrayRowValues)}));
        equal(legacy.phase, "pipeline", "original nine demonstration canvas also uses overlapped scheduling");
        equal(legacy.cycle, 25, "legacy timeline uses the same post-preload logical cycle origin");
        check(legacy.tokens.some(token => token.operand === "I") && legacy.tokens.some(token => token.operand === "P") && legacy.tokens.some(token => token.operand === "O"),
            "original whole-array renderer shows simultaneous inputs, partials, and arriving outputs");
        equal(legacy.rows.length, 256, "legacy canvas reports all 256 independently drawn accumulators");
        for (const cell of legacy.rows) {
            const group = Math.floor((25 - cell.row) / 16), lane = (25 - cell.row) % 16;
            equal([cell.group, cell.lane, cell.value], [group, lane, partial(cell.row, cell.col, group, lane)],
                "legacy canvas accumulator is independently correct for its row, group and lane");
        }

        await select("act-teach-case", "prefill_q_proj_N320"); await seekCycle(25, .2); await click("act-teach-play"); await run(70);
        await click("array-play"); equal((await snapshot()).playing, false, "legacy array playback cancels the ACT pipeline clock");
        await click("act-teach-play"); equal(await page.locator("#array-status").getAttribute("data-playing"), "false", "ACT pipeline playback cancels legacy array clock");
        await page.evaluate(() => { Object.defineProperty(document, "hidden", {value: true, configurable: true}); document.dispatchEvent(new Event("visibilitychange")); });
        equal((await snapshot()).playing, false, "hidden document cancels in-flight pipeline animation");
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        await page.emulateMedia({reducedMotion: "reduce"}); await seekCycle(25, 0); await click("act-teach-play");
        const stationary = await digest(); await run(100);
        equal(await digest(), stationary, "reduced-motion rendering does not interpolate any concurrent packets");
        equal((await snapshot()).effectiveFraction, 1, "reduced motion renders completed discrete cycle events");
        await click("act-teach-play"); await page.setViewportSize({width: 390, height: 844});
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "pipeline view fits a mobile viewport");
        await page.locator("#act-teaching").screenshot({path: path.join(output, "parallel-mobile.png")});
        equal(errors, [], "parallel playback and all workload selections have no browser exceptions");
        const result = {html, assertions, ACT_workloads: cases.length, errors, output};
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
