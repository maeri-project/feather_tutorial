/* The online softmax of the Qwen page inside the site shell.
 *
 *  - The Workload list holds the stages of the recorded attention programs. On the last K tile of
 *    a stage the accelerator canvas continues below the output buffer, through the activation
 *    unit into the HBM image; every word equals the recorded program.
 *  - The hardware animation plays the sample program step by step on the loop of the hardware.
 *  - Both themes, desktop and phone. It reads only the published page; no FEATHER_GEMM checkout
 *    is needed.
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
const near = (value, wanted) => Math.abs(value - wanted) < 2e-3;

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
    await page.waitForFunction(() => window.FeatherSoftmax && window.FeatherSoftmax.inspect && window.FeatherFullWorkloads
      && document.getElementById("softmax-status").textContent);
    return page;
  }
  const inspect = page => page.evaluate(() => window.FeatherSoftmax.inspect());
  const teaching = page => page.evaluate(() => {
    const snapshot = window.FeatherFullWorkloads.inspect().teaching, trace = snapshot.trace, canvas = document.getElementById("full-teach-canvas");
    return {caseId: snapshot.caseId, index: snapshot.index, phase: snapshot.frame.phase, phases: trace.frames.map(frame => frame.phase),
      ratio: canvas.height / canvas.width, moving: snapshot.tokens.filter(token => token.path === "activation").length,
      requests: trace.activation && trace.activation.requests ? trace.activation.requests.map(result => ({name: result.name,
        exact: Object.values(result.matches).every(value => value !== false)})) : null,
      real: trace.realOperands, status: document.getElementById("full-teach-status").textContent};
  });
  try {
    // ---- desktop ---------------------------------------------------------------------------------
    const page = await open({viewport: {width: 1440, height: 1000}});
    const data = await page.locator("#softmax-data").evaluate(node => JSON.parse(node.textContent));
    const stages = await page.locator("#case-data").evaluate(node => JSON.parse(node.textContent).act_cases.softmax_cases.map(item => ({
      id: item.id, program: item.activation.program, title: item.activation.program_title, k: item.loop_counts.k,
      requests: item.activation.tiles[0].requests.map(request => request.name)})));
    check(await page.locator(".qwen-app #softmax-workspace").count() === 1 && await page.locator(".qwen-app #softmax-canvas").count() === 1,
      "the hardware animation is part of the Qwen application");
    equal(data.cases.map(item => [item.phase, item.sample]), [["decode", false], ["prefill", false], ["prefill", true]], "two long programs and the sample are embedded");
    for (const item of data.cases) {
      equal(createHash("sha256").update(item.program.hex_text).digest("hex"), item.program.sha256["minisa_instr.hex"], `${item.id}: the embedded instruction image is the hashed one`);
      equal(item.stages.reduce((sum, stage) => sum + stage.count, 0), item.totals.instructions, `${item.id}: the steps cover every instruction`);
      check(item.measurement && item.stages[item.stages.length - 1].cycles.end - 1 === item.measurement.cycles, `${item.id}: the steps cover every cycle of the recorded simulation`);
      check(item.stages.every(stage => stage.kind !== "request" || stage.cycles.end - stage.cycles.request_start === stage.documented_cycles),
        `${item.id}: every request took its documented number of cycles`);
    }
    equal(await page.locator(`${id("layer")} tbody tr td:nth-child(2)`).allTextContents(), data.layer.map(row => row.what), "the layer procedure lists every operation of a decoder layer in order");
    await page.locator('.qwen-app .intro a[href="#online-softmax"]').click();
    const heading = await page.locator("#online-softmax").boundingBox();
    check(heading.y >= 0 && heading.y < 400, "the link in the introduction opens the section below the top bar");

    // the attention stages in the existing workload list, and their canvas
    const groups = await page.locator("#operator optgroup").evaluateAll(nodes => nodes.filter(node => node.label.startsWith("Attention with online softmax"))
      .map(node => [...node.children].map(child => child.value)));
    equal(groups.flat(), stages.map(item => `act:${item.id}`), "every attention stage is a workload of the explorer, in the order of its program");
    equal(groups.length, new Set(stages.map(item => item.program)).size, "one group per program");
    for (const item of stages) {
      await page.locator("#operator").selectOption(`act:${item.id}`);
      for (let k = 1; k < item.k; k++) await page.locator("#full-next-tile").click();       // to the last K tile of the first output tile
      const state = await teaching(page);
      equal([state.caseId, state.real, state.requests.map(result => result.name)], [item.id, true, item.requests], `${item.id}: its last K tile, with real operands and its requests`);
      check(state.requests.every(result => result.exact), `${item.id}: every word the page writes equals the recorded program`);
      check(near(state.ratio, 1600 / 1120) && !state.phases.includes("store") && state.phases[state.phases.length - 1] === "activation",
        `${item.id}: the canvas continues below the output buffer and ends in the activation unit`);
      const frame = state.phases.lastIndexOf("activation");
      await page.locator("#full-teach-scrub").evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event("input", {bubbles: true})); }, frame);
      const at = await teaching(page);
      check(at.status.startsWith("Activation unit") && at.moving === 1, `${item.id}: a frame of the unit shows the word of its beat`);
    }
    await page.locator("#full-act-teaching canvas").screenshot({path: path.join(output, "stage-activation-unit.png")});
    await page.locator("#operator").selectOption({index: 0});
    let state = await teaching(page);
    check(state.requests === null && !state.real && near(state.ratio, 1220 / 1120), "a recorded ACT workload keeps the canvas and the Store it had");

    // the hardware animation: the sample from the first Load to the attention output
    const sampleIndex = data.cases.findIndex(item => item.sample), sample = data.cases[sampleIndex];
    let now = await inspect(page);
    equal([now.case, now.stage, now.fraction, now.exact, now.landed], [sample.id, 0, 0, true, 0], "the sample is shown first, before its first Load; the engine model reproduces it");
    let landed = 0;
    for (let index = 0; index < sample.stages.length; index++) {
      await page.locator(id("next")).click();
      now = await inspect(page);
      const stage = sample.stages[index];
      equal([now.stage, now.fraction], [index, 1], `sample: step ${index} is shown complete`);
      check((await page.locator(id("status")).textContent()).includes(stage.title), `sample: the status names step ${index}`);
      check((now.landed > landed) === (stage.kind === "request" && stage.writes > 0), `sample: step ${index} ${stage.writes ? "adds its words to" : "leaves"} the HBM board`);
      landed = now.landed;
    }
    equal(landed, now.words, "sample: at the end every result word is in HBM");
    for (const [caseIndex, item] of data.cases.entries()) {
      await page.locator(id("case")).selectOption(String(caseIndex));
      check((await inspect(page)).exact && (await page.locator(id("check")).textContent()).startsWith("✓"), `${item.id}: every request runs again in the page and equals the recorded program`);
    }
    await page.locator(id("case")).selectOption(String(sampleIndex));
    // a result and the Load that brings it back
    const exp2 = sample.stages.findIndex(stage => stage.kind === "request" && stage.fn === "EXP2" && stage.phase === "block");
    await page.locator(id("scrub")).fill(String(exp2));
    await page.locator(`${id("io")} a.sx-jump`).first().click();
    const consumer = sample.stages[exp2].consumers[0];
    now = await inspect(page);
    check(now.stage === consumer.stage && now.sources.some(source => source.item === "P" && source.back && source.target === 1), "the link of P opens the PV step that loads it into the streaming buffer");
    // inside a step, and playback
    await page.evaluate(([index, fraction]) => window.FeatherSoftmax.select(index, fraction), [exp2, .25]);
    equal((await inspect(page)).phase, "scan", "a quarter into EXP2 the first pass keeps the row maxima");
    await page.locator(id("within")).fill("800");
    now = await inspect(page);
    check(now.phase === "emit" && now.fraction === .8 && now.beat.at.item === "P", "the slider moves inside the step: the second pass writes P");
    const picture = await page.locator(id("canvas")).evaluate(node => node.toDataURL());
    await page.locator(id("within")).fill("820");
    check(await page.locator(id("canvas")).evaluate(node => node.toDataURL()) !== picture, "another moment draws another picture");
    await page.locator(id("reset")).click();
    await page.locator(id("speed")).selectOption("3");
    await page.locator(id("play")).click();
    await page.waitForFunction(() => { const at = window.FeatherSoftmax.inspect(); return at.playing && at.fraction > .05; });
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("feather-playback-start", {detail: {owner: "another-player"}})));
    check(!(await inspect(page)).playing && await page.locator(id("play")).textContent() === "Play", "another player's start pauses the animation");

    // ---- both site themes: the animation stays on light paper, the chips take the site colour -----
    await page.locator(id("scrub")).fill(String(exp2));
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const colours = await page.evaluate(() => {
        const workspace = document.getElementById("softmax-workspace"), probe = document.createElement("span");
        probe.style.color = "var(--primary-color)"; workspace.append(probe);
        const primary = getComputedStyle(probe).color; probe.style.color = "var(--sx-on)";
        const highlight = getComputedStyle(probe).color; probe.remove();
        return {primary, highlight, paper: getComputedStyle(document.querySelector(".sx-canvas-scroll")).backgroundColor};
      });
      equal(colours.highlight, colours.primary, `${theme}: the selected step is marked in the site's primary colour`);
      equal(colours.paper, "rgb(250, 252, 252)", `${theme}: the hardware animation stays on light paper`);
      await page.locator(id("canvas")).scrollIntoViewIfNeeded();
      await page.locator("#softmax-workspace").screenshot({path: path.join(output, `animation-${theme}.png`)});
    }
    await page.context().close();

    // ---- phone: the animation waits in Options, with finger-sized controls -----------------------
    const phone = await open({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
    await phone.waitForFunction(() => document.getElementById("mobile-focus-options"));
    check(!await phone.locator("#mobile-focus-options").evaluate(node => node.open), "phone: Options starts closed");
    check(!await phone.locator("#softmax-workspace").isVisible(), "phone: the animation does not push the live drawing down");
    equal(await phone.locator("main button").filter({hasText: /^Play$/}).evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).length), 1,
      "phone: still one visible Play button");
    // an attention stage in the live drawing: the taller canvas with the unit
    const first = stages[0];
    await phone.evaluate(([value, k]) => window.FeatherFullWorkloads.select(value, {n: 0, m: 0, k}), [`act:${first.id}`, first.k - 1]);
    state = await teaching(phone);
    check(state.requests.every(result => result.exact) && near(state.ratio, 1600 / 720), "phone: the live drawing of an attention stage continues through the activation unit");
    await phone.locator("#mobile-focus-options > summary").tap();
    await phone.locator(id("status")).scrollIntoViewIfNeeded();
    check(await phone.locator("#softmax-workspace").isVisible() && await phone.locator(id("canvas")).isVisible(), "phone: Options contains the animation");
    const small = await phone.locator("#softmax-workspace button, #softmax-workspace select, #softmax-workspace summary, #softmax-workspace input")
      .evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).filter(node => {
        const box = node.getBoundingClientRect(); return box.width < 43.5 || box.height < 43.5;
      }).map(node => `${node.id || node.textContent.trim().slice(0, 30)}:${Math.round(node.getBoundingClientRect().width)}×${Math.round(node.getBoundingClientRect().height)}`));
    equal(small, [], "phone: every control of the animation is finger-sized");
    const bounds = await phone.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    check(bounds.document <= bounds.viewport + 1, `phone: the page still fits (${JSON.stringify(bounds)})`);
    await phone.locator(id("next")).tap();
    equal([(await inspect(phone)).stage, (await inspect(phone)).fraction], [0, 1], "phone: Step completes the first step");
    await phone.locator(id("next")).tap();
    equal((await inspect(phone)).stage, 1, "phone: Step advances the animation");
    await phone.locator("#softmax-workspace").screenshot({path: path.join(output, "animation-phone.png")});
    await phone.context().close();

    equal(errors, [], "no browser execution or console errors");
    check(external.every(url => /^https:\/\/fonts\./.test(url)), `no network request besides optional fonts: ${external.join(", ")}`);
    console.log(`PASS online softmax in the Qwen explorer: ${checks} checks, ${stages.length} attention stages, ${sample.stages.length} steps of the sample; screenshots in ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
