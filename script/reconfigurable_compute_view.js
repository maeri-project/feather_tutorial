(function() {
    "use strict";
    const data = window.ReconfigurableComputeData, model = window.ReconfigurableComputeModel;
    const $ = id => document.getElementById(`rc-${id}`);
    const keys = ["reuse", "outputs"], fmt = n => n.toLocaleString("en-US");
    const state = {phase: "decode", step: 15, playing: false, policy: "outputs", row: 4, col: 0, speed: 6};
    const geometry = {w: 600, h: 592, x: 64, y: 88, pitch: 28};
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, lastTime = 0, lastInspector = -1;
    const record = key => data.records[state.phase][key];
    const selected = () => state.phase === "prefill" ? "reuse" : "outputs";
    function text(ctx, value, x, y, color, size = 12, align = "left", weight = "500") {
        ctx.fillStyle = color; ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
        ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(value, x, y);
    }
    function round(ctx, x, y, w, h, radius, fill, stroke) {
        ctx.beginPath(); ctx.roundRect(x, y, w, h, radius);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function draw(key) {
        const canvas = $(`canvas-${key}`), ctx = canvas.getContext("2d"), r = record(key);
        const {w, h, x, y, pitch} = geometry;
        const scale = Math.max(2, Math.ceil((devicePixelRatio || 1) * canvas.clientWidth / w));
        if (canvas.width !== w * scale || canvas.height !== h * scale) {
            canvas.width = w * scale; canvas.height = h * scale;
        }
        ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.clearRect(0, 0, w, h);
        const dark = document.documentElement.dataset.theme === "dark";
        const palette = dark ? {fg: "#e5edf7", muted: "#aab8ca", green: "#143e35", gold: "#45391e", greenLine: "#409c7c", goldLine: "#bb9849", idle: "#242c39", idleText: "#738399", blue: "#70b8ff"}
            : {fg: "#203047", muted: "#526278", green: "#d5eee3", gold: "#f2e6c6", greenLine: "#198067", goldLine: "#a37e23", idle: "#e9edf2", idleText: "#7b8797", blue: "#0875c1"};
        text(ctx, "INPUT STREAMS  I[m, k]  ↓", x, 12, palette.blue, 11, "left", "700");
        text(ctx, "PE cell = output channel n", x + pitch * 16, 12, palette.muted, 10, "right");
        for (let half = 0; half < 2; half++) {
            round(ctx, x + half * pitch * 8, 27, pitch * 8 - 3, 22, 5,
                half ? palette.gold : palette.green, null);
            text(ctx, `Weights for K[${half * 16}:${(half + 1) * 16})`, x + half * pitch * 8 + 110, 38, palette.fg, 11, "center");
        }
        const topDot = Math.min(r.ES.T - 1, Math.floor(state.step / 16));
        for (let col = 0; col < 16; col++) {
            const o = model.owner(r, 0, col, topDot), cx = x + col * pitch + pitch / 2;
            text(ctx, o.valid ? `m${o.m}` : "—", cx, 63, o.valid ? palette.blue : palette.idleText, 10, "center", "600");
            ctx.strokeStyle = o.valid ? palette.blue : palette.idleText;
            ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(cx, 73); ctx.lineTo(cx, y - 3); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - 3, y - 7); ctx.lineTo(cx, y - 3); ctx.lineTo(cx + 3, y - 7); ctx.stroke(); ctx.globalAlpha = 1;
        }
        text(ctx, "row", x - 21, y - 12, palette.muted, 10, "center");
        const frames = model.frame(r, state.step);
        for (const cell of frames) {
            const px = x + cell.col * pitch, py = y + cell.row * pitch;
            const isSelected = state.policy === key && state.row === cell.row && state.col === cell.col;
            const half = cell.kg === 1;
            if (cell.row === 0 && cell.col && cell.col % r.EM.G_c === 0) {
                ctx.strokeStyle = palette.muted; ctx.globalAlpha = cell.col === 8 ? .65 : .17;
                ctx.beginPath(); ctx.moveTo(px - 2, y - 2); ctx.lineTo(px - 2, y + 16 * pitch - 1); ctx.stroke(); ctx.globalAlpha = 1;
            }
            ctx.lineWidth = isSelected ? 2.5 : .65;
            round(ctx, px + 1, py + 1, pitch - 4, pitch - 4, 3,
                !cell.valid ? palette.idle : half ? palette.gold : palette.green,
                isSelected ? palette.blue : cell.valid ? half ? palette.goldLine : palette.greenLine : null);
            ctx.lineWidth = 1;
            text(ctx, cell.n, px + 12, py + 12, cell.valid ? palette.fg : palette.idleText, 10, "center", cell.active ? "700" : "400");
            if (cell.active) {
                // A scalar advances one PE row per teaching step. The selected
                // PE's k and m are exposed in the inspector; weights never move.
                const sub = reducedMotion.matches ? 0 : state.step % 1;
                ctx.fillStyle = palette.blue;
                ctx.beginPath(); ctx.arc(px + 23, py + 2 + sub * 23, 2.6, 0, Math.PI * 2); ctx.fill();
                ctx.fillRect(px + 5, py + 21, 15 * (cell.lane + 1) / 16, 1.8);
            }
            if (cell.col === 0) text(ctx, cell.row, x - 14, py + 13, palette.muted, 10, "center");
        }
        for (let col = 0; col < 16; col++) text(ctx, col, x + col * pitch + 12, y + pitch * 16 + 11, palette.muted, 9, "center");
        text(ctx, "col", x - 14, y + pitch * 16 + 11, palette.muted, 9, "center");
        text(ctx, "Two K halves → BIRRD sum → output accumulation", x, 577, palette.muted, 11);
    }
    function inspector() {
        const r = record(state.policy), o = model.at(r, state.row, state.col, state.step);
        $("pe-title").textContent = `Mapping ${state.policy === "reuse" ? "A" : "B"} · PE (${state.row}, ${state.col})`;
        $("pe-owner").textContent = `Resident W[${o.kStart}:${o.kStart + 16}, ${o.n}] · partial result for O[${o.m}, ${o.n}].`;
        $("pe-stream").textContent = o.valid
            ? `Column ${state.col} forwards I[m, k] through all 16 PE rows. This PE uses token m=${o.m}; the next row reuses the same input with a different weight vector.`
            : `Token m=${o.m} does not exist in this decode tile. The weight slots are occupied, but this PE has no useful dot product.`;
        $("weight-slots").replaceChildren(...Array.from({length: 16}, (_, i) => {
            const slot = document.createElement("div"); slot.className = "rc-slot";
            slot.dataset.active = o.active && o.lane === i;
            const label = document.createElement("small"); label.textContent = `k${o.kStart + i}`;
            slot.append(label, String(model.weight(o.kStart + i, o.n))); return slot;
        }));
        $("equation").textContent = o.active
            ? `I[${o.m}, ${o.k}] × W[${o.k}, ${o.n}] = ${o.input} × ${o.weight} = ${o.input * o.weight}. Local sum through k=${o.k}: ${o.sum}.`
            : !o.valid ? "No useful input: this PE contributes no valid output."
            : state.step < state.row ? "Waiting for the first input scalar to reach this PE."
            : `Local dot complete: ${o.sum}. BIRRD adds the matching partial from column ${(state.col + 8) % 16}.`;
    }
    function metrics(key) {
        const r = record(key);
        $(`metrics-${key}`).innerHTML = `<div><strong>${r.mappedPEs}<small> / 256</small></strong><span>Useful PE owners per dot</span></div><div><strong>${r.tile.N}</strong><span>Output channels per mapping</span></div>`;
        $(`selected-${key}`).hidden = selected() !== key;
        $(`card-${key}`).dataset.selected = selected() === key;
    }
    function render(full = false) {
        for (const key of keys) draw(key);
        const step = Math.floor(state.step), max = model.end(record("reuse"));
        $("scrub").value = step;
        $("step-label").textContent = `${step} / ${max}`;
        if (full || lastInspector !== step) { inspector(); lastInspector = step; }
    }
    function stop() {
        state.playing = false; cancelAnimationFrame(raf); raf = 0; lastTime = 0;
        $("play").textContent = "Play";
    }
    function tick(time) {
        if (!state.playing) return;
        if (lastTime) state.step = Math.min(model.end(record("reuse")), state.step + Math.min(.2, (time - lastTime) / 1000) * state.speed);
        lastTime = time; render();
        if (state.step >= model.end(record("reuse"))) stop();
        else raf = requestAnimationFrame(tick);
    }
    function phase(phase) {
        stop(); state.phase = phase; state.step = 15;
        $("prefill").setAttribute("aria-pressed", phase === "prefill");
        $("decode").setAttribute("aria-pressed", phase === "decode");
        $("shape").textContent = `q_proj · ${phase === "prefill" ? "768" : "1"} × 1,024 × 2,048`;
        $("takeaway").textContent = phase === "decode"
            ? "One token cannot use four replicas. Mapping B doubles useful PE ownership from 64 to 128 and needs half as many mappings: 1.74× faster in the program model."
            : "768 tokens can reuse the weights. Mapping A serves 32 tokens per weight tile, keeping all 256 PE owners useful while halving weight traffic: 1.05× faster in the program model.";
        $("scrub").max = model.end(record("reuse"));
        for (const key of keys) metrics(key);
        components(); render(true);
    }
    function performance() {
        const pre = data.records.prefill, dec = data.records.decode;
        const rows = [
            ["Keep A for both phases", pre.reuse, dec.reuse, false],
            ["Keep B for both phases", pre.outputs, dec.outputs, false],
            ["Reconfigure: A → B", pre.reuse, dec.outputs, true],
        ];
        $("performance-rows").innerHTML = rows.map(([name, a, b, adaptive]) => {
            return `<tr${adaptive ? ' class="rc-adaptive"' : ""}><th scope="row">${name}</th>${[a, b].map((r, i) => {
                const maximum = i ? dec.reuse.cost.total_cycles : pre.outputs.cost.total_cycles;
                return `<td>${fmt(r.cost.total_cycles)}<div class="rc-costbar"><i style="width:${100 * r.cost.total_cycles / maximum}%"></i></div><small>${fmt(r.cost.mapping_count)} mapping invocations</small></td>`;
            }).join("")}</tr>`;
        }).join("");
        const decodeSaving = 100 * (1 - dec.outputs.cost.total_cycles / dec.reuse.cost.total_cycles);
        const prefillSaving = 100 * (1 - pre.reuse.cost.total_cycles / pre.outputs.cost.total_cycles);
        $("savings").textContent = `Switching avoids the slower choice in each phase: ${prefillSaving.toFixed(1)}% fewer prefill cycles than keeping B, and ${decodeSaving.toFixed(1)}% fewer decode cycles than keeping A. Bar lengths compare policies within each phase; the two phases have different amounts of work.`;
    }
    function components() {
        const fields = [["load_w_cycles", "Weight transfer"], ["load_in_cycles", "Input transfer"],
            ["weight_preload_cycles", "PE weight preload"], ["stream_cycles", "Streaming"],
            ["gap_cycles", "Inter-dot gaps"], ["drain_cycles", "Pipeline drain"], ["prime_cycles", "Prime"],
            ["dispatch_cycles", "Instruction dispatch"], ["store_cycles", "Output store"], ["total_cycles", "Total"]];
        $("components").innerHTML = fields.map(([key, label]) => `<tr><th scope="row">${label}</th>${keys.map(k => `<td>${fmt(record(k).cost[key])}</td>`).join("")}</tr>`).join("");
    }
    function selectPE(key, row, col) {
        state.policy = key; state.row = row; state.col = col;
        $("inspect-policy").value = key; $("inspect-row").value = row; $("inspect-col").value = col;
        render(true);
    }
    for (const axis of ["row", "col"]) {
        for (let i = 0; i < 16; i++) $("inspect-" + axis).add(new Option(String(i), i));
        $("inspect-" + axis).value = state[axis];
        $("inspect-" + axis).addEventListener("change", e => { state[axis] = Number(e.target.value); render(true); });
    }
    $("inspect-policy").addEventListener("change", e => { state.policy = e.target.value; render(true); });
    $("prefill").addEventListener("click", () => phase("prefill"));
    $("decode").addEventListener("click", () => phase("decode"));
    $("play").addEventListener("click", () => {
        if (state.playing) { stop(); return; }
        if (state.step >= model.end(record("reuse"))) state.step = 0;
        state.playing = true; $("play").textContent = "Pause"; raf = requestAnimationFrame(tick);
    });
    $("reset").addEventListener("click", () => { stop(); state.step = 0; render(true); });
    $("step").addEventListener("click", () => { stop(); state.step = Math.min(model.end(record("reuse")), Math.floor(state.step) + 1); render(true); });
    $("scrub").addEventListener("input", e => { stop(); state.step = Number(e.target.value); render(true); });
    $("speed").addEventListener("change", e => { state.speed = Number(e.target.value); });
    for (const key of keys) {
        const canvas = $(`canvas-${key}`);
        canvas.addEventListener("click", e => {
            const rect = canvas.getBoundingClientRect();
            const col = Math.floor(((e.clientX - rect.left) * geometry.w / rect.width - geometry.x) / geometry.pitch);
            const row = Math.floor(((e.clientY - rect.top) * geometry.h / rect.height - geometry.y) / geometry.pitch);
            if (row >= 0 && row < 16 && col >= 0 && col < 16) selectPE(key, row, col);
        });
        canvas.addEventListener("keydown", e => {
            const move = {ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]}[e.key];
            if (move) { e.preventDefault(); selectPE(key, Math.max(0, Math.min(15, state.row + move[0])), Math.max(0, Math.min(15, state.col + move[1]))); }
        });
        new ResizeObserver(() => render(true)).observe(canvas);
    }
    new MutationObserver(() => render(true)).observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
    document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
    // No autoplay. A reduced-motion preference keeps deliberate playback
    // discrete by removing fractional packet movement between steps.
    reducedMotion.addEventListener("change", () => { stop(); render(true); });
    performance(); phase("decode");
    window.ReconfigurableCompute = {inspect: () => ({...state}), selectPhase: phase};
})();
