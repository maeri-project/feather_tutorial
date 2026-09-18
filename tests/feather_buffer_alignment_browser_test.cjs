#!/usr/bin/env node
/* Regression for shared architectural/VN-buffer layouts and contained writes.
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node \
 *   tests/feather_buffer_alignment_browser_test.cjs --out /tmp/buffer-alignment
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
const html = path.resolve(argument("--html", path.join(repository, "FEATHER.html")));
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function check(value, message) { assert(value, message); assertions++; }
function near(actual, expected, message) { check(Math.abs(actual - expected) < 0.01, `${message}: ${actual} versus ${expected}`); }

// Independently flatten the ISA's layout dimensions. Neither test expectations
// nor the cross-view comparison call the application's shared address model.
const permutations = {
    I: [[2, 0, 1], [2, 1, 0], [0, 2, 1], [0, 1, 2], [1, 2, 0], [1, 0, 2]],
    W: [[2, 0, 1], [2, 1, 0], [0, 2, 1], [0, 1, 2], [1, 2, 0], [1, 0, 2]],
    O: [[1, 0, 2], [1, 2, 0], [0, 1, 2], [0, 2, 1], [2, 1, 0], [2, 0, 1]],
};
function expectedScalar(operand, width, order, dimensions, bank, scalarRow) {
    const lane = scalarRow % width, vnRow = Math.floor(scalarRow / width);
    const vnIndex = vnRow * width + bank;
    if (vnIndex >= dimensions.reduce((product, value) => product * value, 1)) return null;
    const indices = [0, 0, 0], permutation = permutations[operand][order];
    let remaining = vnIndex;
    for (let i = 2; i >= 0; i--) {
        const dimension = permutation[i];
        indices[dimension] = remaining % dimensions[dimension];
        remaining = Math.floor(remaining / dimensions[dimension]);
    }
    const first = indices[0] + dimensions[0] * indices[1], second = indices[2] * width + lane;
    const label = operand === "I" ? `A[${first},${second}]` : operand === "W" ?
        `B[${second},${first}]` : `C[${first},${second}]`;
    return {bank, scalarRow, vnRow, vnIndex, lane, label};
}
function trace(width, order, options = {}) {
    const dimensions = options.dimensions || [width, 2, 2];
    const [a0, a1, a2] = dimensions, high = options.high || false;
    return {version: "1.0", hardware: {AH: width, AW: width, sram_mb: 4},
        workload: {M: a0 * a1, K: width * a2, N: a0 * a1}, instructions: [
            {type: "SetOVNLayout", params: {order, P_L0: a0, P_L1: a1, Q_L1: a2}},
            {type: "SetIVNLayout", params: {order, M_L0: a0, M_L1: a1, J_L1: a2}},
            {type: "SetWVNLayout", params: {order, N_L0: a0, N_L1: a1, K_L1: a2}},
            {type: "ExecuteMapping", params: {r0: high ? 1 : 0, c0: high ? width + 1 : 0,
                Gr: width / 2, Gc: 1, sr: 1, sc: 0}},
            {type: "ExecuteStreaming", params: {dataflow: 1, m_0: high ? width * 7 + 1 : 0,
                s_m: 1, T: width, vn_size: width - 1}},
        ]};
}
function identity(cell) {
    return Object.fromEntries(["bank", "scalarRow", "vnRow", "vnIndex", "lane", "label", "valid", "written", "status"]
        .map(key => [key, cell[key]]));
}
function inside(point, bounds, message, margin = 0) {
    check(point[0] >= bounds.x + margin - 0.01 && point[0] <= bounds.x + bounds.width - margin + 0.01 &&
        point[1] >= bounds.y + margin - 0.01 && point[1] <= bounds.y + bounds.height - margin + 0.01,
    `${message}: (${point}) inside ${JSON.stringify(bounds)}`);
}

async function main() {
    const output = path.resolve(argument("--out", null) || await fs.mkdtemp(path.join(os.tmpdir(), "feather-buffer-alignment-")));
    check(output !== repository && !output.startsWith(repository + path.sep), "browser artifacts remain outside the repository");
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1600, height: 1100}, reducedMotion: "no-preference"});
    await context.route(/^https?:\/\//, async route => {
        if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url()))
            await route.fulfill({status: 200, contentType: "text/css", body: ""});
        else await route.abort();
    });
    const page = await context.newPage(), errors = [], dialogs = [], groups = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    async function load(value, generate = false) {
        await page.locator("#mgLoadFile").setInputFiles({name: "alignment_trace.json", mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify(value))});
        await page.waitForFunction(expected => JSON.stringify(mgInstructions) === JSON.stringify(expected), value.instructions);
        if (generate) await page.locator('button[onclick="mgGenerateAnimation()"]').click();
    }
    async function views(index = null, progress = 1) {
        return page.evaluate(({index, progress}) => {
            mgStopAnim();
            if (index !== null) { mgCurrentFrame = index; mgFrameProgress = progress; }
            mgSwitchTab("feather");
            const canvas = document.getElementById("mgFeatherCanvas");
            const architectural = {cells: JSON.parse(canvas.dataset.bufferCells || "null"),
                windows: JSON.parse(canvas.dataset.bufferWindows || "null"),
                tokens: JSON.parse(canvas.dataset.bufferTokens || "[]"),
                packets: JSON.parse(canvas.dataset.motionPackets || "[]"),
                events: JSON.parse(canvas.dataset.bufferEvents || "[]"), geometry: structuredClone(mgFeatherGeometry)};
            mgSwitchTab("buffer");
            const detailed = document.getElementById("mgBufferCanvas");
            const vn = {cells: JSON.parse(detailed.dataset.bufferCells || "null"),
                windows: JSON.parse(detailed.dataset.bufferWindows || "null")};
            mgSwitchTab("feather");
            return {architectural, vn, index: mgCurrentFrame, progress: mgFrameProgress};
        }, {index, progress});
    }
    function compareViews(result, width, order, dimensions) {
        check(result.architectural.cells && result.vn.cells, "both buffer views expose their rendered physical scalar cells");
        equal(result.architectural.windows, result.vn.windows, "architecture and VN tab present exactly the same VN-row windows");
        for (const operand of ["I", "W", "O"]) {
            const cells = result.architectural.cells[operand], detailed = result.vn.cells[operand];
            check(cells.length > 0 && cells.length <= 40 * width * width, `${operand}: visible scalar projection stays bounded`);
            equal(cells.map(identity), detailed.map(identity), `${operand}: both views render the same addresses, coordinates and write states`);
            equal([...new Set(cells.map(cell => cell.bank))].sort((a, b) => a - b), Array.from({length: width}, (_, bank) => bank),
                `${operand}: every physical bank is present, even if the final VN row is ragged`);
            const vnRows = [...new Set(cells.map(cell => cell.vnRow))].sort((a, b) => a - b);
            equal(vnRows, result.architectural.windows[operand].vnRows,
                `${operand}: window metadata matches the actual VN rows drawn on canvas`);
            for (const vnRow of vnRows) for (let bank = 0; bank < width; bank++) {
                const lanes = cells.filter(cell => cell.vnRow === vnRow && cell.bank === bank).map(cell => cell.lane);
                equal(lanes, Array.from({length: width}, (_, lane) => lane),
                    `${operand}: VN row ${vnRow}, bank ${bank} contains all AH scalar lanes exactly once`);
            }
            const region = result.architectural.geometry.bufferRegions.find(item => item.operand === operand);
            for (const cell of cells) {
                const expected = expectedScalar(operand, width, order, dimensions, cell.bank, cell.scalarRow);
                if (!expected) { check(!cell.valid, "ragged-bank padding is not invented valid data"); continue; }
                equal(Object.fromEntries(Object.keys(expected).map(key => [key, cell[key]])), expected,
                    `${operand}: rendered bank ${cell.bank}, scalar row ${cell.scalarRow} is independently decoded`);
                inside([cell.x, cell.y], region, `${operand}: scalar center lies inside its visible physical buffer`, 1);
            }
        }
    }
    function addressedTransfers(result) {
        const {cells, tokens, packets, events, geometry} = result.architectural;
        for (const event of events.filter(item => item.valid && (item.phase === "read" || item.arriving))) {
            const cell = cells[event.operand].find(item => item.bank === event.bank && item.scalarRow === event.scalarRow);
            check(cell, `${event.operand}: all simultaneous buffer endpoints have actual visible cells, not edge fallbacks`);
            const token = tokens.find(item => item.operand === event.operand && item.peRow === event.peRow &&
                item.peCol === event.peCol && item.bank === event.bank && item.scalarRow === event.scalarRow && item.phase === event.phase);
            check(token, "each addressed read or arriving partial is represented by a moving token");
            const endpoint = event.phase === "read" ? token.points[0] : token.points.at(-1);
            near(endpoint[0], cell.x, "physical buffer endpoint is the exact bank/lane center (x)");
            near(endpoint[1], cell.y, "physical buffer endpoint is the exact bank/lane center (y)");
            if (event.phase === "preview-write" && result.progress === 1) {
                check(cell.written, "arrived partial remains marked in its actual output scalar");
                const region = geometry.bufferRegions.find(item => item.operand === "O");
                inside([token.x, token.y], region, "arrived output packet is not beyond the output buffer", 1);
            }
        }
        for (const packet of packets.filter(item => item.valid && item.operand === "O" && item.phase === "preview-write")) {
            const region = geometry.bufferRegions.find(item => item.operand === "O");
            if (result.progress !== 1) continue;
            inside([packet.x, packet.y], region, "arrived result marker stays in the output buffer", 1);
            check(packet.renderedBounds, "arrived result publishes its clipped/clamped rendered badge bounds");
            inside([packet.renderedBounds.x, packet.renderedBounds.y], region, "result annotation top-left remains inside its buffer");
            inside([packet.renderedBounds.x + packet.renderedBounds.width, packet.renderedBounds.y + packet.renderedBounds.height],
                region, "result annotation bottom-right remains inside its buffer");
        }
    }
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"}); await page.clock.runFor(150);
        for (const width of [4, 8, 16]) {
            for (let order = 0; order < 6; order++) {
                await load(trace(width, order));
                compareViews(await views(), width, order, [width, 2, 2]);
            }
            await load(trace(width, 5, {dimensions: [width - 1, 1, 1]}));
            const ragged = await views(); compareViews(ragged, width, 5, [width - 1, 1, 1]);
            for (const operand of ["I", "W", "O"])
                check(ragged.architectural.cells[operand].some(cell => !cell.valid && cell.bank === width - 1),
                    `${operand}: a partially occupied VN row keeps its empty final physical bank`);
            groups.push(`${width}-wide shared VN/lane projection: all six ISA layout orders and every physical bank`);
        }
        await load(trace(16, 5, {dimensions: [16, 4096, 1]}));
        const large = await views(); compareViews(large, 16, 5, [16, 4096, 1]);
        for (const operand of ["I", "W", "O"])
            check(large.architectural.cells[operand].length <= 4 * 16 * 16,
                "a large configured buffer renders a bounded initial four-VN-row window");
        groups.push("ragged-bank padding and bounded rendering of large configured buffers");

        for (const width of [4, 8, 16]) {
            const dimensions = [width - 1, 25, 4];
            for (const order of [0, 3, 5]) {
                await load(trace(width, order, {dimensions, high: true}), true);
                const indices = await page.evaluate(() => ({
                    weights: mgAnimFrames.findIndex(frame => frame.aWR.length),
                    input: mgAnimFrames.findIndex(frame => frame.aIR.some(row => frame.pMC[row + ",0"] > 0)),
                    arrivals: mgAnimFrames.flatMap((frame, index) => frame.aOR >= 0 ? [index + mgFeatherGeometry.stages + 1] : [])
                        .filter(index => index < mgAnimFrames.length),
                }));
                check(indices.weights >= 0 && indices.input >= 0 && indices.arrivals.length >= width,
                    "nonzero custom mapping exercises reads and an entire array of output arrivals");
                for (const index of [indices.weights, indices.input, ...indices.arrivals]) {
                    const result = await views(index, 1);
                    compareViews(result, width, order, dimensions); addressedTransfers(result);
                }
                const arrival = indices.arrivals[0], halfway = await views(arrival, 0.5);
                addressedTransfers(halfway);
                const pending = halfway.architectural.events.filter(item => item.operand === "O" && item.arriving && item.valid);
                check(pending.length > 0, "high-address outputs have valid physical destinations");
                check(pending.some(item => item.scalarRow >= width), "regression covers writes beyond the old two-scalar-row miniature");
                for (const event of pending) {
                    const cell = halfway.architectural.cells.O.find(item => item.bank === event.bank && item.scalarRow === event.scalarRow);
                    check(!cell.written, "first arrival is not marked written while traveling to the buffer");
                }
                const complete = await views(arrival, 1); addressedTransfers(complete);
                const rewind = await views(arrival, 0.5);
                equal(rewind.architectural.cells.O.map(identity), halfway.architectural.cells.O.map(identity),
                    "backward scrubbing restores output state without stale written markers");
                if (order === 5) await page.screenshot({path: path.join(output, `aligned-output-${width}.png`)});
            }
            groups.push(`${width}-wide ragged/high-address mappings: exact read/write endpoints, every arriving row, and bounded result annotations`);
        }

        const chronological = trace(4, 0), firstInstructions = chronological.instructions.length;
        chronological.instructions.push(...trace(4, 5).instructions);
        await load(chronological, true);
        const second = await page.evaluate(() => mgAnimFrames.findIndex(frame => frame.iteration === 1));
        check(second > 0 && firstInstructions === 5, "multi-mapping test has chronological layout snapshots");
        compareViews(await views(0), 4, 0, [4, 2, 2]);
        compareViews(await views(second), 4, 5, [4, 2, 2]);
        compareViews(await views(0), 4, 0, [4, 2, 2]);
        const reused = trace(4, 3); reused.instructions.push(...trace(4, 3).instructions.slice(3));
        await load(reused, true);
        const next = await page.evaluate(() => mgAnimFrames.findIndex(frame => frame.iteration === 1));
        const after = await views(next), before = await views(0);
        check(after.architectural.cells.O.some(cell => cell.written), "physical output history survives an EM boundary in both views");
        check(!before.architectural.cells.O.some(cell => cell.written), "rewinding before all writes clears output history in both views");
        groups.push("chronological layout snapshots, reverse navigation, and output SRAM history shared by both tabs");

        await page.setViewportSize({width: 390, height: 844}); await page.clock.runFor(100);
        await load(trace(16, 5), true);
        const mobileArrival = await page.evaluate(() => mgAnimFrames.findIndex(frame => frame.aOR >= 0) + mgFeatherGeometry.stages + 1);
        const mobile = await views(mobileArrival, 1); compareViews(mobile, 16, 5, [16, 2, 2]); addressedTransfers(mobile);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth),
            "expanded physical buffer grids do not overflow the mobile page");
        await page.screenshot({path: path.join(output, "aligned-output-mobile.png")});
        equal(errors, [], "no browser script errors or missing local assets");
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify({status: "PASS", html, assertions,
            browser: browser.version(), groups, errors, dialogs}, null, 2) + "\n");
        console.log(`PASS ${assertions} assertions; report and screenshots: ${output}`);
    } catch (error) {
        await page.screenshot({path: path.join(output, "failure.png"), fullPage: true}).catch(() => {});
        await fs.writeFile(path.join(output, "failure.json"), JSON.stringify({status: "FAIL", assertions, groups, errors,
            error: String(error.stack || error)}, null, 2) + "\n");
        throw error;
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
