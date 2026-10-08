/* The sixteen main SVG rectangles are created once and only change position. */
document.addEventListener('DOMContentLoaded', () => {
  'use strict';
  const model = window.RuntimeComputing;
  const mount = document.getElementById('runtime-stage');
  if (!model || !mount) return;
  const play = document.getElementById('runtime-play');
  const seek = document.getElementById('runtime-seek');
  const clock = document.getElementById('runtime-time');
  const status = document.getElementById('runtime-status');
  // A static opening poster remains visible until the viewer presses Play.
  mount.innerHTML = model.svg(1);
  const elements = [...mount.querySelectorAll('#runtime-elements rect')];
  const groups = [0, 1].map(i => document.getElementById(`runtime-group-${i}`));
  const layers = Object.entries({opacity: 'elements', grouping: 'grouping', leftLabel: 'left-label',
    middleLabel: 'middle-label', rightLabel: 'right-label', firstAction: 'first-action',
    secondAction: 'second-action', firstInset: 'first-inset', secondInset: 'second-inset', conclusion: 'conclusion'})
    .map(([key, id]) => [key, document.getElementById(`runtime-${id}`)]);
  let seconds = 0, playing = false, origin = 0, request = 0;
  const stamp = value => `0:${String(Math.floor(value)).padStart(2, '0')}`;
  function controls() {
    const label = playing ? 'Pause' : seconds >= model.DURATION ? 'Replay' : 'Play';
    if (play) {
      play.textContent = label; play.setAttribute('aria-label', `${label} animation`);
      play.setAttribute('aria-pressed', String(playing));
    }
    if (seek) {
      seek.value = seconds;
      seek.setAttribute('aria-valuetext', `${seconds.toFixed(1)} of 20 seconds`);
    }
    if (clock) clock.value = `${stamp(seconds)} / 0:20`;
  }
  const notify = () => document.dispatchEvent(new Event('runtime-playback-change'));
  function render() {
    const state = model.frame(seconds);
    state.elements.forEach((element, i) => {
      elements[i].setAttribute('x', element.x); elements[i].setAttribute('y', element.y);
    });
    state.groups.forEach((group, i) => {
      for (const [key, value] of Object.entries(group)) groups[i].setAttribute(key, value);
    });
    for (const [key, node] of layers) node.setAttribute('opacity', state[key]);
    controls();
  }
  function tick(now) {
    if (!playing) return;
    seconds = Math.min(model.DURATION, (now - origin) / 1000);
    if (seconds >= model.DURATION) {
      playing = false;
      if (status) status.textContent = '16 elements. Different configurations. Animation complete.';
    }
    render();
    if (playing) request = requestAnimationFrame(tick);
    else notify();
  }
  function pause() {
    if (!playing) return;
    seconds = Math.min(model.DURATION, (performance.now() - origin) / 1000);
    playing = false; cancelAnimationFrame(request); render(); notify();
  }
  function start() {
    if (playing) return;
    if (seconds >= model.DURATION) seconds = 0;
    playing = true; origin = performance.now() - seconds * 1000;
    if (status) status.textContent = '';
    render(); notify(); request = requestAnimationFrame(tick);
  }
  function reset() {
    playing = false; cancelAnimationFrame(request); seconds = 0;
    if (status) status.textContent = '';
    render(); notify();
  }
  play?.addEventListener('click', () => {
    if (playing) pause(); else start();
  });
  seek?.addEventListener('input', () => {
    const next = Number(seek.value);
    pause(); seconds = next;
    if (status) status.textContent = '';
    render();
  });
  // Returning to a backgrounded tab never skips an explanation.
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
  window.RuntimeComputingPlayer = {play:start, pause, reset, inspect:() => ({seconds, playing})};
  controls(); notify();
});
