#!/usr/bin/env node
/* Offline functional and visual checks for the third tutorial page.
 * PLAYWRIGHT_MODULE / PLAYWRIGHT_BROWSERS_PATH may point at external installs. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const html = path.resolve(option("--html", path.join(__dirname, "../FEATHER_VS_SYSTOLIC.html")));
let assertions = 0;
function equal(actual, expected, label) { assert.deepEqual(actual, expected, label); assertions++; }
function check(value, label) { assert.ok(value, label); assertions++; }

(async () => {
    const output = option("--out", await fs.mkdtemp(path.join(os.tmpdir(), "feather-comparison-browser-")));
    await fs.mkdir(output, {recursive: true});
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1600, height: 1100}, reducedMotion: "no-preference"});
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await context.route(/^https?:\/\//, route => route.abort());
    try {
        await page.clock.install({time: new Date("2026-01-01T00:00:00Z")});
        await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"));
        await page.goto(pathToFileURL(html).href);
        await page.waitForFunction(() => window.FeatherComparisonModel && window.FeatherComparisonView);

        const select = (name, value) => page.locator(`#comparison-${name}`).selectOption(String(value));
        const click = name => page.locator(`#comparison-${name}`).click();
        const state = () => page.evaluate(() => {
            const value = FeatherComparisonView.inspect();
            const architecture = item => ({phase: item.snapshot.phase, active: item.snapshot.active,
                peCount: item.snapshot.pe.length, macs: item.snapshot.macs, tokens: item.tokens});
            return {presetId: value.presetId, baseline: value.baseline, scope: value.scope, layerIndex: value.layerIndex,
                cycle: value.cycle, fraction: value.fraction, playing: value.playing,
                systolic: architecture(value.systolic), feather: architecture(value.feather), bridge: value.bridge};
        });
        const pixels = id => page.locator(`#comparison-${id}`).evaluate(canvas => {
            const bytes = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let hash = 2166136261;
            for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
            return hash;
        });
        const seek = (cycle, fraction = 0) => page.evaluate(({cycle, fraction}) => FeatherComparisonView.seek(cycle, fraction), {cycle, fraction});
        const presets = await page.evaluate(() => FeatherComparisonModel.presets());
        equal(await page.locator("#comparison-preset option").count(), presets.length, "all connected workload presets are selectable");
        equal(await page.locator("#comparison-baseline option").count(), 4, "OS, WS, IS, and strongest modeled systolic choices are available");
        equal(await page.locator("main").count(), 1, "page preserves the native main landmark");
        equal(await page.locator('.sidebar a[href="FEATHER_VS_SYSTOLIC.html"]').count(), 1, "third-page sidebar entry is present once");
        equal(await page.locator('.sidebar .active').getAttribute("aria-current"), "page", "current third page is announced accessibly");
        equal(await page.locator("#comparison-sa").getAttribute("data-pe-count"), "256", "systolic renderer draws all 256 physical PE cells");
        equal(await page.locator("#comparison-feather").getAttribute("data-pe-count"), "256", "NEST renderer draws all 256 physical PE cells");
        const boxes = await Promise.all(["sa", "feather"].map(id => page.locator(`#comparison-${id}`).boundingBox()));
        check(boxes[1].x > boxes[0].x + boxes[0].width, "desktop arrays are genuinely side by side");

        for (const preset of presets) {
            await select("preset", preset.id);
            equal(await page.locator("#comparison-layer option").count(), preset.layers.length, `${preset.id}: every GEMM is individually selectable`);
            equal(await page.locator("#comparison-chain-rows tr").count(), preset.layers.length, `${preset.id}: chain table retains every layer`);
            for (const baseline of ["os", "ws", "is", "best"]) {
                await select("baseline", baseline);
                for (let layer = 0; layer < preset.layers.length; layer++) {
                    await select("layer", layer); await click("peak");
                    const snapshot = await state();
                    equal([snapshot.presetId, snapshot.baseline, snapshot.layerIndex], [preset.id, baseline, layer], "controls select the requested model, not a stale cached comparison");
                    for (const arch of ["systolic", "feather"]) {
                        equal(snapshot[arch].peCount, 256, `${preset.id}/${baseline}/${layer}/${arch}: all physical PEs remain visible`);
                        check(snapshot[arch].active >= 0 && snapshot[arch].active <= 256, `${arch}: active count stays within real array capacity`);
                        const used = snapshot[arch].macs.map(event => event.row * 16 + event.col);
                        equal(new Set(used).size, used.length, `${arch}: rendered active PE identities never conflict`);
                    }
                    const mappingSummary = await page.evaluate(() => {
                        const value = FeatherComparisonView.inspect(), layer = value.chain.layers[value.layerIndex];
                        const cells = document.querySelector(`#comparison-chain-rows tr[data-layer="${value.layerIndex}"]`).cells;
                        return {systolic: {text: cells[1].textContent, labels: [...new Set(layer.systolic.segments.map(segment => segment.mappingLabel))]},
                            feather: {text: cells[2].textContent, labels: [...new Set(layer.feather.segments.map(segment => segment.mappingLabel))]}};
                    });
                    for (const arch of ["systolic", "feather"]) for (const label of mappingSummary[arch].labels) {
                        check(mappingSummary[arch].text.includes(label), `${preset.id}/${baseline}/${layer}/${arch}: chain row includes full-tile and tail mapping '${label}'`);
                    }
                    const numeric = await page.evaluate(() => {
                        const value = FeatherComparisonView.inspect(), layer = value.chain.layers[value.layerIndex];
                        const m = layer.shape.M - 1, n = layer.shape.N - 1;
                        for (const [axis, coordinate] of [["m", m], ["n", n]]) {
                            const input = document.getElementById(`comparison-output-${axis}`); input.value = coordinate;
                            input.dispatchEvent(new Event("input", {bubbles: true}));
                        }
                        let expected = 0;
                        for (let k = 0; k < layer.shape.K; k++) expected += layer.input[m * layer.shape.K + k] * layer.weights[k * layer.shape.N + n];
                        return {display: {...document.getElementById("comparison-numeric-result").dataset}, m, n, expected,
                            actualRuns: [layer.systolic.output[m * layer.shape.N + n], layer.feather.output[m * layer.shape.N + n]]};
                    });
                    equal([Number(numeric.display.m), Number(numeric.display.n)], [numeric.m, numeric.n], "numeric inspector honors ragged output coordinates");
                    equal([Number(numeric.display.systolic), Number(numeric.display.feather)], [numeric.expected, numeric.expected], "both displayed outputs equal a separate dot-product oracle");
                    equal([Number(numeric.display.systolic), Number(numeric.display.feather)], numeric.actualRuns, "numeric labels display the actual committed outputs from both architecture runs");
                    equal(Number(numeric.display.oracle), numeric.expected, "independent reference remains separately labeled rather than substituting for a run result");
                }
            }
        }

        // Deliberately perturb only the in-memory test fixture, restoring it in
        // finally. This catches a UI that substitutes its golden for an actual
        // architecture result and would therefore hide a genuine disagreement.
        const injectedMismatch = await page.evaluate(() => {
            const value = FeatherComparisonView.inspect(), layer = value.chain.layers[value.layerIndex];
            const inputM = document.getElementById("comparison-output-m"), inputN = document.getElementById("comparison-output-n");
            const index = Number(inputM.value) * layer.shape.N + Number(inputN.value);
            const original = [layer.systolic.output[index], layer.feather.output[index]];
            const changed = [original[0] + 7, original[1] - 3];
            try {
                layer.systolic.output[index] = changed[0]; layer.feather.output[index] = changed[1];
                inputN.dispatchEvent(new Event("input", {bubbles: true}));
                const node = document.getElementById("comparison-numeric-result");
                return {actual: [Number(node.dataset.systolic), Number(node.dataset.feather)], expected: changed, text: node.textContent};
            } finally {
                layer.systolic.output[index] = original[0]; layer.feather.output[index] = original[1];
                inputN.dispatchEvent(new Event("input", {bubbles: true}));
            }
        });
        equal(injectedMismatch.actual, injectedMismatch.expected, "numeric inspector does not replace real run outputs with the independent golden");
        check(/mismatch/i.test(injectedMismatch.text), "an actual architecture disagreement is visibly flagged");

        await select("preset", "irregular-vector"); await select("baseline", "os"); await select("layer", "0");
        for (const baseline of ["os", "ws", "is"]) {
            await select("baseline", baseline); await seek(5, .4);
            const snapshot = await state(), kinds = new Set(snapshot.systolic.tokens.map(token => token.kind));
            equal(kinds.has("input"), baseline !== "is", `${baseline}: only a non-stationary A operand is animated`);
            equal(kinds.has("weight"), baseline !== "ws", `${baseline}: only a non-stationary B operand is animated`);
        }
        await select("baseline", "os");
        const movingCycle = await page.evaluate(() => {
            const layer = FeatherComparisonView.inspect().chain.layers[0];
            return layer.feather.frames.find(frame => frame.macs.length && frame.network.length &&
                layer.systolic.frames.find(other => other.cycle === frame.cycle && other.macs.length)).cycle;
        });
        await seek(movingCycle, .2); const before = await state(), beforePixels = await pixels("feather");
        await seek(movingCycle, .65); const after = await state();
        for (const arch of ["systolic", "feather"]) {
            check(before[arch].tokens.length > 0, `${arch}: actual packets are rendered`);
            check(before[arch].tokens.every(token => typeof token.id === "string" && token.id.length > 0), `${arch}: every drawn packet has an actual tensor/wave identity`);
            equal(before[arch].tokens.map(token => token.id), after[arch].tokens.map(token => token.id), `${arch}: packet identity stays constant while it travels`);
            check(before[arch].tokens.some((token, index) => token.x !== after[arch].tokens[index].x || token.y !== after[arch].tokens[index].y), `${arch}: packets change actual canvas position within a cycle`);
        }
        check(await pixels("feather") !== beforePixels, "FEATHER MAC and network packet motion changes rendered pixels");
        await page.locator("#comparison-arrays").screenshot({path: path.join(output, "side-by-side-overlap.png")});

        await click("reset"); const start = await state(); await click("step");
        equal((await state()).cycle, start.cycle + 1, "Step advances one shared logical cycle");
        await page.locator("#comparison-scrub").evaluate(node => { node.value = "5"; node.dispatchEvent(new Event("input", {bubbles: true})); });
        equal((await state()).cycle, 5, "timeline seek renders the requested shared cycle");
        await click("play"); await page.clock.runFor(600); const playing = await state();
        check(playing.playing && playing.cycle > 5, "playback advances the shared clock");
        await click("play"); const paused = await state(); await page.clock.runFor(600);
        equal((await state()).cycle, paused.cycle, "Pause stops the logical clock");
        await select("scope", "chain");
        const drainCycle = await page.evaluate(() => FeatherComparisonView.inspect().chain.layers[0].feather.frames.find(frame =>
            !frame.macs.length && (frame.network.length || frame.writes.length)).cycle);
        await seek(drainCycle, .4);
        check((await state()).feather.tokens.some(token => token.kind === "partial" || token.kind === "result"),
            "whole-chain view preserves BIRRD/drain packets after the last MAC, not just compute frames");
        const boundaryCycle = await page.evaluate(() => FeatherComparisonView.inspect().chain.layers[0].systolic.cycles);
        await seek(boundaryCycle); equal((await state()).scope, "chain", "whole-chain playback retains its separate producer/consumer timing");

        await select("preset", "irregular-batch"); await select("boundary", "0");
        const boundary = () => page.evaluate(() => {
            const value = FeatherComparisonView.inspect(), boundary = value.chain.boundaries[value.bridge.boundaryIndex];
            return {changedElements: boundary.changedElements, copiedElements: boundary.copiedElements, sourceCells: boundary.sourceCells, targetCells: boundary.targetCells,
                saCopyCycles: boundary.saCopyCycles, featherCopyCycles: boundary.featherCopyCycles,
                configCycles: boundary.configCycles, routeEligible: boundary.routeEligible, switched: boundary.switched,
                options: value.chain.options};
        });
        let bridgeModel = await boundary();
        check(bridgeModel.changedElements > 0 && bridgeModel.routeEligible, "seven-row chain contains a real mismatched, compiler-eligible layout boundary");
        await select("layout-mode", "fixed"); bridgeModel = await boundary();
        equal(bridgeModel.featherCopyCycles, bridgeModel.saCopyCycles, "fixed-layout setting charges the same conversion to both arrays");
        await page.locator("#comparison-bandwidth").fill("7"); await page.locator("#comparison-bandwidth").dispatchEvent("change");
        bridgeModel = await boundary();
        equal(bridgeModel.saCopyCycles, 2 * Math.ceil(bridgeModel.copiedElements / 7), "bandwidth control changes explicit full-scratch source-read and destination-write cost");
        await select("layout-mode", "switch");
        await page.locator("#comparison-config").fill("9"); await page.locator("#comparison-config").dispatchEvent("change");
        bridgeModel = await boundary();
        equal([bridgeModel.featherCopyCycles, bridgeModel.configCycles], [0, 9], "verified layout switch trades the copy for the displayed configuration cost");
        await click("layout-play"); await page.clock.runFor(200); const bridgeBefore = (await state()).bridge;
        await page.clock.runFor(300); const bridgeAfter = (await state()).bridge;
        check(bridgeBefore.tokens.length > 0, "layout bridge renders individually identifiable output/input data");
        check(bridgeBefore.tokens.every(token => typeof token.id === "string" && token.id.length > 0), "each layout packet names a real producer output");
        equal(bridgeBefore.tokens.map(token => token.id), bridgeAfter.tokens.map(token => token.id), "layout animation retains source tensor identities");
        check(bridgeBefore.tokens.some((token, index) => token.x !== bridgeAfter.tokens[index].x || token.y !== bridgeAfter.tokens[index].y),
            "layout packets visibly move between producer and consumer buffers");
        await page.locator("#comparison-layout").screenshot({path: path.join(output, "layout-switching.png")});
        await page.locator("#comparison-compatible").check(); bridgeModel = await boundary();
        equal([bridgeModel.saCopyCycles, bridgeModel.featherCopyCycles, bridgeModel.configCycles], [0, 0, 0],
            "layout-aware/compatible systolic baseline removes artificial layout advantage for both arrays");
        await page.locator("#comparison-compatible").uncheck();

        for (const theme of ["dark", "light"]) {
            if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
            equal(await page.locator("html").getAttribute("data-theme"), theme, `${theme}: native theme control works`);
            check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}: desktop has no horizontal overflow`);
            await page.screenshot({path: path.join(output, `${theme}.png`)});
        }
        await select("scope", "layer"); await seek(3, .2);
        await page.emulateMedia({reducedMotion: "reduce"});
        await seek(3, .2);
        const reducedPixels = await pixels("feather"); await click("play"); await page.clock.runFor(100);
        equal(await pixels("feather"), reducedPixels, "reduced motion does not interpolate packets inside a cycle");
        await click("play");
        await page.setViewportSize({width: 390, height: 844});
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), "mobile layout has no horizontal document overflow");
        const mobileBoxes = await Promise.all(["sa", "feather"].map(id => page.locator(`#comparison-${id}`).boundingBox()));
        check(mobileBoxes[1].y >= mobileBoxes[0].y + mobileBoxes[0].height, "mobile arrays stack vertically rather than shrink into illegible columns");
        await page.screenshot({path: path.join(output, "mobile.png")});

        equal(errors, [], "comparison page has no browser exceptions");
        const result = {html, assertions, errors, output};
        await fs.writeFile(path.join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } finally { await browser.close(); }
})().catch(error => { process.stderr.write(error.stack + "\n"); process.exitCode = 1; });
