/* Phone-only controls use the existing playback and hit-testing code. */
document.addEventListener('DOMContentLoaded', () => {
  const phone = matchMedia('(max-width: 900px)');
  window.FeatherMobile = {canvasScale(width, height, requested) {
    if (!phone.matches) return requested;
    const limit = Math.sqrt(8_000_000 / (width * height));
    return Math.min(requested, limit >= 1 ? Math.floor(limit) : limit);
  }};
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
      wrapper.classList.toggle('mobile-diagram-zoomed', zoomIndex > 0);
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

  // Present the existing live drawing first on phones; restore every node to
  // its original location on desktop so controls, listeners and models survive.
  const presentations = [
    {drawing:'.mg-app', root:'.doc-content', play:'mgMobilePlay', state:'mgPlayBtn', title:'FEATHER', controls:'.mg-left', tab:'mg-feather-tab'},
    {drawing:'.rc-arrays.mobile-comparison', root:'.rc-page', play:'rc-play', title:'Reconfigurable compute'},
    {drawing:'.comparison-array-grid', root:'.comparison-page', play:'comparison-play', title:'Systolic vs. FEATHER'},
    {drawing:'#full-act-teaching', root:'.qwen-app', play:'full-teach-play', title:'Qwen3 on FEATHER', controls:':scope > :not(.act-teach-viewport)'}
  ];
  const presentation = presentations.find(item => document.querySelector(item.drawing));
  if (presentation) {
    const root = document.querySelector(presentation.root), drawing = document.querySelector(presentation.drawing);
    const hero = document.createElement('div'), options = document.createElement('details');
    const summary = document.createElement('summary'), optionsBody = document.createElement('div');
    hero.className = 'mobile-focus'; options.className = 'mobile-focus-options';
    options.id = 'mobile-focus-options'; summary.textContent = 'Options';
    optionsBody.className = 'mobile-focus-options-body'; options.append(summary, optionsBody);
    const play = button('Play', 'Play', () => {
      document.getElementById(presentation.play)?.click(); syncPlay();
    });
    play.id = 'mobile-focus-play'; play.className = 'mobile-focus-play'; hero.append(play);
    function syncPlay() {
      const source = document.getElementById(presentation.state || presentation.play);
      const label = /pause/i.test(source?.textContent || '') ? 'Pause' : 'Play';
      if (play.textContent !== label) play.textContent = label;
      play.setAttribute('aria-label', label); play.setAttribute('aria-pressed', String(label === 'Pause'));
      play.disabled = !source || source.disabled;
    }
    const source = document.getElementById(presentation.state || presentation.play);
    if (source) new MutationObserver(syncPlay).observe(source, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});
    const title = document.querySelector('.header-title'), originalTitle = title?.textContent;
    const moves = [];
    let active = false;
    function move(node, parent) {
      const anchor = document.createComment('Mobile presentation position');
      node.before(anchor); moves.push({node, anchor}); parent.append(node);
    }
    function arrange() {
      if (phone.matches === active) return;
      active = phone.matches;
      if (active) {
        if (drawing.matches('.mg-expanded')) document.getElementById('mgExpandBtn').click();
        const content = [...root.childNodes].filter(node => !node.matches?.('script,style'));
        root.prepend(hero, options);
        content.forEach(node => move(node, optionsBody));
        move(drawing, hero);
        if (presentation.controls) drawing.querySelectorAll(presentation.controls).forEach(node => move(node, optionsBody));
        // Leave the nav container in place for the architecture's size and
        // hit-testing code; only move its controls into the Options panel.
        const nav = drawing.querySelector('.mg-view-nav');
        if (nav) {
          const controls = document.createElement('div'); controls.className = 'mg-view-nav';
          optionsBody.prepend(controls);
          [...nav.childNodes].forEach(node => move(node, controls));
        }
        // Keep detailed zoom available below the drawing without repeating Play.
        const names = {'rc-canvas-reuse':'Mapping A','rc-canvas-outputs':'Mapping B','comparison-sa':'Systolic array','comparison-feather':'FEATHER'};
        for (const viewer of drawing.querySelectorAll('.mobile-diagram')) {
          const group = document.createElement('fieldset'), legend = document.createElement('legend');
          group.className = 'mobile-focus-zoom'; group.dataset.diagram = viewer.dataset.diagram;
          legend.textContent = names[viewer.dataset.diagram] || 'Diagram zoom';
          group.append(legend); optionsBody.prepend(group);
          move(viewer.querySelector('.mobile-diagram-tools'), group);
        }
        document.body.classList.add('mobile-demo'); root.classList.add('mobile-focus-page');
        if (title) title.textContent = presentation.title;
        if (presentation.tab) document.getElementById(presentation.tab).click();
      } else {
        // Restore descendants before their parents, including moved toolbars.
        for (const {node, anchor} of moves.reverse()) anchor.replaceWith(node);
        moves.length = 0; optionsBody.replaceChildren(); hero.remove(); options.remove();
        document.body.classList.remove('mobile-demo'); root.classList.remove('mobile-focus-page');
        if (title) title.textContent = originalTitle;
      }
      syncPlay();
      requestAnimationFrame(() => {
        viewers.forEach(view => view.size()); window.dispatchEvent(new Event('resize'));
      });
    }
    options.addEventListener('toggle', () => window.dispatchEvent(new Event('resize')));
    phone.addEventListener('change', arrange); arrange();
  }
});
