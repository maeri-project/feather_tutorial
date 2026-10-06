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
    const letter = key => key === "reuse" ? "A" : key === "outputs" ? "B" : "C";
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
        text(ctx,`Each column forwards one input to 16 rows holding different n weights.`,x,665,colors.muted,11);
    }
    function context() {
        const s=stage(),prev=s.previous?stages[s.previous]:null;
        for(const item of data.stages)$(`stage-${item.id}`).setAttribute("aria-pressed",item.id===s.id);
        $("context").textContent=s.id==="down"
            ? "The final MLP still processes all 768 prompt tokens. Its mapper chooses A: four token replicas reuse each weight tile across 32 rows. This is the predecessor that establishes A before the next GEMM."
            : s.id==="head" ? "The preceding down_proj selected A for 768 token rows. After residual addition and normalization, logits_to_keep=1 selects only the final row. Retaining A leaves three token replicas unused; the head selects B instead."
            : "The language-model head already selected B. Sampling creates a token; embedding and normalization create this q_proj input. With one input row, q_proj also prefers B, so the spatial mapping can stay the same while its weights change.";
        $("workload-title").textContent=s.title;
        $("next-stage").textContent=s.id==="down"?"Next: send the last row to lm_head →":s.id==="head"?"Next: start one-token decode →":"Return to the prefill down_proj";
        $("equation").innerHTML=[
            [s.input,s.inputName,`${fmt(s.shape.M)} × ${fmt(s.shape.K)}`,`M: ${s.axes.M} · K: ${s.axes.K}`,"input"],
            [s.weight,s.weightName,`${fmt(s.shape.K)} × ${fmt(s.shape.N)}`,`K: ${s.axes.K} · N: ${s.axes.N}`,"weight"],
            [s.output,s.outputName,`${fmt(s.shape.M)} × ${fmt(s.shape.N)}`,`M: ${s.axes.M} · N: ${s.axes.N}`,"output"]
        ].map(([symbol,name,dims,axes,kind],i)=>`${i?`<b class="rc-math-sign">${i===1?"×":"="}</b>`:""}<div class="rc-matrix rc-${kind}"><small>${name}</small><strong>${symbol}</strong><code>${dims}</code><span>${axes}</span></div>`).join("");
        $("shard-note").textContent=s.programs>1
            ? `Complete operation shown. The comparison uses ${s.programs} sequential, disjoint N=${fmt(s.programN)} programs for every candidate to fit the compiler's operand-image regions. The animation shows the first tile of the first program.`
            : "One complete projection. The animation shows its first tile; the dimensions above describe the whole operation.";
        $("boundary").innerHTML=s.id==="head"
            ? `<strong>The M dimension changes at the boundary</strong><div>ΔH[768,1024] + residual → RMSNorm → Z[768,1024] → <b>take Z[767,:]</b> → Z_last[1,1024]</div><small>The selected row is packed for the head's input layout. This is an explicit transform between GEMMs.</small>`
            : s.id==="down" ? `<strong>The input comes from the preceding MLP branches</strong><div>G = SiLU(gate_proj(H)) ⊙ up_proj(H), with G shaped [768,3072].</div><small>The output ΔH is a residual update, not the final normalized hidden state.</small>`
            : `<strong>A new token creates a new activation tensor</strong><div>logits → sample token → embedding → RMSNorm → X_next[1,1024]</div><small>q_proj loads W_q; the previous vocabulary weights are replaced. B is a reusable spatial mapping, not reused tensor data.</small>`;
        const chosen=s.records[s.preferred],loser=s.records[s.preferred==="reuse"?"outputs":"reuse"];
        $("choice-reason").textContent=s.preferred==="reuse"
            ? `A wins for this workload because it reuses a weight tile over 32 tokens. B handles 16 tokens per tile and reloads more weights. A takes ${fmt(chosen.cost.total_cycles)} predicted cycles versus ${fmt(loser.cost.total_cycles)} for B.`
            : `B wins because one token needs output-channel coverage, not extra token replicas. B covers 64 channels per tile instead of A's 32. ${prev?`The predecessor preferred ${letter(prev.preferred)}; `:""}${s.id==="head"?"this is where A → B becomes useful.":"B remains appropriate here."}`;
        $("candidates").innerHTML=["replicate8","reuse","outputs"].map(key=>{
            const r=s.records[key],rep=8/r.EM.G_c;
            return `<tr${key===s.preferred?' class="rc-chosen"':""}><th scope="row">${title(key)}${key===s.preferred?'<span>Selected by mapper</span>':prev&&key===prev.preferred?'<span>Preferred by preceding GEMM</span>':""}</th><td>${shape(r.tile)}</td><td>2 K halves × ${rep} tokens × ${r.EM.G_c} output groups</td><td>${fmt(r.cost.total_cycles)}</td></tr>`;
        }).join("")+`<tr class="rc-rejected"><th scope="row">One replica · 128 channels</th><td>… × 32 × 128</td><td>4,096 weight scalars &gt; 2,048 available in StaB</td><td>Does not fit</td></tr>`;
        const stats=s.search.stats;
        $("search-note").textContent=`The compiler considered ${stats.tile_proposals} tile proposals, searched ${stats.tiles_searched} and pruned ${stats.tiles_pruned} by its latency bound. The three displayed legal candidates explain the tradeoff; A/B's winning tile and EM parameters match the bounded search result. Cycles exclude inter-operation transformations and layout repacking.`;
        for(const key of keys) {
            const r=record(key),rep=8/r.EM.G_c;
            $(`card-${key}`).dataset.preferred=key===s.preferred;
            $(`badge-${key}`).textContent=key===s.preferred?"Selected here":prev&&prev.preferred===key?"From previous GEMM":"Alternative";
            $(`description-${key}`).textContent=key==="reuse"?"Two output groups per K half. Copy their weight vectors four times, giving four token rows parallel work.":"Four output groups per K half. Copy their weight vectors twice, covering twice as many channels.";
            $(`specs-${key}`).innerHTML=`<span>Tile <b>${shape(r.tile)}</b></span><span>Gr=${r.EM.G_r} · Gc=${r.EM.G_c} · T=${r.ES.T}</span><span>W/I/O layout orders <b>${r.orders.W}/${r.orders.I}/${r.orders.O}</b></span>`;
            $(`schedule-${key}`).innerHTML=`<strong>${r.mappedPEs}/256 useful PE owners</strong><span>Input dot 0 uses token rows ${Array.from({length:rep},(_,i)=>i).join(", ")}${s.shape.M===1?"; only row 0 exists":""}.</span><span>${r.ES.T} dot group${r.ES.T===1?"":"s"}: column c's token row advances by ${r.ES.s_m}. Weights stay resident across those groups.</span>`;
        }
        $("commands").innerHTML=keys.map(key=>`<h3>${title(key)}</h3><pre>${JSON.stringify({ExecuteMapping:record(key).EM,ExecuteStreaming:record(key).ES},null,2)}</pre>`).join("");
    }
    const addressLabel=a=>a?`bank ${a.bank}, scalar rows ${a.rowBase}–${a.rowBase+15}`:"No valid logical vector";
    function detail() {
        const s=stage();$("pe-title").textContent=`PE (${state.row}, ${state.col}) · same location, two assignments`;
        const a=model.at(record("reuse"),state.row,state.col,state.step),b=model.at(record("outputs"),state.row,state.col,state.step);
        $("pe-change").textContent=`A holds ${s.weight}[${a.kStart}:${a.kStart+16}, ${a.n}] for token row ${a.m}. B holds ${s.weight}[${b.kStart}:${b.kStart+16}, ${b.n}] for token row ${b.m}. ${!a.valid&&b.valid?"This PE gains a valid token and computes a different output channel when remapped.":"Follow the weight identity and token assignment, not just the PE color."}`;
        for(const key of keys) {
            const r=record(key),o=model.at(r,state.row,state.col,state.step),addr=model.peAddresses(data,r,state.row,state.col,state.step);
            const sampleOpen=$(`pe-${key}`).querySelector("details")?.open;
            const inputName=s.id==="head"&&o.valid?`Z[767, ${o.kStart}:${o.kStart+16}] ≡ Z_last[0, ${o.kStart}:${o.kStart+16}]`:`${s.input}[${o.m}, ${o.kStart}:${o.kStart+16}]`;
            const pair=(state.col+8)%16;
            $(`pe-${key}`).innerHTML=`<h3>${title(key)}</h3><div class="rc-data-path"><div class="rc-weight"><small>STATIONARY / 16 LOCAL SLOTS</small><strong>${s.weight}[k=${o.kStart}…${o.kStart+15}, n=${o.n}]</strong><span>StaB ${addressLabel(addr.W)} → PE (${state.row}, ${state.col})</span></div><b>×</b><div class="rc-input"><small>STREAMED DOWN COLUMN ${state.col}</small><strong>${inputName}</strong><span>${o.valid?`StrB ${addressLabel(addr.I)} → top of column ${state.col} → PE row ${state.row}`:`Token row ${o.m} is outside M=${r.tile.M}; no useful input is supplied.`}</span></div><b>↓</b><div class="rc-output"><small>LOCAL DOT → BIRRD → ACCUMULATION</small><strong>${o.valid?`${s.output}[${o.m}, ${o.n}] += Σₖ ${s.input}[${o.m},k] × ${s.weight}[k,${o.n}]`:"No valid output contribution"}</strong><span>${o.valid?`Pair with PE (${state.row}, ${pair}) for the other K half. OB bank ${addr.O.bank}, scalar row ${addr.O.row}; later K tiles accumulate here.`:"The resident weights have no matching token in this mapping."}</span></div></div><details><summary>16 weight values and current MAC sample</summary><div class="rc-sample-slots">${Array.from({length:16},(_,i)=>`<span data-active="${o.active&&i===o.lane}"><small>k${o.kStart+i}</small>${model.weight(o.kStart+i,o.n)}</span>`).join("")}</div><p class="rc-note">${o.active?`Input ${model.input(o.m,o.k)} × weight ${model.weight(o.k,o.n)} at k=${o.k}; partial dot sum ${o.sum}.`:"No useful MAC at this teaching step."}</p></details>`;
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
        $(`layout-${key}`).innerHTML=`<h3>${title(key)} · ${op} order ${l.spec.order_id}</h3><p class="rc-layout-ranks">Outer → inner: <b>${l.ranks.map(rank=>namedRanks[rank]).join(" → ")}</b></p><p class="rc-note">Rank sizes (outer → inner): ${l.ranks.map(rank=>l.dims[rank]).join(" × ")}.<br>Tile storage W/I/O: ${["W","I","O"].map(x=>`${fmt(footprints[x].bytes)} B`).join(" / ")}</p><div class="rc-bank-window"><span>Scalar rows ${rowBase}–${rowBase+15} · 16 banks, wrapped into two display rows</span><div class="rc-banks">${Array.from({length:16},(_,bank)=>{const v=vectors.get(bank);return `<div data-selected="${!!a&&bank===a.bank}" title="Bank ${bank}, rows ${rowBase}–${rowBase+15}: ${logicalLabel(v)}"><small>b${bank}</small><strong>${logicalLabel(v)}</strong></div>`;}).join("")}</div></div><p class="rc-layout-address">${a?`Selected vector L=${a.linear} → bank ${a.bank}, base row ${a.rowBase}; current scalar row ${a.row}.`:"This selected PE has no valid vector in this buffer."}</p><p class="rc-note">${op==="W"?"k is a K-group index and n is an output column; each cell holds W[16k:16k+16, n].":op==="I"?"m is a token row and k is a K-group index; each cell holds I[m, 16k:16k+16].":"m is a token row and n is an N-group index; each cell holds O[m, 16n:16n+16]."}</p>`;
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
