/* Phone-only controls use the existing playback and hit-testing code. */
document.addEventListener('DOMContentLoaded', () => {
  const phone = matchMedia('(max-width: 900px)');
  const selector = '#rc-canvas-reuse, #rc-canvas-outputs, #comparison-sa, #comparison-feather, #comparison-bridge, .act-teach-canvas, #full-act-array, #act-array, #nest, #topology';
  const viewers = new Map();
  const zooms = [1, 1.5, 2, 3, 4, 6, 8];
  function button(label, name, action) {
    const node = document.createElement('button');
    node.type = 'button'; node.textContent = label;
    node.setAttribute('aria-label', name); node.addEventListener('click', action);
    return node;
  }
  function enhance(drawing) {
    if (viewers.has(drawing) || !drawing.matches('canvas,svg')) return;
    const wrapper = document.createElement('div'), tools = document.createElement('div'), scroll = document.createElement('div');
    wrapper.className = 'mobile-diagram'; tools.className = 'mobile-diagram-tools'; scroll.className = 'mobile-diagram-scroll';
    wrapper.dataset.diagram = drawing.id;
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', 'Diagram · zoom and swipe to explore');
    drawing.before(wrapper); wrapper.append(tools, scroll); scroll.append(drawing);
    let zoomIndex = 0;
    const output = document.createElement('output');
    output.setAttribute('aria-label', 'Diagram zoom');
    function size() {
      if (!phone.matches) { drawing.style.removeProperty('--mobile-diagram-width'); return; }
      const width = Math.max(1, scroll.clientWidth - 2);
      drawing.style.setProperty('--mobile-diagram-width', `${width * zooms[zoomIndex]}px`);
    }
    function zoom(index) {
      const old = zooms[zoomIndex];
      const centerX = (scroll.scrollLeft + scroll.clientWidth / 2) / old;
      const centerY = (scroll.scrollTop + scroll.clientHeight / 2) / old;
      zoomIndex = Math.max(0, Math.min(zooms.length - 1, index));
      size();
      output.value = `${Math.round(zooms[zoomIndex] * 100)}%`;
      minus.disabled = zoomIndex === 0; plus.disabled = zoomIndex === zooms.length - 1;
      scroll.scrollLeft = zoomIndex ? centerX * zooms[zoomIndex] - scroll.clientWidth / 2 : 0;
      scroll.scrollTop = zoomIndex ? centerY * zooms[zoomIndex] - scroll.clientHeight / 2 : 0;
    }
    const minus = button('−', 'Zoom out', () => zoom(zoomIndex - 1));
    const fit = button('Fit', 'Fit diagram width', () => zoom(0));
    const plus = button('+', 'Zoom in', () => zoom(zoomIndex + 1));
    const playId = drawing.id.startsWith('rc-') ? 'rc-play'
      : drawing.id === 'comparison-bridge' ? 'comparison-layout-play'
      : drawing.id.startsWith('comparison-') ? 'comparison-play'
      : drawing.id.endsWith('-canvas') ? drawing.id.replace(/-canvas$/, '-play') : null;
    const original = document.getElementById(playId);
    let playbackObserver;
    if (original) {
      const play = button('Play', 'Play diagram', () => original.click());
      function sync() {
        const paused = /pause/i.test(original.textContent);
        play.textContent = paused ? 'Pause' : 'Play';
        play.setAttribute('aria-label', paused ? 'Pause diagram' : 'Play diagram');
        play.setAttribute('aria-pressed', String(paused)); play.disabled = original.disabled;
      }
      playbackObserver = new MutationObserver(sync);
      playbackObserver.observe(original, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
      sync(); tools.append(play);
    }
    tools.append(minus, fit, plus, output);
    let lastWidth = -1, resizeFrame;
    const resize = new ResizeObserver(entries => {
      const width = entries[0].contentRect.width;
      if (width === lastWidth) return;
      lastWidth = width;
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(size);
    });
    resize.observe(scroll);
    viewers.set(drawing, {wrapper, resize, playbackObserver, size, cancelResize:() => cancelAnimationFrame(resizeFrame)});
    zoom(0);
  }
  document.querySelectorAll(selector).forEach(enhance);
  // ACT cases create fresh canvases when switching recorded programs.
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(selector)) enhance(node);
      node.querySelectorAll(selector).forEach(enhance);
    }
    for (const [drawing, view] of viewers) if (!drawing.isConnected) {
      view.resize.disconnect(); view.cancelResize(); view.playbackObserver?.disconnect(); viewers.delete(drawing);
    }
  }).observe(document.querySelector('main'), {childList:true,subtree:true});
  phone.addEventListener('change', () => viewers.forEach(view => view.size()));

  const toc = document.querySelector('.on-this-page ul');
  if (toc) {
    const index = document.createElement('details'), summary = document.createElement('summary');
    index.className = 'mobile-page-index'; summary.textContent = 'On this page';
    index.append(summary, toc.cloneNode(true));
    document.querySelector('.doc-content').before(index);
    index.addEventListener('click', event => { if (event.target.closest('a')) index.open = false; });
  }
  // Give unwrapped documentation tables their own horizontal scrolling region.
  document.querySelectorAll('.text-block > table').forEach(table => {
    const scroll = document.createElement('div'); scroll.className = 'mobile-table-scroll';
    scroll.tabIndex = 0; scroll.setAttribute('role','region'); scroll.setAttribute('aria-label','Scrollable table');
    table.before(scroll); scroll.append(table);
  });
  const nativePlay = document.getElementById('mgPlayBtn'), phonePlay = document.getElementById('mgMobilePlay');
  if (nativePlay && phonePlay) {
    const sync = () => { phonePlay.textContent = nativePlay.textContent; phonePlay.setAttribute('aria-pressed', String(/pause/i.test(nativePlay.textContent))); };
    new MutationObserver(sync).observe(nativePlay, {childList:true}); sync();
  }
});
