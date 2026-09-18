#!/usr/bin/env node
/* Browser regression for the architecture's bank/scalar buffer inspectors.
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node \
 *   tests/feather_buffer_browser_test.cjs --out /tmp/feather-buffer-browser
 * Keep screenshots, reports, and downloaded browser packages outside the repo.
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

// Written independently of the app model. The three loop dimensions for each
// operand are flattened in the ISA's listed outer-to-inner order; a VN spans AH
// scalar lanes, while successive VNs interleave across AW physical banks.
const permutations = {
    I: [[2, 0, 1], [2, 1, 0], [0, 2, 1], [0, 1, 2], [1, 2, 0], [1, 0, 2]],
    W: [[2, 0, 1], [2, 1, 0], [0, 2, 1], [0, 1, 2], [1, 2, 0], [1, 0, 2]],
    O: [[1, 0, 2], [1, 2, 0], [0, 1, 2], [0, 2, 1], [2, 1, 0], [2, 0, 1]],
};
function expectedScalar(operand, width, order, bank, scalarRow, a1 = 2, a2 = 2) {
    const lane = scalarRow % width, vnRow = Math.floor(scalarRow / width);
    const vnIndex = vnRow * width + bank, dimensions = [width, a1, a2];
    if (vnIndex >= dimensions.reduce((a, b) => a * b, 1)) return null;
    const indices = [0, 0, 0], permutation = permutations[operand][order];
    let remaining = vnIndex;
    for (let i = 2; i >= 0; i--) {
        const dimension = permutation[i];
        indices[dimension] = remaining % dimensions[dimension];
        remaining = Math.floor(remaining / dimensions[dimension]);
    }
    const first = indices[0] + width * indices[1], second = indices[2] * width + lane;
    const label = operand === "I" ? `A[${first},${second}]` : operand === "W" ?
        `B[${second},${first}]` : `C[${first},${second}]`;
    return {bank, scalarRow, vnRow, vnIndex, lane, label};
}
function trace(width, order = 0, options = {}) {
    const {a1 = 2, a2 = 2, dataflow = 1} = options;
    return {version: "1.0", hardware: {AH: width, AW: width, sram_mb: 4},
        workload: {M: width * a1, K: width * a2, N: width * a1}, instructions: [
            {type: "SetOVNLayout", params: {order, P_L0: width, P_L1: a1, Q_L1: a2}},
            {type: "SetIVNLayout", params: {order, M_L0: width, M_L1: a1, J_L1: a2}},
            {type: "SetWVNLayout", params: {order, N_L0: width, N_L1: a1, K_L1: a2}},
            {type: "ExecuteMapping", params: {r0: 0, c0: 0, Gr: width / 2, Gc: 1, sr: 1, sc: 0}},
            {type: "ExecuteStreaming", params: {dataflow, m_0: 0, s_m: 1, T: width, vn_size: width - 1}},
        ]};
}

async function main() {
    const output = path.resolve(argument("--out", null) || await fs.mkdtemp(path.join(os.tmpdir(), "feather-buffer-browser-")));
    check(output !== repository && !output.startsWith(repository + path.sep), "browser artifacts remain outside the repository");
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1600, height: 1100}, reducedMotion: "no-preference"});
    const errors = [], dialogs = [], groups = [];
    await context.route(/^https?:\/\//, async route => {
        if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url()))
            await route.fulfill({status: 200, contentType: "text/css", body: ""});
        else await route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
    const action = call => page.locator(`button[onclick="${call}"]`).click();
    const popup = page.locator("#mgBufferPopup");
    async function load(value) {
        await page.locator("#mgLoadFile").setInputFiles({name: "buffer_trace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value))});
        await page.waitForFunction(expected => JSON.stringify(mgInstructions) === JSON.stringify(expected), value.instructions);
    }
    async function noOverflow(label) {
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth),
            `${label}: no page-wide horizontal overflow`);
    }
    async function selectKind(operand) {
        await popup.locator(`[data-buffer-kind="${operand}"]`).click();
        equal(await popup.getAttribute("data-operand"), operand, "popup selection identifies the chosen physical buffer");
    }
    async function cells() {
        return page.locator("#mgBufferPopupGrid button[data-bank]").evaluateAll(nodes => nodes.map(node => ({
            bank: Number(node.dataset.bank), scalarRow: Number(node.dataset.scalarRow),
            vnRow: Number(node.dataset.vnRow), vnIndex: Number(node.dataset.vnIndex),
            lane: Number(node.dataset.lane), label: node.dataset.label,
            state: node.dataset.transferState, disabled: node.disabled,
        })));
    }
    async function checkCells(operand, width, order, a1 = 2, a2 = 2) {
        const visible = await cells();
        check(visible.length > 0 && visible.length <= 16 * width, "inspector renders a bounded nonempty scalar-row page");
        for (const cell of visible) {
            const expected = expectedScalar(operand, width, order, cell.bank, cell.scalarRow, a1, a2);
            if (!expected) continue;
            equal(Object.fromEntries(Object.keys(expected).map(key => [key, cell[key]])), expected,
                `${operand} order ${order}: physical bank ${cell.bank}, scalar row ${cell.scalarRow} resolves to the exact logical element`);
        }
    }
    async function openButton(operand) {
        await page.locator(`#mgInspect${operand}`).click();
        check(await popup.isVisible(), `${operand}: accessible figure control opens its layout inspector`);
        equal(await popup.getAttribute("data-operand"), operand, "figure and inspector use the same operand identity");
    }
    async function close() {
        if (await popup.isVisible()) await page.locator("#mgBufferPopupClose").click();
    }
    async function clickBuffer(operand, scale) {
        await close();
        await page.locator("#mgDiagramScale").selectOption(scale);
        const target = await page.evaluate(operand => {
            const region = mgFeatherGeometry.bufferRegions.find(item => item.operand === operand);
            return {x: (region.x + region.width / 2) * mgFeatherGeometry.scale,
                y: (region.y + region.height / 2) * mgFeatherGeometry.scale};
        }, operand);
        await page.locator("#mgFeatherCanvas").click({position: target});
        check(await popup.isVisible(), `${scale}: clicking the ${operand} buffer in the actual canvas opens its inspector`);
        equal(await popup.getAttribute("data-operand"), operand, "canvas hit testing maps display coordinates to the right buffer");
    }
    async function frame(index, progress = 1) {
        return page.evaluate(({index, progress}) => {
            mgStopAnim(); mgCurrentFrame = index; mgFrameProgress = progress;
            mgUpdateAnimDisplay();
            const canvas = document.getElementById("mgFeatherCanvas");
            return {events: JSON.parse(canvas.dataset.bufferEvents || "[]"),
                tokens: JSON.parse(canvas.dataset.bufferTokens || "[]"),
                resultTokens: JSON.parse(canvas.dataset.resultTokens || "[]"),
                width: mgHW.AW, frame: structuredClone(mgAnimFrames[index]),
                geometry: structuredClone(mgFeatherGeometry)};
        }, {index, progress});
    }
    async function pixelHash() {
        return page.locator("#mgFeatherCanvas").evaluate(canvas => {
            const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 2166136261;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            return hash;
        });
    }
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"});
        await page.clock.runFor(150);
        equal(await popup.getAttribute("role"), "dialog", "buffer detail is exposed as an accessible dialog");
        equal(await popup.getAttribute("aria-modal"), "false", "buffer inspection remains modeless so the architecture keeps moving");

        for (const scale of ["fit", "actual"]) {
            for (const operand of ["I", "W", "O"]) await clickBuffer(operand, scale);
        }
        await close(); await page.locator("#mgDiagramScale").selectOption("fit");
        for (const operand of ["I", "W", "O"]) {
            await openButton(operand); await page.keyboard.press("Escape");
            check(!(await popup.isVisible()), "Escape dismisses only the buffer inspector");
            equal(await page.evaluate(() => document.activeElement.id), `mgInspect${operand}`, "closing inspection restores focus to its figure button");
        }
        await openButton("I");
        const rightBounds = await popup.boundingBox();
        await page.locator("#mgBufferPopupDock").click();
        equal(await popup.getAttribute("data-dock"), "left", "desktop inspector can move away from the accelerator diagram");
        equal(await page.locator("#mgBufferPopupDock").innerText(), "Move right", "dock button clearly offers the reverse action");
        const leftBounds = await popup.boundingBox();
        check(leftBounds.x < rightBounds.x && leftBounds.x >= 0 && leftBounds.width === rightBounds.width,
            "moving the popup changes its side without clipping or resizing its data grid");
        const lightColors = await popup.evaluate(node => ({background: getComputedStyle(node).backgroundColor,
            color: getComputedStyle(node).color}));
        await page.locator("#theme-toggle").click();
        await page.clock.runFor(350);
        equal(await page.locator("html").getAttribute("data-theme"), "dark", "site theme toggle remains usable during buffer inspection");
        const darkColors = await popup.evaluate(node => ({background: getComputedStyle(node).backgroundColor,
            color: getComputedStyle(node).color}));
        check(darkColors.background !== lightColors.background && darkColors.color !== lightColors.color,
            "popup background and text follow the site's dark template");
        equal(darkColors, {background: "rgb(26, 29, 45)", color: "rgb(241, 245, 249)"},
            "dark inspector uses the existing template's card and text tokens");
        equal(await page.locator("#mgBufferPopupGrid button[data-bank]").first().evaluate(node => getComputedStyle(node).color),
            "rgb(0, 76, 153)", "dark theme preserves the requested semantic input color on light data cells");
        await page.screenshot({path: path.join(output, "buffer-dark-left.png")});
        await page.locator("#theme-toggle").click();
        await page.clock.runFor(350);
        await page.locator("#mgBufferPopupDock").click();
        equal(await popup.getAttribute("data-dock"), "right", "the popup can return to its original desktop side");
        await close();
        groups.push("actual canvas hit testing in fit and full-resolution views; accessible controls, focus return, movable docking and dark template");

        for (const width of [4, 8, 16]) {
            for (let order = 0; order < 6; order++) {
                await load(trace(width, order)); await openButton("I");
                for (const operand of ["I", "W", "O"]) {
                    await selectKind(operand); await checkCells(operand, width, order);
                    const first = (await cells()).find(cell => !cell.disabled);
                    await page.locator(`#mgBufferPopupGrid button[data-bank="${first.bank}"][data-scalar-row="${first.scalarRow}"]`).click();
                    const details = await page.locator("#mgBufferPopupDetails").innerText();
                    check(details.includes(first.label), "selecting a scalar exposes its exact logical coordinate");
                    check(/bank/i.test(details) && /lane/i.test(details), "scalar details describe the physical bank and VN lane");
                    if (width === 4 && order === 0 && operand === "I") {
                        await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowDown");
                        equal(await page.evaluate(() => ({bank: Number(document.activeElement.dataset.bank),
                            row: Number(document.activeElement.dataset.scalarRow)})),
                        {bank: first.bank + 1, row: first.scalarRow + 1}, "arrow keys navigate actual physical bank/scalar-row cells");
                    }
                    await page.locator("#mgBufferPopupNext").click();
                    await checkCells(operand, width, order);
                    check((await cells()).some(cell => cell.scalarRow >= 8), "next page exposes additional physical scalar rows");
                    await page.locator("#mgBufferPopupPrev").click();
                    await checkCells(operand, width, order);
                }
                await close();
            }
            groups.push(`${width}-wide: all six IVN/WVN/OVN layout orders, physical addresses, lane identities, paging and scalar details`);
        }

        await load(trace(4, 0, {a1: 4096, a2: 1})); await openButton("I");
        check((await cells()).length <= 64, "a large valid layout never materializes its full virtual address space");
        await page.locator("#mgBufferPopupRow").fill("16000"); await page.locator("#mgBufferPopupGo").click();
        await checkCells("I", 4, 0, 4096, 1);
        check((await cells()).some(cell => cell.scalarRow >= 16000), "direct scalar-row navigation reaches distant valid addresses");
        await close();
        groups.push("bounded rendering and direct address navigation for a large layout");

        for (const width of [4, 8, 16]) {
            await load(trace(width, 3)); await action("mgGenerateAnimation()");
            const indices = await page.evaluate(() => ({
                weights: mgAnimFrames.findIndex(item => item.aWR.length),
                input: mgAnimFrames.findIndex(item => item.aIR.some(row => item.pMC[row + ',0'] > 0)),
                issue: mgAnimFrames.findIndex(item => item.aOR >= 0),
                stages: mgFeatherGeometry.stages,
            }));
            check(indices.weights >= 0 && indices.input >= 0 && indices.issue >= 0, "trace contains stationary loads, streaming MAC reads and PE result issues");
            for (const [operand, index] of [["W", indices.weights], ["I", indices.input]]) {
                await openButton(operand);
                const beginning = await frame(index, 0), hashBefore = await pixelHash();
                const moving = await frame(index, 0.5), hashMiddle = await pixelHash();
                const arrived = await frame(index, 1);
                check(hashBefore !== hashMiddle, "specific addressed data packets visibly travel between the buffer and NEST");
                const events = moving.events.filter(item => item.operand === operand && item.phase === "read" && item.valid);
                check(events.length > 0, `${operand}: scalar-level read events identify real source locations`);
                for (const event of events) {
                    const expected = expectedScalar(operand, width, 3, event.bank, event.scalarRow);
                    check(expected, "animated read source lies inside the configured layout");
                    for (const key of Object.keys(expected)) equal(event[key], expected[key], `${operand}: moving ${key} matches independently decoded buffer address`);
                    const kg = Math.floor(event.peCol / (width / 2));
                    const t = Math.floor((moving.frame.pMC[`${event.peRow},${event.peCol}`] - 1) / width);
                    const expectedLabel = operand === "W" ? `B[${kg * width + event.lane},${event.peRow}]` :
                        `A[${t + event.peCol % (width / 2)},${kg * width + event.lane}]`;
                    equal(event.label, expectedLabel, "the selected physical scalar matches this PE's ExecuteMapping and dot-product lane");
                    const token = moving.tokens.find(item => item.operand === operand && item.bank === event.bank &&
                        item.scalarRow === event.scalarRow && item.peRow === event.peRow && item.peCol === event.peCol);
                    check(token, "every valid read is drawn as a packet carrying the same source address and PE destination");
                    check(Number.isFinite(token.x) && Number.isFinite(token.y), "packet coordinates are finite");
                    const cell = moving.geometry.bufferCells[operand].find(item => item.bank === event.bank && item.scalarRow === event.scalarRow);
                    if (cell) equal(token.points[0], [cell.x, cell.y], "read packet originates at the exact highlighted miniature-buffer cell");
                    const geometry = moving.geometry;
                    equal(token.points.at(-1), [geometry.left + event.peCol * geometry.pitch + geometry.cell / 2,
                        geometry.top + event.peRow * geometry.pitch + geometry.cell / 2],
                    "addressed read packet terminates at its mapped PE, not a generic array arrow");
                }
                check(beginning.tokens.some((item, i) => arrived.tokens[i] &&
                    (item.x !== arrived.tokens[i].x || item.y !== arrived.tokens[i].y)), "address-preserving packets reach a different on-canvas endpoint");
                const highlighted = (await cells()).filter(cell => cell.state && !["idle", "none", ""].includes(cell.state));
                check(highlighted.length > 0, "open layout highlights specific source scalars during addressed reads");
                const entry = page.locator("#mgBufferPopupEvents button[data-bank]").first();
                const address = {bank: await entry.getAttribute("data-bank"), row: await entry.getAttribute("data-scalar-row")};
                await entry.click();
                equal(await page.locator(`#mgBufferPopupGrid button[data-bank="${address.bank}"][data-scalar-row="${address.row}"]`).getAttribute("aria-pressed"),
                    "true", "clicking an addressed transfer selects its exact scalar in the physical buffer grid");
                check(!(await page.locator("#mgBufferPopupFollow").isChecked()), "manual transfer selection does not get overwritten by auto-follow");
                await page.locator("#mgBufferPopupFollow").check();
                const firstActive = arrived.events.find(item => item.operand === operand && item.valid);
                equal(await page.locator(`#mgBufferPopupGrid button[data-bank="${firstActive.bank}"][data-scalar-row="${firstActive.scalarRow}"]`).getAttribute("aria-pressed"),
                    "true", "follow-active mode navigates to the actual current read source");
                await close();
            }
            await openButton("O");
            for (let age = 0; age <= indices.stages; age++) {
                const step = await frame(indices.issue + age, 1);
                check(!step.events.some(item => item.phase === "preview-write" && item.status === "preview-written"),
                    "no output-buffer write is reported while the earliest PE row is still on its bus or in BIRRD");
            }
            const writing = await frame(indices.issue + indices.stages + 1, 0.5);
            check(writing.events.some(item => item.phase === "preview-write" && item.status === "in-flight"),
                "BIRRD-to-output packets identify their target before arrival");
            check(!writing.events.some(item => item.phase === "preview-write" && item.status === "preview-written"),
                "output location is not marked written halfway along the final wire");
            const written = await frame(indices.issue + indices.stages + 1, 1);
            const writes = written.events.filter(item => item.phase === "preview-write" && item.status === "preview-written" && item.valid);
            check(writes.length > 0, "output-buffer preview writes occur on BIRRD packet arrival");
            for (const event of writes) {
                const expected = expectedScalar("O", width, 3, event.bank, event.scalarRow);
                check(expected, "output target lies inside configured OVN layout");
                for (const key of ["bank", "scalarRow", "vnRow", "vnIndex", "lane"]) equal(event[key], expected[key], "output event resolves the physical destination scalar");
                const source = await page.evaluate(index => structuredClone(mgAnimFrames[index]), indices.issue);
                const t = Math.floor((source.pMC[`${event.peRow},${event.peCol}`] - 1) / width);
                equal(expected.label, `C[${t + event.peCol % (width / 2)},${event.peRow}]`,
                    "output destination is this issuing PE's logical C coordinate, not a physical-port index");
                check(event.partial, "PASS topology preview does not misrepresent a PE partial as a fully reduced matrix result");
            }
            const visibleWrite = page.locator('#mgBufferPopupEvents button[data-transfer-state="preview-written"]').first();
            const writeAddress = {bank: await visibleWrite.getAttribute("data-bank"), row: await visibleWrite.getAttribute("data-scalar-row")};
            await visibleWrite.click();
            const writtenCell = page.locator(`#mgBufferPopupGrid button[data-bank="${writeAddress.bank}"][data-scalar-row="${writeAddress.row}"]`);
            equal(await writtenCell.getAttribute("data-transfer-state"), "preview-written", "destination cell visibly changes state only when its partial result arrives");
            equal(await writtenCell.getAttribute("data-partial"), "true", "arrived output cell keeps its partial-result identity");
            await frame(indices.issue + indices.stages + 1, 0.5);
            equal(await writtenCell.getAttribute("data-transfer-state"), "in-flight", "scrubbing before arrival removes the previously written cell state");
            await frame(indices.issue + indices.stages + 1, 1);
            check(/partial|preview/i.test(await page.locator("#mgBufferPopup").innerText()), "output inspector explicitly identifies partial/topology-only writes");
            await page.screenshot({path: path.join(output, `buffer-output-${width}.png`)});
            await close();
            groups.push(`${width}-wide: scalar reads, visible addressed packets, layout highlights, delayed BIRRD writeback and partial-result honesty`);
        }

        const chronological = trace(4, 0);
        chronological.instructions.push(...trace(4, 5).instructions);
        await load(chronological); await action("mgGenerateAnimation()"); await openButton("I");
        await frame(0); await checkCells("I", 4, 0);
        const secondMapping = await page.evaluate(() => mgAnimFrames.findIndex(item => item.iteration === 1));
        check(secondMapping > 0, "multiple execute mappings retain distinct animation snapshots");
        await frame(secondMapping); await checkCells("I", 4, 5);
        await frame(0); await checkCells("I", 4, 0);
        await close();
        const reusedBuffer = trace(4, 0);
        reusedBuffer.instructions.push(...trace(4, 0).instructions.slice(3));
        await load(reusedBuffer); await action("mgGenerateAnimation()"); await openButton("O");
        const nextEM = await page.evaluate(() => mgAnimFrames.findIndex(item => item.iteration === 1));
        await frame(nextEM);
        const historicalCell = page.locator('#mgBufferPopupGrid button[data-bank="0"][data-scalar-row="0"]');
        check(await historicalCell.evaluate(node => node.classList.contains("mg-buffer-cell-written")),
            "output-buffer memory retains a previously arrived partial across a later EM using the same layout");
        await frame(0);
        check(!(await historicalCell.evaluate(node => node.classList.contains("mg-buffer-cell-written"))),
            "scrubbing before the historical write removes its written marker");
        await close();
        groups.push("chronological per-EM layout snapshots, cross-EM physical output history and backwards navigation");

        await load(trace(4, 2, {dataflow: 0})); await action("mgGenerateAnimation()");
        const ioReads = await page.evaluate(() => {
            const index = mgAnimFrames.findIndex(item => item.aIR.some(row => item.pMC[row + ',0'] > 0));
            mgCurrentFrame = index; mgFrameProgress = 1; mgUpdateAnimDisplay();
            return JSON.parse(document.getElementById("mgFeatherCanvas").dataset.bufferEvents || "[]");
        });
        for (const event of ioReads.filter(item => item.valid && item.phase === "read")) {
            const expected = expectedScalar(event.operand, 4, 2, event.bank, event.scalarRow);
            const indices = expected && expected.label.match(/\[(\d+),(\d+)\]/);
            const label = indices && `${event.operand === "I" ? "B" : "A"}[${indices[2]},${indices[1]}]`;
            check(expected && label === event.label, "IO-S preview preserves operand-specific physical address decoding");
        }
        check(ioReads.some(item => item.valid && item.phase === "read"), "IO-S generates explicitly addressed read events");
        await openButton("I");
        check(/illustrative|preview|not.*RTL/i.test(await popup.innerText()), "IO-S inspector does not imply cycle-accurate deployed hardware execution");
        await close();

        const incomplete = trace(4, 0); incomplete.instructions = incomplete.instructions.slice(3);
        await load(incomplete); await action("mgGenerateAnimation()"); await openButton("I");
        check(/missing|unavailable|not configured|no .*layout|invalid/i.test(await popup.innerText()), "missing layout has an explicit diagnostic instead of an invented data layout");
        const invalid = await frame(0);
        check(!invalid.events.some(item => item.valid), "invalid configuration produces no falsely valid physical read/write addresses");
        await close();
        groups.push("addressed IO-S teaching preview and honest handling of unconfigured buffers");

        await load(trace(4, 2)); await action("mgGenerateAnimation()"); await openButton("W");
        await page.locator("#mgBufferPopupPlay").click(); await page.clock.runFor(200);
        check(await page.evaluate(() => mgPlaying), "inspector can start the architecture's shared animation clock");
        await page.locator("#mgBufferPopupPlay").click();
        const paused = await page.evaluate(() => ({frame: mgCurrentFrame, progress: mgFrameProgress}));
        await page.clock.runFor(1500);
        equal(await page.evaluate(() => ({frame: mgCurrentFrame, progress: mgFrameProgress})), paused,
            "pause in the inspector freezes both addressed transfers and architecture motion");
        await page.locator("#mgBufferPopupStep").click();
        equal(await page.evaluate(() => mgCurrentFrame), paused.frame + 1, "inspector step advances the same architecture frame");
        check(!(await page.evaluate(() => mgPlaying)), "inspector stepping does not leave a second clock running");
        await page.locator("#mg-buffer-tab").click();
        const offTabFrame = await page.evaluate(() => mgCurrentFrame);
        await page.locator("#mgBufferPopupStep").click();
        check((await page.locator("#mgBufferPopupState").innerText()).startsWith(`Frame ${offTabFrame + 1} ·`),
            "inspector stepping stays synchronized even while the separate VN Buffers tab is visible");
        await page.locator("#mg-feather-tab").click();
        await page.locator("#mgBufferPopupPlay").click(); await page.clock.runFor(150);
        await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {configurable: true, value: true});
            document.dispatchEvent(new Event("visibilitychange"));
        });
        check(!(await page.evaluate(() => mgPlaying)), "hiding the document pauses an animation started from the inspector");
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        await page.emulateMedia({reducedMotion: "reduce"});
        for (let attempt = 0; attempt < 40 && !(await page.evaluate(() => mgReducedMotion.matches)); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25)); await page.clock.runFor(32);
        }
        check(await page.evaluate(() => mgReducedMotion.matches), "system reduced-motion preference is respected by buffer transfers");
        await page.locator("#mgBufferPopupPlay").click();
        const reduced = await pixelHash(); await page.clock.runFor(300);
        equal(await pixelHash(), reduced, "reduced motion does not interpolate traveling addressed buffer packets");
        await page.locator("#mgBufferPopupPlay").click();
        await page.emulateMedia({reducedMotion: "no-preference"}); await page.clock.runFor(100);
        await close();
        groups.push("shared popup/architecture playback, pause, step, hidden-document stop and reduced-motion snapshots");

        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(32);
        await openButton("I");
        check(await page.locator("#mgBufferPopupClose").evaluate(node => {
            const rect = node.getBoundingClientRect();
            return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === node;
        }), "inspector remains interactive above the expanded architecture");
        await page.keyboard.press("Escape");
        check(!(await popup.isVisible()), "first Escape closes buffer inspection");
        equal(await page.locator("#mgExpandBtn").getAttribute("aria-pressed"), "true", "closing the inspector does not also collapse the expanded diagram");
        await page.keyboard.press("Escape");
        equal(await page.locator("#mgExpandBtn").getAttribute("aria-pressed"), "false", "a subsequent Escape restores the architecture");

        await page.setViewportSize({width: 390, height: 844}); await page.clock.runFor(200);
        await openButton("O"); await noOverflow("mobile buffer inspector");
        check(!(await page.locator("#mgBufferPopupDock").isVisible()), "mobile layout hides irrelevant desktop side-switching");
        check(await popup.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
        }), "modeless inspector fits inside a narrow viewport");
        await page.screenshot({path: path.join(output, "buffer-mobile.png")});
        await close(); await page.setViewportSize({width: 1600, height: 1100}); await page.clock.runFor(200);
        await openButton("I"); await action("mgClearAll()");
        equal(await page.evaluate(() => mgAnimFrames.length), 0, "clearing ISA invalidates previous scalar transfers");
        equal(await page.evaluate(() => JSON.parse(document.getElementById("mgFeatherCanvas").dataset.bufferEvents || "[]")), [],
            "no stale addressed events remain after clearing the trace");
        if (await popup.isVisible()) check(!(await cells()).some(cell => cell.state === "reading" || cell.state === "preview-written"),
            "an open popup cannot retain active buffer highlights from a cleared trace");
        await close();
        groups.push("expanded-view Escape isolation, mobile bounds, and stale-transfer invalidation");

        equal(errors, [], "no browser script or local asset failures");
        const report = {status: "PASS", html, assertions, browser: browser.version(), groups, errors, dialogs};
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
