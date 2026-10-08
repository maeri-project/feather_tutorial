'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const model=require('../script/reconfigurable_layout_model.js');
const expected={rows:Array.from({length:16},(_,i)=>i),columns:[0,4,8,12,1,5,9,13,2,6,10,14,3,7,11,15],tiles:[0,1,4,5,2,3,6,7,8,9,12,13,10,11,14,15]};
let frames=0;
for(const config of model.data.cases){
  const run=model.compile(config.id);
  assert.deepEqual(run.states,config.states,'browser simulation matches compiler golden stages');
  assert.deepEqual(run.states[8],expected[config.id],'exact target layout');
  for(const state of run.states)assert.deepEqual([...state].sort((a,b)=>a-b),expected.rows,'every stage preserves all sixteen values');
  for(let bank=0;bank<16;bank++)assert.equal(run.destination[run.states[8][bank]],bank);
  for(let beat=0;beat<=900;beat++){
    const frame=model.frame(run,beat/100);
    assert.equal(frame.length,16);
    assert.equal(new Set(frame.map(t=>t.id)).size,16);
    for(const t of frame){
      assert.equal(t.value,t.id+1);assert.equal(t.bank,run.destination[t.id]);
      assert.ok(t.point.every(Number.isFinite));
      assert.ok(t.point[0]>=0&&t.point[0]<=520&&t.point[1]>=0&&t.point[1]<=872);
    }
    frames++;
  }
  for(let id=0;id<16;id++)for(let s=0;s<8;s++){
    const segment=run.paths[id][s];
    assert.equal(segment[0][0],40+29*run.states[s].indexOf(id));
    assert.equal(segment.at(-1)[0],40+29*run.states[s+1].indexOf(id));
    assert.deepEqual(model.frame(run,s+1)[id].point,segment.at(-1),'stage boundaries have no packet jumps');
  }
  assert.equal((model.svg(run).match(/class="layout-switch"/g)||[]).length,64);
  assert.equal((model.svg(run).match(/id="layout-packet-/g)||[]).length,16);
}
// Cross-check exported topology with the independently maintained FEATHER view.
const feather=fs.readFileSync(require.resolve('../FEATHER.html'),'utf8');
const start=feather.indexOf('function mgBirrdInputs('),end=feather.indexOf('let mgFeatherGeometry',start);
const sandbox={mgCL2:n=>Math.ceil(Math.log2(n))};vm.createContext(sandbox);
vm.runInContext(feather.slice(start,end)+';this.pair=mgBirrdInputs;',sandbox);
for(let s=0;s<8;s++)for(let sw=0;sw<8;sw++)assert.deepEqual(model.data.wiring[s][sw],Array.from(sandbox.pair(s,sw,16)));
assert.notDeepEqual(model.simulate(Array.from({length:8},()=>Array(8).fill(0)))[8],expected.rows,'all-Pass wiring is not falsely presented as identity');
assert.throws(()=>model.compile('unknown'));
assert.throws(()=>model.simulate([[1]]));

// Run the real controller with a controlled clock to check playback and
// layout changes; this does not substitute for a browser layout check.
function node(){
  return {attrs:{},handlers:{},dataset:{},children:[],style:{setProperty(){}},
    setAttribute(key,value){this.attrs[key]=String(value);},
    addEventListener(type,fn){this.handlers[type]=fn;},
    append(...children){this.children.push(...children);},
    replaceChildren(...children){this.children=children;}};
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
const presets=model.data.cases.map(config=>Object.assign(node(),{dataset:{layout:config.id}}));
const events={},pending=new Map();let now=0,next=0;
const document={hidden:false,getElementById:get,createElement:node,
  querySelectorAll:()=>presets,addEventListener(type,fn){events[type]=fn;}};
const window={ReconfigurableLayout:model};
vm.runInNewContext(fs.readFileSync(require.resolve('../script/reconfigurable_layout_view.js'),'utf8'),{
  window,document,performance:{now:()=>now},
  requestAnimationFrame(fn){pending.set(++next,fn);return next;},
  cancelAnimationFrame(id){pending.delete(id);}
});
events.DOMContentLoaded();
const state=()=>window.ReconfigurableLayoutView.inspect();
const fire=(id,event='click')=>get('layout-'+id).handlers[event]();
const advance=ms=>{now+=ms;const callbacks=[...pending.values()];pending.clear();callbacks.forEach(fn=>fn(now));};
assert.equal(state().layout,'columns');assert.equal(state().playing,false);
assert.equal(get('layout-source').children.length,16);assert.equal(get('layout-destination').children.length,16);
assert.equal(get('layout-commands').children.length,8);
assert.match(get('layout-route').textContent,/input 6 → bank 9, row 0/);
fire('play');advance(3000);assert.equal(state().step,2.5);
fire('play');advance(4000);assert.equal(state().step,2.5);assert.equal(pending.size,0,'pause cancels animation');
fire('play');advance(7800);assert.equal(state().step,9);assert.equal(state().playing,false);
assert.equal(get('layout-destination').dataset.written,true);assert.equal(get('layout-play').textContent,'Replay');
fire('play');assert.equal(state().step,0,'replay restarts at the input');
advance(600);get('layout-seek').value='6.25';fire('seek','input');
assert.equal(state().step,6.25,'seeking retains the user value while pausing');assert.equal(state().playing,false);
fire('step');assert.equal(state().step,7,'step advances to the next stage');
get('layout-element').value='11';fire('element','change');
assert.equal(state().selected,11);assert.equal(state().step,7,'following another value preserves progress');
assert.match(get('layout-route').textContent,/input 11 → bank 14, row 0/);
fire('play');advance(300);presets.find(p=>p.dataset.layout==='tiles').handlers.click();
assert.equal(state().layout,'tiles');assert.equal(state().step,0);assert.equal(state().playing,false);
assert.deepEqual(Array.from(state().output),expected.tiles);assert.equal(pending.size,0,'layout change stops the old route');
assert.equal(get('layout-destination').dataset.written,false);
assert.equal(presets.filter(p=>p.attrs['aria-pressed']==='true').length,1);
fire('play');advance(500);document.hidden=true;events.visibilitychange();
assert.equal(state().playing,false);assert.equal(pending.size,0,'background pauses animation');
console.log(`PASS: three verified layouts, ${frames} animation frames, 64 switches, conserved values, and continuous RTL-topology routes.`);
console.log('PASS: preset changes, value selection, playback, pause, replay, stepping, seeking, and visibility pause.');
