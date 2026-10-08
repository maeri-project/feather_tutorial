/* Fixed identities and a deterministic 20-second timeline, in SVG coordinates. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RuntimeComputing = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 1920, HEIGHT = 1000, SIZE = 32, DURATION = 20;
  const clamp = value => Math.max(0, Math.min(1, value));
  const ease = value => { const p = clamp(value); return p * p * p * (10 + p * (-15 + 6 * p)); };
  const progress = (time, start, end) => ease((time - start) / (end - start));
  const mix = (a, b, p) => a + (b - a) * p;
  const visible = (t, start, inEnd, outStart, end) => progress(t, start, inEnd) * (1 - progress(t, outStart, end));

  function frame(seconds) {
    const t = Math.max(0, Math.min(DURATION, Number.isFinite(seconds) ? seconds : 0));
    const split = progress(t, 4.7, 5.5), travel = progress(t, 5.5, 8.25);
    const elements = Array.from({length: 16}, (_, id) => {
      const row = Math.floor(id / 4), col = id % 4, group = Math.floor(col / 2), lane = col % 2;
      const pair = group * 4 + row;
      const firstX = 164 + group * 116;
      let x = mix(firstX, 813, travel) + lane * mix(58, 44, split);
      let y = mix(244, 234 + group * 168, split) + row * mix(58, 42, split);
      if (t >= 12) {
        // Unfold each pair horizontally before closing the rows. Keeping the
        // paths in separate lanes prevents one element from obscuring another.
        const unfold = progress(t, 12.45 + pair * .1, 14.9 + pair * .1);
        const align = progress(t, 15.65 + pair * .04, 16.45 + pair * .04);
        x = mix(813, 1160 + pair * 80, unfold) + lane * mix(44, 40, unfold);
        y = mix(234 + pair * 42, 377, align);
      }
      return {id, group, pair, lane, x, y, width: SIZE, height: SIZE};
    });
    const groups = [0, 1].map(group => {
      const members = elements.filter(element => element.group === group);
      const x = Math.min(...members.map(element => element.x)) - 4;
      const y = Math.min(...members.map(element => element.y)) - 4;
      return {x, y, width: Math.max(...members.map(element => element.x)) + SIZE + 4 - x,
        height: Math.max(...members.map(element => element.y)) + SIZE + 4 - y};
    });
    return {time: t, elements, groups, opacity: progress(t, 0, .85),
      grouping: visible(t, 4, 4.5, 8.3, 8.85),
      leftLabel: 1 - progress(t, 4.7, 5.4),
      middleLabel: visible(t, 8.3, 8.9, 12.4, 13),
      rightLabel: progress(t, 16.6, 17),
      firstAction: visible(t, 4, 4.4, 8.5, 9),
      secondAction: visible(t, 12, 12.4, 16.5, 17),
      firstInset: visible(t, 4.4, 5, 8.4, 9),
      secondInset: visible(t, 12.3, 12.9, 16.4, 17),
      conclusion: progress(t, 17, 17.5)};
  }

  const rect = (attributes, extra = '') => `<rect ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')} ${extra}/>`;
  function inset(x, y, columnsPerGroup) {
    const step = 46, size = 30;
    let result = '';
    for (let col = 0; col < 4; col += columnsPerGroup) {
      result += rect({x: x + col * step - 8, y: y - 8, width: (columnsPerGroup - 1) * step + size + 16, height: 3 * step + size + 16}, 'fill="#f2cbd2" stroke="#a83843" stroke-width="3" stroke-dasharray="9 6"');
    }
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      result += rect({x: x + col * step, y: y + row * step, width: size, height: size}, 'fill="white" stroke="black" stroke-width="5"');
    }
    return result;
  }
  function svg(seconds) {
    const s = frame(seconds);
    return `<svg id="runtime-canvas" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-labelledby="runtime-svg-title runtime-svg-desc">
      <title id="runtime-svg-title">Sixteen elements, three array configurations</title>
      <desc id="runtime-svg-desc">A 4 by 4 array splits into two groups of eight and stacks into eight rows of two. Its eight pairs unfold into a single row of sixteen. Pink diagrams below are separate explanatory insets.</desc>
      <rect width="${WIDTH}" height="${HEIGHT}" fill="black"/>
      <g id="runtime-grouping" opacity="${s.grouping}" fill="#f2cbd2" fill-opacity=".4" stroke="#a83843" stroke-width="3" stroke-dasharray="10 7">
        ${s.groups.map((g, i) => rect(g, `id="runtime-group-${i}"`)).join('')}
      </g>
      <g id="runtime-elements" fill="white" opacity="${s.opacity}">
        ${s.elements.map(e => rect({x: e.x, y: e.y, width: SIZE, height: SIZE}, `id="runtime-element-${e.id}" data-element="${e.id}"`)).join('')}
      </g>
      <g fill="#a83843" font-family="Georgia, 'Times New Roman', serif" font-size="56" text-anchor="middle">
        <text id="runtime-left-label" x="267" y="132" opacity="${s.leftLabel}">4x4 Array</text>
        <text id="runtime-middle-label" x="851" y="132" opacity="${s.middleLabel}">8x2 Array</text>
        <text id="runtime-right-label" x="1476" y="132" opacity="${s.rightLabel}">1x16 Array</text>
        <text id="runtime-first-action" x="553" y="196" font-size="44" opacity="${s.firstAction}">Reconfigure</text>
        <text id="runtime-second-action" x="1065" y="196" font-size="44" opacity="${s.secondAction}">Reconfigure</text>
      </g>
      <g id="runtime-first-inset" opacity="${s.firstInset}" aria-label="Supporting diagram: two groups of eight">${inset(570, 728, 2)}</g>
      <g id="runtime-second-inset" opacity="${s.secondInset}" aria-label="Supporting diagram: four columns of four">${inset(1388, 728, 1)}</g>
      <text id="runtime-conclusion" x="1476" y="485" fill="#e7d7da" font-family="Georgia, 'Times New Roman', serif" font-size="28" text-anchor="middle" opacity="${s.conclusion}">16 elements • Different configurations</text>
    </svg>`;
  }
  return {WIDTH, HEIGHT, SIZE, DURATION, frame, svg};
});
