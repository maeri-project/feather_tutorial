#!/usr/bin/env node
/* Real-browser checks for the standalone Qwen3 explorer. No npm files or browser
 * artifacts are written to the repository. Install Playwright externally, then:
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node \
 *   tests/qwen_visualizer_browser_test.cjs --out /tmp/browser/results
 * Optional: --html /absolute/path/to/QWEN3_MINISA_VISUALIZER.html
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const args = process.argv.slice(2);
function argument(name, fallback) {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    assert(args[index + 1] && !args[index + 1].startsWith("--"), `${name} needs a value`);
    return args[index + 1];
}
const repository = path.resolve(__dirname, "..");
const html = path.resolve(argument("--html", path.join(repository,
    "QWEN3_MINISA_VISUALIZER.html")));
let assertions = 0;
function equal(actual, expected, message) {
    assert.deepEqual(actual, expected, message);
    assertions++;
}
function check(value, message) {
    assert(value, message);
    assertions++;
}

// Independent coefficient simulation: do not use the visualizer's switch helper.
function switchDependencies(code) {
    return [[[0], [1]], [[0, 1], [1]], [[0], [0, 1]], [[1], [0]]][code];
}

function checkBirrd(data) {
    const birrd = data.birrd, width = birrd.AW;
    equal(width, 16, "deployed BIRRD width");
    equal(birrd.stage_count, 8, "eight registered BIRRD stages");
    const rotate = (value, bits, left) => left ?
        ((value << 1) | (value >> (bits - 1))) & ((1 << bits) - 1) :
        (value >> 1) | ((value & 1) << (bits - 1));
    function inputs(stage, sw) {
        if (stage === 0) return [2 * sw, 2 * sw + 1];
        if (stage === 4) return [2 * sw, 2 * sw + 1].map(value =>
            Number.parseInt(value.toString(2).padStart(4, "0").split("").reverse().join(""), 2));
        const exponent = stage < 4 ? stage - 1 : 7 - stage;
        const switches = 8 >> exponent, group = Math.floor(sw / switches), local = sw % switches;
        return [2 * local, 2 * local + 1].map(value =>
            rotate(value, 4 - exponent, stage < 4) + group * (16 >> exponent));
    }
    for (const mode of birrd.modes) equal(mode.output_dependencies,
        switchDependencies(mode.code), `EGG mode ${mode.code} dependencies`);
    for (let stage = 0; stage < 8; stage++) for (let sw = 0; sw < 8; sw++) {
        equal(birrd.wiring[stage][sw], inputs(stage, sw), `RTL permutation S${stage} E${sw}`);
    }
    for (const route of birrd.commands) {
        const packed = BigInt(`0x${route.command_hex.replace(/^0x/, "")}`);
        let coefficients = Array.from({length: width}, (_, port) =>
            Array.from({length: width}, (_, source) => Number(port === source)));
        for (let stage = 0; stage < 8; stage++) {
            const next = [];
            for (let sw = 0; sw < 8; sw++) {
                const command = Number((packed >> BigInt(16 * sw + 2 * (7 - stage))) & 3n);
                const node = route.stages[stage].nodes[sw];
                equal(node.command, command, "packed command bit order");
                equal(route.stage_commands[stage][sw], command, "stage command matrix");
                equal(node.input_ports, inputs(stage, sw), "exported node input ports");
                equal(node.output_ports, [2 * sw, 2 * sw + 1], "exported node output ports");
                const outputs = switchDependencies(command).map(dependencies =>
                    Array.from({length: width}, (_, source) => dependencies.reduce((sum, side) =>
                        sum + coefficients[node.input_ports[side]][source], 0)));
                equal(node.output_coefficients, outputs, "EGG coefficient multiplicity");
                equal(node.output_sources, outputs.map(vector => vector.flatMap((count, port) =>
                    count ? [port] : [])), "EGG source identities");
                next.push(...outputs);
            }
            coefficients = next;
        }
        equal(route.committed_output_ports, Array.from({length: route.G_r}, (_, i) => i),
            "only low Gr ports committed");
        for (const output of route.outputs) {
            equal(output.coefficients, coefficients[output.port], "raw BIRRD output coefficients");
            equal(output.source_columns, coefficients[output.port].flatMap((count, port) =>
                count ? [port] : []), "raw BIRRD source columns");
            equal(output.committed_to_ob, output.port < route.G_r, "OB commit mask");
            if (output.committed_to_ob) equal(output.coefficients,
                Array.from({length: width}, (_, i) => Number(i % route.G_r === output.port)),
                "committed output has each required summand exactly once");
        }
    }
    const pair = birrd.commands.find(route => route.reduction_width === 2);
    equal(pair.command_hex.replace(/^0x/, ""), "010001f0020c02c00ec30e000dc30d3c", "frozen pair command");
    equal(pair.outputs.slice(8).map(output => output.source_columns),
        [1, 12, 5, 8, 6, 11, 2, 15].map(port => [port]), "upper ports carry uncommitted copies");
}

// Pack by setting individual destination-word bits, independently of the
// frontend's binary-string concatenation, preserving cross-word fields.
function referencePacking(trace, isa) {
    const total = trace.reduce((sum, inst) => sum + isa.instructions[inst.op].width, 0);
    const words = Array(Math.ceil(total / 32)).fill(0), offsets = [], stored = [];
    let cursor = 0;
    for (const inst of trace) {
        const spec = isa.instructions[inst.op], encoded = {op: inst.op};
        offsets.push(cursor);
        for (const field of spec.fields) {
            const value = field.name === "opcode" ? spec.opcode : inst[field.name] - field.logical_trace_bias;
            assert(Number.isInteger(value) && value >= 0 && value < 2 ** field.width);
            if (field.name !== "opcode") encoded[field.name] = value;
            for (let bit = field.width - 1; bit >= 0; bit--, cursor++) {
                if (Math.floor(value / 2 ** bit) % 2) {
                    words[Math.floor(cursor / 32)] = (words[Math.floor(cursor / 32)] |
                        (1 << (31 - cursor % 32))) >>> 0;
                }
            }
        }
        stored.push(encoded);
    }
    return {words, bit_offsets: offsets, trace: stored, total_bits: total,
        pad_bits: (32 - total % 32) % 32, num_instructions: trace.length};
}

function halfValue(bits) {
    const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >> 10) & 31, mantissa = bits & 1023;
    return sign * (exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15));
}

function teachingSample(operand, first, second) {
    const hash = (Math.imul(first + 1, 1103515245) ^ Math.imul(second + 1, 12345) ^
        (operand === "I" ? 0x13579bdf : 0x2468ace0)) >>> 0;
    const bits = (((hash >>> 5) & 1) << 15) | ((12 + (hash >>> 20) % 6) << 10) | ((hash >>> 8) & 1023);
    return {bits, value: halfValue(bits)};
}

// Independently round these finite teaching results by finding the nearest
// representable half, rather than reusing the model's bit-shift conversion.
function nearestHalf(value) {
    const magnitude = Math.abs(value);
    assert(magnitude <= halfValue(0x7bff), "teaching result is finite FP16 range");
    let low = 0, high = 0x7bff;
    while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (halfValue(middle) <= magnitude) low = middle;
        else high = middle;
    }
    const a = magnitude - halfValue(low), b = halfValue(high) - magnitude;
    const chosen = a < b ? low : b < a ? high : low % 2 === 0 ? low : high;
    return (value < 0 ? 0x8000 : 0) | chosen;
}

function teachingReference(data, selection) {
    const {row, col, t, mTile, nTile, kTile} = selection, port = col % 8;
    const route = data.birrd.commands.find(command => command.reduction_width === 2);
    function compute(kIndex) {
        const partials = Array(16).fill(0), lanes = [];
        for (let lane = 0; lane < 16; lane++) {
            lanes.push(Array.from({length: 16}, (_, column) => {
                const m = 32 * mTile + 4 * t + Math.floor((column % 8) / 2);
                const n = 32 * nTile + row + 16 * (column % 2), k = 32 * kIndex + 16 * Math.floor(column / 8) + lane;
                const a = teachingSample("I", m, k), b = teachingSample("W", k, n);
                const product = Math.fround(a.value * b.value), before = partials[column];
                const after = Math.fround(before + product); partials[column] = after;
                return {col: column, m, n, k, a: a.value, b: b.value, product, before, after};
            }));
        }
        return {partials, lanes};
    }
    let prior = 0;
    for (let previous = 0; previous < kTile; previous++) {
        const partials = compute(previous).partials;
        prior = Math.fround(prior + Math.fround(partials[port] + partials[port + 8]));
    }
    const current = compute(kTile), stages = [];
    let values = current.partials;
    for (const stage of route.stages) {
        const next = Array(16);
        for (const node of stage.nodes) {
            switchDependencies(node.command).forEach((sides, side) => {
                const operands = sides.map(input => values[node.input_ports[input]]);
                next[node.output_ports[side]] = operands.length === 1 ? operands[0] : Math.fround(operands[0] + operands[1]);
            });
        }
        stages.push({before: values, after: next}); values = next;
    }
    const partial = values[port], final = Math.fround(prior + partial);
    return {...current, stages, prior, partial, final, fp16: nearestHalf(final), port,
        m: current.lanes[0][col].m, n: current.lanes[0][col].n};
}

async function checkAnimation(browser, output, data, errors, externalRequests) {
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, reducedMotion: "no-preference"});
    await context.route(/^https?:\/\//, async route => { externalRequests.push(route.request().url()); await route.abort(); });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const screenshots = ["animation-flow-a.png", "animation-flow-b.png", "animation-mac.png",
        "animation-birrd.png", "animation-store.png", "animation-mobile.png"];
    const state = () => page.locator("#motion-status").evaluate(node => ({...node.dataset}));
    const canvasState = () => page.locator("#nest").evaluate(node => ({...node.dataset}));
    const read = id => page.locator(`#${id}`).innerText();
    const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
    const click = id => page.locator(`#${id}`).click();
    const advance = milliseconds => page.clock.runFor(milliseconds);
    async function scrub(index) {
        await page.locator("#motion-frame").evaluate((node, value) => {
            node.value = String(value); node.dispatchEvent(new Event("input", {bubbles: true}));
        }, index);
    }
    async function tile(axis, number) {
        const node = page.locator(`#tile-${axis}`); await node.fill(String(number)); await node.press("Tab");
    }
    async function pixels(rectangle = [10, 40, 320, 110]) {
        return page.locator("#nest").evaluate((canvas, rect) => {
            const bytes = canvas.getContext("2d").getImageData(...rect).data;
            let hash = 2166136261;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            return hash;
        }, rectangle);
    }
    async function noOverflow(label) {
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth &&
            document.body.scrollWidth <= innerWidth), `${label}: animated page fits viewport`);
    }
    function scalarAddress(operand, column, lane, selection) {
        const design = data.tile_designs.find(item => item.id === data.operators[7].design_id);
        const m = 4 * selection.t + Math.floor((column % 8) / 2);
        const n = selection.row + 16 * (column % 2), kg = Math.floor(column / 8);
        const logical = operand === "I" ? [m, kg] : [kg, n];
        for (const bank of design.operand_maps[operand].banks) {
            const vn = bank.vns.find(item => item.logical.every((value, i) => value === logical[i]));
            if (vn) return {bank: bank.bank, scalarRow: vn.scalar_row_base + lane};
        }
        assert.fail(`missing independent ${operand} VN address`);
    }
    try {
        // Fake only this page's clock; the original regression keeps real time.
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.addInitScript(() => {
            const prototype = CanvasRenderingContext2D.prototype;
            const clear = prototype.clearRect, fill = prototype.fillText;
            window.__elementLabels = [];
            prototype.clearRect = function (...args) {
                if (this.canvas.id === "nest") window.__elementLabels = [];
                return clear.apply(this, args);
            };
            prototype.fillText = function (label, ...args) {
                if (this.canvas.id === "nest") window.__elementLabels.push(String(label));
                return fill.call(this, label, ...args);
            };
        });
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"});
        equal((await state()).phase, "inactive", "data animation does not autoplay");
        equal((await state()).playing, "false", "data clock initially paused");
        await advance(2000);
        equal((await state()).phase, "inactive", "idle page never starts animation");
        check(await page.locator("#motion-frame").getAttribute("aria-label"), "animation scrubber has accessible name");
        check(await page.locator("#motion-next").getAttribute("aria-label"), "animation step has accessible name");

        await select("dataflow-mode", "single");
        await select("motion-speed", 900); await click("motion-play");
        await advance(160);
        const first = await state(), firstPixels = await pixels(), statusText = await read("motion-status");
        const firstElements = JSON.parse((await canvasState()).elementTokens);
        await page.locator("#nest").screenshot({path: path.join(output, screenshots[0])});
        await advance(160);
        const second = await state(), secondPixels = await pixels();
        const secondElements = JSON.parse((await canvasState()).elementTokens);
        await page.locator("#nest").screenshot({path: path.join(output, screenshots[1])});
        equal([first.phase, second.phase, first.frame, second.frame], ["load_input", "load_input", "0", "0"],
            "two smooth samples stay in the same logical phase");
        check(Number(second.fraction) > Number(first.fraction) && Number(second.fraction) < 1,
            "rAF advances fractional token travel");
        check(firstPixels !== secondPixels, "moving token changes datapath pixels independently of step labels");
        check(firstElements.length > 0, "moving input packet names its individual scalar");
        equal(secondElements.map(item => item.identity), firstElements.map(item => item.identity),
            "scalar identity is stable while the packet moves");
        check(secondElements.some((item, i) => item.x !== firstElements[i].x || item.y !== firstElements[i].y),
            "the same identified scalar changes physical screen position");
        equal(await read("motion-status"), statusText, "smooth travel does not churn live-region text");
        check(Number((await canvasState()).tokenCount) > 0, "canvas paints actual numeric tokens");
        await click("motion-play");
        const paused = await state(), pausedPixels = await pixels();
        await advance(1800);
        equal(await state(), paused, "paused motion state stays fixed");
        equal(await pixels(), pausedPixels, "paused token pixels stay fixed");
        await click("motion-play"); await advance(160);
        check(Number((await state()).fraction) > Number(paused.fraction), "resume continues fractional progress");
        await click("motion-play");
        const distances = [];
        for (const speed of [900, 180]) {
            await click("motion-reset"); await select("motion-speed", speed); await click("motion-play");
            await advance(900);
            const value = await state(); distances.push(Number(value.frame) + Number(value.fraction));
            await click("motion-play");
        }
        check(distances[1] > distances[0] * 3, "fast setting advances farther in equal elapsed time");
        await click("motion-reset");
        equal([(await state()).frame, (await state()).fraction, (await state()).playing], ["0", "0", "false"],
            "animation reset returns to unstarted input load");
        await click("motion-next"); equal((await state()).frame, "1", "animation next advances exactly one step");
        await click("motion-back"); equal((await state()).frame, "0", "animation back reverses one step");
        check(await page.locator("#motion-back").isDisabled(), "animation back stops at frame zero");
        await page.locator("#motion-frame").focus(); await page.keyboard.press("ArrowRight");
        equal((await state()).frame, "1", "animation scrubber works from keyboard");
        await page.locator("#motion-play").focus(); await page.keyboard.press("Space");
        equal((await state()).playing, "true", "keyboard can start animation");
        await page.keyboard.press("Space"); equal((await state()).playing, "false", "keyboard can pause animation");

        const selections = [
            {row: 0, col: 0, t: 0, mTile: 0, nTile: 0, kTile: 0},
            {row: 7, col: 11, t: 3, mTile: 1, nTile: 2, kTile: 1},
            {row: 15, col: 15, t: 7, mTile: 3, nTile: 3, kTile: 3},
        ];
        for (const selection of selections) {
            await select("operator", 7);
            for (const axis of ["m", "n", "k"]) await tile(axis, selection[`${axis}Tile`]);
            await select("dot-index", selection.t); await select("pe-row", selection.row); await select("pe-col", selection.col);
            const expected = teachingReference(data, selection), selectedColumns = [expected.port, expected.port + 8];
            await scrub(0);
            const elements = await page.locator("#motion-elements button").evaluateAll(nodes => nodes.map(node => ({...node.dataset})));
            equal(elements.length, 64, "two K groups expose every individual input and weight lane");
            equal(new Set(elements.map(item => `${item.operand}/${item.col}/${item.lane}`)).size, 64,
                "scalar lane buttons are unique by operand, source column and lane");
            for (const element of elements) {
                const column = Number(element.col), lane = Number(element.lane), operand = element.operand;
                check(selectedColumns.includes(column), "scalar lane belongs to one selected K-reduction source");
                check(["I", "W"].includes(operand) && lane >= 0 && lane < 16, "scalar lane has legal operand and index");
                const scalar = expected.lanes[lane][column], address = scalarAddress(operand, column, lane, selection);
                equal(element.identity, operand === "I" ? `A[${scalar.m},${scalar.k}]` : `B[${scalar.k},${scalar.n}]`,
                    "every scalar button displays the exact global tensor coordinate");
                equal([Number(element.bank), Number(element.scalarRow)], [address.bank, address.scalarRow],
                    "every scalar button resolves through compiler-exported physical VN mapping");
            }
            const picked = page.locator(`#motion-elements button[data-operand="W"][data-col="${selectedColumns[1]}"][data-lane="15"]`);
            await picked.click();
            equal((await state()).frame, "18", "clicking an individual stored weight selects its exact MAC lane");
            equal((await state()).playing, "false", "scalar inspection leaves animation paused");
            for (let index = 0; index < 3; index++) {
                await scrub(index);
                equal((await state()).phase, ["load_input", "load_weight", "preload"][index], "DMA/preload animation order");
                check(!(await read("motion-network")).includes("Store bits:"), "no Store before computation");
            }
            await select("motion-speed", 900); await click("motion-play"); await advance(160);
            const macStart = JSON.parse((await canvasState()).elementTokens);
            await advance(160);
            const macEnd = JSON.parse((await canvasState()).elementTokens);
            equal((await state()).frame, "3", "moving scalar test remains on the first MAC lane");
            for (const operand of ["I", "W"]) {
                const before = macStart.filter(item => item.operand === operand), after = macEnd.filter(item => item.operand === operand);
                equal(before.length, 2, "both K-split source columns show the individual operand");
                equal(after.map(item => item.identity), before.map(item => item.identity), "individual operand identities persist during MAC travel");
                equal(after.map(item => item.stationary), [operand === "W", operand === "W"], "only PE-resident weights are stationary");
                equal(after.every((item, i) => item.x === before[i].x && item.y === before[i].y), operand === "W",
                    "A scalars travel while B scalars remain held in the PE");
            }
            await click("motion-play");
            for (let lane = 0; lane < 16; lane++) {
                await scrub(3 + lane);
                const expectedText = selectedColumns.map(column => {
                    const p = expected.lanes[lane][column];
                    return `col ${p.col}: A[${p.m},${p.k}]=${p.a} × B[${p.k},${p.n}]=${p.b}\n` +
                        `FP32 product ${p.product}; accumulator ${p.before} → ${p.after}`;
                }).join("\n\n");
                equal(await read("motion-values"), expectedText, "displayed FP16 inputs and each FP32 MAC are independently correct");
                equal((await state()).phase, "mac", "sixteen MAC phases");
                equal((await canvasState()).motionFrame, String(3 + lane), "canvas follows arithmetic lane");
                const highlighted = await page.locator("#motion-elements button.current-element").evaluateAll(nodes => nodes.map(node => ({
                    ...node.dataset, pressed: node.getAttribute("aria-pressed"),
                })));
                equal(highlighted.length, 4, "both A/B scalars in both K groups are highlighted for the current MAC");
                check(highlighted.every(item => Number(item.lane) === lane && item.pressed === "true"),
                    "VN lane highlighting follows the compute lane accessibly");
                const detail = await read("motion-element-detail");
                const paintedLabels = await page.evaluate(() => window.__elementLabels);
                for (const column of selectedColumns) {
                    const scalar = expected.lanes[lane][column];
                    for (const [operand, identity] of [["I", `A[${scalar.m},${scalar.k}]`], ["W", `B[${scalar.k},${scalar.n}]`]]) {
                        check(detail.includes(identity), "scalar detail preserves coordinate identity");
                        check(paintedLabels.some(label => label.includes(identity)),
                            "canvas paints the individual tensor identity, not just an anonymous value");
                        const address = scalarAddress(operand, column, lane, selection);
                        check(detail.includes(`bank ${address.bank}`) && detail.includes(`scalar row ${address.scalarRow}`),
                            "scalar detail exposes its physical bank and scalar row");
                    }
                }
                if (selection.kTile === 3 && lane === 9) await page.screenshot({path: path.join(output, screenshots[2]), fullPage: true});
            }
            await scrub(19); equal((await state()).phase, "autopick", "column collection follows the final MAC");
            for (let stage = 0; stage < 8; stage++) {
                await scrub(20 + stage);
                equal((await state()).phase, "birrd", "BIRRD stage animation");
                const displayed = await read("motion-network");
                check(displayed.startsWith(`Stage ${stage}:`), "BIRRD stages arrive in order");
                const parse = name => displayed.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))[1].split(", ").map(Number);
                equal(parse("in"), expected.stages[stage].before, "all 16 BIRRD input values");
                equal(parse("out"), expected.stages[stage].after, "all 16 programmed BIRRD output values");
                const packets = JSON.parse((await canvasState()).elementTokens);
                check(packets.every(item => item.operand === "P" && item.identity.endsWith(`→C[${expected.m},${expected.n}]`)),
                    "routed partials retain the originating individual result identity");
                check(!displayed.includes("Store bits:"), "no Store during BIRRD traversal");
                if (selection.kTile === 3 && stage === 3) await page.screenshot({path: path.join(output, screenshots[3]), fullPage: true});
            }
            await scrub(28);
            equal((await state()).phase, "ob", "OB follows eighth BIRRD stage");
            equal(await read("motion-network"), `OB C[${expected.m},${expected.n}]: previous K tiles + routed partial\n` +
                `${expected.prior} + ${expected.partial} → ${expected.final} (FP32)`, "OB accumulated prior K tiles independently checked");
            const resultPacket = JSON.parse((await canvasState()).elementTokens);
            equal(resultPacket.map(item => item.identity), [`C[${expected.m},${expected.n}]`], "OB packet identifies the exact scalar C destination");
            equal([resultPacket[0].bank, resultPacket[0].scalarRow], [Number((await canvasState()).obBank), Number((await canvasState()).obRow)],
                "moving result scalar and selected physical OB destination agree");
            await scrub(29);
            equal((await state()).phase, selection.kTile === 3 ? "store" : "hold", "Store gated by final K tile");
            if (selection.kTile === 3) {
                check((await read("motion-network")).includes(`Store bits: 0x${expected.fp16.toString(16).padStart(4, "0")}`),
                    "final Store matches independent nearest-even FP16 conversion");
                await page.screenshot({path: path.join(output, screenshots[4]), fullPage: true});
            } else check((await read("motion-network")).includes("no FP16 cast and no Store"), "non-final K preserves FP32 without casting");
            check(await page.locator("#motion-next").isDisabled(), "animation stops after Store/hold");
        }
        await select("motion-speed", 180); await scrub(28); await click("motion-play"); await advance(650);
        equal([(await state()).frame, (await state()).fraction, (await state()).playing], ["29", "1", "false"],
            "end-of-animation playback stops itself");
        await click("motion-play"); await advance(32);
        equal((await state()).frame, "0", "play after completion restarts from input load");
        await click("motion-play");

        await click("motion-reset"); await click("motion-play"); await advance(64);
        await click("tab-buffers");
        const tabPaused = await state(); await advance(1000);
        equal(await state(), tabPaused, "leaving dataflow panel cancels its clock");
        equal(tabPaused.playing, "false", "tab change pauses data animation");
        await click("tab-dataflow"); await click("motion-play"); await advance(64);
        await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {configurable: true, value: true});
            document.dispatchEvent(new Event("visibilitychange"));
        });
        const hidden = await state(); await advance(1000);
        equal(await state(), hidden, "hidden-document handler freezes animation");
        equal(hidden.playing, "false", "hidden-document handler pauses data clock");
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        equal((await state()).playing, "false", "visible again does not autoplay");
        for (const [id, value] of [["pe-row", "3"], ["pe-col", "9"], ["dot-index", "2"], ["lane-index", "5"], ["operator", "0"]]) {
            await click("motion-play"); await advance(32); await select(id, value);
            equal((await state()).phase, "inactive", `${id} invalidates old numeric selection`);
            equal((await state()).playing, "false", `${id} stops data clock`);
        }
        await click("motion-play"); await tile("k", 1);
        equal((await state()).phase, "inactive", "K tile edit invalidates old arithmetic trace");
        await click("play"); await advance(180); await click("motion-play");
        equal(await page.locator("#play").getAttribute("aria-pressed"), "false", "data Play stops overview Play");
        await click("play"); equal((await state()).playing, "false", "overview Play stops data Play");
        await click("play");
        await click("tab-program"); await select("program-scope", "tile");
        await click("generate-program"); await click("load-program"); await click("accelerator-run"); await advance(400);
        const beforeMotionPC = (await read("live-registers")).match(/^PC = (\d+)/m)[1];
        await click("motion-play"); await advance(500);
        equal((await read("live-registers")).match(/^PC = (\d+)/m)[1], beforeMotionPC, "data animation pauses ISA PC");
        equal(await read("accelerator-run"), "Run ISA", "ISA run button reflects paused clock");
        await click("accelerator-run"); await advance(400);
        equal((await state()).phase, "inactive", "ISA Run invalidates data animation");
        check(Number((await read("live-registers")).match(/^PC = (\d+)/m)[1]) > Number(beforeMotionPC), "ISA clock resumes separately");
        await click("accelerator-run"); await click("motion-play"); await click("accelerator-step");
        equal((await state()).playing, "false", "ISA Step cancels data clock");
        await click("motion-play"); await click("accelerator-reset");
        equal((await state()).phase, "inactive", "ISA reload/reset cancels numeric animation");

        await click("motion-play"); await advance(64);
        await page.emulateMedia({reducedMotion: "reduce"});
        // Chromium delivers MediaQueryList changes on its real rendering
        // lifecycle, outside the mocked page timer queue. Yield bounded wall
        // time as well as virtual time instead of assuming one rAF is enough.
        for (let attempt = 0; attempt < 40 && (await state()).reduced !== "true"; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25));
            await advance(32);
        }
        equal((await state()).reduced, "true", "media preference reaches the animation controller");
        equal((await state()).playing, "false", "changing reduced-motion preference pauses travel");
        await click("motion-reset"); await select("motion-speed", 900); await click("motion-play");
        equal((await state()).fraction, "1", "reduced motion uses static arrival snapshots");
        const reduced = await state(), reducedPixels = await pixels();
        await advance(400);
        equal(await state(), reduced, "reduced motion has no interpolated sub-step state");
        equal(await pixels(), reducedPixels, "reduced-motion pixels do not travel between steps");
        await advance(550);
        equal([(await state()).frame, (await state()).fraction], ["1", "1"], "reduced motion advances one discrete step");
        await click("motion-play"); await click("motion-next");
        equal((await state()).frame, "2", "reduced motion retains manual stepping");
        await scrub(23);
        await page.setViewportSize({width: 390, height: 844});
        await noOverflow("mobile animation and numeric readouts");
        await scrub(18);
        const visibleLanes = await page.locator("#motion-elements .motion-vn-scroll").evaluateAll(nodes => nodes.map(node => {
            const current = node.querySelector(".current-element").getBoundingClientRect(), bounds = node.getBoundingClientRect();
            return current.left >= bounds.left - 1 && current.right <= bounds.right + 1;
        }));
        equal(visibleLanes, [true, true, true, true], "mobile strips keep all selected individual scalar lanes visible");
        await scrub(23);
        await click("zoom-array"); await noOverflow("mobile enlarged animated graph"); await click("zoom-array");
        await page.screenshot({path: path.join(output, screenshots[5]), fullPage: true});
        return {status: "PASS", numeric_selections: selections, logical_frames: 30,
            reduced_motion: "discrete", clock: "Playwright controlled", screenshots};
    } catch (error) {
        await page.screenshot({path: path.join(output, "animation-failure.png"), fullPage: true}).catch(() => {});
        throw error;
    } finally {
        await context.close();
    }
}

async function main() {
    const output = path.resolve(argument("--out", null) || await fs.mkdtemp(
        path.join(os.tmpdir(), "minisa-visualizer-browser-")));
    // Tests must not introduce downloads, screenshots, or reports into the repo.
    check(output !== repository && !output.startsWith(repository + path.sep),
        "--out must be outside the repository");
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100},
        acceptDownloads: true, reducedMotion: "reduce"});
    const errors = [], externalRequests = [], groups = [];
    await context.route(/^https?:\/\//, async route => {
        externalRequests.push(route.request().url());
        await route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
        if (message.type() === "error") errors.push(message.text());
    });
    const text = selector => page.locator(selector).innerText();
    const value = selector => page.locator(selector).inputValue();
    async function select(id, selected) {
        await page.locator(`#${id}`).selectOption(String(selected));
    }
    async function tile(axis, selected) {
        const input = page.locator(`#tile-${axis}`);
        await input.fill(String(selected));
        await input.press("Tab");
    }
    async function tab(name) {
        await page.locator(`#tab-${name}`).click();
        for (const candidate of ["dataflow", "buffers", "program"]) {
            equal(await page.locator(`#tab-${candidate}`).getAttribute("aria-selected"),
                String(candidate === name), `selected ${name} tab`);
            equal(await page.locator(`#panel-${candidate}`).isVisible(),
                candidate === name, `visible ${name} panel`);
        }
    }
    async function frame(index) {
        await page.locator("#frame").evaluate((input, selected) => {
            input.value = String(selected);
            input.dispatchEvent(new Event("input", {bubbles: true}));
        }, index);
    }
    async function noOverflow(label) {
        const dimensions = await page.evaluate(() => ({
            viewport: innerWidth, root: document.documentElement.scrollWidth,
            body: document.body.scrollWidth,
        }));
        check(dimensions.root <= dimensions.viewport && dimensions.body <= dimensions.viewport,
            `${label}: horizontal page overflow ${JSON.stringify(dimensions)}`);
    }
    async function canvasPainted(selector) {
        const count = await page.locator(selector).evaluate(canvas => {
            const pixels = canvas.getContext("2d").getImageData(0, 0,
                canvas.width, canvas.height).data;
            let count = 0;
            for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
            return count;
        });
        check(count > 10000, `${selector} contains rendered content`);
    }
    try {
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"});
        const data = await page.locator("#case-data").evaluate(node => JSON.parse(node.textContent));
        equal(data.operators.length, 9, "nine operators embedded");
        equal(await page.locator("#operator option").evaluateAll(nodes => nodes.filter(node => /^\d+$/.test(node.value)).map(node => node.textContent)),
            data.operators.map(op => `${op.name} · prefill · ${op.shape.M} × ${op.shape.K} × ${op.shape.N}`), "all nine original operator options with explicit phase and shape");
        equal(await page.locator('#operator option[value^="act:"]').count(), 31, "all recorded and improved ACT workloads are available in the full-operator selector");
        equal(await page.locator("#operator option").count(), 40, "nine original and 31 ACT workload demonstrations are selectable");
        equal(await page.locator("#operator-table tbody tr").count(), 9, "nine table rows");
        checkBirrd(data);
        groups.push("independent RTL wiring, command decoding and symbolic BIRRD dependencies");
        console.log(`PASS ${groups[groups.length - 1]}`);

        async function programAt(op, position) {
            const design = data.tile_designs.find(item => item.id === op.design_id);
            const outputIndex = position.n * op.loop_counts.m + position.m;
            const computeIndex = outputIndex * op.loop_counts.k + position.k;
            const expected = design.logical_trace.filter(inst =>
                (inst.op !== "SetOVNLayout" || position.k === 0) &&
                (inst.op !== "Store" || position.k === op.loop_counts.k - 1));
            const actual = await page.locator("#instructions li").evaluateAll(nodes =>
                nodes.map(node => ({op: node.querySelector("strong").textContent,
                    fields: Object.fromEntries(node.querySelector("code").textContent.trim()
                        .split(/\s+/).map(field => {
                            const [key, value] = field.split("=");
                            return [key, Number(value)];
                        }))})));
            equal(actual.map(inst => inst.op), expected.map(inst => inst.op),
                `${op.name} K=${position.k} instruction sequence`);
            expected.forEach((instruction, index) => {
                const {op: name, ...fields} = instruction;
                if (name === "Load") fields.hbm_addr += computeIndex * op.tile.Mt * op.tile.Kt;
                if (name === "Store") fields.hbm_addr += outputIndex * op.tile.Mt * op.tile.Nt;
                equal(actual[index].fields, fields, `${op.name} ${name} decoded fields`);
                if (name === "Load" || name === "Store") {
                    check(Number.isSafeInteger(fields.hbm_addr) && fields.hbm_addr >= 0 &&
                        fields.hbm_addr < 2 ** 32, `${op.name} ${name} bounded address`);
                }
            });
        }

        for (let index = 0; index < data.operators.length; index++) {
            const op = data.operators[index], counts = op.loop_counts;
            await select("operator", index);
            await tab("dataflow");
            equal(await text("#shape"), [op.shape.M, op.shape.K, op.shape.N]
                .map(number => number.toLocaleString("en-US")).join(" × "), `${op.name} shape`);
            equal(await text("#cycles"), op.schedule_cost.total_cycles.toLocaleString("en-US"),
                `${op.name} cycle prediction`);
            for (const axis of ["n", "m", "k"]) equal(await value(`#tile-${axis}`), "0",
                `${op.name} starts at first ${axis} tile`);
            check(await page.locator("#previous-tile").isDisabled(), "previous clamped at start");

            // Every Cartesian first/last tile corner, including independent axes.
            for (const n of [0, counts.n - 1]) for (const m of [0, counts.m - 1]) {
                for (const k of [0, counts.k - 1]) {
                    for (const [axis, selected] of Object.entries({n, m, k})) await tile(axis, selected);
                    await select("dot-index", 7);
                    await select("lane-index", 15);
                    await select("pe-row", 15);
                    await select("pe-col", 15);
                    const origin = {m: m * op.tile.Mt, k: k * op.tile.Kt, n: n * op.tile.Nt};
                    const coordinates = await text("#pe-details");
                    for (const token of [`A[${origin.m + 31}, ${origin.k + 31}]`,
                        `B[${origin.k + 31}, ${origin.n + 31}]`,
                        `C[${origin.m + 31}, ${origin.n + 31}]`]) {
                        check(coordinates.includes(token), `${op.name} global PE endpoint ${token}`);
                    }
                    equal(await page.locator(".matrix-label").allTextContents(), [
                        `A[${origin.m}:${origin.m + 32}, ${origin.k}:${origin.k + 32}]`,
                        `B[${origin.k}:${origin.k + 32}, ${origin.n}:${origin.n + 32}]`,
                        `C[${origin.m}:${origin.m + 32}, ${origin.n}:${origin.n + 32}]`,
                    ], `${op.name} selected matrix slices`);
                    await programAt(op, {n, m, k});
                }
            }
            check(await page.locator("#next-tile").isDisabled(), "next clamped at end");
            const endpoint = await text("#pe-details");
            check(endpoint.includes(`A[${op.shape.M - 1}, ${op.shape.K - 1}]`) &&
                endpoint.includes(`B[${op.shape.K - 1}, ${op.shape.N - 1}]`) &&
                endpoint.includes(`C[${op.shape.M - 1}, ${op.shape.N - 1}]`),
                `${op.name} last global tensor elements`);

            await tab("buffers");
            const design = data.tile_designs.find(item => item.id === op.design_id);
            for (const operand of ["I", "W", "O"]) {
                await select("operand", operand);
                const buttons = page.locator("#buffer-table button");
                equal(await buttons.count(), 64, `${op.name} ${operand} has 64 clickable VNs`);
                equal(await page.locator("#buffer-table button.highlight").count(), 1,
                    `${op.name} ${operand} one selected VN`);
                const cells = await buttons.evaluateAll(nodes => nodes.map(node => ({
                    bank: Number(node.dataset.bank), row: Number(node.dataset.vnrow),
                    logical: node.textContent.split(",").map(Number),
                })));
                for (const cell of cells) {
                    const vn = design.operand_maps[operand].banks.find(bank => bank.bank === cell.bank)
                        .vns.find(vn => vn.vn_row === cell.row);
                    equal(cell.logical, vn.logical, `${op.name} ${operand} VN layout`);
                }
                // Exercise every cell for one full mapping; all operator endpoints thereafter.
                const clicked = index === 0 ? Array.from({length: 64}, (_, i) => i) : [0, 63];
                for (const cellIndex of clicked) {
                    const cell = cells[cellIndex];
                    const vn = design.operand_maps[operand].banks.find(bank => bank.bank === cell.bank)
                        .vns.find(vn => vn.vn_row === cell.row);
                    await buttons.nth(cellIndex).click();
                    const details = await text("#buffer-details");
                    check(details.includes(`bank ${cell.bank}, VN row ${cell.row}, scalar rows ` +
                        `${vn.scalar_row_base}…${vn.scalar_row_base + 15}`),
                    `${op.name} ${operand} clicked physical VN`);
                    const [first, second] = vn.logical;
                    const m = (counts.m - 1) * 32, k = (counts.k - 1) * 32, n = (counts.n - 1) * 32;
                    const global = operand === "I" ? `A[${m + first}, ${k + 16 * second}…${k + 16 * second + 15}]` :
                        operand === "W" ? `B[${k + 16 * first}…${k + 16 * first + 15}, ${n + second}]` :
                            `C[${m + first}, ${n + 16 * second}…${n + 16 * second + 15}]`;
                    check(details.includes(global), `${op.name} ${operand} clicked global VN`);
                }
            }
            await tab("program");
            for (const k of [0, 1, counts.k - 1]) {
                await tile("k", k);
                await programAt(op, {n: counts.n - 1, m: counts.m - 1, k});
            }
            // Untrusted numeric inputs cannot escape tensor or HBM extents.
            for (const axis of ["n", "m", "k"]) {
                await tile(axis, -999);
                equal(await value(`#tile-${axis}`), "0", `${op.name} negative ${axis} clamp`);
                await tile(axis, 999999);
                equal(await value(`#tile-${axis}`), String(counts[axis] - 1),
                    `${op.name} oversize ${axis} clamp`);
            }
            await programAt(op, {n: counts.n - 1, m: counts.m - 1, k: counts.k - 1});
            await noOverflow(`desktop ${op.name}`);
            groups.push(`${op.name}: 8 tile corners, K schedule, buffers, numeric clamps`);
            console.log(`PASS ${groups[groups.length - 1]}`);
        }

        await select("operator", 0);
        await tab("dataflow");
        await page.locator("#reset").click();
        equal(await value("#frame"), "0", "reset frame");
        for (const id of ["tile-n", "tile-m", "tile-k", "pe-row", "pe-col", "dot-index", "lane-index", "output-row"]) {
            equal(await value(`#${id}`), "0", `reset ${id}`);
        }
        await page.locator("#next-tile").click();
        equal(await value("#tile-k"), "1", "next follows innermost K loop");
        await page.locator("#previous-tile").click();
        equal(await value("#tile-k"), "0", "previous reverses K loop");
        await tile("k", data.operators[0].loop_counts.k - 1);
        await page.locator("#next-tile").click();
        equal([await value("#tile-m"), await value("#tile-k")], ["1", "0"], "K wraps into M");
        await page.locator("#reset").click();
        await page.locator("#step-next").click();
        equal(await value("#frame"), "1", "step next");
        await page.locator("#step-back").click();
        equal(await value("#frame"), "0", "step back");
        check(await page.locator("#step-back").isDisabled(), "step back stops at beginning");
        await frame(37);
        equal(await value("#frame"), "37", "scrub illustration");
        await select("speed", "50");
        await page.locator("#play").click();
        await page.waitForFunction(() => Number(document.getElementById("frame").value) > 37);
        await page.locator("#play").click();
        equal(await page.locator("#play").getAttribute("aria-pressed"), "false", "pause state");
        const paused = await value("#frame");
        await page.waitForTimeout(170);
        equal(await value("#frame"), paused, "paused frame stays still");
        await page.locator("#play").click();
        await tab("buffers");
        const tabPaused = await value("#frame");
        await page.waitForTimeout(170);
        equal(await value("#frame"), tabPaused, "tab change pauses playback");
        await tab("dataflow");
        const lastFrame = Number(await page.locator("#frame").getAttribute("max"));
        await frame(lastFrame - 1);
        await page.locator("#play").click();
        await page.waitForFunction(() => document.getElementById("play").getAttribute("aria-pressed") === "false");
        equal(await value("#frame"), String(lastFrame), "playback ends at final frame");
        check(await page.locator("#step-next").isDisabled(), "step next disabled at end");
        await page.locator("#play").click();
        await page.waitForFunction(() => Number(document.getElementById("frame").value) < 10);
        await page.locator("#play").click();
        check(Number(await value("#frame")) < 10, "play at end restarts illustration");
        await canvasPainted("#nest");
        // Click an actual drawn PE, not a synthetic state setter.
        const nest = await page.locator("#nest").boundingBox();
        const geometry = await page.locator("#nest").evaluate(canvas => ({
            width: canvas.width, height: canvas.height,
            x: Number(canvas.dataset.peX || 58), y: Number(canvas.dataset.peY || 121),
            dx: Number(canvas.dataset.peDx || 47), dy: Number(canvas.dataset.peDy || 30),
        }));
        await page.locator("#nest").click({position: {
            x: (geometry.x + geometry.dx * 3 + geometry.dx / 3) * nest.width / geometry.width,
            y: (geometry.y + geometry.dy * 5 + geometry.dy / 3) * nest.height / geometry.height,
        }});
        equal([await value("#pe-row"), await value("#pe-col")], ["5", "3"], "canvas PE selection");
        await page.locator("#topology-details summary").click();
        await page.waitForFunction(() => document.getElementById("topology").width === 1000);
        await canvasPainted("#topology");
        await page.locator("#topology-details summary").click();
        groups.push("playback, reset, tile navigation, canvas selection and BIRRD topology");
        console.log(`PASS ${groups[groups.length - 1]}`);

        await page.locator("#tab-dataflow").focus();
        await page.keyboard.press("ArrowRight");
        equal(await page.locator("#tab-buffers").getAttribute("aria-selected"), "true", "keyboard next tab");
        await page.keyboard.press("End");
        equal(await page.locator("#tab-program").getAttribute("aria-selected"), "true", "keyboard last tab");
        const downloadEvent = page.waitForEvent("download");
        await page.locator("#download-data").click();
        const download = await downloadEvent;
        equal(download.suggestedFilename(), "qwen3_minisa_mapping.json", "download filename");
        const downloaded = path.join(output, download.suggestedFilename());
        await download.saveAs(downloaded);
        equal(JSON.parse(await fs.readFile(downloaded, "utf8")), data, "download equals all embedded compiler data");
        groups.push("keyboard tabs and exact compiler-data JSON download");
        console.log(`PASS ${groups[groups.length - 1]}`);

        // Observe actual canvas strokes, not just the renderer's metadata. The
        // purple inter-stage edges must be precisely the backward dependencies
        // of the selected committed port, excluding unused multicast copies.
        await select("operator", 0);
        await tab("dataflow");
        await select("dot-index", 7); await select("lane-index", 15);
        await page.evaluate(() => {
            const ctx = document.getElementById("nest").getContext("2d");
            const recorder = {lines: [], labels: [], points: [], original: {}};
            for (const name of ["clearRect", "beginPath", "moveTo", "lineTo", "stroke", "fillText"]) {
                recorder.original[name] = ctx[name].bind(ctx);
            }
            ctx.clearRect = (...args) => {
                recorder.lines = []; recorder.labels = [];
                return recorder.original.clearRect(...args);
            };
            ctx.beginPath = (...args) => { recorder.points = []; return recorder.original.beginPath(...args); };
            ctx.moveTo = (x, y) => { recorder.points.push([x, y]); return recorder.original.moveTo(x, y); };
            ctx.lineTo = (x, y) => { recorder.points.push([x, y]); return recorder.original.lineTo(x, y); };
            ctx.stroke = (...args) => {
                if (Math.abs(ctx.lineWidth - 2.3) < 0.00001 && recorder.points.length === 2) {
                    recorder.lines.push(recorder.points.map(point => [...point]));
                }
                return recorder.original.stroke(...args);
            };
            ctx.fillText = (label, x, y, ...rest) => {
                recorder.labels.push({label: String(label), x, y});
                return recorder.original.fillText(label, x, y, ...rest);
            };
            window.__testRouteRecorder = recorder;
        });
        const route = data.birrd.commands.find(command => command.reduction_width === 2);
        for (let row = 0; row < 16; row++) {
            await select("pe-row", row);
            for (let col = 0; col < 16; col++) {
                await select("pe-col", col);
                const drawn = await page.evaluate(() => {
                    const record = window.__testRouteRecorder;
                    const title = record.labels.find(item => item.label.startsWith("BIRRD ·"));
                    const lastStage = record.labels.find(item => item.label === "S7");
                    const edges = record.lines.filter(([, to]) => to[1] > title.y && to[1] < lastStage.y);
                    const levels = [...new Set(edges.map(([, to]) => to[1]))].sort((a, b) => a - b);
                    const geometry = FeatherAccelerator.geometry;
                    const port = x => (x - geometry.x - geometry.w / 2) / geometry.dx;
                    return {dataset: {...document.getElementById("nest").dataset},
                        edges: edges.map(([from, to]) => [levels.indexOf(to[1]), port(from[0]), port(to[0])])};
                });
                const selected = col % 8;
                equal(Number(drawn.dataset.routePort), selected, "unified canvas selected output");
                equal(drawn.dataset.routeSources, `${selected},${selected + 8}`, "unified canvas true source pair");
                const m = 28 + Math.floor(selected / 2), q = selected % 2, linear = 2 * m + q;
                equal([Number(drawn.dataset.obBank), Number(drawn.dataset.obRow)],
                    [linear % 16, Math.floor(linear / 16) * 16 + row], "unified canvas physical FP32 OB destination");
                check((await text("#route-details")).includes(`C[${m},${row + 16 * q}]`),
                    "accessible route result coordinates");
                const expectedEdges = [];
                let needed = new Set([selected]);
                for (let stage = 7; stage >= 0; stage--) {
                    const previous = new Set();
                    for (const outputPort of needed) {
                        const node = route.stages[stage].nodes[Math.floor(outputPort / 2)];
                        for (const side of switchDependencies(node.command)[outputPort % 2]) {
                            expectedEdges.push([stage, node.input_ports[side], node.output_ports[side]]);
                            previous.add(node.input_ports[side]);
                        }
                    }
                    needed = previous;
                }
                equal(drawn.edges.map(edge => edge.join(",")).sort(),
                    [...new Set(expectedEdges.map(edge => edge.join(",")))].sort(),
                    `actual highlighted EGG wires PE(${row},${col})`);
            }
        }
        await page.evaluate(() => {
            const ctx = document.getElementById("nest").getContext("2d");
            Object.assign(ctx, window.__testRouteRecorder.original);
            delete window.__testRouteRecorder;
        });
        groups.push("256 PE routes: actual highlighted wires, committed source pairs and physical OB addresses");
        console.log(`PASS ${groups[groups.length - 1]}`);

        const programArtifacts = [];
        async function downloadButton(id) {
            const event = page.waitForEvent("download");
            await page.locator(`#${id}`).click();
            const item = await event, target = path.join(output, item.suggestedFilename());
            await item.saveAs(target);
            programArtifacts.push(target);
            return {target, contents: await fs.readFile(target, "utf8")};
        }
        function checkProgram(program, operatorIndex, scope) {
            const op = data.operators[operatorIndex];
            const design = data.tile_designs.find(item => item.id === op.design_id);
            const count = scope === "tile" ? {n: 1, m: 1, k: 1} : op.loop_counts;
            const expected = [];
            for (let n = 0; n < count.n; n++) for (let m = 0; m < count.m; m++) {
                for (let k = 0; k < count.k; k++) for (const original of design.logical_trace) {
                    if (original.op === "SetOVNLayout" && k !== 0) continue;
                    if (original.op === "Store" && k !== count.k - 1) continue;
                    const instruction = {...original};
                    if (instruction.op === "Load") instruction.hbm_addr += ((n * count.m + m) * count.k + k) * 1024;
                    if (instruction.op === "Store") instruction.hbm_addr += (n * count.m + m) * 1024;
                    expected.push(instruction);
                }
            }
            equal(program.logical_trace, expected, `${op.name} ${scope} complete command-order schedule`);
            const packed = referencePacking(expected, data.isa);
            for (const [field, value] of Object.entries(packed)) equal(program[field], value,
                `${op.name} ${scope} independent packed ${field}`);
            if (scope === "tile") {
                const fixture = data.isa.fixtures.find(item => item.design_id === op.design_id);
                for (const key of ["words", "trace", "total_bits", "pad_bits", "num_instructions"]) {
                    equal(program[key], fixture[key], `${op.name} matches real Python assembler fixture ${key}`);
                }
            } else {
                equal(program.num_instructions, op.schedule_cost.instruction_count, `${op.name} cost instruction count`);
                equal(program.total_bits, op.schedule_cost.instruction_bits, `${op.name} cost bit count`);
                equal(program.words.length, op.schedule_cost.instruction_words, `${op.name} cost word count`);
            }
            equal(program.logical_trace.filter(inst => inst.op === "ExecuteStreaming").length,
                count.n * count.m * count.k, "one ES per compute tile");
            equal(program.logical_trace.filter(inst => inst.op === "Store").length,
                count.n * count.m, "one Store per output tile");
        }
        async function generate(operatorIndex, scope) {
            await select("operator", operatorIndex);
            await tab("program");
            await select("program-scope", scope);
            await page.locator("#generate-program").click();
            check((await text("#program-status")).startsWith("Generated and decoder-checked"),
                "UI generation succeeds");
        }
        async function pc() {
            return Number((await text("#live-registers")).match(/^PC = (\d+)/m)?.[1]);
        }
        async function counts(expectedPc, loads, executions, stores) {
            const registers = await text("#live-registers");
            equal(await pc(), expectedPc, "ISA PC");
            for (const [name, value] of [["Loads", loads], ["ES", executions], ["Stores", stores]]) {
                check(registers.includes(`\n${name}: ${value}\n`), `ISA ${name} count ${value}`);
            }
        }
        await select("operator", 0); await tab("dataflow");
        await page.locator("#open-program").click();
        equal(await page.locator("#tab-program").getAttribute("aria-selected"), "true", "program entry button");
        await generate(0, "tile");
        const tileExport = await downloadButton("export-program"), tileProgram = JSON.parse(tileExport.contents);
        checkProgram(tileProgram, 0, "tile");
        const tileHex = await downloadButton("export-hex");
        equal(tileHex.contents.trim().split(/\s+/).map(word => Number.parseInt(word, 16)),
            tileProgram.words, "downloaded tile hex preserves exact unsigned word order");
        await page.locator("#load-program").click();
        await counts(0, 0, 0, 0);
        let loads = 0, executions = 0, stores = 0;
        for (let index = 0; index < tileProgram.num_instructions; index++) {
            const instruction = tileProgram.logical_trace[index];
            const prefix = index % 2 ? "program" : "accelerator";
            await tab(prefix === "program" ? "program" : "dataflow");
            await page.locator(`#${prefix}-step`).click();
            loads += Number(instruction.op === "Load");
            executions += Number(instruction.op === "ExecuteStreaming");
            stores += Number(instruction.op === "Store");
            await counts(index + 1, loads, executions, stores);
            check((await text("#accelerator-status")).includes(instruction.op), "live decoded instruction");
            const register = {SetOVNLayout: "OVN", SetIVNLayout: "IVN", SetWVNLayout: "WVN",
                ExecuteMapping: "EM", ExecuteStreaming: "ES"}[instruction.op];
            if (register) {
                const {op: ignored, ...fields} = instruction;
                const live = (await text("#live-registers")).match(new RegExp(`^${register}: (\\{.*\\})$`, "m"));
                equal(JSON.parse(live[1]), fields, `${register} register comes from decoded instruction`);
            }
        }
        check(await page.locator("#program-step").isDisabled(), "completed ISA cannot step into padding");
        check((await text("#live-registers")).includes('BIRRD: "010001f0020c02c00ec30e000dc30d3c"'),
            "EM programs actual BIRRD command");
        await page.locator("#program-reset").click();
        await counts(0, 0, 0, 0);
        check(!(await text("#live-registers")).includes("EM:"), "ISA reset clears mapping registers");
        await page.locator("#accelerator-run").click();
        await page.waitForFunction(() => /^PC = [1-9]/m.test(document.getElementById("live-registers").textContent));
        await page.locator("#accelerator-run").click();
        const pausedPc = await pc();
        await page.waitForTimeout(420);
        equal(await pc(), pausedPc, "ISA pause freezes PC");
        await tab("program");
        await page.locator("#program-run").click();
        await page.waitForFunction(() => /PC = 8\n/.test(document.getElementById("live-registers").textContent));
        await counts(8, 2, 1, 1);
        await page.locator("#accelerator-reset").click();
        await counts(0, 0, 0, 0);
        await page.locator("#accelerator-run").click();
        await page.waitForFunction(() => /^PC = [1-9]/m.test(document.getElementById("live-registers").textContent));
        await frame(10);
        const scrubbedPc = await pc();
        await page.waitForTimeout(420);
        equal(await pc(), scrubbedPc, "illustration scrub pauses independent ISA clock");
        equal(await text("#accelerator-run"), "Run ISA", "scrub turns off ISA run state");
        check(!(await text("#phase-title")).startsWith("ISA"), "scrub returns to illustration phase");
        groups.push("tile program: exact fixture words, eight decoded steps, live registers, run/pause/reset and clock exclusion");
        console.log(`PASS ${groups[groups.length - 1]}`);

        for (let index = 0; index < data.operators.length; index++) {
            await generate(index, "operator");
            const json = await downloadButton("export-program"), program = JSON.parse(json.contents);
            const hex = await downloadButton("export-hex");
            checkProgram(program, index, "operator");
            equal(hex.contents.trim().split(/\s+/).map(word => Number.parseInt(word, 16)),
                program.words, "full operator hex equals JSON words");
        }
        await generate(7, "operator");
        await page.locator("#load-program").click();
        await page.locator("#accelerator-run").click();
        const attention = data.operators[7], attentionLoops = attention.loop_counts;
        await page.waitForFunction(count => document.getElementById("live-registers")
            .textContent.includes(`PC = ${count}\n`), attention.schedule_cost.instruction_count);
        await counts(attention.schedule_cost.instruction_count, attentionLoops.compute_tiles * 2,
            attentionLoops.compute_tiles, attentionLoops.output_tiles);
        equal([await value("#tile-n"), await value("#tile-m"), await value("#tile-k")],
            [attentionLoops.n, attentionLoops.m, attentionLoops.k].map(count => String(count - 1)),
            "full attention program finishes at final tile");
        equal(await text("#accelerator-run"), "Run ISA", "full program stops itself");
        groups.push(`all nine full operator JSON/hex exports; deployed attention executes ${attention.schedule_cost.instruction_count} instructions, ${attentionLoops.compute_tiles} ES, ${attentionLoops.output_tiles} Stores`);
        console.log(`PASS ${groups[groups.length - 1]}`);

        await tab("program");
        await page.locator("#import-program").setInputFiles(tileExport.target);
        await page.waitForFunction(() => document.getElementById("program-status").textContent.startsWith("Imported and validated"));
        equal([await value("#operator"), await value("#program-scope")], ["0", "tile"],
            "valid import adopts declared operator and scope");
        check(await page.locator("#program-step").isDisabled(), "import does not execute before explicit load");
        await page.locator("#load-program").click();
        await counts(0, 0, 0, 0);
        await tab("program");
        await select("program-scope", "operator");
        check(await page.locator("#load-program").isDisabled() && await page.locator("#export-program").isDisabled(),
            "scope change invalidates stale program");
        equal(await text("#live-registers"), "No program loaded.", "scope change clears loaded state");
        await generate(0, "tile");
        await page.locator("#load-program").click();
        await select("operator", 1);
        equal(await text("#live-registers"), "No program loaded.", "operator change clears loaded state");
        await tab("program");
        const mutations = [
            ["words", p => { p.words[0] = (p.words[0] ^ 1) >>> 0; }],
            ["logical fields", p => { p.logical_trace[0].P_L0++; }],
            ["instruction count", p => { p.num_instructions--; }],
            ["padding", p => { p.pad_bits++; }],
            ["bit offsets", p => { p.bit_offsets[0]++; }],
            ["hardware", p => { p.hardware.AH = 8; }],
            ["operator", p => { p.operator = "unsupported"; }],
            ["scope", p => { p.scope = "unsupported"; }],
        ];
        for (const [name, mutate] of mutations) {
            const bad = structuredClone(tileProgram); mutate(bad);
            await page.locator("#import-program").setInputFiles({name: "bad.json",
                mimeType: "application/json", buffer: Buffer.from(JSON.stringify(bad))});
            await page.waitForFunction(() => document.getElementById("program-status").textContent.startsWith("Import rejected:"));
            check(await page.locator("#load-program").isDisabled() &&
                await page.locator("#export-program").isDisabled(), `${name} import fails closed`);
            equal(await text("#live-registers"), "No program loaded.", `${name} leaves no executable state`);
        }
        await page.locator("#import-program").setInputFiles({name: "oversize.json",
            mimeType: "application/json", buffer: Buffer.alloc(32 * 1024 * 1024 + 1, 32)});
        await page.waitForFunction(() => document.getElementById("program-status").textContent.includes("32 MiB"));
        check(await page.locator("#load-program").isDisabled(), "oversize import rejected before parsing");
        groups.push("valid import; eight tampered manifests and oversize file fail closed; stale programs invalidated");
        console.log(`PASS ${groups[groups.length - 1]}`);

        await select("operator", 0);
        await tab("dataflow");
        await tile("n", 1); await tile("m", 1); await tile("k", 1);
        await select("dot-index", 3); await select("lane-index", 9);
        await select("pe-row", 7); await select("pe-col", 11);
        for (const name of ["dataflow", "buffers", "program"]) {
            await tab(name);
            if (name === "program") {
                await select("program-scope", "tile");
                await page.locator("#generate-program").click();
            }
            await noOverflow(`desktop ${name}`);
            await page.screenshot({path: path.join(output, `desktop-${name}.png`), fullPage: true});
        }
        await page.setViewportSize({width: 390, height: 844});
        for (const name of ["dataflow", "buffers", "program"]) {
            await tab(name);
            await noOverflow(`mobile ${name}`);
        }
        await tab("dataflow");
        await page.locator("#zoom-array").click();
        equal(await page.locator("#zoom-array").getAttribute("aria-pressed"), "true",
            "mobile array zoom enabled");
        check(await page.locator("#nest-viewport").evaluate(node =>
            node.scrollWidth > node.clientWidth), "zoomed array scrolls inside its viewport");
        check((await page.locator("#nest").boundingBox()).width >= 850, "zoomed PE array is legible");
        await noOverflow("mobile zoomed array");
        await page.locator("#zoom-array").click();
        equal(await page.locator("#zoom-array").getAttribute("aria-pressed"), "false",
            "mobile array zoom disabled");
        await page.locator("#topology-details summary").click();
        await canvasPainted("#topology");
        await noOverflow("mobile open topology");
        check((await page.locator("#topology").boundingBox()).width >= 1000,
            "topology remains full-size within its scroll wrapper");
        await page.locator("#topology-details summary").click();
        await page.screenshot({path: path.join(output, "mobile.png"), fullPage: true});
        const animation = await checkAnimation(browser, output, data, errors, externalRequests);
        groups.push("numeric dataflow animation: moving pixels, MACs, BIRRD arrivals, OB/Store, clock isolation, reduced motion and mobile");
        console.log(`PASS ${groups[groups.length - 1]}`);
        equal(errors, [], "no JavaScript or console errors");
        equal(externalRequests, [], "no external network requests");
        groups.push("1440px desktop and 390px mobile: all panels contained, offline, no JS errors");
        const report = {status: "PASS", html, browser: browser.version(), assertions,
            operators: data.operators.length, tile_corners: data.operators.length * 8,
            program_artifacts: programArtifacts, inspected_pe_routes: 256,
            animation, groups, screenshots: ["desktop-dataflow.png", "desktop-buffers.png",
                "desktop-program.png", "mobile.png", ...animation.screenshots], errors, externalRequests};
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(`PASS ${assertions} assertions; report and screenshots: ${output}`);
    } catch (error) {
        await page.screenshot({path: path.join(output, "failure.png"), fullPage: true}).catch(() => {});
        await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({status: "FAIL",
            assertions, groups, error: String(error.stack || error), errors, externalRequests}, null, 2) + "\n");
        throw error;
    } finally {
        await browser.close();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
