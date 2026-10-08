'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const model = require('../script/runtime_computing_model.js');
const positions = time => model.frame(time).elements.map(({id, x, y}) => ({id, x, y}));
const distinct = values => new Set(values).size;

for (let step = 0; step <= 2400; step++) {
  const state = model.frame(step / 120);
  assert.equal(state.elements.length, 16);
  assert.deepEqual(state.elements.map(e => e.id), Array.from({length:16}, (_, i) => i));
  for (const e of state.elements) {
    assert.equal(e.width, 32); assert.equal(e.height, 32);
    assert.ok(e.x >= 0 && e.y >= 0 && e.x + 32 <= model.WIDTH && e.y + 32 <= model.HEIGHT);
    for (const other of state.elements.filter(item => item.id > e.id)) {
      assert.ok(Math.abs(e.x - other.x) >= 32 || Math.abs(e.y - other.y) >= 32,
        `Squares ${e.id}/${other.id} overlap at ${state.time}`);
    }
  }
  if (state.grouping > 0) state.groups.forEach((group, index) => {
    const members = state.elements.filter(e => e.group === index);
    assert.equal(members.length, 8);
    for (const e of members) assert.ok(e.x >= group.x && e.y >= group.y &&
      e.x + 32 <= group.x + group.width && e.y + 32 <= group.y + group.height);
  });
}
for (const [time, rows, cols] of [[2,4,4],[10,8,2],[19,1,16]]) {
  const e = model.frame(time).elements;
  assert.equal(distinct(e.map(e => e.y)), rows);
  assert.equal(distinct(e.map(e => e.x)), cols);
}
assert.deepEqual(positions(1), positions(4), 'opening hold');
assert.deepEqual(positions(9), positions(12), '8x2 hold');
assert.deepEqual(positions(17), positions(20), 'final hold');
const row = model.frame(20).elements.toSorted((a,b) => a.x-b.x);
assert.deepEqual(row.map(e => e.id), [0,1,4,5,8,9,12,13,2,3,6,7,10,11,14,15], 'pairs unfold in order');
for (let i=1;i<row.length;i++) assert.equal(row[i].x-row[i-1].x,40,'equal final gaps');
assert.equal(model.frame(0).opacity,0); assert.equal(model.frame(1).opacity,1);
assert.equal(model.frame(10).middleLabel,1); assert.equal(model.frame(17).rightLabel,1);
assert.equal(model.frame(19).conclusion,1);
for (const t of [0,10,19]) {
  assert.equal(model.frame(t).firstInset,0); assert.equal(model.frame(t).secondInset,0);
}
assert.equal(model.frame(6).firstInset,1); assert.equal(model.frame(14).secondInset,1);
const svg = model.svg(6);
assert.equal((svg.match(/data-element=/g)||[]).length,16,'only sixteen main nodes');
assert.equal((svg.match(/stroke="black"/g)||[]).length,32,'two separate sixteen-square insets');

// Exercise playback with a controlled clock and DOM attributes. Layout is
// checked separately by SVG snapshots; this verifies time, pause and identity.
function node() {
  return {value:'0', attrs:{}, handlers:{}, textContent:'',
    setAttribute(key,value) { this.attrs[key]=String(value); },
    addEventListener(type,handler) { this.handlers[type]=handler; }};
}
const nodes = new Map(), get = id => { if(!nodes.has(id))nodes.set(id,node());return nodes.get(id); };
const elements = Array.from({length:16}, (_,i)=>get(`runtime-element-${i}`));
get('runtime-stage').querySelectorAll=()=>elements;
let now=0,next=0,domReady;
const callbacks=new Map(),documentHandlers={};
const document={hidden:false,getElementById:get,addEventListener(type,handler){
  if(type==='DOMContentLoaded')domReady=handler;else documentHandlers[type]=handler;
}};
vm.runInNewContext(fs.readFileSync(require.resolve('../script/runtime_computing_change.js'),'utf8'),{
  window:{RuntimeComputing:model},document,performance:{now:()=>now},
  requestAnimationFrame(fn){callbacks.set(++next,fn);return next;},
  cancelAnimationFrame(id){callbacks.delete(id);}
});
domReady();
const click=()=>get('runtime-play').handlers.click();
const advance=ms=>{now+=ms;const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(now));};
click();advance(9000);
assert.equal(get('runtime-time').value,'0:09 / 0:20');
assert.equal(get('runtime-play').textContent,'Pause');
click();advance(5000);
assert.equal(get('runtime-time').value,'0:09 / 0:20','pause retains time');
click();advance(11000);
assert.equal(get('runtime-time').value,'0:20 / 0:20');
assert.equal(get('runtime-play').textContent,'Replay');assert.equal(callbacks.size,0);
row.forEach(e=>{assert.equal(Number(get(`runtime-element-${e.id}`).attrs.x),e.x);});
click();assert.equal(get('runtime-time').value,'0:00 / 0:20','replay begins at zero');
advance(3000);get('runtime-seek').value='10';get('runtime-seek').handlers.input();
assert.equal(get('runtime-time').value,'0:10 / 0:20');assert.equal(get('runtime-play').textContent,'Play');
click();advance(500);document.hidden=true;documentHandlers.visibilitychange();
assert.equal(get('runtime-play').textContent,'Play','background pauses');assert.equal(callbacks.size,0);
assert.deepEqual(elements,Array.from({length:16},(_,i)=>get(`runtime-element-${i}`)),'same DOM elements survive replay and seeking');
console.log('PASS: 2,401 timeline samples, 16 fixed squares, no collisions, exact layouts/holds, and playback controls.');
