'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../QWEN3_MINISA_VISUALIZER.html'), 'utf8');
const renderer = html.slice(html.indexOf('function renderDiagram(info)'));
const textHelper = renderer.slice(renderer.indexOf('function text('), renderer.indexOf('function shortValue('));
const cellHelper = renderer.slice(renderer.indexOf('function cellText('), renderer.indexOf('function line('));
assert.ok(textHelper && cellHelper);

// Record the real generated helpers' transforms at the drawing boundary.
// Simulate proportional fonts with different metrics; glyphs must retain their
// aspect ratio and fit their allotted width without Canvas maxWidth stretching.
let checks = 0;
for (const horizontalScale of [720 / 1120, 1]) for (const density of [1, 2, 3]) for (const glyphWidth of [.48, .7]) {
  let state = {a:density*horizontalScale, d:density, e:0, f:0, font:'10px system-ui'};
  const stack = [], draws = [];
  const ctx = {
    get font(){return state.font;}, set font(value){state.font=value;},
    save(){stack.push({...state});}, restore(){state=stack.pop();},
    translate(x,y){state.e+=x*state.a;state.f+=y*state.d;},
    scale(x,y){state.a*=x;state.d*=y;},
    measureText(label){return {width:String(label).length*glyphWidth*parseFloat(state.font)};},
    fillText(...args){draws.push({args,...state,width:this.measureText(args[0]).width});}
  };
  const sandbox = {ctx, horizontalScale, geom:{width:1120}, fontFamily:'system-ui, sans-serif'};
  vm.createContext(sandbox);vm.runInContext(`${textHelper}\n${cellHelper}\nthis.labels={text,cellText};`,sandbox);
  for (const sample of [
    {x:50,y:40,label:'Streaming buffer · FP16',width:486,size:13,align:'left'},
    {x:48,y:65,label:'64/128 rows/bank · order 2',width:486,size:10,align:'left'},
    {x:90,y:233,label:'-.25',width:28,size:11,align:'center',cell:true},
    {x:970,y:870,label:'AR',width:36,size:11,align:'center',cell:true},
    {x:1010,y:1202,label:'Output buffer',width:60,size:11,align:'right'}
  ]) {
    const before={...state};
    if(sample.cell)sandbox.labels.cellText(sample.x,sample.y,sample.label,sample.width,'#263d4b',sample.align);
    else sandbox.labels.text(sample.x,sample.y,sample.label,sample.size,'#263d4b',sample.align,sample.width);
    const draw=draws.at(-1);
    assert.equal(draw.args.length,3,'no horizontal glyph condensation');
    assert.ok(Math.abs(draw.a-draw.d)<1e-10,'equal horizontal and vertical text scale');
    assert.ok(draw.width<=sample.width*horizontalScale+1e-9,'text fits its box');
    assert.ok(Math.abs(draw.e-sample.x*density*horizontalScale)<1e-9,'text keeps its logical anchor');
    assert.equal(draw.f,sample.y*density);
    assert.ok(parseFloat(draw.font)<=sample.size);
    assert.match(draw.font,/system-ui, sans-serif$/);
    assert.deepEqual(state,before,'text drawing restores the diagram transform');
    checks++;
  }
}
console.log(`PASS: ${checks} desktop/mobile text cases retain glyph proportions, font, anchors, and bounds.`);
