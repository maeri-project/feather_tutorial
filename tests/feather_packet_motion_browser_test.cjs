#!/usr/bin/env node
/* Distinct packet provenance, visible motion and shared-clock detail controls.
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node \
 *   tests/feather_packet_motion_browser_test.cjs --out /tmp/feather-packet-motion
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
const palette = {I: "#004c99", W: "#006633", partial: "#4c0099", result: "#990000"};
let assertions = 0;
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function check(value, message) { assert(value, message); assertions++; }
function near(actual, expected, message) { check(Math.abs(actual - expected) < 0.05, `${message}: ${actual} vs ${expected}`); }
function trace(width) {
    return {version: "1.0", hardware: {AH: width, AW: width, sram_mb: 4},
        workload: {M: width * 4, K: width * 2, N: width * 2}, instructions: [
            {type: "SetOVNLayout", params: {order: 3, P_L0: width, P_L1: 4, Q_L1: 2}},
            {type: "SetIVNLayout", params: {order: 3, M_L0: width, M_L1: 4, J_L1: 2}},
            {type: "SetWVNLayout", params: {order: 3, N_L0: width, N_L1: 2, K_L1: 2}},
            {type: "ExecuteMapping", params: {r0: 0, c0: 0, Gr: width / 2, Gc: 1, sr: 1, sc: 0}},
            {type: "ExecuteStreaming", params: {dataflow: 1, m_0: 0, s_m: 1, T: width * 2, vn_size: width - 1}},
        ]};
}

async function main() {
    const output = path.resolve(argument("--out", null) || await fs.mkdtemp(path.join(os.tmpdir(), "feather-packet-motion-")));
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
    const select = page.locator("#mgMotionSelect"), diagram = page.locator("#mgMotionDiagram");
    async function load(width) {
        const value = trace(width);
        await page.locator("#mgLoadFile").setInputFiles({name: "packet_trace.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value))});
        await page.waitForFunction(expected => JSON.stringify(mgInstructions) === JSON.stringify(expected), value.instructions);
        await page.locator('button[onclick="mgGenerateAnimation()"]').click();
    }
    async function frame(index, progress = 1) {
        return page.evaluate(({index, progress}) => {
            mgStopAnim(); mgCurrentFrame = index; mgFrameProgress = progress; mgUpdateAnimDisplay();
            const canvas = document.getElementById("mgFeatherCanvas");
            return {packets: JSON.parse(canvas.dataset.motionPackets || "[]"), geometry: structuredClone(mgFeatherGeometry),
                frame: structuredClone(mgAnimFrames[index]), index: mgCurrentFrame, progress: mgFrameProgress};
        }, {index, progress});
    }
    async function state() {
        return page.evaluate(() => ({frame: mgCurrentFrame, progress: mgFrameProgress, playing: mgPlaying}));
    }
    async function lens() {
        return diagram.evaluate(node => ({key: node.dataset.selectedKey, progress: Number(node.dataset.progress),
            x: Number(node.dataset.packetX), y: Number(node.dataset.packetY),
            start: Number(node.dataset.startX), end: Number(node.dataset.endX)}));
    }
    async function scrub(percent) {
        await page.locator("#mgMotionScrub").evaluate((node, percent) => {
            node.value = String(percent); node.dispatchEvent(new Event("input", {bubbles: true}));
        }, percent);
    }
    async function pixels() {
        return page.locator("#mgFeatherCanvas").evaluate(canvas => {
            const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 2166136261;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            return hash;
        });
    }
    function packetContract(packet, geometry) {
        for (const key of ["key", "tag", "label", "operand", "color", "sourceLabel", "destinationLabel", "originLabel", "stageLabel"])
            check(typeof packet[key] === "string" && packet[key].length > 0, `packet has a readable ${key}`);
        check(Number.isInteger(packet.shape) && packet.shape >= 0 && packet.shape <= 3, "packet has a non-color shape fingerprint");
        check(["I", "W", "O"].includes(packet.operand), "packet operand identifies its semantic data class");
        check(Number.isInteger(packet.bank) && packet.bank >= 0 && packet.bank < geometry.busX.length, "packet retains a real physical bank");
        check(Number.isInteger(packet.scalarRow) && packet.scalarRow >= 0, "packet retains a scalar buffer row");
        check(Number.isInteger(packet.peRow) && Number.isInteger(packet.peCol), "packet retains the exact source/destination PE");
        check(Array.isArray(packet.points) && packet.points.length >= 2 && packet.points.every(point => point.length === 2 && point.every(Number.isFinite)),
            "packet exposes a finite on-canvas route rather than only a changing highlight");
        check(Number.isFinite(packet.x) && Number.isFinite(packet.y), "packet has a finite interpolated position");
        const expected = packet.operand === "O" ? (packet.age <= geometry.stages ? palette.partial : palette.result) : palette[packet.operand];
        equal(packet.color.toLowerCase(), expected, "motion preserves the requested input/weight/partial/result palette");
    }
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href, {waitUntil: "load"});
        await page.clock.runFor(100);
        check(await page.locator("#mgMotionMount").isVisible(), "architecture includes an in-place detailed packet-motion view");

        for (const width of [4, 8, 16]) {
            await load(width);
            const indices = await page.evaluate(() => ({
                weights: mgAnimFrames.findIndex(item => item.aWR.length),
                inputs: mgAnimFrames.findIndex(item => item.aIR.some(row => item.pMC[row + ',0'] > 0)),
                forwarded: mgAnimFrames.findIndex(item => item.aIR.some(row => row > 0 && item.pMC[row + ',0'] > 0)),
                issue: mgAnimFrames.findIndex(item => item.aOR >= 0),
                stages: mgFeatherGeometry.stages,
            }));
            check(Object.values(indices).every(value => value >= 0), `${width}-wide trace exercises each data-motion phase`);
            for (const [operand, index] of [["W", indices.weights], ["I", indices.inputs]]) {
                const start = await frame(index, 0), hashStart = await pixels();
                const middle = await frame(index, 0.5), hashMiddle = await pixels();
                const end = await frame(index, 1), hashEnd = await pixels();
                const packets = middle.packets.filter(item => item.operand === operand && item.valid);
                check(packets.length >= 2, `${operand}: several concurrently moving scalars are represented individually`);
                equal(new Set(packets.map(item => item.key)).size, packets.length, "simultaneous transfers have distinct provenance keys");
                const addresses = new Map();
                for (const packet of packets) {
                    const address = `${packet.bank}:${packet.scalarRow}`;
                    if (addresses.has(address)) equal(packet.tag, addresses.get(address), "multicast copies retain the same source-scalar tag");
                    addresses.set(address, packet.tag);
                }
                check(addresses.size >= 2, "frame includes distinguishable physical data elements");
                equal(new Set(addresses.values()).size, addresses.size, "different scalar addresses have distinct visible tags, not color alone");
                check(hashStart !== hashMiddle && hashMiddle !== hashEnd, "actual canvas pixels move at source, halfway and arrival");
                for (const packet of packets) {
                    packetContract(packet, middle.geometry);
                    const first = start.packets.find(item => item.key === packet.key), last = end.packets.find(item => item.key === packet.key);
                    check(first && last, "packet identity survives the entire movement within a cycle");
                    equal([first.tag, last.tag, first.label, last.label], [packet.tag, packet.tag, packet.label, packet.label],
                        "visible identity and tensor coordinates remain stable while a scalar moves");
                    near(first.x, first.points[0][0], "scalar starts at its physical route origin");
                    near(first.y, first.points[0][1], "scalar starts at its physical route origin");
                    near(last.x, last.points.at(-1)[0], "scalar arrives at the route destination");
                    near(last.y, last.points.at(-1)[1], "scalar arrives at the route destination");
                    check(Math.hypot(packet.x - first.x, packet.y - first.y) > 1 && Math.hypot(packet.x - last.x, packet.y - last.y) > 1,
                        "mid-cycle card is genuinely between source and destination");
                    check(/bank|B\d/i.test(packet.originLabel) && /row|r\d/i.test(packet.originLabel), "visible origin distinguishes physical buffer address");
                    check(/PE/i.test(packet.destinationLabel), "visible destination identifies a PE rather than a generic array");
                    const cell = middle.geometry.bufferCells[operand].find(item => item.bank === packet.bank && item.scalarRow === packet.scalarRow);
                    if (cell) equal(packet.points[0], [cell.x, cell.y], "scalar starts at its exact miniature-buffer cell");
                    equal(packet.points.at(-1), [middle.geometry.left + packet.peCol * middle.geometry.pitch + middle.geometry.cell / 2,
                        middle.geometry.top + packet.peRow * middle.geometry.pitch + middle.geometry.cell / 2], "scalar reaches its exact mapped PE");
                }
            }
            const forwarded = await frame(indices.forwarded, 0.5);
            const forwarding = forwarded.packets.filter(item => item.operand === "I" && item.peRow > 0 && item.valid);
            check(forwarding.length > 0, "vertical streaming forwards named individual scalars between PE rows");
            for (const packet of forwarding) {
                check(/PE/i.test(packet.sourceLabel), "forwarding names the previous PE as the immediate source");
                check(/bank|B\d/i.test(packet.originLabel), "forwarding retains the original streaming-buffer provenance");
            }

            const launched = await frame(indices.issue, 0.5);
            const outputs = launched.packets.filter(item => item.operand === "O" && item.age === 0 && item.valid);
            check(outputs.length >= 2, "PE result issue creates individually identifiable partial-result cards");
            const output = outputs[0];
            await select.selectOption(output.key);
            const seenStages = new Set(), seenSources = new Set();
            for (let age = 0; age <= indices.stages + 1; age++) {
                const current = await frame(indices.issue + age, 0.5);
                const same = current.packets.find(item => item.key === output.key);
                check(same, "the same PE result identity survives column bus, BIRRD permutations and writeback");
                packetContract(same, current.geometry);
                equal([same.tag, same.label, same.bank, same.scalarRow, same.peRow, same.peCol, same.originLabel],
                    [output.tag, output.label, output.bank, output.scalarRow, output.peRow, output.peCol, output.originLabel],
                    "result tensor identity, destination address and issuing-PE provenance do not change when BIRRD changes ports");
                equal(same.age, age, "result stage age tracks elapsed architecture frames");
                seenStages.add(same.stageLabel); seenSources.add(same.sourceLabel);
                equal(await select.inputValue(), output.key, "detail selection sticks to the result as it crosses network stages");
                equal((await lens()).key, output.key, "detail lens and architecture highlight the same persistent packet");
                if (age === indices.stages + 1) check(/bank|B\d/i.test(same.destinationLabel), "writeback names the exact output-buffer destination");
            }
            check(seenStages.size >= 3 && seenSources.size >= 3, "phase and immediate source descriptions follow actual bus/network/writeback progress");
            const later = await page.evaluate(({row, issue}) => mgAnimFrames.findIndex((item, index) => index > issue && item.aOR === row),
                {row: output.peRow, issue: indices.issue});
            if (later >= 0) {
                const laterFrame = await frame(later, 0.5);
                const next = laterFrame.packets.find(item => item.operand === "O" && item.age === 0 && item.peRow === output.peRow && item.peCol === output.peCol);
                check(next && next.key !== output.key && next.tag !== output.tag, "a later dot-product issue from the same PE receives a new result identity");
            }
            groups.push(`${width}-wide: individually tagged moving scalar cards, exact sources/destinations, forwarding provenance and persistent BIRRD results`);
        }

        await load(4);
        const activeIndex = await page.evaluate(() => mgAnimFrames.findIndex(item => item.aWR.length));
        const active = await frame(activeIndex, 0.5), selected = active.packets.find(item => item.operand === "W" && item.valid);
        await select.selectOption(selected.key);
        check(!(await state()).playing, "choosing a packet does not implicitly start playback");
        check((await page.locator("#mgMotionOrigin").innerText()).includes(selected.originLabel), "detail view spells out the selected packet's original provenance");
        const endpoints = await page.locator("#mgMotionEndpoints").innerText();
        check(endpoints.includes(selected.sourceLabel) && endpoints.includes(selected.destinationLabel), "detail view spells out both current movement endpoints");
        check((await page.locator("#mgMotionCard").textContent()).includes(selected.label), "large moving card carries an exact tensor coordinate");
        check((await page.locator("#mgMotionCard").textContent()).includes(selected.tag), "large moving card carries a distinguishable persistent tag");
        const renderedColor = await page.locator("#mgFeatherCanvas").evaluate((canvas, packet) => {
            const color = packet.color.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
            const x = Math.max(0, Math.floor(packet.x - 35)), y = Math.max(0, Math.floor(packet.y - 24));
            const bytes = canvas.getContext("2d").getImageData(x, y, Math.min(70, canvas.width - x), Math.min(50, canvas.height - y)).data;
            let matches = 0;
            for (let i = 0; i < bytes.length; i += 4) if (bytes[i] === color[0] && bytes[i + 1] === color[1] && bytes[i + 2] === color[2] && bytes[i + 3] === 255) matches++;
            return matches;
        }, selected);
        check(renderedColor > 8, "actual moving card pixels use the reported semantic operand color");
        check(await page.locator("#mgMotionSourceGhost").isVisible(), "detailed movement retains a visible source ghost");
        check(await page.locator("#mgMotionTrail").evaluate(node => {
            const style = getComputedStyle(node);
            return style.display !== "none" && style.visibility !== "hidden" && style.stroke !== "none" &&
                Number.parseFloat(style.strokeWidth) > 0 && node.getTotalLength() > 1;
        }), "detailed movement leaves a stroked travel trail");
        const lensPositions = [];
        for (const percent of [0, 50, 100]) {
            await scrub(percent);
            const current = await state(), detail = await lens(); lensPositions.push(detail);
            equal(current.frame, activeIndex, "within-cycle scrub never jumps to another architecture frame");
            near(current.progress, percent / 100, "scrub controls the shared architecture fraction");
            check(!current.playing, "manual scrubbing pauses the shared animation clock");
            near(detail.progress, percent / 100, "detail lens uses the same frame fraction");
            near(detail.x, detail.start + (detail.end - detail.start) * percent / 100, "large detail card moves continuously between its displayed endpoints");
            equal(detail.key, selected.key, "scrubbing retains the chosen packet");
            const transform = await page.locator("#mgMotionCard").getAttribute("transform");
            check(transform && transform.includes(String(detail.x)), "moving-card SVG transform matches the measured moving position");
        }
        check(lensPositions[0].x < lensPositions[1].x && lensPositions[1].x < lensPositions[2].x, "detail card visibly traverses the lane instead of only relabeling a stationary object");
        await select.focus();
        await select.evaluate(node => { node.dataset.testFocusSentinel = "same-control"; });
        await frame(activeIndex, 0.25); await frame(activeIndex, 0.75);
        equal(await page.evaluate(() => document.activeElement.id), "mgMotionSelect", "animation updates do not steal packet-selector keyboard focus");
        equal(await select.getAttribute("data-test-focus-sentinel"), "same-control", "animation updates preserve the same selector DOM node");

        await page.locator("#mgInspectW").click();
        await page.locator(`#mgBufferPopupGrid button[data-bank="${selected.bank}"][data-scalar-row="${selected.scalarRow}"]`).click();
        const addressedSelection = await page.evaluate(() => {
            const key = document.getElementById("mgMotionSelect").value;
            return JSON.parse(document.getElementById("mgFeatherCanvas").dataset.motionPackets).find(packet => packet.key === key);
        });
        check(addressedSelection && addressedSelection.operand === selected.operand && addressedSelection.bank === selected.bank &&
            addressedSelection.scalarRow === selected.scalarRow, "selecting an active buffer scalar follows that exact data element in the motion detail");
        await page.locator("#mgBufferPopupClose").click();

        await page.locator("#mgSpeedSlider").evaluate(node => { node.value = "5"; });
        await frame(activeIndex, 1); await page.locator("#mgMotionReplay").click();
        const replayStart = await state();
        equal(replayStart.frame, activeIndex, "replay restarts the selected architecture frame");
        check(replayStart.progress < 1 && replayStart.playing, "replay actually animates the selected transfer from its source");
        await page.clock.runFor(1600);
        const replayEnd = await state();
        equal(replayEnd.frame, activeIndex, "single-transfer replay stops at this frame's arrival rather than skipping ahead");
        near(replayEnd.progress, 1, "replay finishes at the destination");
        check(!replayEnd.playing, "single-transfer replay releases the shared clock at arrival");
        await page.locator("#mgMotionPlay").click(); await page.clock.runFor(80);
        check((await state()).playing, "detail play uses the architecture playback clock");
        await scrub(37);
        const paused = await state(); await page.clock.runFor(800);
        equal(await state(), paused, "scrubbing cancels ongoing shared playback without a second animation timer");
        await page.locator("#mgMotionMount").scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(output, "motion-desktop.png"), animations: "disabled"});
        groups.push("large detail cards, provenance, source ghost/trail, sticky selection, focus stability, fractional shared-clock scrub and bounded single-frame replay");

        await page.emulateMedia({reducedMotion: "reduce"});
        for (let attempt = 0; attempt < 40 && !(await page.evaluate(() => mgReducedMotion.matches)); attempt++) {
            await new Promise(resolve => setTimeout(resolve, 25)); await page.clock.runFor(32);
        }
        check(await page.evaluate(() => mgReducedMotion.matches), "motion detail respects the system reduced-motion preference");
        await frame(activeIndex, 0.2);
        const reduced = await lens();
        near(reduced.x, reduced.end, "reduced motion renders a clear arrival snapshot rather than moving the detail card");
        const reducedPixels = await pixels(); await page.clock.runFor(100);
        equal(await pixels(), reducedPixels, "a paused reduced-motion snapshot remains still");
        await page.emulateMedia({reducedMotion: "no-preference"}); await page.clock.runFor(150);
        await page.setViewportSize({width: 390, height: 844}); await page.clock.runFor(450);
        await frame(activeIndex, 0.5);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth),
            "detailed packet controls do not create mobile page-wide horizontal overflow");
        check(await diagram.evaluate(node => { const rect = node.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth; }),
            "the readable motion lane fits the mobile viewport");
        check(await select.isVisible() && await page.locator("#mgMotionScrub").isVisible(), "packet selection and fractional inspection remain available on mobile");
        await page.locator("#mgMotionMount").scrollIntoViewIfNeeded();
        await page.screenshot({path: path.join(output, "motion-mobile.png"), animations: "disabled"});
        await page.setViewportSize({width: 360, height: 720}); await page.clock.runFor(450);
        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(64);
        await frame(activeIndex, 0.5);
        await page.locator("#mgMotionMount").evaluate(node => { node.scrollTop = 0; });
        const compact = await page.evaluate(() => {
            const mount = document.getElementById("mgMotionMount").getBoundingClientRect();
            const card = document.getElementById("mgMotionCard").getBoundingClientRect();
            return {mount: {left: mount.left, right: mount.right, top: mount.top, bottom: mount.bottom},
                card: {left: card.left, right: card.right, top: card.top, bottom: card.bottom}};
        });
        check(compact.card.left >= compact.mount.left - 0.1 && compact.card.right <= compact.mount.right + 0.1 &&
            compact.card.top >= compact.mount.top - 0.1 && compact.card.bottom <= compact.mount.bottom + 0.1,
            "360×720 expanded view keeps the complete moving card inside the compact pane at its initial scroll position");
        await select.scrollIntoViewIfNeeded();
        check(await select.evaluate(node => {
            const control = node.getBoundingClientRect(), mount = document.getElementById("mgMotionMount").getBoundingClientRect();
            return control.left >= mount.left - 0.1 && control.right <= mount.right + 0.1 &&
                control.top >= mount.top - 0.1 && control.bottom <= mount.bottom + 0.1;
        }), "compact expanded detail controls remain accessible by scrolling within the motion pane");
        await page.locator("#mgMotionMount").evaluate(node => { node.scrollTop = 0; });
        await page.screenshot({path: path.join(output, "motion-mobile-expanded.png"), animations: "disabled"});
        await page.locator("#mgExpandBtn").click(); await page.clock.runFor(64);
        await page.locator('button[onclick="mgClearAll()"]').click();
        equal(await page.evaluate(() => JSON.parse(document.getElementById("mgFeatherCanvas").dataset.motionPackets || "[]")), [],
            "clearing the ISA trace removes all stale packet identities");
        check(await select.isDisabled(), "empty trace cannot select a stale detail packet");
        groups.push("reduced-motion snapshots, narrow-screen controls, unclipped 360×720 expanded data cards and stale-data invalidation");

        equal(errors, [], "no browser script errors or local asset loading failures");
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
