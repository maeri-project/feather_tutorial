document.addEventListener('DOMContentLoaded',()=>{
  'use strict';
  const model=window.ReconfigurableLayout,$=id=>document.getElementById('layout-'+id);
  let run=model.compile('columns'),selected=6,step=0,playing=false,origin=0,raf=0,packets=[];
  function selectElement(id){selected=id;build();}
  function cell(id,bank){
    const node=document.createElement('div');node.className='layout-cell';
    node.style.setProperty('--element-color',model.color(id));
    node.dataset.selected=id===selected;
    node.setAttribute('aria-label',`Value ${id+1}, C[${Math.floor(id/4)},${id%4}]${bank===undefined?'':`, bank ${bank}, row 0`}`);
    const value=document.createElement('strong');value.textContent=id+1;
    const address=document.createElement('small');address.textContent=bank===undefined?`C[${Math.floor(id/4)},${id%4}]`:`B${bank}`;
    node.append(value,address);return node;
  }
  function build(){
    $('source').replaceChildren(...Array.from({length:16},(_,id)=>cell(id)));
    $('destination').replaceChildren(...run.states[8].map((id,bank)=>cell(id,bank)));
    $('target-label').textContent=run.config.label+' · row 0';
    $('route').textContent=`C[${Math.floor(selected/4)},${selected%4}] = ${selected+1} · input ${selected} → bank ${run.destination[selected]}, row 0`;
    $('mount').innerHTML=model.svg(run,selected,step);
    packets=Array.from({length:16},(_,id)=>$('packet-'+id));
    const body=$('commands');body.replaceChildren();
    run.config.commands.forEach((commands,s)=>{
      const tr=document.createElement('tr'),th=document.createElement('th');th.scope='row';th.textContent='S'+s;tr.append(th);
      commands.forEach(command=>{const td=document.createElement('td');td.textContent=command===3?'SW · 11':'PS · 00';td.dataset.swap=command===3;tr.append(td);});body.append(tr);
    });
    document.querySelectorAll('[data-layout]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.layout===run.config.id)));
    $('swap-count').textContent=run.config.commands.flat().filter(command=>command===3).length+' Swap switches · 64 switches total';
    render();
  }
  function render(){
    model.frame(run,step).forEach((token,i)=>packets[i].setAttribute('transform',`translate(${token.point.join(' ')})`));
    const active=Math.floor(step);
    for(let s=0;s<8;s++)$('stage-'+s).setAttribute('data-active',String(active===s));
    $('destination').dataset.written=step>=9;
    $('seek').value=step;
    $('seek').setAttribute('aria-valuetext',step>=9?'Output written':`Routing stage ${Math.min(8,active+1)} of 8`);
    $('phase').value=step>=9?'Output written':step===0?'Ready':active>=8?'Write buffer':`Stage ${active+1} / 8`;
    $('play').textContent=playing?'Pause':step>=9?'Replay':'Play';
    $('play').setAttribute('aria-pressed',String(playing));
    $('network').dataset.step=step;
  }
  function stop(){playing=false;cancelAnimationFrame(raf);render();}
  function tick(now){
    if(!playing)return;
    step=Math.min(9,(now-origin)/1200);
    if(step===9)playing=false;
    render();if(playing)raf=requestAnimationFrame(tick);
  }
  $('play').addEventListener('click',()=>{
    if(playing){stop();return;}
    if(step>=9)step=0;
    playing=true;origin=performance.now()-step*1200;render();raf=requestAnimationFrame(tick);
  });
  $('step').addEventListener('click',()=>{stop();step=Math.min(9,Math.floor(step)+1);render();});
  $('seek').addEventListener('input',()=>{const next=Number($('seek').value);stop();step=next;render();});
  for(let id=0;id<16;id++){
    const option=document.createElement('option');option.value=id;option.textContent=`C[${Math.floor(id/4)},${id%4}] = ${id+1}`;$('element').append(option);
  }
  $('element').value=selected;
  $('element').addEventListener('change',()=>selectElement(Number($('element').value)));
  document.querySelectorAll('[data-layout]').forEach(button=>button.addEventListener('click',()=>{
    stop();run=model.compile(button.dataset.layout);step=0;build();
  }));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  build();
  window.ReconfigurableLayoutView={inspect:()=>({layout:run.config.id,selected,step,playing,output:run.states[8].slice()})};
});
