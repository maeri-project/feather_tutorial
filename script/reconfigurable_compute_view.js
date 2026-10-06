(function() {
    "use strict";
    const data = window.ReconfigurableComputeData, model = window.ReconfigurableComputeModel;
    const $ = id => document.getElementById(`rc-${id}`), fmt = n => n.toLocaleString("en-US");
    const keys = ["reuse", "outputs"], stages = Object.fromEntries(data.stages.map(s => [s.id,s]));
    const state = {stage:"down", row:0, col:2, step:15, mode:"weights", playing:false, speed:6, operand:"W"};
    const geometry = {w:680,h:680,x:84,y:116,pitch:32};
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, lastTime = 0, lastInteger = -1;
    const stage = () => stages[state.stage], record = key => stage().records[key];
    const title = key => data.policies[key].name;
    const shape = s => [s.M,s.K,s.N].map(fmt).join(" × ");
    function text(ctx,str,x,y,color,size=12,align="left",bold=false) {
        ctx.fillStyle=color;ctx.font=`${bold ? 650 : 450} ${size}px system-ui, sans-serif`;
        ctx.textAlign=align;ctx.textBaseline="middle";ctx.fillText(str,x,y);
    }
    function box(ctx,x,y,w,h,fill,line=null,width=1) {
        ctx.beginPath();ctx.roundRect(x,y,w,h,4);ctx.fillStyle=fill;ctx.fill();
        if(line){ctx.strokeStyle=line;ctx.lineWidth=width;ctx.stroke();ctx.lineWidth=1;}
    }
    function draw(key) {
        const canvas=$(`canvas-${key}`),ctx=canvas.getContext("2d"),r=record(key),s=stage();
        const {w,h,x,y,pitch}=geometry,scale=Math.max(2,Math.ceil(devicePixelRatio*canvas.clientWidth/w));
        if(canvas.width!==w*scale||canvas.height!==h*scale){canvas.width=w*scale;canvas.height=h*scale;}
        ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,w,h);
        const dark=document.documentElement.dataset.theme==="dark";
        const colors=dark ? {fg:"#e7eef8",muted:"#a9b8ce",green:"#173f37",gold:"#48391e",blue:"#71bbff",idle:"#252d3c",dim:"#8892a4",select:"#c1a0ff"}
            : {fg:"#24334a",muted:"#55677e",green:"#d4efe5",gold:"#f5e8c4",blue:"#0874be",idle:"#edf0f4",dim:"#7b8594",select:"#7040c1"};
        text(ctx,`Stationary: ${s.weight}[k, n]`,x,16,colors.fg,14,"left",true);
        text(ctx,`Stream: ${s.input}[m, k] ↓`,x,37,colors.blue,12);
        for(let kg=0;kg<2;kg++) {
            box(ctx,x+kg*256,54,253,22,kg?colors.gold:colors.green);
            text(ctx,`K half ${kg}: k=${kg*16}…${kg*16+15}`,x+kg*256+126,65,colors.fg,11,"center",true);
        }
        const dot=Math.min(r.ES.T-1,Math.floor(state.step/16));
        for(let col=0;col<16;col++) {
            const o=model.owner(r,0,col,dot),cx=x+col*pitch+14;
            text(ctx,`m${o.m}${o.valid?"":"×"}`,cx,89,o.valid?colors.blue:colors.dim,11,"center",true);
            text(ctx,`c${col}`,cx,106,colors.muted,9,"center");
        }
        const frames=model.frame(r,state.step);
        for(const cell of frames) {
            const px=x+cell.col*pitch,py=y+cell.row*pitch,selected=cell.row===state.row&&cell.col===state.col;
            box(ctx,px+1,py+1,28,28,!cell.valid?colors.idle:cell.kg?colors.gold:colors.green,selected?colors.select:null,2.8);
            text(ctx,`n${cell.n}`,px+15,py+14,cell.valid?colors.fg:colors.dim,11,"center",true);
            if(cell.col===0)text(ctx,`r${cell.row}`,x-16,py+15,colors.muted,10,"right");
            if(cell.row===0&&cell.col&&cell.col%r.EM.G_c===0) {
                ctx.globalAlpha=.35;ctx.strokeStyle=colors.muted;ctx.beginPath();ctx.moveTo(px-1,y);ctx.lineTo(px-1,y+512);ctx.stroke();ctx.globalAlpha=1;
            }
            if(state.mode==="stream"&&cell.active) {
                const sub=reduced.matches?0:state.step%1;
                ctx.fillStyle=colors.blue;ctx.beginPath();ctx.arc(px+27,py+2+25*sub,3,0,Math.PI*2);ctx.fill();
            }
        }
        text(ctx,`${r.EM.G_r/r.EM.G_c} token replicas × ${r.EM.G_c} output groups × 2 K halves`,x,645,colors.fg,12,"left",true);
    }
    function context() {
        const s=stage(),prev=s.previous?stages[s.previous]:null;
        for(const item of data.stages)$(`stage-${item.id}`).setAttribute("aria-pressed",item.id===s.id);
        $("context").textContent=s.id==="down"
            ? "768 prompt tokens → choose A for weight reuse."
            : s.id==="head" ? "down_proj preferred A. One token remains → switch to B for more channels."
            : "lm_head preferred B. One decode token → keep B; load new weights.";
        $("workload-title").textContent=s.title;
        $("next-stage").textContent=s.id==="down"?"Next: lm_head →":s.id==="head"?"Next: decode →":"Back to prefill";
        $("equation").innerHTML=[
            [s.input,s.inputName,`${fmt(s.shape.M)} × ${fmt(s.shape.K)}`,"M × K","input"],
            [s.weight,s.weightName,`${fmt(s.shape.K)} × ${fmt(s.shape.N)}`,"K × N","weight"],
            [s.output,s.outputName,`${fmt(s.shape.M)} × ${fmt(s.shape.N)}`,"M × N","output"]
        ].map(([symbol,name,dims,axes,kind],i)=>`${i?`<b class="rc-math-sign">${i===1?"×":"="}</b>`:""}<div class="rc-matrix rc-${kind}"><small>${name}</small><strong>${symbol}</strong><code>${dims}</code><span>${axes}</span></div>`).join("");
        $("shard-note").textContent=s.programs>1
            ? `${s.programs} sequential N=${fmt(s.programN)} partitions fit the operand-image regions. Every candidate uses the same partitions; cycles cover the full operation. Animation: first tile.`
            : "One complete projection. Animation: first tile.";
        $("boundary").innerHTML=s.id==="head"
            ? `<div>ΔH + residual → RMSNorm → <b>Z[767,:]</b> → Z_last</div>`
            : s.id==="down" ? `<div>G = SiLU(gate_proj(H)) ⊙ up_proj(H)</div>`
            : `<div>logits → sample token → embedding → RMSNorm → X_next</div>`;
        $("layer-note").textContent=s.id==="head"
            ? "Residual addition and final RMSNorm produce Z[768,1024]. logits_to_keep=1 selects Z[767,:], packed into the head's input layout."
            : s.id==="down" ? "Block 28: RMSNorm → attention → residual add → RMSNorm → gate/up projections → SiLU(gate) × up → G[768,3072]. down_proj produces the residual update ΔH."
            : "Sampling creates a new token. Embedding and block-1 RMSNorm produce X_next[1,1024]. q_proj replaces vocabulary weights with W_q; only mapping B carries over.";
        $("choice-reason").textContent=s.preferred==="reuse"
            ? "A reuses each tile across 32 tokens; B covers 16 and reloads weights more often."
            : "B covers 64 channels per tile; A covers 32. Extra token replicas are idle.";
        $("candidates").innerHTML=["replicate8","reuse","outputs"].map(key=>{
            const r=s.records[key],rep=8/r.EM.G_c;
            return `<tr${key===s.preferred?' class="rc-chosen"':""}><th scope="row">${title(key)}${key===s.preferred?'<span>Selected</span>':prev&&key===prev.preferred?'<span>Previous layer</span>':""}</th><td>${shape(r.tile)}</td><td>2 K halves × ${rep} tokens × ${r.EM.G_c} output groups</td><td>${fmt(r.cost.total_cycles)}</td></tr>`;
        }).join("")+`<tr class="rc-rejected"><th scope="row">1 replica · 128 channels</th><td>… × 32 × 128</td><td>StaB: 4,096 scalars &gt; 2,048 capacity</td><td>Does not fit</td></tr>`;
        const stats=s.search.stats;
        $("search-note").textContent=`Bounded search: ${stats.tile_proposals} proposed · ${stats.tiles_searched} searched · ${stats.tiles_pruned} pruned. Selected tile and mapping match its winner. Cycles exclude boundary operations and repacking.`;
        for(const key of keys) {
            const r=record(key);
            $(`card-${key}`).dataset.preferred=key===s.preferred;
            $(`badge-${key}`).textContent=key===s.preferred?"Selected":prev&&prev.preferred===key?"Previous layer":"Alternative";
            $(`specs-${key}`).innerHTML=`<span>Tile M×K×N <b>${shape(r.tile)}</b></span><span>W/I/O orders <b>${r.orders.W}/${r.orders.I}/${r.orders.O}</b></span>`;
            $(`schedule-${key}`).innerHTML=`<strong>${r.mappedPEs}/256 useful PEs</strong><span>${r.ES.T} dot groups · ${r.tile.M} tokens/tile</span>`;
        }
        $("commands").innerHTML=keys.map(key=>`<h3>${title(key)}</h3><pre>${JSON.stringify({ExecuteMapping:record(key).EM,ExecuteStreaming:record(key).ES},null,2)}</pre>`).join("");
    }
    const addressLabel=a=>a?`bank ${a.bank}, rows ${a.rowBase}–${a.rowBase+15}`:"No vector";
    function detail() {
        const s=stage();$("pe-title").textContent=`Inspect PE (${state.row}, ${state.col})`;
        const a=model.at(record("reuse"),state.row,state.col,state.step),b=model.at(record("outputs"),state.row,state.col,state.step);
        $("pe-change").textContent=`A: token ${a.m}, channel ${a.n} → B: token ${b.m}, channel ${b.n}${!a.valid&&b.valid?" · idle → active":""}`;
        for(const key of keys) {
            const r=record(key),o=model.at(r,state.row,state.col,state.step),addr=model.peAddresses(data,r,state.row,state.col,state.step);
            const sampleOpen=$(`pe-${key}`).querySelector("details")?.open;
            const inputName=s.id==="head"&&o.valid?`Z[767, ${o.kStart}:${o.kStart+16}] ≡ Z_last[0, ${o.kStart}:${o.kStart+16}]`:`${s.input}[${o.m}, ${o.kStart}:${o.kStart+16}]`;
            const pair=(state.col+8)%16;
            $(`pe-${key}`).innerHTML=`<h3>${title(key)}</h3>
                <div class="rc-data-path">
                  <div class="rc-weight"><small>WEIGHTS · 16 SLOTS</small><strong>${s.weight}[k=${o.kStart}…${o.kStart+15}, n=${o.n}]</strong><span>StaB ${addressLabel(addr.W)}</span></div><b>×</b>
                  <div class="rc-input"><small>INPUT ↓ COLUMN ${state.col}</small><strong>${inputName}</strong><span>${o.valid?`StrB ${addressLabel(addr.I)} → row ${state.row}`:`Token ${o.m} outside M=${r.tile.M} · idle`}</span></div><b>↓</b>
                  <div class="rc-output"><small>BIRRD → ACCUMULATE</small><strong>${o.valid?`${s.output}[${o.m}, ${o.n}] += dot`:"No output"}</strong><span>${o.valid?`Other K half: PE (${state.row}, ${pair}) · OB bank ${addr.O.bank}, row ${addr.O.row}`:"No matching token"}</span></div>
                </div>
                <details><summary>Sample values</summary><div class="rc-sample-slots">${Array.from({length:16},(_,i)=>`<span data-active="${o.active&&i===o.lane}"><small>k${o.kStart+i}</small>${model.weight(o.kStart+i,o.n)}</span>`).join("")}</div><div class="rc-details-body"><p>${o.active?`Input ${model.input(o.m,o.k)} × weight ${model.weight(o.k,o.n)} at k=${o.k}; partial dot = ${o.sum}.`:"No useful MAC at this step."}</p><p>Local dot = Σₖ ${s.input}[${o.m},k] × ${s.weight}[k,${o.n}]. BIRRD combines K halves; later K tiles accumulate in OB. Synthetic values.</p></div></details>`;
            $(`pe-${key}`).querySelector("details").open=!!sampleOpen;
            layout(key,addr);
        }
    }
    function layout(key,addresses) {
        const r=record(key),op=state.operand,l=data.layouts[r.layouts][op],a=addresses[op];
        const rowBase=a?a.rowBase:0;
        const vectors=new Map(l.vectors.filter(v=>v.rowBase===rowBase).map(v=>[v.bank,v]));
        const logicalLabel=v=>!v?"empty":op==="W"?`k${v.logical[0]} / n${v.logical[1]}`:op==="I"?`m${v.logical[0]} / k${v.logical[1]}`:`m${v.logical[0]} / n${v.logical[1]}`;
        const namedRanks={nL0:"n mod 16",nL1:"⌊n/16⌋",kL1:"K group",mL0:`m mod ${l.spec.a0}`,mL1:`⌊m/${l.spec.a0}⌋`,jL1:"K group",pL0:`m mod ${l.spec.a0}`,pL1:`⌊m/${l.spec.a0}⌋`,qL1:"N group"};
        const footprints=data.layouts[r.layouts];
        $(`layout-${key}`).innerHTML=`<h3>${title(key)} · ${op} order ${l.spec.order_id}</h3>
            <p class="rc-layout-ranks">Outer → inner: <b>${l.ranks.map(rank=>namedRanks[rank]).join(" → ")}</b></p>
            <div class="rc-bank-window"><span>Scalar rows ${rowBase}–${rowBase+15} · 16 banks (wrapped)</span><div class="rc-banks">${Array.from({length:16},(_,bank)=>{const v=vectors.get(bank);return `<div data-selected="${!!a&&bank===a.bank}" title="Bank ${bank}, rows ${rowBase}–${rowBase+15}: ${logicalLabel(v)}"><small>b${bank}</small><strong>${logicalLabel(v)}</strong></div>`;}).join("")}</div></div>
            <p class="rc-layout-address">${a?`L=${a.linear} → bank ${a.bank} · base row ${a.rowBase} · scalar row ${a.row}`:"No valid vector"}</p>
            <p class="rc-note">${op==="W"?"Cell: W[16k:16k+16, n] · k: K group":op==="I"?"Cell: I[m, 16k:16k+16] · k: K group":"Cell: O[m, 16n:16n+16] · n: N group"}</p>`;
        $(`layout-meta-${key}`).textContent=`${title(key)} · ${op} rank sizes: ${l.ranks.map(rank=>l.dims[rank]).join(" × ")}. Tile storage W/I/O: ${["W","I","O"].map(x=>`${fmt(footprints[x].bytes)} B`).join(" / ")}.`;
    }
    function render(full=false) {
        keys.forEach(draw);$("scrub").value=Math.floor(state.step);$("step-label").textContent=`${Math.floor(state.step)} / ${model.end(record("reuse"))}`;
        if(full||lastInteger!==Math.floor(state.step)){detail();lastInteger=Math.floor(state.step);}
    }
    function stop(){state.playing=false;cancelAnimationFrame(raf);lastTime=0;$("play").textContent="Stream inputs";}
    function tick(t){if(!state.playing)return;if(lastTime)state.step=Math.min(model.end(record("reuse")),state.step+Math.min(.2,(t-lastTime)/1000)*state.speed);lastTime=t;render();if(state.step>=model.end(record("reuse")))stop();else raf=requestAnimationFrame(tick);}
    function selectStage(id){stop();state.stage=id;state.step=15;state.mode="weights";$("weights").setAttribute("aria-pressed","true");$("scrub").max=model.end(record("reuse"));context();render(true);}
    function choose(row,col){state.row=row;state.col=col;$("row").value=row;$("col").value=col;render(true);}
    $("next-stage").addEventListener("click",()=>selectStage(state.stage==="down"?"head":state.stage==="head"?"decode":"down"));
    for(const id of Object.keys(stages))$(`stage-${id}`).addEventListener("click",()=>selectStage(id));
    for(const field of ["row","col"]){for(let i=0;i<16;i++)$(field).add(new Option(i,i));$(field).value=state[field];$(field).addEventListener("change",()=>choose(Number($("row").value),Number($("col").value)));}
    $("operand").addEventListener("change",e=>{state.operand=e.target.value;detail();});
    $("weights").addEventListener("click",()=>{stop();state.mode="weights";$("weights").setAttribute("aria-pressed","true");render();});
    $("play").addEventListener("click",()=>{if(state.playing){stop();return;}state.mode="stream";$("weights").setAttribute("aria-pressed","false");if(state.step>=model.end(record("reuse")))state.step=0;state.playing=true;$("play").textContent="Pause inputs";raf=requestAnimationFrame(tick);});
    $("step").addEventListener("click",()=>{stop();state.mode="stream";$("weights").setAttribute("aria-pressed","false");state.step=Math.min(model.end(record("reuse")),Math.floor(state.step)+1);render(true);});
    $("reset").addEventListener("click",()=>{stop();state.step=0;render(true);});
    $("speed").addEventListener("change",e=>{state.speed=Number(e.target.value);});
    $("scrub").addEventListener("input",e=>{stop();state.step=Number(e.target.value);state.mode="stream";$("weights").setAttribute("aria-pressed","false");render(true);});
    for(const key of keys){const canvas=$(`canvas-${key}`);canvas.addEventListener("click",e=>{const rect=canvas.getBoundingClientRect(),col=Math.floor(((e.clientX-rect.left)*680/rect.width-geometry.x)/32),row=Math.floor(((e.clientY-rect.top)*680/rect.height-geometry.y)/32);if(row>=0&&row<16&&col>=0&&col<16)choose(row,col);});canvas.addEventListener("keydown",e=>{const move={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];if(move){e.preventDefault();choose(Math.max(0,Math.min(15,state.row+move[0])),Math.max(0,Math.min(15,state.col+move[1])));}});new ResizeObserver(()=>render()).observe(canvas);}
    new MutationObserver(()=>render()).observe(document.documentElement,{attributes:true,attributeFilter:["data-theme"]});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)stop();});reduced.addEventListener("change",()=>{stop();render();});
    selectStage("down");window.ReconfigurableCompute={inspect:()=>({...state}),selectStage};
})();
