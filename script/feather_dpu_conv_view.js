/* FEATHER vs. Xilinx DPU -- per-layer convolution view.
 *
 * Draws what each accelerator computes, layer by layer, at ResNet-50's real
 * geometry, following each one's dataflow:
 *
 *   FEATHER  -- from its HLS (SushiAccel_K16_C9, qconv.cpp, DPE_ARRAY):
 *               per cycle ONE output pixel, its whole 3x3 window (9 taps),
 *               9 input and 16 output channels = 1296 MACs. Loop order
 *               K-tile -> C-tile -> every output pixel, so the output map is
 *               swept once per C-tile and partial sums accumulate.
 *               1x1 follows the flexDataflow library's kernel_recompile,
 *               which folds 9 input channels into the 9 taps: 81 input
 *               channels per tile (FEATHER_1X1 below switches this).
 *   DPU B1152 -- 4 adjacent output pixels x 12 input x 12 output channels,
 *               ONE kernel tap per cycle = 576 MACs. Its internal loop order
 *               is not published; the order used here is illustrative and the
 *               canvas says so.
 *
 * Timing is NOT modelled here: progress through a layer comes from the
 * measured per-layer latency (feather_dpu_race_data.js). A layer is millions
 * of cycles, so at any watchable playback speed the per-cycle steps cannot be
 * followed; the close-up inset loops a few cycles slowly instead.
 *
 * Colours come from the site theme through setPalette().
 */
(function (root) {
  "use strict";

  // How FEATHER maps a 1x1 layer onto its 3x3 PEs.
  //   "fold-input"  : the 9 taps carry 9 more INPUT channels (81 in x 16 out)
  //                   -- what library.py's kernel_recompile configures
  //   "fold-output" : the 9 taps carry 9 more OUTPUT channels (9 in x 144 out)
  var FEATHER_1X1 = "fold-input";

  var HW = {
    feather: {pp: 1, icp: 9, ocp: 16, macs: 1296, mhz: 100,
              caption: "16 × 9 PEs × 9 taps = 1,296 MACs / cycle"},
    dpu:     {pp: 4, icp: 12, ocp: 12, macs: 576, mhz: 300,
              caption: "4 px × 12 in × 12 out = 576 MACs / cycle"}
  };

  // Theme colours; replaced by setPalette() from the page's CSS variables.
  var PAL = {ink: "#1e293b", muted: "#64748b", base: "#f1f5f9", off: "#e2e8f0",
             sheetA: "#e2e8f0", sheetB: "#edf2f7", line: "rgba(100,116,139,.22)",
             hatch: "rgba(100,116,139,.55)", tileSep: "rgba(255,255,255,.8)",
             font: "Inter, system-ui, sans-serif"};

  function setPalette(p) {
    for (var key in p) if (Object.prototype.hasOwnProperty.call(p, key) && p[key]) PAL[key] = p[key];
  }

  // ------------------------------------------------------------- tiling
  var planCache = {};

  function plan(e, idx, geo) {
    var key = e + idx;
    if (planCache[key]) return planCache[key];
    var k = geo[0], C = geo[3], K = geo[6], Ho = geo[7], Wo = geo[8];
    var P = Ho * Wo, useful = K * C * k * k * P, p;
    if (e === "feather") {
      p = {P: P, subs: 1, oc: 16, Kt: Math.ceil(K / 16)};
      if (k === 1 && FEATHER_1X1 === "fold-input") {
        // kernel_recompile: C -> ceil(C/9), rounded up to a multiple of 9
        p.ic = 81; p.Ct = Math.ceil(Math.ceil(C / 9) / 9);
      } else if (k === 1) {
        p.ic = 9; p.oc = 144; p.Ct = Math.ceil(C / 9); p.Kt = Math.ceil(K / 144);
      } else if (k === 7) {
        // the notebook runs the stem as 3 sub-layers, 3 channels folded to 9
        p.ic = 9; p.Ct = 1; p.subs = 3;
      } else {
        p.ic = 9; p.Ct = Math.ceil(C / 9);
      }
      p.passes = p.subs * p.Kt * p.Ct;
      p.cycles = p.passes * P;
    } else {
      var Sw = Math.ceil(Wo / 4);
      p = {ic: 12, oc: 12, Kt: Math.ceil(K / 12), Ct: Math.ceil(C / 12),
           Sw: Sw, S: Ho * Sw, taps: k * k};
      p.cycles = p.Kt * p.S * p.Ct * p.taps;
      p.passes = p.Kt;
    }
    p.util = useful / (p.cycles * HW[e].macs);
    planCache[key] = p;
    return p;
  }

  // progress through the layer -> position in the engine's loop nest
  function where(e, p, frac) {
    var n = Math.max(0, Math.min(p.cycles - 1, Math.floor(frac * p.cycles)));
    if (e === "feather") {
      var perSub = p.Kt * p.Ct * p.P, m = n % perSub;
      return {sub: Math.floor(n / perSub),
              kt: Math.floor(m / (p.Ct * p.P)),
              ct: Math.floor(m / p.P) % p.Ct,
              pix: m % p.P};
    }
    var r = Math.floor(n / p.taps);
    return {tap: n % p.taps, ct: r % p.Ct,
            s: Math.floor(r / p.Ct) % p.S,
            kt: Math.floor(r / (p.Ct * p.S))};
  }

  // ------------------------------------------------------------- helpers
  function txt(x, s, px, py, size, colour, align, italic) {
    x.fillStyle = colour || PAL.ink;
    x.font = (italic ? "italic " : "") + size + "px " + PAL.font;
    x.textAlign = align || "left";
    x.fillText(s, px, py);
  }

  function grid(x, px, py, cols, rows, cell) {
    if (cell < 5) return;
    x.strokeStyle = PAL.line; x.lineWidth = 1; x.beginPath();
    for (var a = 1; a < cols; a++) {
      x.moveTo(px + a * cell + .5, py); x.lineTo(px + a * cell + .5, py + rows * cell);
    }
    for (var b = 1; b < rows; b++) {
      x.moveTo(px, py + b * cell + .5); x.lineTo(px + cols * cell, py + b * cell + .5);
    }
    x.stroke();
  }

  function cellRect(x, mapX, mapY, cell, row, col, h, w, minPx) {
    if (row < 0 || col < 0 || row >= h || col >= w) return;
    var s = Math.max(cell, minPx || 0), off = (s - cell) / 2;
    x.fillRect(mapX + col * cell - off, mapY + row * cell - off, s, s);
  }

  function glowRect(x, colour, rx, ry, rw, rh) {
    x.save(); x.shadowColor = colour; x.shadowBlur = 12;
    x.strokeStyle = colour; x.lineWidth = 2; x.strokeRect(rx, ry, rw, rh);
    x.restore();
  }

  // ------------------------------------------------------------- the maps
  // Channel depth is drawn for real: the sheets behind the input map are the
  // input-channel tile being processed this cycle (9 or 12 deep), the sheets
  // behind the output map the output-channel tile (16 or 12). The window is a
  // block running through the input sheets; the output is a column through
  // the output sheets -- one per filter computed at once.
  var DX = 2.6, DY = 2.0, MAX_SHEETS = 16;

  function stack(x, px, py, w, h, n) {
    for (var i = n; i >= 1; i--) {
      x.fillStyle = i % 2 ? PAL.sheetA : PAL.sheetB;
      x.fillRect(px + i * DX, py - i * DY, w, h);
      x.strokeStyle = PAL.line; x.lineWidth = 1;
      x.strokeRect(px + i * DX + .5, py - i * DY + .5, w - 1, h - 1);
    }
    x.fillStyle = PAL.base; x.fillRect(px, py, w, h);
  }

  // A rectangle on the front sheet, extruded n sheets deep (oblique view):
  // translucent top and right faces, so it reads as a block through the stack.
  function prism(x, rx, ry, rw, rh, n, colour) {
    var dx = n * DX, dy = n * DY;
    x.save();
    x.fillStyle = colour;
    x.globalAlpha = .30;
    x.beginPath();                                    // top face
    x.moveTo(rx, ry); x.lineTo(rx + dx, ry - dy);
    x.lineTo(rx + rw + dx, ry - dy); x.lineTo(rx + rw, ry); x.closePath(); x.fill();
    x.globalAlpha = .45;
    x.beginPath();                                    // right face
    x.moveTo(rx + rw, ry); x.lineTo(rx + rw + dx, ry - dy);
    x.lineTo(rx + rw + dx, ry + rh - dy); x.lineTo(rx + rw, ry + rh); x.closePath(); x.fill();
    x.globalAlpha = .9; x.strokeStyle = colour; x.lineWidth = 1;
    x.beginPath();                                    // back edges
    x.moveTo(rx + dx, ry - dy); x.lineTo(rx + rw + dx, ry - dy);
    x.lineTo(rx + rw + dx, ry + rh - dy); x.stroke();
    x.restore();
  }

  function drawMaps(x, e, geo, p, at, colour, dim, fast, L) {
    var k = geo[0], st = geo[1], pd = geo[2], hin = geo[4], win = geo[5],
        hout = geo[7], wout = geo[8];
    var nIn = Math.min(p.ic, MAX_SHEETS), nOut = Math.min(p.oc, MAX_SHEETS);
    var box = L.box, cell = box / Math.max(hin, win, hout, wout);
    var iw = cell * win, ih = cell * hin, ow = cell * wout, oh = cell * hout;
    var ix = L.pad + (box - iw) / 2, iy = L.top + (box - ih) / 2;
    var ox = L.W - L.pad - box - MAX_SHEETS * DX + (box - ow) / 2,
        oy = L.top + (box - oh) / 2;

    stack(x, ix, iy, iw, ih, nIn); grid(x, ix, iy, win, hin, cell);
    stack(x, ox, oy, ow, oh, nOut);

    // how many passes over the output map are complete
    var done = e === "feather" ? at.sub * p.Kt * p.Ct + at.kt * p.Ct + at.ct : at.kt;
    var a0 = .7 * done / p.passes, a1 = .7 * (done + 1) / p.passes;
    x.fillStyle = colour;
    if (a0 > 0) { x.globalAlpha = a0; x.fillRect(ox, oy, ow, oh); }

    var orow, ocol, npx = 1, sx, sy;
    if (e === "feather") {
      orow = Math.floor(at.pix / wout); ocol = at.pix % wout;
    } else {
      orow = Math.floor(at.s / p.Sw); ocol = (at.s % p.Sw) * 4;
      npx = Math.min(4, wout - ocol);
    }

    if (fast) {
      // a pass is over in less than a few frames: show the pass, not a pixel
      x.globalAlpha = a1; x.fillRect(ox, oy, ow, oh);
      x.globalAlpha = .35; x.fillStyle = dim; x.fillRect(ix, iy, iw, ih);
      x.globalAlpha = 1;
      grid(x, ox, oy, wout, hout, cell);
      return {done: done, ix: ix, ox: ox, ow: ow};
    }

    // this pass, written so far
    x.globalAlpha = a1;
    if (orow > 0) x.fillRect(ox, oy, ow, orow * cell);
    if (ocol > 0) x.fillRect(ox, oy + orow * cell, ocol * cell, cell);
    x.globalAlpha = 1;
    grid(x, ox, oy, wout, hout, cell);

    var mo = Math.max(cell, 4), half = (mo - cell) / 2;
    var wy = orow * st - pd, wx = ocol * st - pd;
    if (e === "feather") {
      // ONE window, all k x k taps at once, through the 9-channel input tile
      var r0 = Math.max(0, wy), c0 = Math.max(0, wx);
      var r1 = Math.min(hin, wy + k), c1 = Math.min(win, wx + k);
      var bx = ix + c0 * cell - half, by = iy + r0 * cell - half;
      var bw = Math.max((c1 - c0) * cell, mo), bh = Math.max((r1 - r0) * cell, mo);
      x.fillStyle = colour; x.fillRect(bx, by, bw, bh);
      prism(x, bx, by, bw, bh, nIn, colour);
      glowRect(x, colour, bx, by, bw, bh);
      sx = bx + bw / 2; sy = by + bh / 2;
    } else {
      // FOUR windows -- one per pixel of the strip -- outlined; this cycle
      // each touches only ONE tap, through the 12-channel input tile
      var ty = Math.floor(at.tap / k), tx = at.tap % k;
      x.save(); x.strokeStyle = colour; x.globalAlpha = .55; x.lineWidth = 1.2;
      for (var j = 0; j < npx; j++)
        x.strokeRect(ix + (wx + j * st) * cell + .5, iy + wy * cell + .5,
                     k * cell - 1, k * cell - 1);
      x.restore();
      var tx0 = 0, ty0 = 0;
      for (var q = 0; q < npx; q++) {
        var tr = wy + ty, tc = wx + q * st + tx;
        if (tr < 0 || tc < 0 || tr >= hin || tc >= win) continue;
        var cx = ix + tc * cell - half, cy = iy + tr * cell - half;
        x.fillStyle = colour; x.fillRect(cx, cy, mo, mo);
        prism(x, cx, cy, mo, mo, nIn, colour);
        tx0 += cx + mo / 2; ty0 += cy + mo / 2;
      }
      var spanW = (npx - 1) * st + k;
      glowRect(x, colour, ix + wx * cell, iy + wy * cell,
               Math.max(spanW * cell, 8), Math.max(k * cell, 6));
      sx = ix + (wx + spanW / 2) * cell; sy = iy + (wy + k / 2) * cell;
    }

    // the output position(s), as a column through the output-channel tile:
    // one value per filter computed this cycle
    x.fillStyle = colour;
    for (var i2 = 0; i2 < npx; i2++) {
      var px2 = ox + (ocol + i2) * cell - half, py2 = oy + orow * cell - half;
      x.fillRect(px2, py2, mo, mo);
      prism(x, px2, py2, mo, mo, nOut, colour);
    }

    var ex = ox + (ocol + npx / 2) * cell, ey = oy + (orow + .5) * cell;
    x.save(); x.globalAlpha = .55; x.strokeStyle = colour; x.lineWidth = 1.5;
    x.setLineDash([4, 4]); x.lineDashOffset = -(performance.now() / 45) % 8;
    x.beginPath(); x.moveTo(sx, sy); x.lineTo(ex, ey); x.stroke(); x.restore();
    return {done: done, orow: orow, ocol: ocol, npx: npx, ix: ix, ox: ox, ow: ow};
  }

  // ------------------------------------------------------------- channel bars
  function drawBar(x, y, label, real, tile, nTiles, cur, colour, dim, L) {
    var bx = 118, bw = L.W - bx - L.pad, slots = tile * nTiles, sw = bw / slots;
    txt(x, label, L.pad, y + 15, 18, PAL.ink);
    x.fillStyle = PAL.base; x.fillRect(bx, y, bw, 18);
    // Colour only the slots holding a real channel; padding stays pale and
    // hatched, so a 3-channel layer on a 12-wide array reads as 3 of 12.
    for (var t = 0; t <= cur && t < nTiles; t++) {
      var s0 = t * tile, s1 = Math.min(real, s0 + tile);
      if (s1 <= s0) continue;
      x.fillStyle = t < cur ? dim : colour;
      x.fillRect(bx + s0 * sw, y, (s1 - s0) * sw, 18);
    }
    // padding slots: channels the array carries but the layer does not have
    if (slots > real) {
      x.save(); x.beginPath(); x.rect(bx + real * sw, y, (slots - real) * sw, 18); x.clip();
      x.strokeStyle = PAL.hatch; x.lineWidth = 1;
      for (var h = -18; h < (slots - real) * sw + 18; h += 5) {
        x.moveTo(bx + real * sw + h, y + 18); x.lineTo(bx + real * sw + h + 18, y);
      }
      x.stroke(); x.restore();
    }
    if (tile * sw >= 4) {
      x.strokeStyle = PAL.tileSep; x.lineWidth = 1; x.beginPath();
      for (var s2 = 1; s2 < nTiles; s2++) {
        x.moveTo(bx + s2 * tile * sw + .5, y); x.lineTo(bx + s2 * tile * sw + .5, y + 18);
      }
      x.stroke();
    }
    x.strokeStyle = PAL.off; x.lineWidth = 1; x.strokeRect(bx + .5, y + .5, bw - 1, 17);
  }

  // ------------------------------------------------------------- compute array
  function drawArray(x, e, geo, p, at, colour, fast, L) {
    var k = geo[0], C = geo[3], K = geo[6], wout = geo[8];
    var top = L.arrTop, left = L.pad, d = 5, i, j, a, b;
    if (e === "feather") {
      // 9 rows of PEs (input channels) x 16 columns (output channels),
      // each PE a 3x3 block of multipliers -- one per window tap
      var pe = 3 * d + 4;
      var outOn, inSlots;
      if (k === 1 && FEATHER_1X1 === "fold-output") {
        outOn = Math.min(144, K - at.kt * 144); inSlots = Math.min(9, C - at.ct * 9) * 9;
      } else {
        outOn = Math.min(16, K - at.kt * 16);
        if (k === 1) inSlots = Math.min(81, C - at.ct * 81);        // taps carry channels
        else if (k === 7) inSlots = 81;                             // folded stem
        else inSlots = Math.min(9, C - at.ct * 9) * 9;              // 9 taps per channel
      }
      for (a = 0; a < 9; a++)
        for (b = 0; b < 16; b++)
          for (i = 0; i < 3; i++)
            for (j = 0; j < 3; j++) {
              var slot = a * 9 + i * 3 + j;
              var on = slot < inSlots;
              if (k === 1 && FEATHER_1X1 === "fold-output") on = a * 9 < inSlots && (b * 9 + i * 3 + j) < outOn;
              else on = on && b < outOn;
              x.fillStyle = on ? colour : PAL.off;
              x.fillRect(left + b * pe + j * d, top + a * pe + i * d, d - 1, d - 1);
            }
      txt(x, k === 1 ? "1×1: each PE's 9 multipliers take 9 more input channels"
                     : "each PE: one 3×3 window, all 9 taps at once",
          left, top + 9 * pe + 18, 16, PAL.muted, "left", true);
    } else {
      // 4 pixel lanes, each 12 output (columns) x 12 input (rows) multipliers
      var lane = 12 * d + 10, lanesOn = at.npx || 4;
      var oOn = Math.min(12, K - at.kt * 12), iOn = Math.min(12, C - at.ct * 12);
      for (var l = 0; l < 4; l++)
        for (a = 0; a < 12; a++)
          for (b = 0; b < 12; b++) {
            x.fillStyle = (l < lanesOn && a < iOn && b < oOn) ? colour : PAL.off;
            x.fillRect(left + l * lane + b * d, top + a * d, d - 1, d - 1);
          }
      // which tap of the kernel this cycle is on
      var tk = k, tc = 9, tx0 = left, ty0 = top + 12 * d + 16;
      txt(x, "tap", tx0, ty0 + 14, 16, PAL.muted, "left", true);
      for (i = 0; i < tk; i++)
        for (j = 0; j < tk; j++) {
          x.fillStyle = (!fast && i * tk + j === at.tap) ? colour : PAL.off;
          x.fillRect(tx0 + 36 + j * (tc + 2), ty0 + i * (tc + 2), tc, tc);
        }
      txt(x, "one tap per cycle · " + (tk * tk) + (tk === 1 ? " cycle" : " cycles")
          + " per window",
          left, ty0 + tk * (tc + 2) + 20, 16, PAL.muted, "left", true);
    }
    txt(x, HW[e].caption, left, L.arrCap, 18, PAL.ink);
    txt(x, HW[e].mhz + " MHz  ·  this layer keeps " + Math.round(p.util * 100)
        + "% of them busy", left, L.arrCap + 22, 16, PAL.muted, "left", true);
  }

  // ------------------------------------------------------------- close-up
  // A few cycles, slowed right down, independent of the measured timing.
  function drawInset(x, e, geo, colour, dim, L) {
    var k = geo[0] === 1 ? 1 : 3, x0 = L.insX, y0 = L.insY, cs = 20;
    txt(x, "one cycle, up close", x0, y0 - 6, 16, PAL.ink, "left", true);
    var t = Math.floor(performance.now() / 750);
    var cols = 6, rows = k === 1 ? 1 : 3;
    // input patch
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++) {
        x.fillStyle = PAL.base; x.fillRect(x0 + c * cs, y0 + 6 + r * cs, cs - 2, cs - 2);
      }
    var outY = y0 + 6 + rows * cs + 34, i, j, lit;
    txt(x, "↓", x0 + cols * cs / 2, outY - 10, 18, PAL.muted, "center");
    for (c = 0; c < 4; c++) { x.fillStyle = PAL.base; x.fillRect(x0 + c * cs, outY, cs - 2, cs - 2); }
    var note;
    if (e === "feather") {
      var px = t % 4;
      x.fillStyle = colour;
      for (i = 0; i < rows; i++)
        for (j = 0; j < k; j++) x.fillRect(x0 + (px + j) * cs, y0 + 6 + i * cs, cs - 2, cs - 2);
      x.fillRect(x0 + px * cs, outY, cs - 2, cs - 2);
      note = k === 1 ? ["1 pixel per cycle,", "81 input ch at once"]
                     : ["1 pixel per cycle,", "all 9 taps at once"];
    } else {
      var taps = k * k, tap = t % taps, ty = Math.floor(tap / k), tx = tap % k;
      x.globalAlpha = .45; x.fillStyle = dim;
      x.fillRect(x0, y0 + 6, (3 + k) * cs - 2 - (k === 1 ? 2 * cs : 0), rows * cs - 2);
      x.globalAlpha = 1; x.fillStyle = colour;
      for (i = 0; i < 4; i++) {
        x.fillRect(x0 + (i + tx) * cs, y0 + 6 + ty * cs, cs - 2, cs - 2);
        x.fillRect(x0 + i * cs, outY, cs - 2, cs - 2);
      }
      note = k === 1 ? ["4 pixels per cycle,", "1 tap"]
                     : ["4 pixels per cycle,", "1 tap at a time ("
                        + geo[0] * geo[0] + " cycles)"];   // real k*k, drawn as 3x3
    }
    // the inset is ~190 px wide, so captions go on two lines
    txt(x, note[0], x0, outY + cs + 18, 15, PAL.muted, "left", true);
    txt(x, note[1], x0, outY + cs + 36, 15, PAL.muted, "left", true);
    if (e === "dpu") txt(x, "loop order illustrative", x0, outY + cs + 54, 13, PAL.muted, "left", true);
  }

  // ------------------------------------------------------------- entry point
  function draw(g, layer, frac, colour, dim, idleText, e, rate, RESNET) {
    var c = g.canvas, x = g.ctx, W = c.width, H = c.height;
    x.clearRect(0, 0, W, H);
    var geo = layer && RESNET[layer.idx];
    if (!geo || !e) {
      txt(x, idleText || "waiting", W / 2, H / 2, 20, idleText ? colour : PAL.muted, "center", true);
      return;
    }
    var L = {W: W, pad: 18, top: 68, box: 166, insX: W - 200, insY: 394,
             arrTop: 372, arrCap: H - 32};
    var p = plan(e, layer.idx, geo);
    var at = where(e, p, frac);
    // a pass over the output map that lasts under ~4 frames cannot be followed
    var fast = rate * p.passes > 0.25;

    var m = drawMaps(x, e, geo, p, at, colour, dim, fast, L);
    at.npx = m.npx;

    var k = geo[0], st = geo[1];
    var outX = W - L.pad - L.box - 16 * 2.6;
    txt(x, "in " + geo[4] + "\u00d7" + geo[5] + "\u00d7" + geo[3], L.pad, 24, 20, PAL.ink);
    txt(x, "out " + geo[7] + "\u00d7" + geo[8] + "\u00d7" + geo[6], outX, 24, 20, PAL.ink);
    var mid = (L.pad + L.box + 16 * 2.6 + outX) / 2, cy = L.top + L.box / 2;
    txt(x, k + "\u00d7" + k + (st > 1 ? " /" + st : ""), mid, cy - 14, 21, colour, "center", true);
    txt(x, "\u2192", mid, cy + 10, 21, PAL.muted, "center");
    txt(x, Math.min(p.ic, 999) + " in \u00b7 " + p.oc + " out", mid, cy + 34, 15, colour, "center", true);
    txt(x, "per cycle", mid, cy + 52, 13, PAL.muted, "center", true);

    var status;
    if (e === "feather") {
      status = "pass " + (m.done + 1) + "/" + p.passes
             + (fast ? " — sweeping too fast to follow" : "  ·  pixel "
                + (at.pix + 1).toLocaleString() + "/" + p.P.toLocaleString());
    } else {
      status = "out-tile " + (at.kt + 1) + "/" + p.Kt
             + (fast ? " — too fast to follow" : "  ·  strip " + (at.s + 1)
                + "/" + p.S + "  ·  tap " + (at.tap + 1) + "/" + p.taps);
    }
    txt(x, status, L.pad, L.top + L.box + 24, 17, PAL.muted, "left", true);

    var C = geo[3], K = geo[6];
    // FEATHER's stem folds its 3 channels with the kernel rows into 9 slots,
    // so all 9 are real work, not padding.
    var stemFold = e === "feather" && k === 7;
    drawBar(x, L.top + L.box + 40, stemFold ? "in ch 3→9" : "in ch " + C,
            stemFold ? p.ic : C, p.ic, p.Ct, at.ct, colour, dim, L);
    drawBar(x, L.top + L.box + 72, "out ch " + K, K, p.oc, p.Kt, at.kt, colour, dim, L);
    txt(x, "tile " + p.ic + " in × " + p.oc + " out · hatched = padding",
        118, L.top + L.box + 112, 15, PAL.muted, "left", true);

    drawArray(x, e, geo, p, at, colour, fast, L);
    drawInset(x, e, geo, colour, dim, L);
  }

  root.FeatherDpuConvView = {draw: draw, plan: plan, HW: HW, setPalette: setPalette};
})(window);
