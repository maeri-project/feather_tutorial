#!/usr/bin/env node
/* Native site navigation/theme regression; Playwright installed externally. */
"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
let assertions = 0;
function check(value, label) { assert(value, label); assertions++; }
async function main() {
    const output = await fs.mkdtemp(path.join(os.tmpdir(), "feather-site-shell-"));
    const browser = await chromium.launch({headless: true});
    const context = await browser.newContext({viewport: {width: 1440, height: 1000}, colorScheme: "dark"});
    const errors = [], remote = [];
    await context.route(/^https?:\/\//, async route => {
        remote.push(route.request().url());
        await route.fulfill({status: 200, contentType: "text/css", body: ""});
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    try {
        for (const file of ["index.html", "ACT.html", "Allo.html", "beginner.html", "hands_on.html", "setup.html", "FEATHER.html"]) {
            const source = await fs.readFile(path.join(root, file), "utf8");
            check((source.match(/href="QWEN3_MINISA_VISUALIZER.html"/g) || []).length === 1, `${file}: one sidebar entry`);
            check((source.match(/href="FEATHER_VS_SYSTOLIC.html"/g) || []).length === 1, `${file}: one comparison-page entry`);
        }
        await page.goto(pathToFileURL(path.join(root, "index.html")).href);
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        await page.waitForFunction(() => window.FeatherFullWorkloads);
        check(await page.locator("#operator option").count() === 40, "sidebar opens all original and ACT workloads");
        check(await page.locator('#operator option[value^="act:"]').count() === 31, "all recorded and improved ACT cases remain selectable");
        const optimized = await page.locator("#case-data").evaluate(node => JSON.parse(node.textContent)
            .act_cases.cases.filter(item => item.catalog_group === "optimized_full" || item.catalog_group === "optimized_six")
            .map(item => ({id: item.id, group: item.catalog_group, nStart: item.partition_origin.n_start})));
        check(optimized.filter(item => item.group === "optimized_full").length === 3, "three improved full programs are embedded");
        check(optimized.filter(item => item.group === "optimized_six").length === 6, "six aligned q-projection partitions are embedded");
        for (const item of optimized) {
            await page.locator("#operator").selectOption(`act:${item.id}`);
            const selected = await page.evaluate(() => {
                const state = window.FeatherFullWorkloads.inspect(), trace = state.teaching.trace;
                return {caseId: state.caseId, depths: trace.case.hardware.buffer_depths, n: trace.origins.n};
            });
            check(selected.caseId === item.id, `${item.id}: sidebar page initializes the improved animation`);
            check(selected.depths.D_StaB === 128 && selected.depths.D_StrB === 64 && selected.depths.D_OB === 64,
                `${item.id}: the animation retains its per-program physical depths`);
            check(selected.n === item.nStart, `${item.id}: the initial tile retains its global partition column`);
        }
        await page.locator("#operator").selectOption("0");
        check(await page.locator(".sidebar .active").count() === 1, "one active page");
        check(await page.locator('.sidebar .active').getAttribute("aria-current") === "page", "current page announced");
        check(await page.locator("main").count() === 1, "one main landmark");
        for (const theme of ["dark", "light"]) {
            if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
            await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor ===
                getComputedStyle(document.querySelector(".qwen-app")).backgroundColor);
            const palette = await page.evaluate(() => {
                const style = selector => getComputedStyle(document.querySelector(selector));
                return {body: style("body").backgroundColor, app: style(".qwen-app").backgroundColor,
                    card: style(".qwen-app .card").backgroundColor, target: style("html").getPropertyValue("--bg-card").trim(),
                    width: innerWidth, scroll: document.documentElement.scrollWidth};
            });
            check(palette.body === palette.app, `${theme}: background matches site`);
            check(palette.card !== "rgba(0, 0, 0, 0)", `${theme}: card uses opaque site surface`);
            check(palette.scroll <= palette.width, `${theme}: desktop fits`);
            await page.screenshot({path: path.join(output, `${theme}.png`)});
        }
        await page.reload();
        check(await page.locator("html").getAttribute("data-theme") === "light", "site theme persists on reload");
        await page.locator('.sidebar a[href="FEATHER_VS_SYSTOLIC.html"]').click();
        await page.waitForFunction(() => window.FeatherComparisonView && window.FeatherComparisonModel);
        check(await page.locator("#comparison-preset option").count() === 3, "Qwen sidebar initializes all three comparison workload chains");
        check(await page.locator("#comparison-baseline option").count() === 4, "comparison navigation initializes all four systolic choices");
        check(await page.locator("#comparison-sa").getAttribute("data-pe-count") === "256" &&
            await page.locator("#comparison-feather").getAttribute("data-pe-count") === "256", "both comparison arrays render after sidebar navigation");
        check(await page.locator("main").count() === 1, "comparison uses the native single main landmark");
        check(await page.locator(".sidebar .active").count() === 1 &&
            await page.locator(".sidebar .active").getAttribute("href") === "FEATHER_VS_SYSTOLIC.html" &&
            await page.locator(".sidebar .active").getAttribute("aria-current") === "page", "comparison sidebar has one accessible current-page entry");
        check(await page.locator("html").getAttribute("data-theme") === "light", "native theme persists from Qwen to comparison");
        for (const theme of ["dark", "light"]) {
            if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator("#theme-toggle").click();
            const palette = await page.evaluate(() => {
                const card = document.querySelector(".comparison-card"), reference = document.createElement("div");
                reference.style.backgroundColor = "var(--bg-card)"; document.body.append(reference);
                const colors = {actual: getComputedStyle(card).backgroundColor, expected: getComputedStyle(reference).backgroundColor};
                reference.remove(); return colors;
            });
            check(palette.actual === palette.expected, `${theme}: comparison cards use the shared native theme surface`);
            check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme}: comparison fits the native desktop shell`);
        }
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        await page.waitForFunction(() => window.FeatherFullWorkloads);
        check(await page.locator("#operator option").count() === 40, "comparison sidebar returns to a fully initialized Qwen Explorer");
        check(await page.locator(".sidebar .active").getAttribute("href") === "QWEN3_MINISA_VISUALIZER.html", "return navigation restores Qwen active-page state");
        check(await page.locator("html").getAttribute("data-theme") === "light", "comparison theme selection persists back into Qwen");
        await page.setViewportSize({width: 390, height: 844});
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile no horizontal overflow");
        await page.locator("#mobile-menu-btn").click();
        check(await page.locator(".sidebar").evaluate(sidebar => sidebar.classList.contains("open")), "mobile sidebar opens");
        await page.locator('.sidebar a[href="FEATHER.html"]').click();
        check(await page.locator("#mg-feather-tab").count() === 1, "sidebar preserves original unified editor");
        await page.locator("#mobile-menu-btn").click();
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        await page.waitForFunction(() => window.FeatherFullWorkloads);
        await page.screenshot({path: path.join(output, "mobile.png")});
        check(await page.locator("#array-play").isVisible(), "overlapping pipeline controls visible by default on mobile");
        await page.locator("#dataflow-mode").selectOption("single");
        check(await page.locator("#motion-play").isVisible(), "isolated-result controls remain available on mobile");
        await page.locator("#mobile-menu-btn").click();
        await page.locator('.sidebar a[href="FEATHER_VS_SYSTOLIC.html"]').click();
        await page.waitForFunction(() => window.FeatherComparisonView);
        check(await page.locator("#comparison-play").isVisible(), "mobile sidebar opens the initialized comparison controls");
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "comparison preserves native mobile viewport width");
        check(!await page.locator(".sidebar").evaluate(sidebar => sidebar.classList.contains("open")), "comparison navigation closes the mobile sidebar");
        await page.locator("#mobile-menu-btn").click();
        check(await page.locator(".sidebar").evaluate(sidebar => sidebar.classList.contains("open")), "comparison mobile sidebar opens normally");
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        await page.waitForFunction(() => window.FeatherFullWorkloads);
        check(await page.locator("#array-play").isVisible(), "mobile comparison sidebar returns to the Qwen pipeline page");
        check(errors.length === 0, `no browser exceptions: ${errors.join("; ")}`);
        check(remote.every(url => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), "only optional existing tutorial fonts requested");
        console.log(`PASS ${assertions} site-shell assertions; screenshots: ${output}`);
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
