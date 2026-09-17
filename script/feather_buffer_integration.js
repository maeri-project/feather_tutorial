/* Bind the generic tutorial's symbolic animation to configured scalar addresses.
 * No tensor values or programmed reduction commands are invented here. */
(function (global) {
  'use strict';
  function create(host) {
    const model=global.FeatherBufferModel;
    const kinds={I:'streaming',W:'stationary',O:'output'};
    let program=null,signature='',hardwareKey='',revision=0,base=null,view=null;
    let historyFrames=null,historyProgram=null,history=new Map(),selected=null;
    const colors={I:'#004C99',W:'#006633',O:'#990000'};
    const fills={I:'#E6EDF5',W:'#E6F0EB',O:'#F5E6E6'};
    function getProgram() {
      const hw=host.hardware(),key=JSON.stringify(hw),trace=host.signature();
      if(!program||signature!==trace||key!==hardwareKey){
        program=model.create(hw,host.instructions());signature=trace;hardwareKey=key;
        revision++;base=null;view=null;historyFrames=null;
      }
      return program;
    }
    function snapshotFor(frame) {
      const source=getProgram();
      return frame ? source.snapshots[frame.snapshotIndex??frame.iteration]||source.final : source.final;
    }
    function outputAccess(source,snapshot,col) {
      const count=source.pMC?.[source.aOR+','+col]||0;
      const t=source.outputDot??Math.max(0,Math.floor((count-1)/snapshot.AH));
      return model.pe(snapshot,source.aOR,col,t,0);
    }
    function valid(cell){return Boolean(cell?.valid&&!cell.outOfCapacity);}
    function event(operand,cell,extra={}) {
      return {operand,bank:cell?.bank??null,scalarRow:cell?.scalarRow??null,vnRow:cell?.vnRow??null,
        lane:cell?.lane??null,vnIndex:cell?.vnIndex??null,label:cell?.label||'Unmapped',
        valid:valid(cell),diagnostics:cell?.diagnostics||[],cell,...extra};
    }
    function buildBase(frame,index) {
      const snapshot=snapshotFor(frame),events=[],resultTargets=new Map(),forwarded=[];
      const diagnostics=[...(getProgram().diagnostics||[]),...(snapshot?.diagnostics||[])];
      if(frame&&snapshot){
        const reads=model.transfers(snapshot,frame);
        diagnostics.push(...reads.diagnostics);
        for(const operand of ['I','W'])for(const item of reads[kinds[operand]])
          events.push(event(operand,item.cell,{phase:'read',peRow:item.peRow,peCol:item.peCol,
            t:item.t,sourcePort:null,partial:false}));
        // Input elements already read by row zero advance down the array; these
        // forwarding hops must not be reported as new SRAM reads.
        for(const row of frame.aIR||[])if(row>0)for(let col=0;col<snapshot.AW;col++){
          const key=row+','+col,count=frame.pMC?.[key]||0;
          if(!['computing','dp_done','outputting'].includes(frame.pp?.[key])||count<1)continue;
          const access=model.pe(snapshot,row,col,Math.floor((count-1)/snapshot.AH),(count-1)%snapshot.AH);
          if(access.valid&&valid(access.streaming))forwarded.push(event('I',access.streaming,
            {phase:'forward',peRow:row,peCol:col,t:access.t,partial:false}));
        }
        const stages=snapshot.AW===4?3:2*Math.log2(snapshot.AW),frames=host.frames();
        for(let age=0;age<=stages+1;age++){
          const source=frames[index-age];
          if(!source||source.aOR<0||source.snapshotIndex!==frame.snapshotIndex||source.iteration!==frame.iteration)continue;
          const sourceSnapshot=snapshotFor(source);
          for(let col=0;col<snapshot.AW;col++){
            const access=outputAccess(source,sourceSnapshot,col),cell=access.output;
            let port=col;
            for(let stage=0;stage<stages;stage++){
              for(let sw=0;sw<snapshot.AW/2;sw++){
                const inputs=host.birrdInputs(stage,sw,snapshot.AW),side=inputs.indexOf(port);
                if(side>=0){port=2*sw+side;break;}
              }
            }
            const item=event('O',cell,{phase:'preview-write',age,peRow:source.aOR,peCol:col,
              t:access.t,sourcePort:port,partial:true,preview:true,committed:false,
              arriving:age===stages+1,valid:Boolean(access.valid&&valid(cell)),
              diagnostics:[...(access.diagnostics||[]),...(cell?.diagnostics||[])]});
            resultTargets.set(age+':'+col,item);
            if(item.valid)events.push(item);else diagnostics.push(...item.diagnostics);
          }
        }
        const arrivals=new Map();
        for(const item of events.filter(item=>item.operand==='O'&&item.arriving))
          arrivals.set(item.bank,(arrivals.get(item.bank)||0)+1);
        for(const [bank,count] of arrivals)if(count>1)
          diagnostics.push('PASS preview: '+count+' partials target output bank '+bank+
            '; these are intended destinations, not simultaneous committed SRAM writes.');
      }
      return {frame,index,snapshot,events,resultTargets,forwarded,diagnostics:[...new Set(diagnostics)]};
    }
    function prepare(frame,progress) {
      getProgram();const index=host.index();
      if(!base||base.frame!==frame||base.index!==index)base=buildBase(frame,index);
      const fraction=Math.max(0,Math.min(1,progress));
      const events=base.events.map(item=>({...item,status:item.phase==='read'?
        (fraction===1?'arrived':'reading'):(item.arriving&&fraction===1?'preview-written':'in-flight')}));
      view={...base,progress:fraction,events,revision};
      return view;
    }
    function current(){
      getProgram();
      return view&&view.frame===host.frame()&&view.index===host.index()
        ?view:prepare(host.frame(),host.progress());
    }
    function ensureHistory() {
      const frames=host.frames(),source=getProgram();
      if(historyFrames===frames&&historyProgram===source)return;
      historyFrames=frames;historyProgram=source;history=new Map();
      const stages=host.hardware().AW===4?3:2*Math.log2(host.hardware().AW);
      frames.forEach((frame,index)=>{
        if(frame.aOR<0)return;
        const snapshot=snapshotFor(frame);if(!snapshot?.es)return;
        for(let col=0;col<snapshot.AW;col++){
          const access=outputAccess(frame,snapshot,col),cell=access.output;
          if(!access.valid||!valid(cell))continue;
          const key=cell.bank+':'+cell.scalarRow;
          // Mapping changes do not clear physical output SRAM. Retain preview
          // write history by physical address while scrubbing this trace.
          if(!history.has(key))history.set(key,index+stages+1);
        }
      });
    }
    function getLayout(operand) {
      const state=current(),layout=model.layoutAt(state.snapshot,kinds[operand]);
      return {...layout,bankCount:layout.AW||host.hardware().AW,rowCount:layout.scalarRows||0,
        revision:revision+':'+(state.frame?.snapshotIndex??'final'),
        note:'Order '+(layout.order??'—')+' · '+(layout.permutation||[]).join(' → ')+
          ' · bank = VN index mod AW; scalar row = floor(VN index / AW) × AH + lane. '+
          (layout.bytesPerScalar||'?')+' byte(s) per scalar in this generic tutorial.',
        diagnostics:[...(layout.diagnostics||[]),...state.diagnostics]};
    }
    function getCell(operand,bank,row) {
      const state=current(),cell=model.scalar(model.layoutAt(state.snapshot,kinds[operand]),bank,row);
      let written=false;
      if(operand==='O'&&state.frame){
        ensureHistory();const arrival=history.get(bank+':'+row);
        written=arrival!==undefined&&(state.index>arrival||state.index===arrival&&state.progress===1);
      }
      return {...cell,valid:valid(cell),partial:operand==='O',written};
    }
    const popup=global.FeatherBufferPopup.create({
      getState:()=>{const state=current();return {playing:host.playing(),frame:state.index,
        progress:state.progress,phase:state.frame?.phase||'Configured buffer layout · generate animation to track transfers',
        revision:revision+':'+(state.frame?.snapshotIndex??'final')+':'+state.index+':'+(state.progress===1),reduced:host.reduced()};},
      getLayout,getCell,getTransfers:operand=>current().events.filter(item=>item.operand===operand),
      onPlayPause:()=>{host.playPause();refresh();},onStep:delta=>host.step(delta),
      onSelectCell:cell=>{selected=cell;host.onSelectCell?.(cell);host.redraw();}
    });
    function refresh(){popup.refresh();}
    function open(operand,opener){prepare(host.frame(),host.progress());popup.open(operand,opener);}
    function read(operand,row,col){return current().events.find(item=>item.phase==='read'&&item.operand===operand&&item.peRow===row&&item.peCol===col);}
    function forward(row,col){return current().forwarded.find(item=>item.peRow===row&&item.peCol===col);}
    function result(age,col){return current().resultTargets.get(age+':'+col);}
    function windowFor(operand) {
      const state=current(),layout=model.layoutAt(state.snapshot,kinds[operand]);
      let active=state.events.filter(item=>item.operand===operand&&item.valid);
      if(operand==='O'&&active.length){
        // Only one row wave reaches SRAM in a teaching step. Include every
        // destination of that wave, even when its VN rows are non-contiguous.
        const arrivals=active.filter(item=>item.arriving);
        const age=Math.max(...active.map(item=>item.age));
        active=arrivals.length?arrivals:active.filter(item=>item.age===age);
      }
      return global.FeatherBufferView.window(layout,active.map(item=>item.cell));
    }
    function point(operand,cell,geometry) {
      return global.FeatherBufferView.point(geometry.bufferCells?.[operand]||[],cell.bank,cell.scalarRow);
    }
    function drawBuffer(ctx,operand,region,window=windowFor(operand)) {
      const state=current(),layout=model.layoutAt(state.snapshot,kinds[operand]);
      return global.FeatherBufferView.draw(ctx,layout,window,region,{
        events:state.events.filter(item=>item.operand===operand&&item.valid),
        cellAt:(bank,row)=>getCell(operand,bank,row),color:colors[operand],fill:fills[operand]
      });
    }
    function drawMini(ctx,geometry) {
      geometry.bufferCells={};geometry.bufferWindows={};
      for(const region of geometry.bufferRegions){
        const operand=region.operand,window=windowFor(operand);
        geometry.bufferWindows[operand]=window;
        geometry.bufferCells[operand]=drawBuffer(ctx,operand,region,window);
      }
    }
    const canvas=host.canvas();
    canvas.addEventListener('click',event=>{
      const geometry=host.geometry();if(!geometry)return;
      const rect=canvas.getBoundingClientRect(),x=(event.clientX-rect.left)*canvas.width/rect.width,
        y=(event.clientY-rect.top)*canvas.height/rect.height;
      const region=geometry.bufferRegions?.find(item=>x>=item.x&&x<=item.x+item.width&&y>=item.y&&y<=item.y+item.height);
      if(region)open(region.operand,document.getElementById('mgInspect'+region.operand));
    });
    canvas.addEventListener('mousemove',event=>{
      const geometry=host.geometry(),rect=canvas.getBoundingClientRect();if(!geometry)return;
      const x=(event.clientX-rect.left)*canvas.width/rect.width,y=(event.clientY-rect.top)*canvas.height/rect.height;
      const hit=geometry.bufferRegions?.some(item=>x>=item.x&&x<=item.x+item.width&&y>=item.y&&y<=item.y+item.height);
      canvas.style.cursor=hit?'pointer':'default';
    });
    return {getProgram,snapshotFor,prepare,current,getLayout,getCell,read,forward,result,
      windowFor,point,drawBuffer,drawMini,refresh,open,popup,selection:()=>selected};
  }
  global.FeatherBufferIntegration={create};
})(window);
