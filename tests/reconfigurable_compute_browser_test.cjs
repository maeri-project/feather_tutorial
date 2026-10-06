"use strict";
const assert=require("node:assert/strict"),path=require("node:path"),{pathToFileURL}=require("node:url");
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||"playwright");
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1560,height:1100},deviceScaleFactor:2}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const url=process.env.RECONFIGURABLE_URL||pathToFileURL(path.resolve(__dirname,"../RECONFIGURABLE_COMPUTE.html")).href;
  await page.goto(url);await page.waitForFunction(()=>window.ReconfigurableCompute);
  assert.equal((await page.evaluate(()=>ReconfigurableCompute.inspect())).stage,"down");
  assert.match(await page.locator("#rc-equation").textContent(),/768 × 3,072/);
  assert.match(await page.locator("#rc-context").textContent(),/predecessor/);
  assert.match(await page.locator("#rc-candidates .rc-chosen").textContent(),/A · Token parallel/);
  assert.match(await page.locator("#rc-candidates").textContent(),/Eight token replicas/);
  assert.match(await page.locator("#rc-candidates").textContent(),/Does not fit/);
  assert.equal(await page.locator("#rc-race-play").count(),0,"No performance race distracting from mappings");
  await page.locator("#rc-next-stage").click();
  assert.equal((await page.evaluate(()=>ReconfigurableCompute.inspect())).stage,"head");
  assert.match(await page.locator("#rc-context").textContent(),/preceding down_proj selected A/);
  assert.match(await page.locator("#rc-equation").textContent(),/1 × 151,936/);
  assert.match(await page.locator("#rc-boundary").textContent(),/Z\[767,:\]/);
  assert.match(await page.locator("#rc-badge-reuse").textContent(),/From previous GEMM/);
  assert.match(await page.locator("#rc-badge-outputs").textContent(),/Selected here/);
  assert.match(await page.locator("#rc-pe-reuse").textContent(),/Token row 1 is outside M=1/);
  assert.match(await page.locator("#rc-pe-outputs").textContent(),/W_vocab\[k=0…15, n=32\]/);
  assert.match(await page.locator("#rc-pe-outputs").textContent(),/Z\[767, 0:16\]/);
  assert.match(await page.locator("#rc-layout-outputs").textContent(),/bank 2/);
  for(const op of ["I","O","W"]){
   await page.locator("#rc-operand").selectOption(op);
   if(op==="I")assert.match(await page.locator("#rc-layout-reuse").textContent(),/no valid vector/);
   assert.equal(await page.locator("#rc-layout-outputs .rc-banks > div").count(),16);
  }
  const canvas=page.locator("#rc-canvas-reuse"),box=await canvas.boundingBox();
  await canvas.click({position:{x:(84+3*32+14)/680*box.width,y:(116+4*32+14)/680*box.height}});
  assert.match(await page.locator("#rc-pe-title").textContent(),/PE \(4, 3\)/);
  await canvas.focus();await page.keyboard.press("ArrowLeft");
  assert.match(await page.locator("#rc-pe-title").textContent(),/PE \(4, 2\)/);
  const dims=await page.locator("canvas").evaluateAll(es=>es.map(c=>[c.width,c.height]));
  assert.ok(dims.every(([w,h])=>w>=1360&&h>=1360));
  await page.locator("#rc-pe-outputs summary").click();
  await page.locator("#rc-play").click();
  await page.waitForFunction(()=>ReconfigurableCompute.inspect().step>16);
  assert.equal(await page.locator("#rc-pe-outputs details").getAttribute("open"),"","Sample stays open during playback");
  await page.locator("#rc-play").click();
  assert.equal((await page.evaluate(()=>ReconfigurableCompute.inspect())).playing,false);
  await page.locator("#rc-stage-down").click();
  await page.locator("#rc-scrub").fill("63");
  assert.match(await page.locator("#rc-pe-reuse").textContent(),/G\[13, 0:16\]/);
  await page.locator("#rc-stage-decode").click();
  assert.match(await page.locator("#rc-context").textContent(),/already selected B/);
  assert.match(await page.locator("#rc-boundary").textContent(),/sample token → embedding/);
  assert.match(await page.locator("#rc-equation").textContent(),/1 × 2,048/);
  await page.locator("#rc-stage-head").click();await page.locator("#rc-row").selectOption("0");await page.locator("#rc-col").selectOption("2");
  await page.locator("#rc-pe-outputs summary").click();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"/tmp/reconfigurable-graph-top.png",animations:"disabled"});
  await page.locator(".rc-pe-detail").screenshot({path:"/tmp/reconfigurable-graph-pe.png",animations:"disabled"});
  await page.locator("#rc-layout-title").scrollIntoViewIfNeeded();
  await page.screenshot({path:"/tmp/reconfigurable-graph-layout.png",animations:"disabled"});
  await page.locator("#theme-toggle").click();await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"/tmp/reconfigurable-graph-dark.png",animations:"disabled"});
  for(const width of [1280,768,390]){
   await page.setViewportSize({width,height:1000});
   for(const id of ["down","head","decode"]){await page.locator(`#rc-stage-${id}`).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`No page overflow at ${width}px, ${id}`);}
  }
  await page.locator("#rc-stage-head").click();await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:"/tmp/reconfigurable-graph-mobile.png",fullPage:true,animations:"disabled"});
  await page.emulateMedia({reducedMotion:"reduce"});await page.reload();await page.waitForFunction(()=>window.ReconfigurableCompute);
  assert.equal((await page.evaluate(()=>ReconfigurableCompute.inspect())).playing,false);
  await page.locator("#rc-step").click();assert.equal((await page.evaluate(()=>ReconfigurableCompute.inspect())).step,16);
  assert.deepEqual(errors,[]);
  console.log("PASS: graph lineage, workload equations, candidate selection, PE assignments, all buffer layouts, keyboard, playback, mobile and reduced motion.");
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
