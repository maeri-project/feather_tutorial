#!/usr/bin/env node
/* Whole-array browser checks. Supply Playwright externally; no npm/browser
 * artifacts are written into the repository. --html permits site snapshots. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const html = path.resolve(option("--html", path.join(__dirname, "../QWEN3_MINISA_VISUALIZER.html")));
let assertions = 0;
function equal(a, b, message) { assert.deepEqual(a, b, message); assertions++; }
function check(value, message) { assert(value, message); assertions++; }

(async () => {
    const output = option("--out", await fs.mkdtemp(path.join(os.tmpdir(), "feather-array-browser-")));
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1100}, reducedMotion: "no-preference"});
    const page = await context.newPage(), errors = [], requests = [];
    page.on("pageerror", error => errors.push(String(error)));
    await context.route(/^https?:\/\//, async route => { requests.push(route.request().url()); await route.abort(); });
    const click = id => page.locator(`#${id}`).click();
    const select = (id, value) => page.locator(`#${id}`).selectOption(String(value));
    const status = () => page.locator("#array-status").evaluate(node => ({...node.dataset}));
    const drawing = () => page.locator("#nest").evaluate(node => ({...node.dataset}));
    const heatmap = () => page.locator("#array-output").evaluate(node => ({...node.dataset}));
    const run = ms => page.clock.runFor(ms);
    const scrub = index => page.locator("#array-frame").evaluate((node, value) => {
        node.value = value; node.dispatchEvent(new Event("input", {bubbles: true}));
    }, String(index));
    const pixels = () => page.locator("#nest").evaluate(canvas => {
        const bytes = canvas.getContext("2d").getImageData(0, 148, 850, 430).data;
        let hash = 2166136261;
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
        return hash;
    });
    const weights = () => page.locator("#nest").evaluate(canvas => {
        const ctx = canvas.getContext("2d"), result = [];
        for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
            result.push([...ctx.getImageData(58 + col * 47 + 38, 256 + row * 20 + 2, 1, 1).data]);
        }
        return result;
    });
    async function tile(axis, value) {
        await page.locator(`#tile-${axis}`).fill(String(value)); await page.locator(`#tile-${axis}`).press("Tab");
    }
    async function isStopped(message) {
        const before = await status(); await run(450);
        equal(await status(), before, message); equal(before.playing, "false", message + " has no active clock");
    }
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href);
        equal(await page.locator("#dataflow-mode").inputValue(), "single", "single-element mode remains the default");
        check(await page.locator("#array-dataflow-controls").isHidden(), "new controls do not clutter single-element mode");
        await run(2000); equal((await status()).phase, "inactive", "no automatic array playback");
        await select("dataflow-mode", "array");
        check(await page.locator("#single-dataflow-controls").isHidden(), "single-element inspector remains separate");
        equal((await status()).playing, "false", "choosing a mode does not autoplay");
        equal(await page.locator("#array-frame").getAttribute("max"), "331", "complete 332-step tile trace");
        await scrub(8);
        const mac = await drawing(), packets = JSON.parse(mac.arrayTokens);
        equal([mac.arrayPhase, mac.arrayPeCount, mac.arrayMovingTokens], ["mac", "256", "256"], "all PEs receive scalar input packets");
        equal(new Set(packets.map(p => p.row * 16 + p.col)).size, 256, "one individual packet per PE");
        for (const packet of packets) {
            const m = Math.floor(packet.col % 8 / 2), n = packet.row + 16 * (packet.col % 2), k = 16 * Math.floor(packet.col / 8) + 5;
            equal([packet.m, packet.n, packet.k, packet.lane, packet.operand], [m, n, k, 5, "I"], "every packet has the correct element coordinates");
            equal(packet.identity, `A[${m},${k}]`, "packet identifies its actual A scalar");
            check(Number.isFinite(packet.value), "packet has a finite operand value");
        }
        check((await page.locator("#array-summary").innerText()).includes("× held B["), "selected PE reports the held B value and MAC");
        await page.screenshot({path: path.join(output, "array-all-pes.png"), fullPage: true});

        // Enter MAC lane 1 from a completed lane-0 snapshot, then stop midstep.
        await scrub(3); await select("array-speed", 350); await click("array-play"); await run(32);
        await run(48); const imageA = await pixels(), weightA = await weights(), first = JSON.parse((await drawing()).arrayTokens);
        await run(64); const second = JSON.parse((await drawing()).arrayTokens);
        check(await pixels() !== imageA, "actual array pixels move between logical steps");
        equal(await weights(), weightA, "all 256 held-weight pixel markers stay stationary");
        check(first.some((packet, i) => packet.x !== second[i].x || packet.y !== second[i].y), "individual packet positions interpolate");
        await click("array-play"); await isStopped("Pause freezes the array and fraction");
        await page.screenshot({path: path.join(output, "array-inflight.png"), fullPage: true});

        await scrub(28);
        const routed = JSON.parse((await drawing()).arrayTokens);
        const stages = routed.filter(packet => packet.stage !== undefined);
        equal(stages.length, 128, "eight concurrent stages each carry 16 raw ports");
        for (let stage = 0; stage < 8; stage++) {
            equal([...new Set(stages.filter(packet => packet.stage === stage).map(packet => packet.row))], [8 - stage], "pipeline wave advances one stage at a time");
            equal(stages.filter(packet => packet.stage === stage).map(packet => packet.port).sort((a, b) => a - b),
                Array.from({length: 16}, (_, i) => i), "all BIRRD raw ports carry numerical values");
        }
        equal(routed.filter(packet => packet.operand === "O").map(packet => packet.port), [0, 1, 2, 3, 4, 5, 6, 7], "exactly eight ports commit to OB");
        equal((await heatmap()).committedCount, "8", "first row wave writes eight distinct outputs");
        await page.screenshot({path: path.join(output, "array-row-waves.png"), fullPage: true});
        const snapshots = await page.evaluate(() => {
            const range = document.getElementById("array-frame"), output = document.getElementById("array-output"), results = [];
            for (let t = 0; t < 8; t++) for (let row = 0; row < 16; row++) {
                range.value = String(28 + t * 41 + row); range.dispatchEvent(new Event("input", {bubbles: true}));
                results.push({t, row, count: Number(output.dataset.committedCount), indices: JSON.parse(output.dataset.completedIndices)});
            }
            return results;
        });
        const seen = new Set();
        for (const snapshot of snapshots) {
            equal(snapshot.count, (snapshot.t * 16 + snapshot.row + 1) * 8, "each wave adds exactly eight outputs");
            const fresh = snapshot.indices.filter(index => !seen.has(index));
            const expected = Array.from({length: 8}, (_, port) => (4 * snapshot.t + Math.floor(port / 2)) * 32 + snapshot.row + 16 * (port % 2));
            equal(fresh, expected, "wave writes correct M-replica / N-subgroup destinations");
            snapshot.indices.forEach(index => seen.add(index));
        }
        equal([...seen].sort((a, b) => a - b), Array.from({length: 1024}, (_, i) => i), "all 1,024 output cells are covered exactly once");
        await scrub(331); equal((await status()).phase, "hold", "nonfinal K tile never stores");
        equal([(await heatmap()).committedCount, (await heatmap()).stored], ["1024", "false"], "complete FP32 tile retained without cast");
        await select("operator", 7); await tile("k", 3); await select("dataflow-mode", "array"); await scrub(331);
        equal([(await status()).phase, (await heatmap()).stored], ["store", "true"], "last K tile stores the full result");
        const stored = JSON.parse((await drawing()).arrayTokens);
        equal(stored.map(packet => packet.identity), Array.from({length: 32}, (_, n) => `C[31,${n}]`), "compressed Store sweep reaches the last complete output row");
        check(stored.every(packet => packet.format === "FP16" && Number.isInteger(packet.bits)), "completed Store packets have FP16 encodings");
        await page.screenshot({path: path.join(output, "array-complete-output.png"), fullPage: true});
        const reference = await page.evaluate(() => {
            const data = JSON.parse(document.getElementById("case-data").textContent);
            const trace = FeatherArrayAnimation.build(data, {origins: {m: 0, k: 96, n: 0}, kTile: 3, kTiles: 4});
            return {fp32: trace.outputFP32, fp16: trace.fp16Values};
        });
        await scrub(330); await click("array-play"); const formats = new Set();
        for (let tick = 0; tick < 10; tick++) {
            await run(16);
            if ((await status()).phase !== "store") continue;
            for (const packet of JSON.parse((await drawing()).arrayTokens)) {
                formats.add(packet.format);
                equal(packet.value, reference[packet.format === "FP32" ? "fp32" : "fp16"][packet.m * 32 + packet.n],
                    "OB values remain FP32 until the moving packet reaches the cast node");
            }
        }
        equal([...formats].sort(), ["FP16", "FP32"], "Store animation shows both sides of the FP32-to-FP16 boundary");
        await click("array-play");
        await select("operator", 6); await tile("k", 95);
        const start = Date.now(); await select("dataflow-mode", "array"); await scrub(331);
        check(Date.now() - start < 10000, "maximum K tile remains responsive while prior FP32 contributions are computed");
        equal((await status()).phase, "store", "maximum supported K tile completes");

        await click("array-reset"); await click("array-play"); await run(50); await select("dataflow-mode", "single");
        await isStopped("switching to the single-element view cancels the array clock");
        await click("motion-play"); await run(60); await select("dataflow-mode", "array");
        equal(await page.locator("#motion-status").getAttribute("data-playing"), "false", "array mode cancels the individual-element clock");
        await click("array-play"); await run(50); await click("play");
        await isStopped("overview playback cancels the array clock"); await click("play");
        await click("array-play"); await run(50); await click("tab-buffers");
        await isStopped("leaving the dataflow tab cancels the array clock");
        await click("tab-dataflow"); await click("array-play"); await run(50);
        await page.evaluate(() => {
            Object.defineProperty(document, "hidden", {value: true, configurable: true}); document.dispatchEvent(new Event("visibilitychange"));
        });
        await isStopped("hidden document cancels the array clock");
        await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
        await click("array-play"); await run(50); await select("pe-row", 5);
        await isStopped("PE selection pauses the array for inspection");
        check((await page.locator("#array-summary").innerText()).length > 0, "selected PE has an accessible text summary");
        await click("array-play"); await run(50); await tile("k", 0);
        await isStopped("tile changes cancel and invalidate the array model");
        equal((await status()).phase, "inactive", "old tile output is not reused after selection changes");
        await click("open-program"); await select("program-scope", "tile"); await click("generate-program"); await click("load-program");
        await select("dataflow-mode", "array"); await click("array-play"); await run(50); await click("accelerator-run");
        await isStopped("ISA run cancels the array clock");
        await click("array-play");
        equal(await page.locator("#accelerator-run").innerText(), "Run ISA", "array playback cancels the ISA clock");
        await run(50); await click("accelerator-step");
        await isStopped("ISA stepping cancels the array clock");
        await click("array-play"); await run(50); await click("accelerator-reset");
        await isStopped("ISA reset cancels the array clock");
        await click("array-play"); await run(50);
        const uploaded = await page.evaluate(() => JSON.stringify(FeatherProgram.generate(
            JSON.parse(document.getElementById("case-data").textContent), 7, "tile")));
        await page.locator("#import-program").setInputFiles({name: "array-import-check.json", mimeType: "application/json", buffer: Buffer.from(uploaded)});
        await isStopped("importing a MINISA program cancels and invalidates the array clock");
        equal((await status()).phase, "inactive", "import never retains stale array operands");
        await select("dataflow-mode", "array");

        await page.emulateMedia({reducedMotion: "reduce"}); await scrub(3); await select("array-speed", 350);
        await click("array-play"); const still = await pixels(); await run(100);
        equal(await pixels(), still, "reduced motion has no interpolated pixels");
        equal((await status()).fraction, "1", "reduced motion uses complete static steps");
        await run(260); equal((await status()).frame, "4", "reduced motion still supports discrete playback");
        await click("array-play"); await isStopped("reduced-motion pause cancels pending timeout");
        await page.setViewportSize({width: 390, height: 844}); await scrub(28);
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "whole-array controls and output tile fit mobile viewport");
        check(await page.locator("#array-frame").getAttribute("aria-label"), "array scrubber is accessible");
        await page.screenshot({path: path.join(output, "array-mobile.png"), fullPage: true});
        equal(errors, [], "no browser exceptions"); equal(requests, [], "standalone page needs no network assets");
        const result = {html, assertions, errors, external_requests: requests, output};
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
