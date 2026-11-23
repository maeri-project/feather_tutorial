/* Online-softmax walkthrough of the Qwen page inside the site shell: every step of
 * both recorded attention programs, both themes, desktop and phone. It reads only
 * the published page; no FEATHER_GEMM checkout is needed.
 *
 * PLAYWRIGHT_MODULE=/tmp/browser/node_modules/playwright \
 * PLAYWRIGHT_BROWSERS_PATH=/tmp/browser/browsers node tests/qwen_online_softmax_browser_test.cjs
 */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const {createHash} = require("node:crypto");
const {pathToFileURL} = require("node:url");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "QWEN3_MINISA_VISUALIZER.html");
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const id = name => `#softmax-${name}`;

(async () => {
  // Tests must not leave screenshots or reports in the repository.
  const output = await fs.mkdtemp(path.join(os.tmpdir(), "feather-online-softmax-"));
  const browser = await chromium.launch({headless: true});
  const errors = [], external = [];
  async function open(options) {
    const context = await browser.newContext(options);
    await context.route(/^https?:\/\//, route => { external.push(route.request().url()); return route.fulfill({status: 200, body: ""}); });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => window.FeatherSoftmax && document.getElementById("softmax-status").textContent);
    return page;
  }
  const step = page => page.evaluate(() => window.FeatherSoftmax.state.stage);
  const lit = page => page.locator("#softmax-diagram .on[id]").evaluateAll(nodes => nodes.map(node => node.id.replace("softmax-", "")).sort());
  try {
    // ---- desktop ---------------------------------------------------------------------------------
    const page = await open({viewport: {width: 1440, height: 1000}});
    const data = await page.locator("#softmax-data").evaluate(node => JSON.parse(node.textContent));
    equal(data.cases.map(item => item.phase), ["decode", "prefill"], "a decode step and a causal prefill program are embedded");
    check(await page.locator(".qwen-app #softmax-workspace").count() === 1, "the walkthrough is part of the Qwen application");
    equal(await page.locator(`${id("layer")} tbody tr td:nth-child(2)`).allTextContents(), data.layer.map(row => row.what),
      "the layer procedure lists every operation of a decoder layer in order");
    equal(data.layer.filter(row => row.where === "gemm").length, 5, "five steps of a layer are GEMM programs");
    check((await page.locator(`${id("layer")} tr.sx-where-softmax`).textContent()).includes("8 programs, one per KV head"),
      "the attention row says how often the program runs in a decode step");
    await page.locator('.qwen-app .intro a[href="#online-softmax"]').click();
    const heading = await page.locator("#online-softmax").boundingBox();
    check(heading.y >= 0 && heading.y < 400, "the link in the introduction opens the walkthrough below the top bar");
    for (const item of data.cases) {
      equal(createHash("sha256").update(item.program.hex_text).digest("hex"), item.program.sha256["minisa_instr.hex"],
        `${item.id}: the embedded instruction image is the hashed one`);
      equal(item.stages.reduce((sum, stage) => sum + stage.count, 0), item.totals.instructions, `${item.id}: the steps cover every instruction`);
      check(item.measurement && item.stages[item.stages.length - 1].cycles.end - 1 === item.measurement.cycles,
        `${item.id}: the steps cover every cycle of the recorded simulation`);
      check(item.stages.every(stage => stage.kind !== "request" || stage.cycles.end - stage.cycles.request_start === stage.documented_cycles),
        `${item.id}: every request took its documented number of cycles`);
    }
    for (const [caseIndex, item] of data.cases.entries()) {
      await page.locator(id("case")).selectOption(String(caseIndex));
      const stages = item.stages;
      for (let index = 0; index < stages.length; index++) {
        const stage = stages[index], on = await lit(page);
        equal(await step(page), index, `${item.id}: step ${index} is selected`);
        check((await page.locator(id("status")).textContent()).includes(stage.title), `${item.id}: the status names step ${index}`);
        equal(await page.locator(`${id("lines")} tbody tr`).count(), stage.lines.length, `${item.id}: step ${index} lists its instructions`);
        if (stage.kind === "gemm") check(on.includes("n-nest") && on.includes("n-ob") && !on.includes("n-engine"), `${item.id}: step ${index} is drawn on the PE array`);
        else equal(on.filter(name => name.startsWith("e-e2")), stage.store ? [{I: "e-e2i", W: "e-e2w", O: "e-e2o"}[stage.store.region]] : [],
          `${item.id}: step ${index} is drawn into its HBM region`);
        if (index < stages.length - 1) await page.locator(id("next")).click();
      }
      // a result and the Load that brings it back
      const exp2 = stages.findIndex(stage => stage.kind === "request" && stage.fn === "EXP2" && stage.phase === "block");
      await page.locator(id("scrub")).fill(String(exp2));
      await page.locator(`${id("io")} a.sx-jump`).first().click();
      const consumer = stages[exp2].consumers[0];
      equal(await step(page), consumer.stage, `${item.id}: the link of P opens the PV step that loads it`);
      check(stages[consumer.stage].gemm === "PV" && consumer.target === 1, `${item.id}: P returns into the streaming buffer`);
      await page.locator(`${id("io")} li.sx-back a.sx-jump`).first().click();
      equal(await step(page), exp2, `${item.id}: the link of that Load opens the request that wrote its image`);
    }
    const prefill = data.cases[1], masked = prefill.stages.findIndex(stage => stage.kind === "request" && stage.mask.hi_slope);
    await page.locator(id("scrub")).fill(String(masked));
    check((await page.locator(id("step-text")).textContent()).includes("The mask is on"), "the causal mask is explained where it acts");

    // ---- both site themes: the highlight is the site's colour and stays readable -----------------
    await page.locator(id("reset")).click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const colours = await page.evaluate(() => {
        const parse = value => (value.match(/[\d.]+/g) || []).map(Number);
        const luminance = ([r, g, b]) => [r, g, b].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; })
          .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const workspace = document.getElementById("softmax-workspace"), node = document.querySelector("#softmax-diagram .sx-node.on");
        const probe = document.createElement("span"); probe.style.color = "var(--primary-color)"; workspace.append(probe);
        const primary = getComputedStyle(probe).color; probe.style.color = "var(--sx-on)";
        const highlight = getComputedStyle(probe).color; probe.remove();
        const card = parse(getComputedStyle(workspace).backgroundColor), tint = parse(getComputedStyle(node.querySelector("rect")).fill);
        const alpha = tint.length > 3 ? tint[3] : 1;
        const behind = tint.slice(0, 3).map((value, index) => alpha * value + (1 - alpha) * card[index]);
        const ink = parse(getComputedStyle(node.querySelector("text")).fill).slice(0, 3);
        const [light, dark] = [luminance(behind), luminance(ink)].sort((a, b) => b - a);
        return {primary, highlight, contrast: (light + .05) / (dark + .05), stroke: getComputedStyle(node.querySelector("rect")).stroke};
      });
      equal(colours.highlight, colours.primary, `${theme}: the highlight is the site's primary colour`);
      check(colours.contrast >= 4.5, `${theme}: the label of a highlighted block is readable (contrast ${colours.contrast.toFixed(1)})`);
      await page.locator(id("status")).scrollIntoViewIfNeeded();
      await page.locator("#softmax-workspace").screenshot({path: path.join(output, `walkthrough-${theme}.png`)});
    }
    await page.context().close();

    // ---- phone: the walkthrough waits in Options, with finger-sized controls ---------------------
    const phone = await open({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
    await phone.waitForFunction(() => document.getElementById("mobile-focus-options"));
    check(!await phone.locator("#mobile-focus-options").evaluate(node => node.open), "phone: Options starts closed");
    check(!await phone.locator("#softmax-workspace").isVisible(), "phone: the walkthrough does not push the live drawing down");
    equal(await phone.locator("main button").filter({hasText: /^Play$/}).evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).length), 1,
      "phone: still one visible Play button");
    await phone.locator("#mobile-focus-options > summary").tap();
    await phone.locator(id("status")).scrollIntoViewIfNeeded();
    check(await phone.locator("#softmax-workspace").isVisible(), "phone: Options contains the walkthrough");
    const small = await phone.locator("#softmax-workspace button, #softmax-workspace select, #softmax-workspace summary, #softmax-workspace input")
      .evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).filter(node => {
        const box = node.getBoundingClientRect(); return box.width < 43.5 || box.height < 43.5;
      }).map(node => `${node.id || node.textContent.trim().slice(0, 30)}:${Math.round(node.getBoundingClientRect().width)}×${Math.round(node.getBoundingClientRect().height)}`));
    equal(small, [], "phone: every control of the walkthrough is finger-sized");
    const bounds = await phone.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    check(bounds.document <= bounds.viewport + 1, `phone: the page still fits (${JSON.stringify(bounds)})`);
    await phone.locator(id("next")).tap();
    equal(await step(phone), 1, "phone: Step advances the walkthrough");
    await phone.locator("#softmax-workspace").screenshot({path: path.join(output, "walkthrough-phone.png")});
    await phone.context().close();

    equal(errors, [], "no browser execution or console errors");
    check(external.every(url => /^https:\/\/fonts\./.test(url)), `no network request besides optional fonts: ${external.join(", ")}`);
    console.log(`PASS online softmax walkthrough: ${checks} checks, ${data.cases.reduce((sum, item) => sum + item.stages.length, 0)} steps; screenshots in ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
