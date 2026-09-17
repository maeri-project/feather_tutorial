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
        }
        await page.goto(pathToFileURL(path.join(root, "index.html")).href);
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        check(await page.locator("#operator option").count() === 9, "sidebar opens functioning Qwen app");
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
        await page.setViewportSize({width: 390, height: 844});
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile no horizontal overflow");
        await page.locator("#mobile-menu-btn").click();
        check(await page.locator(".sidebar").evaluate(sidebar => sidebar.classList.contains("open")), "mobile sidebar opens");
        await page.locator('.sidebar a[href="FEATHER.html"]').click();
        check(await page.locator("#mg-feather-tab").count() === 1, "sidebar preserves original unified editor");
        await page.locator("#mobile-menu-btn").click();
        await page.locator('.sidebar a[href="QWEN3_MINISA_VISUALIZER.html"]').click();
        await page.screenshot({path: path.join(output, "mobile.png")});
        check(await page.locator("#motion-play").isVisible(), "single-element controls available on mobile");
        check(errors.length === 0, `no browser exceptions: ${errors.join("; ")}`);
        check(remote.every(url => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)), "only optional existing tutorial fonts requested");
        console.log(`PASS ${assertions} site-shell assertions; screenshots: ${output}`);
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
