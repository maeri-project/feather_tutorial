/* FEATHER vs. Xilinx DPU: replay of the measured per-layer ResNet-50 race.
 *
 * Data: window.FeatherDpuRaceData (feather_dpu_race_data.js).
 * Renderer: window.FeatherDpuConvView (feather_dpu_conv_view.js).
 */
(function () {
  "use strict";
  var DATA = window.FeatherDpuRaceData, VIEW = window.FeatherDpuConvView;
  if (!DATA || !VIEW) return;
  function $(id) { return document.getElementById(id); }
  if (!$("race-arena")) return;

  var ENG = ["dpu", "feather"];
  var RESNET = DATA.resnet;
  var live = {};
  ENG.forEach(function (e) {
    live[e] = DATA[e].map(function (r) { return {idx: r[0], ms: r[1], subs: r[2] || 1}; });
  });
  var N = Math.min(live.dpu.length, live.feather.length);

  var ui = {};
  ENG.forEach(function (e) {
    var r = $("race-side-" + e), c = r.querySelector("canvas");
    ui[e] = {canvas: c, ctx: c.getContext("2d"), clock: r.querySelector("[data-clock]"),
             layer: r.querySelector("[data-layer]"), shape: r.querySelector("[data-shape]")};
  });

  // ------------------------------------------------------------- theme
  // Engine colours and the renderer's palette follow the site's light/dark theme.
  var COL = {};
  function isDark() { return document.documentElement.getAttribute("data-theme") === "dark"; }
  function applyTheme() {
    var cs = getComputedStyle(document.documentElement);
    function v(n, d) { return (cs.getPropertyValue(n) || "").trim() || d; }
    var dark = isDark();
    COL = dark
      ? {feather: "#60a5fa", featherDim: "#2f5d8f", dpu: "#fb923c", dpuDim: "#8a4f22"}
      : {feather: "#1f5fae", featherDim: "#8badd8", dpu: "#a8502a", dpuDim: "#d9a483"};
    COL.card = v("--bg-card", dark ? "#1a1d2d" : "#ffffff");
    VIEW.setPalette(dark
      ? {ink: v("--text-main", "#f1f5f9"), muted: v("--text-muted", "#cbd5e1"),
         base: "#232739", off: "#30364c", sheetA: "#262a3e", sheetB: "#2d3248",
         line: "rgba(203,213,225,.16)", hatch: "rgba(203,213,225,.45)",
         tileSep: "rgba(11,12,21,.85)"}
      : {ink: v("--text-main", "#1e293b"), muted: v("--text-muted", "#64748b"),
         base: "#f1f5f9", off: "#e2e8f0", sheetA: "#e2e8f0", sheetB: "#edf2f7",
         line: "rgba(100,116,139,.22)", hatch: "rgba(100,116,139,.55)",
         tileSep: "rgba(255,255,255,.8)"});
    if (!running) drawIdle(); else if (!raf && repaint) repaint(0);
  }

  // ------------------------------------------------------------- playback speed
  // Wall-clock milliseconds per millisecond of chip time; logarithmic slider.
  var MULT_MIN = 20, MULT_MAX = 3000, timeMult = 150;
  function sliderToMult(v) { return MULT_MIN * Math.pow(MULT_MAX / MULT_MIN, v / 100); }
  function multToSlider(m) {
    return Math.round(100 * Math.log(m / MULT_MIN) / Math.log(MULT_MAX / MULT_MIN));
  }

  function fmtShape(idx) {
    var g = RESNET[idx];
    if (!g) return "";
    return g[4] + "×" + g[5] + "×" + g[3] + " → "
         + g[7] + "×" + g[8] + "×" + g[6]
         + " · " + g[0] + "×" + g[0] + (g[1] > 1 ? " stride " + g[1] : "");
  }
  function fmtDur(ms) {
    var s = ms / 1000;
    return s < 90 ? Math.round(s) + " s" : (s / 60).toFixed(1) + " min";
  }

  var raf = null, paused = false, running = false, repaint = null;

  // "time":  both spend measured time at the same rate -- the race as measured.
  // "layer": both start every layer together; the first to finish waits.
  var alignMode = "time";

  function setPaused(p) {
    paused = p;
    var b = $("race-pause");
    b.setAttribute("aria-pressed", String(p));
    b.textContent = p ? "▶ Resume" : "❚❚ Pause";
  }

  function drawIdle() {
    ENG.forEach(function (e) {
      VIEW.draw(ui[e], null, 0, COL[e], COL[e + "Dim"], "press Play", e, 0, RESNET);
    });
  }

  function waitBanner(g, e) {
    var x = g.ctx, W = g.canvas.width, other = e === "dpu" ? "FEATHER" : "the DPU";
    x.save();
    x.globalAlpha = .9; x.fillStyle = COL.card;
    x.fillRect(0, 122, W, 34);
    x.globalAlpha = 1; x.fillStyle = COL[e];
    x.font = "italic 600 19px Inter, system-ui, sans-serif"; x.textAlign = "center";
    x.fillText("✓ layer done — waiting for " + other, W / 2, 146);
    x.restore();
  }

  function setRatio(text, cls) {
    $("race-ratio").textContent = text;
    $("race-ratio").className = "race-ratio" + (cls ? " " + cls : "");
  }

  function race() {
    if (raf) cancelAnimationFrame(raf);
    running = true;
    $("race-play").textContent = "↻ Replay";
    $("race-pause").disabled = false;
    setPaused(false);
    setRatio("—", "idle");
    $("race-ratio-label").innerHTML = alignMode === "layer"
      ? "this layer<br>DPU ÷ FEATHER" : "layers done<br>FEATHER : DPU";
    var R = {dpu: {i: 0, acc: 0, el: 0, done: false, wait: false},
             feather: {i: 0, acc: 0, el: 0, done: false, wait: false}};
    var last = performance.now();

    function advanceTime(adv) {
      ENG.forEach(function (e) {
        var r = R[e], list = live[e];
        if (r.done) return;
        var b = adv;
        while (b > 0 && r.i < list.length) {
          var need = list[r.i].ms - r.acc;
          if (b >= need) { b -= need; r.el += need; r.i++; r.acc = 0; }
          else { r.acc += b; r.el += b; b = 0; }
        }
        if (r.i >= list.length) { r.done = true; r.i = list.length; }
      });
    }

    function advanceLayer(adv) {
      ENG.forEach(function (e) {
        var r = R[e];
        if (r.done || r.wait) return;
        var need = live[e][r.i].ms - r.acc;
        if (adv >= need) { r.acc += need; r.el += need; r.wait = true; }
        else { r.acc += adv; r.el += adv; }
      });
      if (R.dpu.wait && R.feather.wait) {          // the barrier: both done
        ENG.forEach(function (e) {
          var r = R[e];
          r.i++; r.acc = 0; r.wait = false;
          if (r.i >= N) { r.done = true; r.i = N; }
        });
      }
    }

    function frame(now) {
      var dt = Math.min(now - last, 80); last = now;
      // paused: nothing advances, but frames keep drawing so the close-up loops
      var adv = paused ? 0 : dt / timeMult;
      if (alignMode === "layer") advanceLayer(adv); else advanceTime(adv);
      paint(adv);
      if (R.dpu.done && R.feather.done) {
        setPaused(false);
        $("race-pause").disabled = true;
        raf = null;
        return;
      }
      raf = requestAnimationFrame(frame);
    }

    function paint(adv) {
      ENG.forEach(function (e) {
        var r = R[e], list = live[e], g = ui[e];
        var cur = r.done ? null : list[r.i];
        VIEW.draw(g, cur, cur ? (r.wait ? 1 : r.acc / cur.ms) : 1, COL[e], COL[e + "Dim"],
                  r.done ? list.length + " convolutions · " + r.el.toFixed(2) + " ms" : null,
                  e, (cur && !r.wait) ? adv / cur.ms : 0, RESNET);
        if (r.wait) waitBanner(g, e);
        g.clock.textContent = r.el.toFixed(2);
        if (cur) {
          g.layer.textContent = "layer " + (cur.idx + 1) + " of " + list.length
            + (cur.subs > 1 ? " · " + cur.subs + " sub-layers" : "")
            + (r.wait ? " · done, waiting" : "");
          g.shape.textContent = fmtShape(cur.idx);
        } else {
          g.layer.textContent = "finished";
          g.shape.textContent = "";
        }
      });
      if (alignMode === "layer") {
        var L = Math.min(R.dpu.i, N - 1);
        setRatio((live.dpu[L].ms / live.feather[L].ms).toFixed(2) + "×");
      } else {
        setRatio(R.feather.i + " : " + R.dpu.i);
      }
      if (R.dpu.done && R.feather.done) {
        setRatio((R.dpu.el / R.feather.el).toFixed(2) + "×", "final");
        $("race-ratio-label").innerHTML = "measured conv<br>latency ratio";
      }
    }
    repaint = paint;
    raf = requestAnimationFrame(frame);
  }

  function showRate() {
    var perMs = timeMult / 1000;
    $("race-rate").textContent = "1 ms of chip time = "
      + (perMs < 1 ? perMs.toFixed(2) : perMs.toFixed(1)) + " s on screen";
    var f = 0, d = 0, both = 0;
    for (var i = 0; i < N; i++) {
      f += live.feather[i].ms; d += live.dpu[i].ms;
      both += Math.max(live.dpu[i].ms, live.feather[i].ms);
    }
    $("race-est").textContent = alignMode === "layer"
      ? "both ≈ " + fmtDur(both * timeMult)
      : "FEATHER ≈ " + fmtDur(f * timeMult) + ", DPU ≈ " + fmtDur(d * timeMult);
  }

  function setAlign(m) {
    alignMode = m === "layer" ? "layer" : "time";
    Array.prototype.forEach.call(document.querySelectorAll("[data-race-align]"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-race-align") === alignMode));
    });
    try { localStorage.setItem("featherDpuRace.align", alignMode); } catch (e) {}
    showRate();
  }

  // ------------------------------------------------------------- wiring
  try {
    var saved = parseFloat(localStorage.getItem("featherDpuRace.playback"));
    if (saved >= MULT_MIN && saved <= MULT_MAX) timeMult = saved;
  } catch (e) {}
  $("race-speed").value = multToSlider(timeMult);
  $("race-speed").addEventListener("input", function () {
    timeMult = sliderToMult(Number(this.value));
    try { localStorage.setItem("featherDpuRace.playback", String(timeMult)); } catch (e) {}
    showRate();
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-race-align]"), function (b) {
    b.addEventListener("click", function () {
      var m = b.getAttribute("data-race-align");
      if (m === alignMode) return;
      setAlign(m);
      // mid-race the engines may be on different layers: restart in the new mode
      if (running) race();
    });
  });
  var savedAlign = "time";
  try { savedAlign = localStorage.getItem("featherDpuRace.align") || "time"; } catch (e) {}
  setAlign(savedAlign);

  $("race-play").addEventListener("click", race);
  $("race-pause").addEventListener("click", function () {
    if (!this.disabled) setPaused(!paused);
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.code !== "Space" || $("race-pause").disabled) return;
    var t = ev.target && ev.target.tagName;
    if (t === "BUTTON" || t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
    ev.preventDefault();
    setPaused(!paused);
  });

  $("race-total-dpu").textContent = DATA.totals_ms.dpu.toFixed(2);
  $("race-total-feather").textContent = DATA.totals_ms.feather.toFixed(2);
  $("race-total-ratio").textContent = (DATA.totals_ms.dpu / DATA.totals_ms.feather).toFixed(2) + "×";

  applyTheme();
  new MutationObserver(applyTheme).observe(document.documentElement,
    {attributes: true, attributeFilter: ["data-theme"]});
})();
