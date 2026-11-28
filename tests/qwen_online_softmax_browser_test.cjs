/* The online softmax of the Qwen page inside the site shell.
 *
 *  - An attention program with online softmax is a workload of the Workload list. The accelerator
 *    animation plays it tile after tile with its real operands; below the output buffer the canvas
 *    continues through the activation unit into the HBM image, and every word equals the recorded
 *    program. The steps of the part are chips above the diagram.
 *  - The program panel takes the place of the ACT workspace and follows the animation. The page has
 *    no second animation and no section of its own for the online softmax.
 *  - One program is a full attention workload: the decode step with all 16 query heads. Its 8 KV
 *    heads are reached through the part selector above the diagram and through the bar of KV heads
 *    in the panel.
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
    await page.waitForFunction(() => window.FeatherSoftmax && window.FeatherSoftmax.inspect && window.FeatherFullWorkloads && window.FeatherFullWorkloads.inspect().teaching);
    return page;
  }
  const panel = page => page.evaluate(() => window.FeatherSoftmax.inspect());
  // What the workbench shows: the workload, the tile and frame of the animation, the chips, the two lower cards.
  const bench = page => page.evaluate(() => {
    const full = window.FeatherFullWorkloads.inspect(), snapshot = full.teaching, trace = snapshot.trace, canvas = document.getElementById("full-teach-canvas");
    const chips = [...document.querySelectorAll("#full-teach-steps button")];
    return {workload: document.getElementById("operator").value, caseId: full.caseId, instance: full.instance, indices: full.indices, step: full.step,
      index: snapshot.index, last: trace.frames.length - 1, phase: snapshot.frame.phase, playing: snapshot.playing, phases: trace.frames.map(frame => frame.phase),
      ratio: canvas.height / canvas.width, moving: snapshot.tokens.filter(token => token.path === "activation").length,
      requests: trace.activation && trace.activation.requests ? trace.activation.requests.map(result => ({name: result.name,
        exact: Object.values(result.matches).every(value => value !== false)})) : null,
      real: trace.realOperands, position: trace.activation ? trace.activation.position : null, status: document.getElementById("full-teach-status").textContent,
      strip: !document.getElementById("full-teach-procedure").hidden, part: document.getElementById("full-teach-part").textContent,
      chips: chips.map(chip => Number(chip.dataset.step)), pressed: chips.filter(chip => chip.getAttribute("aria-pressed") === "true").map(chip => Number(chip.dataset.step)),
      panelShown: !document.getElementById("softmax-workspace").hidden, workspaceShown: !document.getElementById("full-act-workspace").hidden};
  });
  const seek = (page, index) => page.locator("#full-teach-scrub").evaluate((node, value) => { node.value = value; node.dispatchEvent(new Event("input", {bubbles: true})); }, index);
  try {
    // ---- desktop ---------------------------------------------------------------------------------
    const page = await open({viewport: {width: 1440, height: 1000}});
    const data = await page.locator("#softmax-data").evaluate(node => JSON.parse(node.textContent));
    const programs = await page.locator("#case-data").evaluate(node => { const all = JSON.parse(node.textContent).act_cases, counts = new Map(all.softmax_cases.map(item => [item.id, item.loop_counts]));
      return all.softmax_programs.map(program => ({id: program.id, program: program.program, title: program.title, sample: program.sample, heads: program.kv_groups,
        instances: program.instances.map(entry => ({kind: entry.kind, where: entry.where, counts: counts.get(entry.case), tiles: entry.tiles.map(tile => ({step: tile.step, requests: tile.requests.map(request => request.name)}))}))})); });
    equal([await page.locator(".qwen-app #full-operator-act > #softmax-workspace").count(), await page.locator("#online-softmax, #softmax-canvas, #softmax-play").count()], [1, 0],
      "the program panel is part of the full-workload view; no section and no animation of its own are left");
    equal(data.cases.map(item => [item.phase, item.sample, item.kv_groups.length]), [["decode", false, data.model.kv_heads], ["prefill", false, 1], ["prefill", true, 1]],
      "the decode step with every KV head, a long prefill program and the sample are embedded");
    equal(programs.map(program => program.program), data.cases.map(item => item.id), "each of them is a workload");
    for (const item of data.cases) {
      equal(createHash("sha256").update(item.program.hex_text).digest("hex"), item.program.sha256["minisa_instr.hex"], `${item.id}: the embedded instruction image is the hashed one`);
      equal(item.stages.reduce((sum, stage) => sum + stage.count, 0), item.totals.instructions, `${item.id}: the steps cover every instruction`);
      check(item.measurement && item.stages[item.stages.length - 1].cycles.end - 1 === item.measurement.cycles, `${item.id}: the steps cover every cycle of the recorded simulation`);
      check(item.stages.every(stage => stage.kind !== "request" || stage.cycles.end - stage.cycles.request_start === stage.documented_cycles),
        `${item.id}: every request took its documented number of cycles`);
    }

    // the programs in the existing workload list; the link of the introduction opens the sample
    const order = programs.slice().sort((a, b) => Number(b.sample) - Number(a.sample)), sample = order[0], sampleCase = data.cases.find(item => item.id === sample.program);
    const groups = await page.locator("#operator optgroup").evaluateAll(nodes => nodes.filter(node => node.label.startsWith("Attention with online softmax"))
      .map(node => [...node.children].map(child => child.value)));
    equal(groups, [order.map(program => `act:${program.id}`)], "one group of the Workload list holds the attention programs, the sample first");
    let now = await bench(page);
    equal([now.panelShown, now.workspaceShown, now.strip, now.real], [false, true, false, false], "a recorded ACT workload has its workspace and no steps of a program");
    // the full attention workload has a link of its own in the introduction
    const full = programs.find(program => program.heads.length > 1), fullCase = data.cases.find(item => item.id === full.program);
    await page.locator(`.qwen-app .intro a[data-open-online-softmax="${full.program}"]`).click();
    now = await bench(page);
    equal([now.workload, now.step, (await panel(page)).case, (await panel(page)).heads, full.instances.length], [`act:${full.id}`, 0, full.program, data.model.kv_heads, 34 * data.model.kv_heads],
      "its link opens the decode step with all KV heads, at its first Load");
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.qwen-app .intro a[data-open-online-softmax=""]').click();
    const heading = await page.locator("#full-operator-examples").boundingBox();
    check(heading.y >= 0 && heading.y < 400, "the link in the introduction opens the full-workload view below the top bar");
    now = await bench(page);
    equal([now.workload, now.instance, now.indices, now.step, now.index], [`act:${sample.id}`, 0, {n: 0, m: 0, k: 0}, 0, 0], "and selects the sample there, at its first Load");
    equal([now.panelShown, now.workspaceShown, now.strip, now.real], [true, false, true, true], "its panel replaces the ACT workspace; its steps are above the diagram; its operands are real");
    check(near(now.ratio, 1600 / 1120), "the canvas continues below the output buffer");
    equal(await page.locator(`${id("layer")} tbody tr td:nth-child(2)`).allTextContents(), data.layer.map(row => row.what), "the layer procedure lists every operation of a decoder layer in order");

    // every step of the sample through the panel; a sample of the steps of the long programs
    for (const program of order) {
      const item = data.cases.find(entry => entry.id === program.program);
      await page.locator("#operator").selectOption(`act:${program.id}`);
      const shown = await panel(page);
      equal([shown.case, shown.stage, shown.exact, shown.requests], [item.id, 0, true, item.totals.requests], `${item.id}: every request runs again in the page and equals the recorded program`);
      check((await page.locator(id("check")).textContent()).startsWith("✓") && (await page.locator(id("summary")).textContent()).includes(item.measurement.cycles.toLocaleString("en-US")),
        `${item.id}: the panel says so and shows the recorded cycles`);
      for (let index = 0; index < item.stages.length; index += program.sample ? 1 : 7) {
        const stage = item.stages[index], entry = program.instances[stage.instance];
        if (program.sample && index > 0) await page.locator(id("next")).click();
        else await page.evaluate(value => window.FeatherSoftmax.select(value), index);
        now = await bench(page);
        equal([now.step, (await panel(page)).stage, now.instance, now.pressed], [index, index, stage.instance, [index]], `${item.id}: step ${index + 1} in the animation, in the panel and among the chips`);
        check((await page.locator(id("status")).textContent()).includes(stage.title), `${item.id}: the panel names step ${index + 1}`);
        if (stage.kind === "request") {
          equal([now.phase, now.indices.k, now.requests.map(result => result.name)], ["activation", entry.counts.k - 1, entry.tiles[stage.tile].requests], `${item.id}: step ${index + 1} is in the activation unit`);
          check(now.requests.every(result => result.exact) && !now.phases.includes("store") && now.phases[now.last] === "activation",
            `${item.id}: step ${index + 1}: every word the page writes equals the recorded program, and the tile ends in the unit`);
        } else equal([now.phase, now.indices.k, now.index], ["load_input", 0, 0], `${item.id}: step ${index + 1} starts at the first Load of its GEMM tile`);
      }
    }

    // the full attention workload: its KV heads in the part selector and in the first bar of the panel
    await page.locator("#operator").selectOption(`act:${full.id}`);
    const perHead = fullCase.blocks.length + fullCase.rows;
    equal(await page.locator("#full-teach-part-select optgroup").evaluateAll(groups => groups.map(group => [group.label, group.children.length])),
      full.heads.map(head => [`KV head ${head.kv_group} · query heads ${head.query_heads.join(" and ")}`, perHead]), "the part selector lists the parts of every KV head under its head");
    const far = fullCase.kv_groups[6], block = fullCase.blocks.length - 1;
    await page.locator("#full-teach-part-select").selectOption(`g${far.kv_group}b${block}`);
    now = await bench(page);
    const there = fullCase.stages.findIndex(stage => stage.group === far.kv_group && stage.block === block);
    equal([now.step, now.index, (await panel(page)).stage, (await panel(page)).head], [there, 0, there, far.kv_group], "a part chosen there is shown from its first Load, in the animation and in the panel");
    check(now.part.includes(`KV head ${far.kv_group}`) && now.part.includes(`Key block ${block}`) && now.real, "the strip names the KV head; the operands are those of that head");
    const third = fullCase.kv_groups[3];
    await page.locator(`${id("bar-heads")} .sx-seg[data-head="${third.kv_group}"]`).click();
    now = await bench(page);
    equal([now.step, (await panel(page)).stage, await page.locator(`${id("bar-all")} .sx-seg`).count(), await page.locator(`${id("bar-heads")} .sx-seg.on`).allTextContents()],
      [third.first_stage, third.first_stage, third.stages, [String(third.kv_group)]], "a KV head chosen in the panel is shown from its first step; the bar below holds its steps");
    check((await page.locator(id("bar-all-label")).textContent()).includes(`KV head ${third.kv_group} · query heads ${third.query_heads.join(" and ")}`), "and is named with its query heads");
    await page.evaluate(value => window.FeatherSoftmax.select(value), fullCase.stages.length - 1);
    now = await bench(page);
    check(now.requests.every(result => result.exact) && (await page.locator(id("status")).textContent()).includes(`query head ${data.model.query_heads - 1}`)
      && (await page.locator(id("io")).textContent()).includes(`attention output O · KV head ${data.model.kv_heads - 1}`), "the last request writes the attention output of the last query head");
    await page.locator("#softmax-workspace").screenshot({path: path.join(output, "full-attention-panel.png")});
    await page.locator("#full-act-teaching").screenshot({path: path.join(output, "full-attention-widget.png")});

    // the sample in the animation: a frame of the unit, the chips, the parts, tile after tile, playback
    await page.locator("#operator").selectOption(`act:${sample.id}`);
    await page.locator('#full-teach-steps button[data-step="1"]').click();
    now = await bench(page);
    equal([now.step, now.phase, now.requests[0].name, (await panel(page)).stage], [1, "activation", "EXP2", 1], "a chip shows its request in the activation unit, and the panel follows");
    await seek(page, now.phases.lastIndexOf("activation"));
    now = await bench(page);
    check(now.status.startsWith("Activation unit") && now.moving === 1 && now.step === 2, "a frame of the unit shows the word of its beat; the last frames belong to ROWMAX");
    await page.locator("#full-act-teaching canvas").screenshot({path: path.join(output, "program-activation-unit.png")});
    await page.locator("#full-teach-part-next").click();
    const second = sampleCase.stages.findIndex(stage => stage.block === 1);
    now = await bench(page);
    equal([now.step, now.chips[0], now.part.includes("Key block 1")], [second, second, true], "Next part starts the next key block");
    await page.locator("#full-next-tile").click();
    equal((await bench(page)).position, now.position + 1, "Next tile walks on through the program");
    // a result and the Load that brings it back
    const exp2 = sampleCase.stages.findIndex(stage => stage.kind === "request" && stage.fn === "EXP2" && stage.phase === "block");
    await page.evaluate(value => window.FeatherSoftmax.select(value), exp2);
    await page.locator(`${id("io")} a.sx-jump`).first().click();
    const consumer = sampleCase.stages[exp2].consumers[0];
    now = await bench(page);
    check(now.step === consumer.stage && (await panel(page)).stage === consumer.stage && now.status.includes("Streaming buffer ← P"),
      "the link of P opens the PV step that loads it into the streaming buffer, in the animation too");
    // playback runs on into the next GEMM and yields to other players
    const short = sampleCase.stages.findIndex(stage => stage.gemm === "rowsum");
    await page.evaluate(value => window.FeatherFullWorkloads.showStep(value), short);
    await page.locator("#full-teach-speed").selectOption("4");
    await page.locator("#full-teach-play").click();
    await page.waitForFunction(value => window.FeatherFullWorkloads.inspect().step >= value + 2, short, {timeout: 60000});
    now = await bench(page);
    equal([now.playing, now.instance, (await panel(page)).stage], [true, sampleCase.stages[short].instance + 1, short + 2], "at the end of a tile playback runs on into the next GEMM, and the panel follows");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("feather-playback-start", {detail: {owner: "another-player"}})));
    check(!(await bench(page)).playing && await page.locator("#full-teach-play").textContent() === "Play", "another player's start pauses the animation");

    // ---- both site themes: the diagram stays on light paper, the chips take the site colour --------
    await page.evaluate(value => window.FeatherSoftmax.select(value), exp2);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      const colours = await page.evaluate(() => ["softmax-workspace", "full-teach-procedure"].map(name => {
        const holder = document.getElementById(name), probe = document.createElement("span");
        probe.style.color = "var(--primary-color)"; holder.append(probe);
        const primary = getComputedStyle(probe).color; probe.style.color = "var(--sx-on)";
        const highlight = getComputedStyle(probe).color; probe.remove();
        return {primary, highlight};
      }).concat({paper: getComputedStyle(document.querySelector("#full-act-teaching .act-teach-viewport")).backgroundColor}));
      equal([colours[0].highlight, colours[1].highlight], [colours[0].primary, colours[1].primary], `${theme}: the selected step is marked in the site's primary colour, in the panel and above the diagram`);
      equal(colours[2].paper, "rgb(250, 252, 252)", `${theme}: the hardware diagram stays on light paper`);
      await page.locator("#full-act-teaching").screenshot({path: path.join(output, `animation-${theme}.png`)});
      await page.locator("#softmax-workspace").screenshot({path: path.join(output, `panel-${theme}.png`)});
    }
    await page.locator("#operator").selectOption({index: 0});
    now = await bench(page);
    check(now.requests === null && !now.real && near(now.ratio, 1220 / 1120) && !now.panelShown && now.workspaceShown && !now.strip,
      "a recorded ACT workload keeps the canvas, the Store and the workspace it had");
    await page.context().close();

    // ---- phone: the live drawing plays the program; steps and panel wait in Options -----------------
    const phone = await open({viewport: {width: 390, height: 844}, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
    await phone.waitForFunction(() => document.getElementById("mobile-focus-options"));
    check(!await phone.locator("#mobile-focus-options").evaluate(node => node.open), "phone: Options starts closed");
    await phone.locator("#operator").selectOption(`act:${sample.id}`);
    now = await bench(phone);
    equal([now.workload, now.real, now.step, near(now.ratio, 1600 / 720)], [`act:${sample.id}`, true, 0, true], "phone: the Workload list selects the sample; the live drawing has the activation unit below the output buffer");
    check(!await phone.locator("#softmax-workspace").isVisible() && !await phone.locator("#full-teach-steps").isVisible(), "phone: panel and steps do not push the live drawing down");
    equal(await phone.locator("main button").filter({hasText: /^Play$/}).evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).length), 1,
      "phone: still one visible Play button");
    await phone.locator("#mobile-focus-play").tap();
    await phone.waitForFunction(() => window.FeatherFullWorkloads.inspect().teaching.playing);
    await phone.locator("#mobile-focus-play").tap();
    check(!(await bench(phone)).playing, "phone: that button plays and pauses the program");
    await phone.evaluate(() => window.FeatherFullWorkloads.showStep(1));
    now = await bench(phone);
    check(now.phase === "activation" && now.requests.every(result => result.exact) && near(now.ratio, 1600 / 720), "phone: the live drawing of the program continues through the activation unit");
    await phone.locator("#full-act-teaching canvas").screenshot({path: path.join(output, "animation-phone.png")});
    await phone.locator("#mobile-focus-options > summary").tap();
    await phone.locator("#full-teach-steps").scrollIntoViewIfNeeded();
    check(await phone.locator("#full-teach-steps").isVisible() && await phone.locator("#softmax-workspace").isVisible(), "phone: Options contains the steps and the program panel");
    const small = await phone.locator("#softmax-workspace button, #softmax-workspace select, #softmax-workspace summary, #softmax-workspace input, #full-teach-procedure button, #full-teach-procedure select")
      .evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).filter(node => {
        const box = node.getBoundingClientRect(); return box.width < 43.5 || box.height < 43.5;
      }).map(node => `${node.id || node.textContent.trim().slice(0, 30)}:${Math.round(node.getBoundingClientRect().width)}×${Math.round(node.getBoundingClientRect().height)}`));
    equal(small, [], "phone: every control of the steps and of the panel is finger-sized");
    const bounds = await phone.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    check(bounds.document <= bounds.viewport + 1, `phone: the page still fits (${JSON.stringify(bounds)})`);
    await phone.locator('#full-teach-steps button[data-step="3"]').tap();
    equal([(await bench(phone)).step, (await panel(phone)).stage], [3, 3], "phone: a chip shows its step");
    await phone.locator(id("next")).scrollIntoViewIfNeeded();
    await phone.locator(id("next")).tap();
    equal([(await bench(phone)).step, (await panel(phone)).stage], [4, 4], "phone: Next step of the panel moves the animation too");
    await phone.locator("#softmax-workspace").screenshot({path: path.join(output, "panel-phone.png")});
    // the full attention workload on a phone: the part selector reaches another KV head, and the page still fits
    await phone.locator("#operator").selectOption(`act:${full.id}`);
    await phone.locator("#full-teach-part-select").selectOption(`g${far.kv_group}b0`);
    now = await bench(phone);
    equal([now.step, (await panel(phone)).head, now.real], [far.first_stage, far.kv_group, true], "phone: the part selector shows a key block of another KV head");
    await phone.locator(`${id("bar-heads")}`).scrollIntoViewIfNeeded();
    equal(await phone.locator(`${id("bar-heads")} .sx-seg.on`).allTextContents(), [String(far.kv_group)], "phone: the bar of KV heads marks it");
    const wide = await phone.evaluate(() => ({viewport: innerWidth, document: document.documentElement.scrollWidth}));
    check(wide.document <= wide.viewport + 1, `phone: the page fits with the full program too (${JSON.stringify(wide)})`);
    await phone.locator("#full-teach-procedure").screenshot({path: path.join(output, "full-attention-strip-phone.png")});
    await phone.locator(id("timeline")).screenshot({path: path.join(output, "full-attention-timeline-phone.png")});
    await phone.context().close();

    equal(errors, [], "no browser execution or console errors");
    check(external.every(url => /^https:\/\/fonts\./.test(url)), `no network request besides optional fonts: ${external.join(", ")}`);
    console.log(`PASS online softmax in the Qwen explorer: ${checks} checks, ${programs.length} attention programs, ${sampleCase.stages.length} steps of the sample; screenshots in ${output}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
