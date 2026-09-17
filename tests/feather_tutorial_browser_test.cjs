#!/usr/bin/env node
/* Regression for the original tutorial's generic ISA editor and unified
 * FEATHER diagram. Playwright and browser artifacts stay outside both repos.
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node \
 *   tests/feather_tutorial_browser_test.cjs --out /tmp/tutorial-browser
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
const tutorial = repository;
const html = path.resolve(argument("--html", path.join(tutorial, "FEATHER.html")));
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function check(value, message) { assert(value, message); assertions++; }
const colors = {input: "#004c99", weight: "#006633", result: "#990000", partial: "#4c0099"};

function pointAlong(points, progress) {
    const lengths = points.slice(1).map((point, index) =>
        Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
    let distance = lengths.reduce((sum, length) => sum + length, 0) * progress;
    for (let index = 0; index < lengths.length; index++) {
        if (distance <= lengths[index] || index === lengths.length - 1) {
            const fraction = lengths[index] ? distance / lengths[index] : 0;
            return points[index].map((value, axis) => value +
                (points[index + 1][axis] - value) * fraction);
        }
        distance -= lengths[index];
    }
    return points[0];
}

function nearPoint(actual, expected) {
    return actual.length === 2 && actual.every((value, axis) => Math.abs(value - expected[axis]) < 1e-7);
}

// Independent BIRRD permutation model. The 4-wide tutorial topology omits
// the first-half shuffle stage, matching its established three-stage network.
function stageInputs(width, stage, sw) {
    const bits = Math.log2(width), skip = width === 4 ? 1 : 0;
    const logical = stage + skip * (bits - 1);
    if (stage === 0) return [2 * sw, 2 * sw + 1];
    if (logical === bits) return [2 * sw, 2 * sw + 1].map(value =>
        Number.parseInt(value.toString(2).padStart(bits, "0").split("").reverse().join(""), 2));
    const left = logical < bits, exponent = left ? stage - 1 : 2 * bits - 1 - logical;
    const perGroup = width / 2 ** (exponent + 1), group = Math.floor(sw / perGroup), local = sw % perGroup;
    const blockBits = bits - exponent, mask = 2 ** blockBits - 1;
    return [2 * local, 2 * local + 1].map(value => (left ?
        ((value << 1) | (value >> (blockBits - 1))) & mask :
        (value >> 1) | ((value & 1) << (blockBits - 1))) + group * 2 ** blockBits);
}

function customTrace(width) {
    return {version: "1.0", hardware: {AH: width, AW: width, sram_mb: 4},
        workload: {M: width, K: width, N: width}, instructions: [
            {type: "SetOVNLayout", params: {order: 0, P_L0: width, P_L1: 1, Q_L1: 1}},
            {type: "SetIVNLayout", params: {order: 5, M_L0: width, M_L1: 1, J_L1: 1}},
            {type: "SetWVNLayout", params: {order: 2, N_L0: width, N_L1: 1, K_L1: 1}},
            {type: "ExecuteMapping", params: {r0: 0, c0: 0, Gr: width, Gc: 1, sr: 1, sc: 0}},
            {type: "ExecuteStreaming", params: {dataflow: 1, m_0: 0, s_m: 1, T: width, vn_size: width - 1}},
        ]};
}

async function main() {
    const output = path.resolve(argument("--out", null) || await fs.mkdtemp(path.join(os.tmpdir(), "feather-tutorial-browser-")));
    for (const root of [repository, tutorial]) check(output !== root && !output.startsWith(root + path.sep), "test artifacts stay outside repositories");
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1600, height: 1100}, acceptDownloads: true, reducedMotion: "no-preference"});
    const errors = [], requests = [], dialogs = [], groups = [];
    await context.route(/^https?:\/\//, async route => {
        const url = route.request().url(); requests.push(url);
        // Font loading is optional: verify the restored site using local CSS,
        // script and sponsor assets, without relying on Google's availability.
        if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) {
            await route.fulfill({status: 200, contentType: "text/css", body: ""});
        } else await route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("dialog", async dialog => { dialogs.push({type: dialog.type(), message: dialog.message()}); await dialog.accept(); });
    const action = call => page.locator(`button[onclick="${call}"]`).click();
    const state = () => page.evaluate(() => ({hardware: {...mgHW}, instructions: structuredClone(mgInstructions),
        frame: mgCurrentFrame, count: mgAnimFrames.length, playing: mgPlaying, activeTab: mgActiveTab}));
    async function load(trace) {
        await page.locator("#mgLoadFile").setInputFiles({name: "custom_minisa.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(trace))});
        await page.waitForFunction(expected => JSON.stringify(mgInstructions) === JSON.stringify(expected), trace.instructions);
    }
    async function noOverflow(label) {
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth),
            `${label}: page has no horizontal overflow`);
    }
    async function canvasPixels() {
        return page.locator("#mgFeatherCanvas").evaluate(canvas => {
            const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 2166136261, count = 0;
            for (let i = 0; i < bytes.length; i++) { hash = Math.imul(hash ^ bytes[i], 16777619) >>> 0; if (i % 4 === 3 && bytes[i]) count++; }
            return {hash, count};
        });
    }
    async function legendColors(label, partial) {
        const legend = await page.locator("#mgLegend .mg-legend-item").evaluateAll(nodes => nodes.map(node => ({
            text: node.textContent, color: getComputedStyle(node.querySelector(".mg-legend-swatch")).backgroundColor})));
        for (const [pattern, color] of [[/Input|Streaming/i, "rgb(0, 76, 153)"],
            [/Weight|Stationary/i, "rgb(0, 102, 51)"], [/Output/i, "rgb(153, 0, 0)"],
            ...(partial ? [[/Partial|PE results/i, "rgb(76, 0, 153)"]] : [])]) {
            const item = legend.find(entry => pattern.test(entry.text));
            check(item, `${label}: semantic legend item ${pattern} is present`);
            equal(item.color, color, `${label}: semantic legend swatch uses the exact requested color`);
        }
    }
    async function fitDiagram(label) {
        await page.locator("#mgDiagramScale").selectOption("fit");
        await page.locator("#mg-tab-feather").evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
        const dimensions = await page.evaluate(() => {
            const panel = document.getElementById("mg-tab-feather"), canvas = document.getElementById("mgFeatherCanvas");
            const outer = panel.getBoundingClientRect(), inner = canvas.getBoundingClientRect();
            return {scale: mgFeatherGeometry.scale, canvas: {width: inner.width, height: inner.height},
                backing: {width: canvas.width, height: canvas.height}, contained: inner.left >= outer.left - 1 &&
                    inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1};
        });
        check(dimensions.contained, `${label}: Fit diagram exposes the complete connected NEST and BIRRD canvas inside its pane`);
        check(dimensions.scale > 0 && dimensions.scale <= 1, `${label}: fit has a positive bounded scale`);
        check(Math.abs(dimensions.canvas.width - dimensions.backing.width * dimensions.scale) < 1 &&
            Math.abs(dimensions.canvas.height - dimensions.backing.height * dimensions.scale) < 1,
        `${label}: fit retains the original geometry and aspect ratio`);
    }
    async function actualDiagram(label) {
        await page.locator("#mgDiagramScale").selectOption("actual");
        const dimensions = await page.evaluate(() => {
            const panel = document.getElementById("mg-tab-feather"), canvas = document.getElementById("mgFeatherCanvas");
            const rect = canvas.getBoundingClientRect();
            return {scale: mgFeatherGeometry.scale, width: rect.width, height: rect.height,
                backing: [canvas.width, canvas.height], scrollable: panel.scrollHeight > panel.clientHeight || panel.scrollWidth > panel.clientWidth};
        });
        equal([dimensions.scale, dimensions.width, dimensions.height], [1, ...dimensions.backing],
            `${label}: Actual size presents full-resolution readable canvas`);
        check(dimensions.scrollable, `${label}: full-resolution canvas scrolls inside its pane`);
        await noOverflow(`${label}: Actual size`);
        await fitDiagram(label);
    }
    async function expandedTool(label) {
        const overflow = await page.evaluate(() => document.body.style.overflow);
        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(32);
        equal(await page.locator("#mgExpandBtn").getAttribute("aria-pressed"), "true", `${label}: expanded state is accessible`);
        equal(await page.locator("#mgExpandBtn").innerText(), "Restore", `${label}: expanded control offers Restore`);
        const bounds = await page.evaluate(() => {
            const outer = document.querySelector(".mg-app").getBoundingClientRect(), right = document.querySelector(".mg-right").getBoundingClientRect();
            return {inWindow: outer.left >= 0 && outer.top >= 0 && outer.right <= innerWidth && outer.bottom <= innerHeight,
                rightInside: right.left >= outer.left && right.top >= outer.top && right.right <= outer.right && right.bottom <= outer.bottom,
                overflow: document.body.style.overflow};
        });
        check(bounds.inWindow, `${label}: expanded tool stays inside the browser window`);
        check(bounds.rightInside, `${label}: expanded graph controls and panel are not clipped by the overlay`);
        equal(bounds.overflow, "hidden", `${label}: expanded workbench locks background scrolling`);
        await fitDiagram(`${label} expanded`);
        await page.locator("#mgIsaList .mg-isa-item").first().click(); await action("mgEditInstruction()");
        const input = page.locator("#mgm_order");
        check(await input.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
        }), `${label}: editor modal remains on top of the expanded tool`);
        const value = await input.inputValue(); await input.fill(value); await page.locator("#mgModalOk").click();
        check(!(await page.locator("#mgModalOverlay").isVisible()), `${label}: editor modal can save while expanded`);
        await page.keyboard.press("Escape"); await page.clock.runFor(32);
        equal(await page.locator("#mgExpandBtn").getAttribute("aria-pressed"), "false", `${label}: Escape restores inline workbench`);
        equal(await page.evaluate(() => document.body.style.overflow), overflow, `${label}: Escape restores prior background scrolling`);
        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(32);
        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(32);
        equal(await page.locator("#mgExpandBtn").innerText(), "Expand", `${label}: Restore button also returns inline`);
        await noOverflow(`${label}: restored workbench`);
    }
    async function saved() {
        const event = page.waitForEvent("download"); await action("mgSaveTrace()");
        const download = await event;
        equal(download.suggestedFilename(), "minisa_trace.json", "original trace export filename retained");
        const target = path.join(output, "minisa_trace.json"); await download.saveAs(target);
        return JSON.parse(await fs.readFile(target, "utf8"));
    }
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.addInitScript(() => {
            const prototype = CanvasRenderingContext2D.prototype, originals = {};
            for (const method of ["clearRect", "beginPath", "moveTo", "lineTo", "arcTo", "stroke", "fill", "fillText", "arc"]) originals[method] = prototype[method];
            window.__tutorialDraw = {paths: [], labels: [], text: [], points: [], arcs: [], pendingArcs: []};
            window.__tutorialBufferDraw = {paths: [], labels: [], text: [], points: [], arcs: [], pendingArcs: []};
            for (const method of Object.keys(originals)) prototype[method] = function (...args) {
                if (["mgFeatherCanvas", "mgBufferCanvas"].includes(this.canvas.id)) {
                    const record = this.canvas.id === "mgFeatherCanvas" ? window.__tutorialDraw : window.__tutorialBufferDraw;
                    if (method === "clearRect") { record.paths = []; record.labels = []; record.text = []; record.arcs = []; }
                    if (method === "beginPath") { record.points = []; record.pendingArcs = []; }
                    if (method === "moveTo" || method === "lineTo" || method === "arcTo") record.points.push(args.slice(0, 2));
                    if (method === "stroke" && record.points.length >= 2) record.paths.push({points: record.points.map(point => [...point]), width: this.lineWidth, color: this.strokeStyle});
                    if (method === "fillText") { record.labels.push(String(args[0])); record.text.push({label: String(args[0]), x: args[1], y: args[2], color: this.fillStyle}); }
                    if (method === "arc") {
                        const arc = {x: args[0], y: args[1], radius: args[2]};
                        record.arcs.push(arc); record.pendingArcs.push(arc);
                    }
                    if (method === "fill") for (const arc of record.pendingArcs) arc.color = this.fillStyle;
                }
                return originals[method].apply(this, args);
            };
        });
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"}); await page.clock.runFor(150);
        equal(await page.locator("#minisa-tool h2").innerText(), "FEATHER Microarchitecture and MINISA ISA Visualizer", "original tutorial visualizer heading retained");
        equal(await page.title(), "FEATHER - RAIC Tutorial", "original tutorial site identity retained");
        for (const [id, expected] of [["isa-summary", "Instruction Set Summary"], ["isa-formats", "Instruction Formats"],
            ["isa-pipeline", "6-Stage Compilation Pipeline"], ["isa-search-opt", "Search Optimizations"]]) {
            equal(await page.locator(`#${id}`).innerText(), expected, "original instructional prose remains accessible");
        }
        equal(await page.locator(".mg-tab").count(), 2, "one combined FEATHER tab plus VN buffers, not separate compute/network tabs");
        check((await page.locator('.mg-tab[data-tab="feather"]').innerText()).includes("FEATHER"), "combined tab is labeled FEATHER");
        equal(await page.locator("#mg-tab-feather canvas").count(), 1, "compute and network share one canvas");
        equal(await page.locator("#mg-tab-nest, #mg-tab-birrd").count(), 0, "old split panels are absent");
        equal((await state()).instructions.length, 7, "original seven-instruction default preserved");
        equal((await state()).hardware.AW, 4, "original editable four-wide initial hardware preserved");
        equal(await page.locator("#mgNestSize option").evaluateAll(nodes => nodes.map(node => node.value)), ["4", "8", "16"], "all original hardware width options retained");
        const initial = await saved();
        equal(initial.instructions, (await state()).instructions, "saving preserves complete editable ISA trace");
        equal(initial.hardware.AW, 4, "saving preserves generic hardware config rather than replacing with Qwen profile");
        groups.push("original tutorial title, prose, controls, defaults and JSON schema");

        await page.locator("#mgIsaList .mg-isa-item").nth(2).click();
        check((await page.locator("#mgDetailsBox").innerText()).includes("SetWVNLayout"), "selection opens original instruction details");
        await action("mgEditInstruction()"); await page.locator("#mgm_order").fill("3");
        check((await page.locator("#mgOrderPrev").innerText()).includes("nL0"), "live VN-order preview works");
        await page.locator("#mgModalOk").click(); equal((await state()).instructions[2].params.order, 3, "editing custom ISA parameters retained");
        await action("mgMoveInstruction(-1)"); equal((await state()).instructions[1].type, "SetWVNLayout", "instruction can move up");
        await action("mgMoveInstruction(1)"); equal((await state()).instructions[2].type, "SetWVNLayout", "instruction can move down");
        await page.locator("#mgIsaTypeSelect").selectOption("ExecuteMapping"); await action("mgAddInstruction()");
        await page.locator("#mgModalOk").click(); equal((await state()).instructions.length, 8, "adding ISA instruction preserved");
        await action("mgDeleteInstruction()"); equal((await state()).instructions.length, 7, "deleting ISA instruction preserved");
        await action("mgClearAll()"); equal((await state()).instructions.length, 0, "clear original editor trace");
        await load(initial); equal((await state()).instructions, initial.instructions, "load JSON restores original trace exactly");
        await action("mgResetDefault()"); equal((await state()).instructions, initial.instructions, "reset returns original default ISA");
        for (const mutate of [trace => { trace.hardware.AW = 3; }, trace => { trace.instructions[0].type = "<img onerror=alert(1)>"; },
            trace => { trace.instructions[0].params.order = 9; }, trace => { trace.instructions[0].params.P_L0 = null; }]) {
            const invalid = structuredClone(initial); mutate(invalid);
            const oldErrors = await page.locator(".mg-toast.error").count();
            await page.locator("#mgLoadFile").setInputFiles({name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid))});
            await page.waitForFunction(count => document.querySelectorAll(".mg-toast.error").length > count, oldErrors);
            equal((await state()).instructions, initial.instructions, "invalid import leaves previous editor instructions intact");
            equal((await state()).hardware.AW, 4, "invalid import leaves previous hardware intact");
        }
        groups.push("ISA add, edit, reorder, delete, clear, load/save and default reset");

        for (const width of [4, 8, 16]) {
            const trace = customTrace(width); await load(trace); await page.clock.runFor(150);
            equal((await state()).hardware.AW, width, "JSON hardware width applied");
            equal(await page.locator("#mgNestSize").inputValue(), String(width), "hardware selector reflects imported custom trace");
            for (const dimension of ["M", "K", "N"]) equal(await page.locator(`#mgWl${dimension}`).inputValue(), String(width), "workload remains derived from custom layouts");
            equal((await saved()).instructions, trace.instructions, "arbitrary original-format trace round trips");
            await action("mgValidateTrace()");
            await fitDiagram(`${width}-wide diagram`);
            await actualDiagram(`${width}-wide diagram`);
            const network = await page.evaluate(() => ({width: mgHW.AW,
                stages: mgHW.AW === 4 ? 3 : 2 * Math.log2(mgHW.AW),
                inputs: Array.from({length: mgHW.AW === 4 ? 3 : 2 * Math.log2(mgHW.AW)}, (_, stage) =>
                    Array.from({length: mgHW.AW / 2}, (_, sw) => mgBirrdInputs(stage, sw, mgHW.AW))),
                dataset: {...document.getElementById("mgFeatherCanvas").dataset}, geometry: mgFeatherGeometry,
                painted: window.__tutorialDraw}));
            for (let stage = 0; stage < network.stages; stage++) for (let sw = 0; sw < width / 2; sw++) {
                equal(network.inputs[stage][sw], stageInputs(width, stage, sw), `independent ${width}-wide topology S${stage} E${sw}`);
            }
            equal(Number(network.dataset.columnLinks), width, "every NEST column connects to one BIRRD input");
            equal(Number(network.dataset.stages), network.stages, "combined canvas shows all network stages");
            equal(Number(network.dataset.networkLinks), width * network.stages, "combined canvas draws all stage input wires");
            const geometry = network.geometry;
            const drawn = new Set(network.painted.paths.map(item => JSON.stringify(item.points)));
            const paintedPath = points => network.painted.paths.find(item => JSON.stringify(item.points) === JSON.stringify(points));
            await legendColors(`${width}-wide FEATHER`, true);
            equal(geometry.busX.length, width, "one result bus is exposed per PE column");
            equal(geometry.peBusLinks.length, width * width, "every PE has its own diagonal output tap");
            equal(Number(network.dataset.peBusLinks), width * width, "rendered canvas reports all PE-to-bus taps");
            for (let col = 0; col < width; col++) {
                const peRight = geometry.left + col * geometry.pitch + geometry.cell;
                const busX = geometry.busX[col], link = geometry.columnLinks[col];
                check(busX > peRight && busX < geometry.left + (col + 1) * geometry.pitch,
                    "column result bus runs in the whitespace to the right of its PEs");
                equal([link.column, link.input], [col, col], "bus retains its matching BIRRD input identity");
                equal([link.from[0], link.to[0], geometry.portX[col]], [busX, busX, busX],
                    "result bus and BIRRD input are vertically aligned without a cross-column jog");
                equal(link.to[1], geometry.networkTop, "column bus ends exactly at its BIRRD input");
                check(link.from[1] <= geometry.top + geometry.cell && link.from[1] >= geometry.top,
                    "column bus begins alongside the top PE before its output tap");
                check(drawn.has(JSON.stringify([link.from, link.to])),
                    "actual canvas stroke is one continuous vertical column result bus");
                equal(paintedPath([link.from, link.to]).color, colors.partial, "column bus uses the exact partial-result color");
                for (let row = 0; row < width; row++) {
                    const bottom = geometry.top + row * geometry.pitch + geometry.cell;
                    const taps = geometry.peBusLinks.filter(tap => tap.row === row && tap.column === col);
                    equal(taps.length, 1, "every PE owns exactly one output tap");
                    const tap = taps[0];
                    equal(tap.from, [peRight, bottom], "diagonal output tap starts at the PE bottom-right corner");
                    equal(tap.to[0], busX, "diagonal output tap joins its own column bus");
                    check(tap.to[1] > bottom && tap.to[1] < bottom + geometry.pitch - geometry.cell,
                        "diagonal tap descends through inter-row whitespace, not a PE interior");
                    check(drawn.has(JSON.stringify([tap.from, tap.to])), "actual canvas stroke draws every PE-to-bus diagonal");
                    equal(paintedPath([tap.from, tap.to]).color, colors.partial, "every PE output tap uses the exact partial-result color");
                    for (let otherCol = 0; otherCol < width; otherCol++) {
                        const otherLeft = geometry.left + otherCol * geometry.pitch;
                        check(busX <= otherLeft || busX >= otherLeft + geometry.cell,
                            "continuous vertical result bus does not intersect any PE column interior");
                    }
                }
            }
            check(!network.painted.labels.some(label => /row\s*auto\s*pick/i.test(label)),
                "column bus replaces the old Row AutoPick diagram block");
            for (let stage = 0; stage < network.stages; stage++) for (let sw = 0; sw < width / 2; sw++) {
                const sources = stageInputs(width, stage, sw);
                for (let side = 0; side < 2; side++) {
                    const fromX = geometry.portX[sources[side]], toX = geometry.portX[2 * sw + side];
                    const start = stage === 0 ? geometry.networkTop : geometry.stageY[stage - 1] + 14;
                    const end = geometry.stageY[stage] - 14, middle = (start + end) / 2;
                    const expected = [[fromX, start], [fromX, middle - 4], [toX, middle + 4], [toX, end]];
                    check(drawn.has(JSON.stringify(expected)), `actual ${width}-wide canvas topology wire S${stage} E${sw} side${side}`);
                    equal(paintedPath(expected).color, colors.partial, "every BIRRD traversal wire uses the exact partial-result color");
                }
            }
            for (let stage = 0; stage < network.stages; stage++) for (let port = 0; port < width; port++) {
                const pass = [[geometry.portX[port], geometry.stageY[stage] - 14],
                    [geometry.portX[port], geometry.stageY[stage] + 14]];
                equal(paintedPath(pass).color, colors.partial, "internal BIRRD PASS path retains the partial-result color");
            }
            for (let port = 0; port < width; port++) {
                const output = [[geometry.portX[port], geometry.stageY[network.stages - 1] + 14],
                    [geometry.portX[port], geometry.outputY]];
                equal(paintedPath(output).color, colors.result, "BIRRD-to-OVN output link uses the exact result color");
            }
            check(network.painted.labels.some(label => label.includes("NEST")) && network.painted.labels.some(label => label.includes("BIRRD")),
                "one actual canvas includes both compute and network labels");
            equal(network.dataset.switchMode, "PASS", "generic editor labels topology-only PASS mode without inventing reduction commands");
            check((await canvasPixels()).count > 20000, "combined canvas has painted NEST and network content");
            await action("mgGenerateAnimation()");
            check((await state()).count > width * width, "custom ISA produces operand and pipeline teaching frames");
            check(!(await state()).playing, "Generate does not autoplay");
            for (const operand of ["input", "weight"]) {
                const painted = await page.evaluate(operand => {
                    const index = mgAnimFrames.findIndex(frame => operand === "weight" ?
                        (frame.aWR || []).some(row => Array.from({length: mgHW.AW}, (_, col) => frame.pLE[row + "," + col]).some(value => value >= 0)) :
                        (frame.aIR || []).some(row => ["computing", "dp_done", "outputting"].includes(frame.pp[row + ",0"])));
                    if (index < 0) return {index};
                    mgStepAnim(index - mgCurrentFrame); mgDrawFeather(mgAnimFrames[index], 0.6);
                    return {index, arcs: window.__tutorialDraw.arcs, text: window.__tutorialDraw.text};
                }, operand);
                check(painted.index >= 0, `${operand}: custom trace includes a moving operand frame`);
                const packets = painted.text.filter(item => operand === "weight" ? /^B\[\d+,\d+\]$/.test(item.label) : /^A\[\d+,\d+\]$/.test(item.label));
                check(packets.length >= width, `${operand}: the canvas paints operand packet identities`);
                for (const packet of packets) {
                    equal(packet.color, colors[operand], `${operand}: moving packet label uses the exact requested color`);
                    check(painted.arcs.some(arc => arc.radius === 5 && nearPoint([arc.x, arc.y], [packet.x, packet.y + 10]) && arc.color === colors[operand]),
                        `${operand}: moving packet circle is actually filled with the exact requested color`);
                }
            }
            equal(geometry.busTapFraction, 0.25, "diagonal tap has a visible quarter-step travel interval at every array size");
            const rowIssues = await page.evaluate(() => Array.from({length: mgHW.AH}, (_, row) =>
                ({row, index: mgAnimFrames.findIndex(frame => frame.aOR === row)})));
            check(rowIssues.every(issue => issue.index >= 0), "custom teaching trace emits partial results from every PE row");
            for (const issue of rowIssues) {
                for (const progress of [0, 0.125, 0.25, 0.625, 1]) {
                    const rendered = await page.evaluate(({index, progress}) => {
                        mgStepAnim(index - mgCurrentFrame);
                        mgDrawFeather(mgAnimFrames[index], progress);
                        return {tokens: JSON.parse(document.getElementById("mgFeatherCanvas").dataset.resultTokens),
                            arcs: window.__tutorialDraw.arcs, text: window.__tutorialDraw.text};
                    }, {index: issue.index, progress});
                    const tokens = rendered.tokens.filter(token => token.age === 0);
                    equal(tokens.length, width, "each emitted row launches exactly one result per column bus");
                    for (let col = 0; col < width; col++) {
                        const tap = geometry.peBusLinks.find(link => link.row === issue.row && link.column === col);
                        const expectedPath = [tap.from, tap.to, geometry.columnLinks[col].to];
                        const token = tokens.find(item => item.column === col);
                        check(token, "every result token records its originating PE column");
                        equal([token.row, token.identity], [issue.row, `R${issue.row}·C${col}`],
                            "result packet preserves the originating PE identity on the bus");
                        equal(token.points, expectedPath, "result packet uses the drawn PE diagonal and continuous column bus");
                        const expected = progress <= geometry.busTapFraction ?
                            pointAlong(expectedPath.slice(0, 2), progress / geometry.busTapFraction) :
                            pointAlong(expectedPath.slice(1), (progress - geometry.busTapFraction) / (1 - geometry.busTapFraction));
                        check(nearPoint([token.x, token.y], expected),
                            `PE(${issue.row},${col}) result occupies the correct diagonal/bus point at ${progress}`);
                        check(rendered.arcs.some(arc => arc.radius === 5 && nearPoint([arc.x, arc.y], expected)),
                            "result packet is actually painted at its declared diagonal/bus position");
                        check(rendered.arcs.some(arc => arc.radius === 5 && nearPoint([arc.x, arc.y], expected) && arc.color === colors.partial),
                            "PE result packet stays exactly purple along the diagonal and column bus");
                        check(rendered.text.some(item => item.label === token.identity && nearPoint([item.x, item.y + 10], expected)),
                            "painted result identity follows its packet along the drawn route");
                    }
                }
            }
            await page.evaluate(() => mgStepAnim(-mgCurrentFrame));
            await page.locator("#mgPlayBtn").click(); await page.clock.runFor(180);
            const first = await state(), pixelsA = await canvasPixels();
            const datasetA = await page.locator("#mgFeatherCanvas").evaluate(node => ({...node.dataset}));
            await page.clock.runFor(180);
            const second = await state(), pixelsB = await canvasPixels();
            const datasetB = await page.locator("#mgFeatherCanvas").evaluate(node => ({...node.dataset}));
            equal(second.frame, first.frame, "smooth tutorial samples retain the same teaching step");
            check(Number(datasetB.animationProgress) > Number(datasetA.animationProgress), "individual operands move within a teaching frame");
            check(pixelsA.hash !== pixelsB.hash, "tutorial operand movement changes real rendered pixels");
            check(Number(datasetB.tokenCount) > 0, "tutorial shows actual moving scalar packets");
            await page.locator("#mgPlayBtn").click(); const paused = await state(), pixelsPaused = await canvasPixels();
            await page.clock.runFor(1200); equal(await state(), paused, "tutorial pause freezes playback state");
            equal(await canvasPixels(), pixelsPaused, "tutorial pause freezes data packet pixels");
            await action("mgStepAnim(1)"); equal((await state()).frame, paused.frame + 1, "original single-step control retained");
            await action("mgStepAnim(-1)"); equal((await state()).frame, paused.frame, "original backward step retained");
            const lastIssue = await page.evaluate(() => {
                const index = mgAnimFrames.findLastIndex(frame => frame.aOR >= 0);
                return {index, row: mgAnimFrames[index].aOR};
            });
            check(lastIssue.index >= 0, "NEST eventually emits an individual result row");
            await page.evaluate(index => mgStepAnim(index - mgCurrentFrame), lastIssue.index);
            await page.locator("#mgPlayBtn").click(); await page.clock.runFor(120);
            const diagonalMotion = await page.locator("#mgFeatherCanvas").evaluate(canvas => ({
                progress: Number(canvas.dataset.animationProgress),
                tokens: JSON.parse(canvas.dataset.resultTokens).filter(token => token.age === 0)}));
            const diagonalPixels = await canvasPixels();
            await page.clock.runFor(240);
            const busMotion = await page.locator("#mgFeatherCanvas").evaluate(canvas => ({
                progress: Number(canvas.dataset.animationProgress),
                tokens: JSON.parse(canvas.dataset.resultTokens).filter(token => token.age === 0)}));
            check(diagonalMotion.progress > 0 && diagonalMotion.progress < geometry.busTapFraction &&
                busMotion.progress > geometry.busTapFraction && busMotion.progress < 1,
            "real playback first traverses the PE diagonal and then the vertical bus within one teaching step");
            equal((await state()).frame, lastIssue.index, "bus playback retains the emitted row's teaching step");
            for (let col = 0; col < width; col++) {
                const before = diagonalMotion.tokens.find(token => token.column === col);
                const after = busMotion.tokens.find(token => token.column === col);
                check(before.x < geometry.busX[col] && after.x === geometry.busX[col] && before.y < after.y,
                    "running result packet moves diagonally right onto its bus, then down toward BIRRD");
            }
            check((await canvasPixels()).hash !== diagonalPixels.hash, "PE-to-BIRRD result playback changes actual pixels");
            await page.locator("#mgPlayBtn").click();
            const pausedBusPixels = await canvasPixels(); await page.clock.runFor(1200);
            equal(await canvasPixels(), pausedBusPixels, "Pause freezes result packets on the column bus");
            const stageEntry = await page.evaluate(index => {
                mgStepAnim(index - mgCurrentFrame); mgDrawFeather(mgAnimFrames[index], 0);
                return {tokens: JSON.parse(document.getElementById("mgFeatherCanvas").dataset.resultTokens),
                    arcs: window.__tutorialDraw.arcs};
            }, lastIssue.index + 1);
            for (let col = 0; col < width; col++) {
                const token = stageEntry.tokens.find(item => item.age === 1 && item.column === col);
                check(token && token.identity === `R${lastIssue.row}·C${col}`, "BIRRD receives the same PE result identity from its column bus");
                equal(token.points[0], geometry.columnLinks[col].to, "first BIRRD route starts at the column bus endpoint");
                check(nearPoint([token.x, token.y], geometry.columnLinks[col].to),
                    "result moves continuously from bus arrival to BIRRD entry without a jump");
                check(stageEntry.arcs.some(arc => arc.radius === 5 && nearPoint([arc.x, arc.y], geometry.columnLinks[col].to)),
                    "actual BIRRD entry packet is painted at the same input used by the column bus");
            }
            let ports = Array.from({length: width}, (_, i) => i);
            for (let age = 0; age <= network.stages + 1; age++) {
                await page.evaluate(index => mgStepAnim(index - mgCurrentFrame), lastIssue.index + age);
                const rendered = await page.evaluate(() => ({text: window.__tutorialDraw.text, arcs: window.__tutorialDraw.arcs,
                    dataset: {...document.getElementById("mgFeatherCanvas").dataset}}));
                if (age > 0 && age <= network.stages) {
                    ports = ports.map(port => {
                        for (let sw = 0; sw < width / 2; sw++) {
                            const inputs = stageInputs(width, age - 1, sw), side = inputs.indexOf(port);
                            if (side >= 0) return 2 * sw + side;
                        }
                        assert.fail("unconnected independent network port");
                    });
                }
                const expectedY = age === 0 ? geometry.networkTop : age <= network.stages ? geometry.stageY[age - 1] + 14 : geometry.outputY + 18;
                for (let col = 0; col < width; col++) {
                    const output = age === network.stages + 1 ? JSON.parse(rendered.dataset.bufferTokens).find(item =>
                        item.operand === 'O' && item.peRow === lastIssue.row && item.peCol === col) : null;
                    const endpoint = output ? output.points.at(-1) : [geometry.portX[ports[col]], expectedY];
                    if (output) equal(output.points[0], [geometry.portX[ports[col]], geometry.stageY[network.stages - 1] + 14],
                        "physical output-bank route starts at the independently traced final PASS port");
                    check(rendered.text.some(item => item.label === `R${lastIssue.row}·C${col}` && nearPoint([item.x, item.y + 10], endpoint)),
                        `individual column result keeps its identity through ${age === 0 ? "column result bus" : age <= network.stages ? `BIRRD stage ${age - 1}` : "OVN arrival"}`);
                    const color = age <= network.stages ? colors.partial : colors.result;
                    check(rendered.arcs.some(arc => arc.radius === 5 && nearPoint([arc.x, arc.y], endpoint) && arc.color === color),
                        age <= network.stages ? "PE result stays purple throughout every BIRRD stage" : "completed result turns red on the BIRRD-to-OVN route");
                }
                if (age > 0) check(Number(rendered.dataset.networkTokens) >= width, "last issued NEST row remains animated throughout network drain");
            }
            await page.screenshot({path: path.join(output, `tutorial-${width}.png`), fullPage: true});
            await page.locator("#mgPlayBtn").click(); await page.clock.runFor(120);
            await page.locator('.mg-tab[data-tab="buffer"]').click();
            const tabPaused = await state(); await page.clock.runFor(1200);
            equal(await state(), tabPaused, "leaving unified tab freezes its clock");
            check(!tabPaused.playing, "buffer tab visibly pauses animation");
            check(await page.locator("#mg-tab-buffer").isVisible(), "original VN-buffer panel still works");
            check(!(await page.locator("#mg-tab-feather").isVisible()), "only selected buffer panel is visible");
            await legendColors(`${width}-wide VN buffers`, false);
            const buffer = await page.evaluate(() => ({...window.__tutorialBufferDraw, width: document.getElementById("mgBufferCanvas").width}));
            const panelWidth = Math.floor(buffer.width / 3) - 20;
            for (const [index, operand, label] of [[0, "input", "Input (IVN)"], [1, "weight", "Weight (WVN)"], [2, "result", "Output (OVN)"]]) {
                const title = buffer.text.find(item => item.label === label);
                equal(title.color, colors[operand], `${label}: VN-buffer title uses the exact operand/result color`);
                const left = 15 + index * (panelWidth + 15);
                const cells = buffer.paths.filter(item => item.points.every(point => point[0] >= left && point[0] < left + panelWidth));
                check(cells.length > 0, `${label}: VN-buffer contains actually drawn cell edges`);
                check(cells.every(item => item.color === colors[operand]), `${label}: every populated VN-buffer cell edge has the exact requested color`);
            }
            await page.locator('.mg-tab[data-tab="feather"]').click(); check(await page.locator("#mgFeatherCanvas").isVisible(), "unified graph returns after buffer inspection");
            await noOverflow(`desktop width ${width}`);
            groups.push(`${width}-wide custom ISA: every PE tap, column bus, result path, topology, exact semantic colors, moving pixels, pause/step and buffers`);
        }

        await expandedTool("desktop");

        await page.setViewportSize({width: 390, height: 844}); await page.clock.runFor(150);
        await noOverflow("mobile unified FEATHER");
        await fitDiagram("mobile"); await actualDiagram("mobile"); await expandedTool("mobile");
        await page.screenshot({path: path.join(output, "tutorial-mobile.png"), fullPage: true});
        await page.locator('.mg-tab[data-tab="buffer"]').click(); await noOverflow("mobile buffers");
        await page.locator('.mg-tab[data-tab="feather"]').click();
        await page.locator("#mgPlayBtn").click(); await page.clock.runFor(120);
        await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {configurable: true, value: true});
            document.dispatchEvent(new Event("visibilitychange"));
        });
        const hidden = await state(); await page.clock.runFor(1100);
        equal(await state(), hidden, "hidden document does not advance the tutorial");
        check(!hidden.playing, "hidden document pauses tutorial motion");
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        await page.emulateMedia({reducedMotion: "reduce"});
        for (let attempt = 0; attempt < 40 && !(await page.evaluate(() => mgReducedMotion.matches)); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25)); await page.clock.runFor(32);
        }
        check(await page.evaluate(() => mgReducedMotion.matches), "tutorial respects system reduced-motion preference");
        await action("mgGenerateAnimation()"); await page.locator("#mgPlayBtn").click();
        const reducedPixels = await canvasPixels(), reducedFrame = (await state()).frame;
        await page.clock.runFor(400);
        equal(await canvasPixels(), reducedPixels, "reduced-motion tutorial uses static snapshots without traveling pixels");
        equal((await state()).frame, reducedFrame, "reduced-motion frame remains stable before next discrete step");
        await page.clock.runFor(700);
        equal((await state()).frame, reducedFrame + 1, "reduced-motion playback retains discrete advance");
        await page.locator("#mgPlayBtn").click();
        await page.locator("#mgNestSize").selectOption("8");
        equal((await state()).hardware.AW, 8, "original hardware dropdown applies changes");
        equal((await state()).count, 0, "hardware edits invalidate stale animation frames");
        await page.locator("#mgSramMB").fill("8"); await page.locator("#mgSramMB").press("Tab");
        equal((await state()).hardware.sram_mb, 8, "original SRAM control applies custom capacity");
        await page.reload({waitUntil: "load"}); await page.clock.runFor(150);
        equal((await state()).instructions, initial.instructions, "refresh still resets the original tutorial editor");
        equal((await state()).hardware.AW, 4, "refresh still resets generic hardware to four-wide");
        equal(errors, [], "no JavaScript, local asset or console errors");
        check(requests.every(url => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), "only pre-existing optional webfont requests");
        groups.push("mobile containment, refresh defaults, local assets and error-free rendering");
        const report = {status: "PASS", html, assertions, browser: browser.version(), groups,
            topology_widths: [4, 8, 16], errors, requests, dialogs,
            screenshots: ["tutorial-4.png", "tutorial-8.png", "tutorial-16.png", "tutorial-mobile.png"]};
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(`PASS ${assertions} assertions; report and screenshots: ${output}`);
    } catch (error) {
        await page.screenshot({path: path.join(output, "failure.png"), fullPage: true}).catch(() => {});
        await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({status: "FAIL", assertions, groups, errors,
            error: String(error.stack || error)}, null, 2) + "\n");
        throw error;
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
