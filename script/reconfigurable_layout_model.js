/* Routes preserve scalar identities through the compiler's actual wiring. */
(function(root,factory){
  const data=typeof module==='object'&&module.exports?require('./reconfigurable_layout_data.js'):root.ReconfigurableLayoutData;
  const api=factory(data);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ReconfigurableLayout=api;
})(globalThis,function(data){
  'use strict';
  const colors=['#2465b4','#147663','#a26512','#8150b5'];
  const color=id=>colors[Math.floor(id/4)];
  const x=port=>40+29*port, y=stage=>130+78*stage;
  const inputY=64,outputY=786;
  function simulate(commands){
    if(commands.length!==8||commands.some(row=>row.length!==8||row.some(cmd=>cmd!==0&&cmd!==3)))throw Error('Expected eight stages of Pass/Swap commands.');
    const states=[Array.from({length:16},(_,i)=>i)];
    for(let s=0;s<8;s++){
      const next=[];
      data.wiring[s].forEach(([lo,hi],sw)=>{
        const pair=[states[s][lo],states[s][hi]];
        next.push(...(commands[s][sw]===3?pair.reverse():pair));
      });
      states.push(next);
    }
    return states;
  }
  function compile(id){
    const config=data.cases.find(item=>item.id===id);
    if(!config)throw Error('Unknown layout');
    const states=simulate(config.commands),destination=Array(16);
    states[8].forEach((id,bank)=>destination[id]=bank);
    const paths=Array.from({length:16},(_,id)=>{
      const segments=[];
      for(let s=0;s<8;s++){
        const from=states[s].indexOf(id),to=states[s+1].indexOf(id),sw=Math.floor(to/2);
        const entry=2*sw+data.wiring[s][sw].indexOf(from),start=s?y(s-1)+34:inputY;
        const mid=(start+y(s))/2;
        segments.push([[x(from),start],[x(from),mid-5],[x(entry),mid+5],[x(entry),y(s)],[x(to),y(s)+34]]);
      }
      segments.push([[x(destination[id]),y(7)+34],[x(destination[id]),outputY]]);
      return segments;
    });
    return {config,states,destination,paths};
  }
  function point(points,fraction){
    const lengths=points.slice(1).map((p,i)=>Math.hypot(p[0]-points[i][0],p[1]-points[i][1]));
    let remaining=lengths.reduce((a,b)=>a+b,0)*fraction;
    for(let i=0;i<lengths.length;i++){
      if(remaining<=lengths[i]&&lengths[i]>0){const t=remaining/lengths[i];return points[i].map((v,j)=>v+(points[i+1][j]-v)*t);}
      remaining-=lengths[i];
    }
    return points.at(-1);
  }
  function frame(run,step){
    const bounded=Math.max(0,Math.min(9,step)),segment=Math.min(8,Math.floor(bounded)),p=bounded-segment;
    const smooth=p*p*(3-2*p);
    return Array.from({length:16},(_,id)=>({id,value:id+1,bank:run.destination[id],point:point(run.paths[id][segment],smooth)}));
  }
  const line=points=>points.map((p,i)=>(i?'L':'M')+p.join(',')).join(' ');
  function svg(run,selected=6,step=0){
    let wires='',switches='',ports='';
    for(let s=0;s<8;s++){
      let boxes=`<text x="7" y="${y(s)+22}" fill="#607185" font-size="10">S${s}</text>`;
      data.wiring[s].forEach((pair,sw)=>{
        const swap=run.config.commands[s][sw]===3;
        pair.forEach((from,lane)=>{
          const start=s?y(s-1)+34:inputY,mid=(start+y(s))/2;
          wires+=`<path d="${line([[x(from),start],[x(from),mid-5],[x(2*sw+lane),mid+5],[x(2*sw+lane),y(s)]])}"/>`;
        });
        const fill=swap?'#ede3fa':'#f1f5f9';
        boxes+=`<g><title>S${s}, switch ${sw}: ${swap?'Swap (11)':'Pass (00)'}</title><rect class="layout-switch" x="${x(2*sw)-9}" y="${y(s)}" width="47" height="34" rx="4" fill="${fill}" stroke="${swap?'#9878bc':'#aebdcb'}"/>`;
        pair.forEach((from,lane)=>{
          const active=run.states[s][from]===selected;
          boxes+=`<path d="${line([[x(2*sw+lane),y(s)],[x(2*sw+(swap?1-lane:lane)),y(s)+34]])}" stroke="${active?color(selected):'#a5b0be'}" stroke-width="${active?2.8:1}"/>`;
        });
        boxes+=`<rect x="${x(2*sw)+4}" y="${y(s)+9}" width="21" height="16" fill="${fill}"/><text x="${x(2*sw)+14.5}" y="${y(s)+21}" text-anchor="middle" font-size="11" font-weight="650" fill="#374555">${swap?'SW':'PS'}</text></g>`;
      });
      switches+=`<g id="layout-stage-${s}">${boxes}</g>`;
    }
    for(let port=0;port<16;port++){
      const id=run.states[8][port];
      wires+=`<path d="M${x(port)},${y(7)+34}V${outputY}"/>`;
      ports+=`<text x="${x(port)}" y="43" text-anchor="middle" font-size="11" fill="${color(port)}">${port+1}</text><text x="${x(port)}" y="815" text-anchor="middle" font-size="10" fill="#607185">${port}</text><text x="${x(port)}" y="845" text-anchor="middle" font-size="11" fill="${color(id)}">${id+1}</text>`;
    }
    const selectedPath=run.paths[selected].flat();
    return `<svg id="layout-network" xmlns="http://www.w3.org/2000/svg" width="520" height="872" viewBox="0 0 520 872" role="img" aria-labelledby="layout-svg-title layout-svg-desc" font-family="system-ui, sans-serif">
      <title id="layout-svg-title">BIRRD routing to ${run.config.label} output layout</title>
      <desc id="layout-svg-desc">Sixteen input values cross eight stages of Pass and Swap switches. Highlighted value ${selected+1} goes to bank ${run.destination[selected]}, row zero.</desc>
      <rect width="520" height="872" fill="#fafcfe"/>
      <text x="260" y="20" text-anchor="middle" fill="#374555" font-size="13" font-weight="600">Input values</text>
      <g fill="none" stroke="#cbd5df" stroke-width=".8">${wires}</g>
      <path d="${line(selectedPath)}" fill="none" stroke="${color(selected)}" stroke-width="2.8"/>
      ${switches}${ports}
      <text x="8" y="815" font-size="9" fill="#607185">bank</text>
      <text x="8" y="845" font-size="9" fill="#607185">value</text>
      ${frame(run,step).map(token=>`<g id="layout-packet-${token.id}" transform="translate(${token.point.join(' ')})"><circle r="${token.id===selected?6:3.5}" fill="${color(token.id)}" stroke="white" stroke-width="1.5"/></g>`).join('')}
    </svg>`;
  }
  return {data,color,compile,simulate,frame,svg};
});
