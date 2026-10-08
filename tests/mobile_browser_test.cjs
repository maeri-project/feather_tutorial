/* All published HTML pages plus real touch interaction in each visualizer. */
"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), os = require("node:os");
const {pathToFileURL} = require("node:url");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, ".."), engine = process.env.MOBILE_BROWSER || "chromium";
let checks = 0;
function check(value, message) { assert.ok(value, message); checks++; }
(async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), `feather-mobile-${engine}-`));
  const browser = await playwright[engine].launch({headless:true});
  const context = await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await context.route(/^https:\/\/fonts\./, route => route.fulfill({body:""}));
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(`${page.url()}: ${error.message}`));
  page.on("dialog", dialog => dialog.accept());
  page.setDefaultTimeout(10000);
  const url = file => process.env.MOBILE_SITE_URL ? `${process.env.MOBILE_SITE_URL.replace(/\/$/, "")}/${file}` : pathToFileURL(path.join(root,file)).href;
  const load = async file => { await page.goto(url(file)); await page.waitForFunction(() => document.getElementById("mobile-menu-btn").hasAttribute("aria-expanded")); };
  async function fits(label) {
    const bounds = await page.evaluate(() => ({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
    check(bounds.document <= bounds.viewport + 1 && bounds.body <= bounds.viewport + 1, `${label}: document fits (${JSON.stringify(bounds)})`);
  }
  async function targets(label) {
    const small = await page.locator("main button, main select, main summary, main input:not([type=checkbox]):not([type=radio]):not([type=hidden]), #mobile-close-btn").evaluateAll(nodes => nodes.filter(e => e.checkVisibility() && !e.disabled).filter(e => {
      const r = e.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5;
    }).map(e => `${e.id || e.textContent.trim().slice(0,30)}:${Math.round(e.getBoundingClientRect().width)}×${Math.round(e.getBoundingClientRect().height)}`));
    check(small.length === 0, `${label}: finger-sized controls: ${small.join(", ")}`);
    const fields = await page.locator("input:not([type=range]), select, textarea").evaluateAll(nodes => nodes.filter(e=>e.checkVisibility()).filter(e=>parseFloat(getComputedStyle(e).fontSize)<16).map(e=>e.id));
    check(fields.length === 0, `${label}: fields avoid phone focus zoom: ${fields.join(", ")}`);
  }
  const view = id => page.locator(`.mobile-diagram[data-diagram="${id}"]`);
  const controls = id => page.locator(`.mobile-focus-zoom[data-diagram="${id}"], .mobile-diagram[data-diagram="${id}"]:has(.mobile-diagram-tools)`);
  async function options() {
    const panel=page.locator("#mobile-focus-options");
    if(await panel.count() && !await panel.evaluate(e=>e.open)) await panel.locator(":scope > summary").tap();
  }
  async function zoom(id, times=3) {
    await options();
    for (let i=0;i<times;i++) await controls(id).getByRole("button",{name:"Zoom in",exact:true}).tap();
    check(await view(id).locator(".mobile-diagram-scroll").evaluate(e=>e.scrollWidth>e.clientWidth*2), `${id}: local zoom preserves detail`);
    await fits(`${id}: zoom`);
  }
  async function tapDrawing(id,x,y,width,height) {
    const drawing=page.locator(`#${id}`), scroller=view(id).locator(".mobile-diagram-scroll");
    await scroller.evaluate((e,{x,y,width,height})=>{const c=e.querySelector("canvas,svg");e.scrollLeft=x/width*c.getBoundingClientRect().width-e.clientWidth/2;e.scrollTop=y/height*c.getBoundingClientRect().height-e.clientHeight/2;},{x,y,width,height});
    await scroller.scrollIntoViewIfNeeded();
    const rect=await drawing.boundingBox();
    await page.touchscreen.tap(rect.x+x/width*rect.width,rect.y+y/height*rect.height);
  }
  async function maxZoom(id) {
    await options();
    const plus=controls(id).getByRole("button",{name:"Zoom in",exact:true});
    while(await plus.isEnabled()) await plus.tap();
    await page.waitForTimeout(100);
    check(await page.locator(`#${id}`).evaluate(c=>c.width*c.height<=8_010_000),`${id}: maximum phone zoom bounds canvas memory`);
    await fits(`${id}: maximum zoom`);
    await controls(id).getByRole("button",{name:"Fit diagram width",exact:true}).tap();
  }
  try {
    const files = (await fs.readdir(root)).filter(file=>file.endsWith(".html")).sort();
    check(files.length>=10,"inventory includes every published tutorial HTML");
    for (const size of [{width:320,height:740},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(size);
      for (const file of files) {
        await load(file); await fits(`${file} ${size.width}`); await targets(file);
        const takeaway=page.locator('.page-takeaway');
        if(await takeaway.count()) {
          check(await takeaway.isVisible() && await takeaway.locator('p').isVisible(),`${file}: takeaway is visible without opening Options`);
          check(await takeaway.locator('p').evaluate(e=>getComputedStyle(e).fontFamily===getComputedStyle(document.body).fontFamily),`${file}: takeaway uses the shared font`);
        }
        if(await page.locator(".mobile-focus").count()) {
          check(!await page.locator("#mobile-focus-options").evaluate(e=>e.open),`${file}: Options starts closed`);
          check(await page.locator("main button").filter({hasText:/^Play$/}).evaluateAll(nodes=>nodes.filter(e=>e.checkVisibility()).length)===1,`${file}: one visible Play button`);
          const toolbar=await page.locator(".mobile-focus-toolbar").boundingBox(), drawing=await page.locator(".mobile-primary-visual").boundingBox();
          check(drawing.y>=toolbar.y+toolbar.height && drawing.y-toolbar.y-toolbar.height<20,`${file}: visualization immediately follows playback`);
          check(await page.locator(".mobile-focus-page p").evaluateAll(nodes=>nodes.filter(e=>!e.closest('#isa,.page-takeaway')).every(e=>!e.checkVisibility())),`${file}: explanations remain hidden except the ISA and takeaway`);
          const takeawayBox=await takeaway.boundingBox();
          check(takeawayBox.y+takeawayBox.height<=toolbar.y,`${file}: takeaway precedes playback`);
          if(file==='FEATHER.html') {
            check(await page.locator('.page-takeaway a[href="runtime_computing_change.html"]').isVisible(),"FEATHER exposes the runtime animation outside Options");
            check(await page.locator('.mobile-focus-speed #mgSpeedSlider').isVisible(),"speed is beside Play");
            check(await page.locator('#mgIsaList').isVisible() && await page.locator('#isa').isVisible(),"MINISA trace and reference are visible");
            const isa=await page.locator('#mgIsaList').boundingBox();
            check(isa.y>=drawing.y+drawing.height,"MINISA trace follows the architecture");
            const geometry=await page.evaluate(()=>({width:mgHW.AW,regions:mgFeatherGeometry.bufferRegions}));
            check(geometry.regions.every(r=>r.width===geometry.width*22+58),"all three phone buffers use narrow scalar columns");
          }
          if(file==='QWEN3_MINISA_VISUALIZER.html') {
            check(await page.locator('#operator').isVisible(),"Qwen workload selector is always visible");
            check(await page.locator('#full-teach-canvas').evaluate(c=>Math.abs(c.width/c.height-720/1220)<.001),"Qwen uses narrow phone geometry");
          }
          if(file==='RECONFIGURABLE_COMPUTE.html') {
            check(await page.locator('.mobile-focus .rc-chain').isVisible(),"compact layer sequence is visible");
            check(await page.locator('.mobile-focus #rc-runtime-demo').isVisible(),"runtime reconfiguration is embedded outside Options");
            check(await page.locator('#runtime-elements rect').count()===16,"embedded runtime keeps sixteen main squares");
          }
          if(file==='FEATHER_VS_SYSTOLIC.html')check(await page.locator('#comparison-preset').isVisible()&&await page.locator('#comparison-baseline').isVisible(),"comparison selectors are always visible");
        }
        await page.locator("#mobile-menu-btn").tap();
        check(await page.locator(".sidebar").evaluate(e=>e.classList.contains("open")&&!e.inert),`${file}: touch menu opens`);
        check(await page.locator("main").evaluate(e=>e.inert),`${file}: background cannot steal menu touches`);
        const sidebar=await page.locator(".sidebar").boundingBox();
        await page.touchscreen.tap(Math.min(size.width-8,sidebar.x+sidebar.width+16),Math.min(150,size.height-20));
        check(await page.locator(".navigation-backdrop").isHidden(),`${file}: outside tap dismisses menu`);
        check(!await page.locator("main").evaluate(e=>e.inert),`${file}: page remains interactive`);
      }
    }
    console.log(`PASS ${files.length} pages at 320px, 390px and landscape 844px`);
    await page.setViewportSize({width:390,height:844});
    await load("index.html"); await page.locator("#mobile-menu-btn").tap();
    await page.locator('.sidebar a[href="RECONFIGURABLE_COMPUTE.html"]').tap();
    await page.waitForFunction(()=>window.ReconfigurableCompute);
    check(await page.locator(".sidebar").evaluate(e=>!e.classList.contains("open")),"touch navigation arrives with menu closed");
    check((await page.evaluate(()=>ReconfigurableCompute.inspect())).stage==='head',"phone opens on the utilization comparison");
    check(await page.locator('#rc-util-reuse').isVisible()&&await page.locator('#rc-util-outputs').isVisible(),"both PE utilization counts are visible on phone");
    await page.locator('#rc-stage-down').tap();
    await options();await page.locator("#rc-next-stage").tap();
    check((await page.evaluate(()=>ReconfigurableCompute.inspect())).stage==="head","touch advances the inference graph");
    await zoom("rc-canvas-reuse");
    await tapDrawing("rc-canvas-reuse",84+3*32+14,116+4*32+14,680,680);
    check((await page.evaluate(()=>ReconfigurableCompute.inspect())).row===4 && (await page.evaluate(()=>ReconfigurableCompute.inspect())).col===3,"zoomed PE tap retains exact hit coordinates");
    if(engine==="chromium") {
      const scroll=view("rc-canvas-reuse").locator(".mobile-diagram-scroll");
      await scroll.evaluate(e=>{e.scrollLeft=120;e.scrollTop=120;});await scroll.scrollIntoViewIfNeeded();
      const r=await scroll.boundingBox(),cdp=await context.newCDPSession(page),start=r.x+r.width*.75,y=Math.max(r.y+40,Math.min(r.y+r.height/2,700));
      const before=await scroll.evaluate(e=>e.scrollLeft);
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:start,y}]});
      for(let i=1;i<=6;i++){await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:start-i*22,y}]});await page.waitForTimeout(20);}
      // Release after the finger stops, so momentum does not consume the next tap.
      await page.waitForTimeout(300);
      await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      await page.waitForTimeout(120);
      check(await scroll.evaluate(e=>e.scrollLeft)>before+30,"finger swipe pans the enlarged diagram");await cdp.detach();
    }
    await page.locator("#mobile-focus-play").tap();
    await page.waitForFunction(()=>ReconfigurableCompute.inspect().step>16);
    check(await page.evaluate(()=>RuntimeComputingPlayer.inspect().playing && RuntimeComputingPlayer.inspect().seconds>0),"central Play starts the embedded runtime animation");
    await page.locator("#mobile-focus-play").tap();
    check(!(await page.evaluate(()=>ReconfigurableCompute.inspect())).playing,"near-diagram pause controls the original clock");
    check(!await page.evaluate(()=>RuntimeComputingPlayer.inspect().playing),"central Pause also stops the runtime animation");
    await controls("rc-canvas-reuse").getByRole("button",{name:"Fit diagram width",exact:true}).tap();
    await view("rc-canvas-reuse").screenshot({path:path.join(output,"mapping-phone.png")});
    await maxZoom("rc-canvas-reuse");await maxZoom("rc-canvas-outputs");
    await page.locator('#mobile-focus-play').tap();
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>!document.body.classList.contains('mobile-demo'));
    check(await page.locator('#rc-runtime-demo').isHidden(),"runtime embed is mobile-only");
    check(!await page.evaluate(()=>RuntimeComputingPlayer.inspect().playing),"desktop switch pauses the hidden runtime animation");
    await page.setViewportSize({width:390,height:844});

    await load("FEATHER_VS_SYSTOLIC.html");await page.waitForFunction(()=>window.FeatherComparisonView);
    await zoom("comparison-feather");await tapDrawing("comparison-feather",112+2*25+10,126+3*25+10,640,660);
    check((await page.locator("#comparison-feather-pe").innerText()).includes("PE[3,2]"),"comparison exposes PE values on tap without hover");
    await page.locator("#mobile-focus-play").tap();
    await page.waitForFunction(()=>FeatherComparisonView.inspect().cycle>0);
    await page.locator("#mobile-focus-play").tap();
    await page.locator("#comparison-baseline").selectOption("ws");
    check(await page.locator("#comparison-baseline").inputValue()==="ws","phone can change systolic dataflow");
    await maxZoom("comparison-sa");await maxZoom("comparison-feather");
    await zoom("comparison-bridge",4);await fits("layout bridge");
    await page.locator("#comparison-compatible").check();
    await page.locator("#comparison-layout-element").selectOption("0");
    await view("comparison-bridge").getByRole("button",{name:"Play diagram",exact:true}).tap();
    await page.waitForTimeout(200);
    await page.screenshot({path:path.join(output,"comparison-phone.png"),animations:"disabled"});
    await maxZoom("comparison-bridge");

    await load("RECONFIGURABLE_LAYOUT.html");await page.waitForFunction(()=>window.ReconfigurableLayoutView);
    check(await page.locator('#layout-network .layout-switch').count()===64,"layout exposes all BIRRD switches");
    check(await page.locator('#layout-network [id^="layout-packet-"]').count()===16,"layout routes sixteen values");
    await page.locator('[data-layout="tiles"]').tap();
    check((await page.evaluate(()=>ReconfigurableLayoutView.inspect())).layout==='tiles',"phone selects a tiled layout");
    await page.locator('#layout-element').selectOption('11');
    check((await page.locator('#layout-route').innerText()).includes('bank 13, row 0'),"phone follows the exact destination bank");
    await page.locator('#layout-play').tap();await page.waitForFunction(()=>ReconfigurableLayoutView.inspect().step>0);
    await page.locator('#layout-play').tap();check(!await page.evaluate(()=>ReconfigurableLayoutView.inspect().playing),"phone pauses routing");
    await page.locator('#layout-seek').focus();await page.keyboard.press('End');
    check(await page.locator('#layout-destination').getAttribute('data-written')==='true',"completed route writes the buffer");
    await page.locator('.layout-page details > summary').tap();await targets('layout commands');await fits('layout commands');
    await page.locator('.layout-page details > summary').tap();
    await page.screenshot({path:path.join(output,'layout-phone.png'),fullPage:true});

    await load("QWEN3_MINISA_VISUALIZER.html");await page.waitForFunction(()=>window.FeatherFullWorkloads);
    await options();
    const cases=await page.locator("#operator option").evaluateAll(nodes=>nodes.map(n=>({value:n.value,text:n.textContent})));
    const prefill=cases.find(c=>/prefill/i.test(c.text));check(prefill,"prefill remains available on phone");
    await page.locator("#operator").selectOption(prefill.value);
    check((await page.evaluate(()=>FeatherFullWorkloads.inspect())).caseId===prefill.value.replace(/^act:/,""),"phone can load prefill");
    await page.locator("#operator").selectOption(cases[0].value);
    await zoom("full-teach-canvas");
    await tapDrawing("full-teach-canvas",72+2*60+30,220+3*22+11,1120,1220);
    const qwenPE=await page.evaluate(()=>FeatherFullWorkloads.inspect().teaching);
    check(qwenPE.row===3&&qwenPE.col===2,"zoomed Qwen PE responds to a fingertip tap");
    await page.locator("#full-teach-overlap").tap();
    await page.locator("#mobile-focus-play").tap();
    await page.waitForFunction(()=>FeatherFullWorkloads.inspect().teaching.playing);
    await page.locator("#mobile-focus-play").tap();
    const beforeTile=await page.evaluate(()=>FeatherFullWorkloads.inspect().indices);
    await page.locator("#full-next-tile").tap();
    check(JSON.stringify(await page.evaluate(()=>FeatherFullWorkloads.inspect().indices))!==JSON.stringify(beforeTile),"phone traverses workload tiles");
    await page.locator("#full-act-trace-toggle").tap();await targets("Qwen expanded trace");await fits("Qwen expanded trace");
    await controls("full-teach-canvas").getByRole("button",{name:"Fit diagram width",exact:true}).tap();
    await view("full-teach-canvas").screenshot({path:path.join(output,"qwen-phone.png")});
    await maxZoom("full-teach-canvas");

    await load("FEATHER.html");
    await page.locator('#mgSpeedSlider').focus();await page.keyboard.press('End');
    check(await page.locator('.mobile-focus-speed output').innerText()==='5×',"speed control updates the visible multiplier");
    await page.locator("#mobile-focus-play").tap();
    await page.waitForFunction(()=>document.getElementById("mgPlayBtn").textContent==="Pause");
    await page.locator("#mobile-focus-play").tap();
    check((await page.locator("#mgPlayBtn").innerText())==="Play","generic editor starts and pauses from the diagram");
    await options();await page.locator("#mgDiagramScale").selectOption("actual");
    check(await page.locator("#mg-tab-feather").evaluate(e=>e.scrollWidth>e.clientWidth),"generic diagram retains readable native zoom");
    check(await page.locator("#mgFeatherCanvas").evaluate(c=>c.width*c.height<=8_010_000),"generic phone canvas memory is bounded");
    await page.locator("#mgInspectBuffer").selectOption("I");
    check(await page.locator(".mg-buffer-popup").isVisible(),"buffer inspector opens by touch control");
    await page.locator(".mg-buffer-cell").first().tap();await targets("buffer inspector");await fits("buffer inspector");
    await page.locator(".mg-buffer-popup").screenshot({path:path.join(output,"buffer-phone.png")});
    await page.locator("#mgBufferPopupClose").tap();
    await page.locator("#mgIsaList .mg-isa-item").first().tap();
    const edit=page.locator('button[onclick="mgEditInstruction()"]');
    await page.locator(".mg-trace-tools > summary").tap();await edit.tap();
    const modal=await page.locator(".mg-modal").boundingBox();
    check(modal.x>=0&&modal.x+modal.width<=390,"instruction editor fits phone width");
    await targets("instruction editor");await fits("instruction editor");
    await page.locator("#mgm_order").fill("2");await page.locator("#mgModalOk").tap();
    check(await page.locator("#mgModalOverlay").isHidden(),"instruction edit saves with touch");
    await page.setViewportSize({width:1280,height:900});
    await page.waitForFunction(()=>!document.body.classList.contains("mobile-demo"));
    check(await page.locator(".mg-app > .mg-left").count()===1,"desktop restores the original configuration panel");
    check(await page.locator("#mg-tab-feather > .mg-view-nav #mgDiagramScale").count()===1,"desktop restores the original diagram controls");
    check(await page.locator("#mobile-focus-play").count()===0,"desktop removes the phone presentation");
    check(await page.locator('.doc-content > .page-takeaway').isVisible(),"desktop restores the takeaway to its original position");
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.body.classList.contains("mobile-demo"));
    check(await page.locator("#mgDiagramScale").count()===1,"returning to phone does not duplicate controls");
    await page.emulateMedia({reducedMotion:"reduce"});
    await load("RECONFIGURABLE_COMPUTE.html");
    check(!(await page.evaluate(()=>ReconfigurableCompute.inspect())).playing,"mobile reduced motion does not autoplay");
    await options();await page.locator("#rc-step").tap();check((await page.evaluate(()=>ReconfigurableCompute.inspect())).step===16,"reduced-motion touch stepping works");
    assert.deepEqual(errors,[]);
    console.log(`PASS ${checks} ${engine} mobile checks; screenshots: ${output}`);
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
