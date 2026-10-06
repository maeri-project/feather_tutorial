(function () {
    "use strict";

    const model = window.FeatherComparisonModel;
    const byId = id => document.getElementById(`comparison-${id}`);
    if (!model) {
        byId("model-error").textContent = "The comparison model could not be loaded. Serve this page together with its script directory.";
        byId("model-error").hidden = false;
        return;
    }

    const colors = {input: "#004c99", weight: "#006633", partial: "#4c0099", result: "#990000"};
    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const grid = {x: 112, y: 126, step: 25, size: 21};
    const canvasSizes = {sa: {width: 640, height: 660}, feather: {width: 640, height: 660}, bridge: {width: 1240, height: 580}};
    const elementColors = ["#245bc2", "#a63232", "#16754e", "#7845b3", "#a94d00", "#00778a", "#a02d78", "#586d16", "#494db0", "#956024", "#00695c", "#8c3e62"];
    const names = {os: "Output-stationary", ws: "Weight-stationary", is: "Input-stationary", best: "Best modeled stationary mapping"};
    const state = {
        presetId: "irregular-batch", baseline: "os", scope: "layer", layerIndex: 0,
        cycle: 0, fraction: 0, playing: false, speed: 4, request: null, lastTime: 0,
        chain: null, boundaryIndex: 0, bridgeProgress: 0, bridgePlaying: false,
        bridgeRequest: null, bridgeStart: 0, boards: {}, bridge: {}, hover: null,
        bridgeElement: null, bridgeBoundary: null
    };

    function escape(text) {
        return String(text).replace(/[&<>"']/g, char => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[char]));
    }
    function number(value) { return Number(value || 0).toLocaleString("en-US", {maximumFractionDigits: 4}); }
    function percent(value) { return `${(100 * (value || 0)).toFixed(1)}%`; }
    function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
    function shapeText(shape) { return `${shape.M}×${shape.K}×${shape.N}`; }
    function theme() {
        const style = getComputedStyle(document.documentElement);
        return {text: style.getPropertyValue("--text-main").trim(), muted: style.getPropertyValue("--text-muted").trim(),
            line: style.getPropertyValue("--border-color").trim(), background: style.getPropertyValue("--bg-body").trim(),
            card: style.getPropertyValue("--bg-card").trim(), dark: document.documentElement.dataset.theme === "dark"};
    }
    function maxCycle() {
        if (state.scope === "chain") return Math.max(0, state.chain.cycles - 1);
        const layer = state.chain.layers[state.layerIndex];
        return Math.max(0, layer.systolic.cycles - 1, layer.feather.cycles - 1);
    }
    function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
    function setOptions(id, entries, value) {
        const select = byId(id);
        select.replaceChildren(...entries.map(entry => option(entry[0], entry[1])));
        select.value = value;
    }
    function configuredOptions() {
        return {baseline: state.baseline, layoutMode: byId("layout-mode").value,
            bandwidth: clamp(Math.round(Number(byId("bandwidth").value) || 1), 1, 256),
            configCycles: clamp(Math.round(Number(byId("config").value) || 0), 0, 64),
            compatible: byId("compatible").checked};
    }
    function stopBridge() {
        state.bridgePlaying = false;
        if (state.bridgeRequest !== null) cancelAnimationFrame(state.bridgeRequest);
        state.bridgeRequest = null;
        byId("layout-play").textContent = "Animate layout bridge";
    }
    function pause() {
        state.playing = false;
        if (state.request !== null) cancelAnimationFrame(state.request);
        state.request = null;
        byId("play").textContent = "Play";
        byId("play").setAttribute("aria-pressed", "false");
    }
    function rebuild() {
        pause(); stopBridge();
        state.chain = model.build(state.presetId, configuredOptions());
        byId("bandwidth").value = state.chain.options.bandwidth;
        byId("config").value = state.chain.options.configCycles;
        state.layerIndex = clamp(state.layerIndex, 0, state.chain.layers.length - 1);
        state.boundaryIndex = clamp(state.boundaryIndex, 0, Math.max(0, state.chain.boundaries.length - 1));
        state.cycle = 0; state.fraction = 0; state.bridgeProgress = 0;
        setOptions("layer", state.chain.layers.map((layer, i) => [i, `GEMM ${i + 1} · ${shapeText(layer.shape)}`]), state.layerIndex);
        setOptions("boundary", state.chain.boundaries.map((boundary, i) => [i,
            `GEMM ${i + 1} → GEMM ${i + 2} · ${boundary.changedElements ? `${boundary.changedElements}/${boundary.elements} addresses change` : "same layout"}`]), state.boundaryIndex);
        byId("boundary").disabled = !state.chain.boundaries.length;
        byId("layout-play").disabled = !state.chain.boundaries.length;
        renderChain(); render(); renderBridge();
    }

    function location(kind) {
        if (state.scope === "chain") return model.locate(state.chain, kind, state.cycle);
        const run = state.chain.layers[state.layerIndex][kind];
        const finished = state.cycle >= run.cycles;
        const snapshot = model.snapshot(run, state.cycle);
        return {layerIndex: state.layerIndex, localCycle: state.cycle, phase: finished ? "complete" : snapshot.phase,
            snapshot: finished ? {...snapshot, active: 0, macs: [], partials: [], network: [], writes: [], pe: snapshot.pe.map(pe => ({...pe, active: false}))} : snapshot, progress: 0};
    }
    function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
        ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }
    function canvasContext(id, height = canvasSizes[id].height) {
        const canvas = byId(id), size = canvasSizes[id];
        if (size.height !== height) {
            size.height = height;
            canvas.style.aspectRatio = `${size.width} / ${height}`;
        }
        const display = canvas.getBoundingClientRect();
        const scale = Math.max(2, (window.devicePixelRatio || 1) * display.width / size.width);
        const width = Math.ceil(size.width * scale), pixelHeight = Math.ceil(size.height * scale);
        if (canvas.width !== width || canvas.height !== pixelHeight) {
            canvas.width = width; canvas.height = pixelHeight;
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(canvas.width / size.width, 0, 0, canvas.height / size.height, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);
        return ctx;
    }
    function canvasPoint(id, event) {
        const rect = byId(id).getBoundingClientRect(), size = canvasSizes[id];
        return {x: (event.clientX - rect.left) * size.width / rect.width, y: (event.clientY - rect.top) * size.height / rect.height};
    }
    function label(ctx, text, x, y, size, color, align = "left", weight = 400) {
        ctx.fillStyle = color; ctx.font = `${weight} ${size}px Inter, sans-serif`; ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillText(text, x, y);
    }
    function point(row, col) { return {x: grid.x + col * grid.step + grid.size / 2, y: grid.y + row * grid.step + grid.size / 2}; }
    function line(ctx, points, color, width = 1) {
        ctx.beginPath(); points.forEach((p, index) => index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
    }
    function along(points, progress) {
        const lengths = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));
        const total = lengths.reduce((sum, value) => sum + value, 0);
        let distance = clamp(progress, 0, 1) * total;
        for (let i = 0; i < lengths.length; i++) {
            if (distance <= lengths[i] || i === lengths.length - 1) {
                const t = lengths[i] ? Math.min(1, distance / lengths[i]) : 1;
                return {x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t};
            }
            distance -= lengths[i];
        }
        return points[0];
    }
    function token(ctx, tokens, kind, points, progress, identity, radius = 4) {
        const pos = along(points, progress);
        ctx.fillStyle = colors[kind]; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = .9;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        tokens.push({...identity, kind, color: colors[kind], x: pos.x, y: pos.y});
    }
    function metric(labelText, value, suffix) {
        return `<div class="comparison-metric"><span>${escape(labelText)}</span><strong>${escape(value)}${suffix ? ` <small>${escape(suffix)}</small>` : ""}</strong></div>`;
    }

    function drawBoard(kind) {
        const id = kind === "systolic" ? "sa" : "feather";
        const canvas = byId(id), ctx = canvasContext(id), palette = theme();
        const loc = location(kind);
        const layerIndex = clamp(loc.layerIndex ?? state.layerIndex, 0, state.chain.layers.length - 1);
        const layer = state.chain.layers[layerIndex], run = layer[kind];
        const snapshot = loc.snapshot || model.snapshot(run, loc.localCycle ?? 0);
        const isComputing = !["done", "complete", "layout copy", "configure RIR"].includes(loc.phase);
        const macs = isComputing ? snapshot.macs || [] : [];
        const partials = isComputing ? snapshot.partials || [] : [];
        const network = isComputing ? snapshot.network || [] : [];
        const writes = isComputing ? snapshot.writes || [] : [];
        const tokens = [], feather = kind === "feather";
        const packetFraction = motionPreference.matches ? .85 : state.fraction;
        const phase = loc.phase === "compute" ? snapshot.phase : loc.phase;
        ctx.fillStyle = palette.background; ctx.fillRect(0, 0, canvasSizes[id].width, canvasSizes[id].height);
        roundedRect(ctx, 108, 20, 408, 37, 6, run.kind === "is" ? colors.input : colors.weight, null);
        label(ctx, run.kind === "is" ? "RESIDENT INPUT A[m,k]" : (feather || run.kind === "ws") ? "RESIDENT WEIGHTS B[k,n]" : "WEIGHT SOURCE B[k,n] · STREAMED", 312, 38, 10, "#fff", "center", 600);
        label(ctx, `GEMM ${layerIndex + 1} · ${shapeText(layer.shape)} · local cycle ${loc.localCycle ?? state.cycle}`, 312, 78, 11, palette.text, "center", 600);
        label(ctx, feather ? "NEST · 16 rows × 16 columns" : "SYSTOLIC · 16 rows × 16 columns", 312, 99, 10, palette.muted, "center");
        roundedRect(ctx, 15, 128, 53, 392, 6, run.kind === "is" ? colors.weight : colors.input, null);
        ctx.save(); ctx.translate(41, 324); ctx.rotate(-Math.PI / 2); label(ctx, run.kind === "is" ? "STREAMING WEIGHTS B[k,n]" : "STREAMING INPUT A[m,k]", 0, 0, 11, "#fff", "center", 600); ctx.restore();
        for (let index = 0; index < 16; index++) {
            const p = point(index, index);
            label(ctx, index, grid.x - 13, p.y, 8, palette.muted, "right");
            label(ctx, index, p.x, grid.y - 11, 8, palette.muted, "center");
            line(ctx, [{x: p.x, y: 57}, {x: p.x, y: 67}], palette.line);
        }
        const peList = snapshot.pe || [];
        for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) {
            const pe = peList[row * 16 + col] || {row, col};
            const active = isComputing && !!pe.active;
            const x = grid.x + col * grid.step, y = grid.y + row * grid.step;
            const fill = active ? colors.partial : pe.mapped ? (palette.dark ? "#143e35" : "#c8e5d8") : palette.card;
            roundedRect(ctx, x, y, grid.size, grid.size, 3, fill, active ? "#9a76cb" : palette.line);
            if (active) label(ctx, "×+", x + grid.size / 2, y + grid.size / 2, 8, "#fff", "center", 600);
            else if (pe.mapped) label(ctx, "·", x + grid.size / 2, y + grid.size / 2, 10, palette.muted, "center");
            if (feather) {
                const bx = x + grid.size + 2;
                line(ctx, [{x: x + grid.size - 2, y: y + grid.size - 2}, {x: bx, y: y + grid.size + 1}], palette.line, .7);
            }
        }
        if (feather) {
            line(ctx, [{x: 68, y: 140}, {x: 78, y: 114}, {x: 507, y: 114}], colors.input, 1.3);
            for (let col = 0; col < 16; col++) {
                const bx = grid.x + col * grid.step + grid.size + 2;
                line(ctx, [{x: bx, y: grid.y + 13}, {x: bx, y: 542}], palette.line, .8);
            }
            label(ctx, "COLUMN BUSES → BIRRD (8 stages)", 312, 552, 9, palette.muted, "center");
            line(ctx, [{x: 121, y: 577}, {x: 502, y: 577}], palette.line, 2);
            for (let stage = 0; stage < 8; stage++) {
                roundedRect(ctx, 114 + stage * 51, 566, 32, 23, 4, palette.card, palette.line);
                label(ctx, `s${stage}`, 130 + stage * 51, 577, 8, palette.muted, "center");
            }
        } else {
            label(ctx, "Stationary mapping determines spatial dimensions", 312, 551, 9, palette.muted, "center");
            line(ctx, [{x: 123, y: 536}, {x: 123, y: 583}, {x: 500, y: 583}], palette.line, 1.5);
            label(ctx, "ACCUMULATE / DRAIN", 312, 572, 10, palette.muted, "center");
        }
        roundedRect(ctx, 109, 606, 408, 35, 6, colors.result, null);
        label(ctx, `OUTPUT C[m,n] · ${(snapshot.completedOutputs || []).length}/${layer.shape.M * layer.shape.N} written`, 313, 623, 10, "#fff", "center", 600);

        for (const event of macs) {
            const p = point(event.row, event.col);
            const identity = {row: event.row, col: event.col, m: event.m, k: event.k, n: event.n, layerIndex};
            const sourceA = feather ? {x: p.x, y: p.y - grid.step} : {x: event.col ? p.x - grid.step : 70, y: p.y};
            const inputPath = feather && !event.row ? [{x: 68, y: 140}, {x: 78, y: 114}, {x: p.x, y: 114}, p] : [sourceA, p];
            if (run.kind !== "is") token(ctx, tokens, "input", inputPath, packetFraction, {...identity, id: `A:${event.m}:${event.k}`, value: event.a}, macs.length > 100 ? 2.8 : 3.8);
            // The selected systolic mode may keep A or B stationary. Only its moving operand gets a packet.
            if (!feather && run.kind !== "ws") {
                token(ctx, tokens, "weight", [{x: p.x, y: event.row ? p.y - grid.step : 94}, p], packetFraction,
                    {...identity, id: `B:${event.k}:${event.n}`, value: event.b}, macs.length > 100 ? 2.8 : 3.8);
            }
        }
        for (const event of partials) {
            const row = clamp(event.row || 0, 0, 15), col = clamp(event.col || 0, 0, 15), p = point(row, col);
            const bx = grid.x + col * grid.step + grid.size + 2;
            const path = feather ? [p, {x: bx, y: p.y + 13}, {x: bx, y: 542}, {x: 130, y: 577}] : [p, {x: p.x, y: 583}];
            token(ctx, tokens, "partial", path, packetFraction, {...event, layerIndex, id: `P:${event.m}:${event.n}:${row}:${col}`}, 4);
        }
        for (const event of network) {
            const stage = clamp(event.stage || 0, 0, 7), y = 577 + ((event.row || 0) % 3 - 1) * 4;
            token(ctx, tokens, "partial", [{x: 106 + stage * 51, y}, {x: 141 + stage * 51, y}], packetFraction,
                {...event, layerIndex, id: `BIRRD:${event.group}:${event.row}:${stage}`}, 3.6);
        }
        for (const event of writes) {
            const x = 122 + (event.index % 16) * 25;
            token(ctx, tokens, event.final ? "result" : "partial", [{x: feather ? 493 : x, y: feather ? 577 : 583}, {x, y: 605}, {x, y: 623}], packetFraction,
                {...event, layerIndex, id: `C:${event.m}:${event.n}`}, 4.5);
        }
        const sample = macs[0];
        label(ctx, sample ? `A[${sample.m},${sample.k}]=${number(sample.a)}  ×  B[${sample.k},${sample.n}]=${number(sample.b)}` : `${macs.length ? "Useful MAC activity" : "No useful MAC on this tick"} · ${phase || "ready"}`, 312, 652, 9, palette.muted, "center");
        canvas.dataset.peCount = "256";
        canvas.dataset.active = macs.length;
        canvas.dataset.mapped = peList.filter(pe => pe.mapped).length;
        canvas.dataset.cycle = state.cycle;
        canvas.dataset.phase = phase || "ready";
        canvas.dataset.tokens = JSON.stringify(tokens);
        byId(`${id}-phase`).textContent = phase || "ready";
        byId(`${id}-name`).textContent = feather ? "Compiler-selected WO mapping" : names[run.kind] || run.name;
        byId(`${id}-mapping`).textContent = snapshot.mappingLabel || run.mappingLabel;
        byId(`${id}-metrics`).innerHTML = metric("Mapped PEs · maximum spatial slots", number(run.mappedPEs), "/ 256") +
            metric("Instantaneous useful MACs", number(macs.length), "/ tick") + metric("Peak useful MACs", number(run.peakActive), "/ tick") +
            metric("Integrated MAC utilization", percent(run.utilization), `${number(run.cycles)} cycles`);
        byId(`${id}-caption`).textContent = ["layout copy", "configure RIR"].includes(loc.phase) ?
            `GEMM ${layerIndex + 1} boundary: ${loc.phase}. These are editable hypothetical layout/configuration cycles; no MACs are issued.` :
            `GEMM ${layerIndex + 1}: ${number(run.macs)} useful MACs. ${number(macs.length)} now, ${partials.length} partial transfers, ${network.length} network-stage events, ${writes.length} writes. ${feather ? "Purple links use the column buses and BIRRD." : "PE coordinates depend on the chosen stationary mapping."}`;
        state.boards[kind] = {location: loc, snapshot, tokens, layerIndex};
    }

    function matrixValue(matrix, row, col, columns) {
        return Array.isArray(matrix[row]) || ArrayBuffer.isView(matrix[row]) ? matrix[row][col] : matrix[row * columns + col];
    }
    function renderNumeric() {
        const layer = state.chain.layers[state.layerIndex], shape = layer.shape;
        const m = clamp(Math.floor(Number(byId("output-m").value) || 0), 0, shape.M - 1);
        const n = clamp(Math.floor(Number(byId("output-n").value) || 0), 0, shape.N - 1);
        byId("output-m").max = shape.M - 1; byId("output-n").max = shape.N - 1;
        byId("output-m").value = m; byId("output-n").value = n;
        const terms = [];
        let total = 0;
        for (let k = 0; k < shape.K; k++) {
            const a = matrixValue(layer.input, m, k, shape.K), b = matrixValue(layer.weights, k, n, shape.N);
            total = Math.fround(total + Math.fround(a * b));
            if (k < 6) terms.push(`${number(a)}×${number(b)}`);
        }
        const systolicValue = matrixValue(layer.systolic.output, m, n, shape.N);
        const featherValue = matrixValue(layer.feather.output, m, n, shape.N);
        byId("numeric-result").innerHTML = `C[${m},${n}] = ${terms.join(" + ")}${shape.K > 6 ? ` + … (${shape.K} terms)` : ""}<br>` +
            `Systolic = <span class="comparison-value">${number(systolicValue)}</span> &nbsp; FEATHER = <span class="comparison-value">${number(featherValue)}</span><br>` +
            `Independent dot-product oracle = ${number(total)} &nbsp; ${total === systolicValue && total === featherValue ? "✓ all agree" : "⚠ mismatch"}`;
        byId("numeric-result").dataset.m = m; byId("numeric-result").dataset.n = n;
        byId("numeric-result").dataset.systolic = systolicValue; byId("numeric-result").dataset.feather = featherValue;
        byId("numeric-result").dataset.oracle = total;
    }
    function summary(title, value, detail) {
        return `<div class="comparison-summary"><span>${escape(title)}</span><strong>${escape(value)}</strong><small>${escape(detail)}</small></div>`;
    }
    function mappingSummary(run, layer) {
        const labels = [...new Set(run.segments.map(segment => segment.mappingLabel))];
        const visible = labels.map(text => `<span class="comparison-mapping-choice">${escape(text)}</span>`).join("");
        if (run.kind !== "feather") return visible;
        const seen = new Set(), descriptors = [];
        for (const segment of run.segments) {
            const descriptor = {EM: segment.EM, ES: segment.ES};
            const key = JSON.stringify(descriptor);
            if (seen.has(key)) continue;
            seen.add(key);
            descriptors.push(`<div><strong>${escape(segment.mappingLabel)}</strong><br>EM ${escape(JSON.stringify(segment.EM))}<br>ES ${escape(JSON.stringify(segment.ES))}</div>`);
        }
        const tile = layer.record.tile;
        return `${visible}<details class="comparison-mapping-details"><summary>Tile + exact EM/ES choices</summary>` +
            `<div>Tile Mt×Kt×Nt = ${tile.Mt}×${tile.Kt}×${tile.Nt}; unique choices in execution order.</div>${descriptors.join("")}</details>`;
    }
    function performanceSummary(run, layer) {
        const dataflow = run.kind === "feather" ? "Weight-stationary (WO-S)" : `${names[run.kind]} (${run.kind.toUpperCase()})`;
        return `<dl class="comparison-performance"><div class="comparison-performance-dataflow"><dt>Dataflow</dt><dd>${escape(dataflow)}</dd></div>` +
            `<div><dt>Modeled cycles</dt><dd>${number(run.cycles)}</dd></div>` +
            `<div><dt>PE utilization</dt><dd>${percent(run.utilization)}</dd></div></dl>` +
            `<details class="comparison-performance-mapping"><summary>Mapping details</summary><div>${mappingSummary(run, layer)}</div></details>`;
    }
    function renderChain() {
        const rows = byId("chain-rows"); rows.replaceChildren();
        state.chain.layers.forEach((layer, index) => {
            const tr = document.createElement("tr"); tr.dataset.layer = index;
            tr.innerHTML = `<td><button type="button">GEMM ${index + 1}<br>${escape(shapeText(layer.shape))}</button></td>` +
                `<td>${performanceSummary(layer.systolic, layer)}</td>` +
                `<td>${performanceSummary(layer.feather, layer)}</td>`;
            tr.querySelector("button").addEventListener("click", () => selectLayer(index)); rows.append(tr);
        });
        const sa = state.chain.totals.systolic, feather = state.chain.totals.feather;
        byId("chain-summary").innerHTML = summary("Systolic chain · illustrative total", `${number(sa.cycles)} cycles`, `${number(sa.computeCycles)} compute/drain + ${number(sa.copyCycles)} repack + ${number(sa.configCycles)} configuration`) +
            summary("FEATHER chain · illustrative total", `${number(feather.cycles)} cycles`, `${number(feather.computeCycles)} compute/drain + ${number(feather.copyCycles)} repack + ${number(feather.configCycles)} configuration`) +
            summary("Identical useful mathematical work", `${number(sa.macs)} MACs`, `Including hypothetical boundaries: SA ${percent(sa.utilization)}, FEATHER ${percent(feather.utilization)}. Not measured throughput.`);
    }
    function updateSelected() {
        for (const node of document.querySelectorAll("#comparison-chain-rows [data-layer]")) {
            const selected = Number(node.dataset.layer) === state.layerIndex;
            node.classList.toggle("is-selected", selected);
        }
    }
    function render() {
        byId("scrub").max = maxCycle(); byId("scrub").value = state.cycle;
        byId("cycle").textContent = `${state.cycle} / ${maxCycle()}`;
        byId("clock-note").textContent = state.scope === "chain" ? "One shared clock; each architecture advances to its next layer when ready. Layout/configuration costs follow the editable assumptions below." : "Both arrays start this GEMM at cycle 0. One may finish while the other is still active. Weight preload and physical FP16 latency are omitted.";
        drawBoard("systolic"); drawBoard("feather"); renderNumeric(); updateSelected();
    }
    function selectLayer(index) {
        pause(); state.layerIndex = clamp(Number(index) || 0, 0, state.chain.layers.length - 1);
        state.cycle = 0; state.fraction = 0; byId("layer").value = state.layerIndex;
        state.scope = "layer";
        state.boundaryIndex = Math.min(state.layerIndex, state.chain.boundaries.length - 1);
        byId("boundary").value = state.boundaryIndex;
        stopBridge(); state.bridgeProgress = 0; render(); renderBridge();
    }
    function seek(cycle, fraction = 0) {
        pause(); state.cycle = clamp(Math.floor(Number(cycle) || 0), 0, maxCycle());
        state.fraction = clamp(Number(fraction) || 0, 0, .999999); render();
    }
    function tick(now) {
        if (!state.playing) return;
        const elapsed = Math.min(1000, now - state.lastTime); state.lastTime = now;
        const position = state.cycle + state.fraction + elapsed * state.speed / 1000;
        if (position >= maxCycle() + 1) { state.cycle = maxCycle(); state.fraction = .999; pause(); render(); return; }
        state.cycle = Math.floor(position); state.fraction = position - state.cycle;
        render(); state.request = requestAnimationFrame(tick);
    }
    function play() {
        if (state.playing) return;
        stopBridge();
        if (state.cycle >= maxCycle()) { state.cycle = 0; state.fraction = 0; }
        state.playing = true; state.lastTime = performance.now(); byId("play").textContent = "Pause"; byId("play").setAttribute("aria-pressed", "true");
        state.request = requestAnimationFrame(tick);
    }
    function bridgeCellPosition(cell, side) {
        return {x: (side === "source" ? 44 : 750) + cell.bank * 28 + 13, y: 126 + cell.row * 24 + 11, height: 24};
    }
    function bridgeStyle(cell, sample) {
        const sampleIndex = sample.findIndex(item => item.index === cell.index);
        return {label: String(cell.index), color: elementColors[(sampleIndex < 0 ? cell.index : sampleIndex) % elementColors.length]};
    }
    function bridgeTile(ctx, position, style, outline) {
        roundedRect(ctx, position.x - 13, position.y - 10, 26, 21, 3, style.color, null);
        label(ctx, style.label, position.x, position.y + .5, 10, "#fff", "center", 600);
        if (outline) {
            ctx.strokeStyle = outline; ctx.lineWidth = 2;
            ctx.strokeRect(position.x - 15, position.y - 12, 30, 25);
        }
    }
    function renderBridge() {
        const boundary = state.chain.boundaries[state.boundaryIndex];
        const canvas = byId("bridge"), palette = theme();
        if (!boundary) {
            const ctx = canvasContext("bridge", 580);
            label(ctx, "No producer–consumer boundary in this preset.", 620, 180, 18, palette.muted, "center");
            byId("layout-element").disabled = true;
            state.bridge = {boundaryIndex: state.boundaryIndex, progress: 0, tokens: []};
            return;
        }
        const sourceCells = boundary.sourceCells || [], targetCells = boundary.targetCells || [];
        const rows = Math.max(1, ...sourceCells.map(cell => cell.row + 1), ...targetCells.map(cell => cell.row + 1));
        const targets = new Map(targetCells.map(cell => [cell.index, cell]));
        if (state.bridgeBoundary !== boundary) {
            const previous = state.bridgeBoundary;
            if (!previous || previous.from !== boundary.from || previous.elements !== boundary.elements) state.bridgeElement = null;
            state.bridgeBoundary = boundary;
            setOptions("layout-element", [["", "Show all sample elements"], ...sourceCells.map(cell =>
                [cell.index, `Element ${cell.index} · C[${cell.m},${cell.n}] = ${number(cell.value)}`])], state.bridgeElement ?? "");
            byId("layout-element").disabled = false;
        }
        const sampleCount = Math.min(12, sourceCells.length);
        const baseSample = Array.from({length: sampleCount}, (_, i) => sourceCells[Math.floor(i * sourceCells.length / sampleCount)]);
        const sample = [...baseSample];
        const selected = sourceCells.find(cell => cell.index === state.bridgeElement);
        if (selected && !sample.some(cell => cell.index === selected.index)) sample.push(selected);
        const height = Math.max(580, 126 + rows * 24 + 64);
        const ctx = canvasContext("bridge", height);
        ctx.fillStyle = palette.card; ctx.fillRect(0, 0, 1240, height);
        label(ctx, `GEMM ${state.boundaryIndex + 1} · producer output`, 267, 28, 17, palette.text, "center", 600);
        label(ctx, `GEMM ${state.boundaryIndex + 2} · consumer input`, 973, 28, 17, palette.text, "center", 600);
        label(ctx, String(boundary.sourceLayout), 267, 54, 12, palette.muted, "center");
        label(ctx, String(boundary.targetLayout), 973, 54, 12, palette.muted, "center");
        label(ctx, "BANK", 267, 79, 10, palette.muted, "center", 600);
        label(ctx, "BANK", 973, 79, 10, palette.muted, "center", 600);
        for (const side of ["source", "target"]) {
            for (let bank = 0; bank < 16; bank++) {
                const p = bridgeCellPosition({bank, row: 0}, side);
                label(ctx, bank, p.x, 104, 11, palette.muted, "center");
                for (let row = 0; row < rows; row++) {
                    const slot = bridgeCellPosition({bank, row}, side);
                    roundedRect(ctx, slot.x - 13, slot.y - 10, 26, 21, 3, palette.background, palette.line);
                }
            }
            for (let row = 0; row < rows; row++) {
                const p = bridgeCellPosition({bank: 0, row}, side);
                label(ctx, row, p.x - 21, p.y, 10, palette.muted, "right");
            }
            const cells = side === "source" ? sourceCells : targetCells;
            for (const cell of cells) {
                const p = bridgeCellPosition(cell, side), style = bridgeStyle(cell, baseSample);
                ctx.save();
                if (selected && cell.index !== selected.index) ctx.globalAlpha = .25;
                bridgeTile(ctx, p, style, selected && cell.index === selected.index ? palette.text : null);
                ctx.restore();
            }
        }
        const actualChange = boundary.changed && !byId("compatible").checked;
        roundedRect(ctx, 511, 22, 217, 90, 8, palette.background, palette.line);
        label(ctx, !actualChange ? "ALREADY COMPATIBLE" : boundary.switched ? "LAYOUT SWITCH WHAT-IF" : "MATERIALIZE + REPACK", 620, 44, 11, palette.text, "center", 600);
        label(ctx, !actualChange ? "no additional copy" : `${boundary.changedElements}/${boundary.elements} addresses change`, 620, 70, 11, palette.muted, "center");
        label(ctx, `${Math.round(state.bridgeProgress * 100)}% of illustration`, 620, 94, 11, palette.muted, "center");
        const tokens = [];
        // Draw the selected route last so its label remains visible at crossings.
        const ordered = sample.map((source, lane) => ({source, lane})).sort((a, b) =>
            Number(a.source.index === state.bridgeElement) - Number(b.source.index === state.bridgeElement));
        for (const {source, lane} of ordered) {
            const target = targets.get(source.index);
            if (!target) continue;
            const from = bridgeCellPosition(source, "source"), to = bridgeCellPosition(target, "target");
            const progress = clamp((state.bridgeProgress - lane * .018) / .79, 0, 1);
            const routeY = 156 + lane * 28, style = bridgeStyle(source, baseSample);
            const path = [from, {x: 515, y: routeY}, {x: 723, y: routeY}, to];
            const pos = along(path, progress), active = !selected || selected.index === source.index;
            ctx.save(); ctx.globalAlpha = active ? .3 : .035;
            line(ctx, path, style.color, selected && active ? 2.5 : 1);
            ctx.restore();
            ctx.save(); ctx.globalAlpha = active ? 1 : .25;
            if (progress > 0 && progress < 1) {
                bridgeTile(ctx, pos, style, selected && active ? palette.text : null);
            }
            ctx.restore();
            tokens.push({id: `C:${source.m}:${source.n}`, label: style.label, color: style.color,
                index: source.index, m: source.m, n: source.n, value: source.value,
                sourceBank: source.bank, sourceRow: source.row, targetBank: target.bank, targetRow: target.row,
                kind: progress < .5 ? "result" : "input", x: pos.x, y: pos.y, progress});
        }
        label(ctx, `${sourceCells.length} elements · 16 banks · ${rows} address rows · ${sample.length} illustrated routes`, 620, height - 38, 12, palette.muted, "center");
        label(ctx, "Cell numbers are element IDs. The same ID and color identify the same C[m,n] on both sides.", 620, height - 16, 12, palette.muted, "center");
        canvas.dataset.tokens = JSON.stringify(tokens); canvas.dataset.progress = state.bridgeProgress; canvas.dataset.changed = boundary.changed;
        state.bridge = {boundaryIndex: state.boundaryIndex, boundary, progress: state.bridgeProgress, tokens, selectedIndex: state.bridgeElement};
    }
    function seekBridge(progress) { stopBridge(); state.bridgeProgress = clamp(Number(progress) || 0, 0, 1); renderBridge(); }
    function bridgeTick(now) {
        if (!state.bridgePlaying) return;
        state.bridgeProgress = Math.min(1, (now - state.bridgeStart) / 5000); renderBridge();
        if (state.bridgeProgress >= 1) { stopBridge(); return; }
        state.bridgeRequest = requestAnimationFrame(bridgeTick);
    }
    function playBridge() {
        if (state.bridgePlaying) { stopBridge(); return; }
        if (motionPreference.matches) { pause(); seekBridge(1); return; }
        pause(); state.bridgePlaying = true; state.bridgeProgress = 0; state.bridgeStart = performance.now();
        byId("layout-play").textContent = "Pause layout bridge"; state.bridgeRequest = requestAnimationFrame(bridgeTick);
    }
    byId("preset").addEventListener("change", () => { state.presetId = byId("preset").value; state.layerIndex = 0; state.boundaryIndex = 0; rebuild(); });
    byId("baseline").addEventListener("change", () => { state.baseline = byId("baseline").value; rebuild(); });
    byId("layer").addEventListener("change", () => selectLayer(byId("layer").value));
    byId("speed").addEventListener("change", () => { state.speed = Number(byId("speed").value); });
    byId("play").addEventListener("click", () => state.playing ? pause() : play());
    byId("reset").addEventListener("click", () => seek(0));
    byId("scrub").addEventListener("input", () => seek(byId("scrub").value));
    byId("output-m").addEventListener("input", renderNumeric); byId("output-n").addEventListener("input", renderNumeric);
    byId("numeric-toggle").addEventListener("click", () => {
        const panel = byId("numeric-panel"), button = byId("numeric-toggle");
        panel.hidden = !panel.hidden;
        button.setAttribute("aria-expanded", String(!panel.hidden));
        button.textContent = panel.hidden ? "Show numerical comparison" : "Hide numerical comparison";
    });
    for (const id of ["layout-mode", "bandwidth", "config", "compatible"]) byId(id).addEventListener("change", rebuild);
    byId("boundary").addEventListener("change", () => { stopBridge(); state.boundaryIndex = Number(byId("boundary").value); state.bridgeProgress = 0; renderBridge(); });
    byId("layout-play").addEventListener("click", playBridge);
    byId("layout-element").addEventListener("change", () => {
        state.bridgeElement = byId("layout-element").value === "" ? null : Number(byId("layout-element").value);
        renderBridge();
    });
    for (const kind of ["systolic", "feather"]) {
        const canvas = byId(kind === "systolic" ? "sa" : "feather");
        canvas.addEventListener("mousemove", event => {
            const {x, y} = canvasPoint(kind === "systolic" ? "sa" : "feather", event);
            const row = Math.floor((y - grid.y) / grid.step), col = Math.floor((x - grid.x) / grid.step);
            const pe = row >= 0 && row < 16 && col >= 0 && col < 16 ? state.boards[kind].snapshot.pe[row * 16 + col] : null;
            canvas.title = pe ? `PE[${row},${col}] ${pe.active ? "active" : pe.mapped ? "mapped / idle" : "unmapped"}; m=${pe.m}, k=${pe.k}, n=${pe.n}; A=${pe.a}, B=${pe.b}, partial=${pe.value}` : "Hover a PE for its coordinates and operands.";
        });
    }
    function bridgeHit(event) {
        const {x, y} = canvasPoint("bridge", event);
        const boundary = state.chain.boundaries[state.boundaryIndex]; if (!boundary) return null;
        const contains = position => Math.abs(x - position.x) < 13 && y - position.y >= -10 && y - position.y <= 11;
        const packet = [...state.bridge.tokens].reverse().find(item => item.progress > 0 && item.progress < 1 && contains(item));
        if (packet) return {...packet, side: "transfer"};
        const side = x < 620 ? "source" : "target", cells = side === "source" ? boundary.sourceCells : boundary.targetCells;
        const cell = cells.find(item => contains(bridgeCellPosition(item, side)));
        return cell ? {...cell, side} : null;
    }
    byId("bridge").addEventListener("mousemove", event => {
        const cell = bridgeHit(event);
        byId("bridge").title = cell ? `Element ${cell.index} · C[${cell.m},${cell.n}]=${number(cell.value)} · ${cell.side === "transfer" ? `bank ${cell.sourceBank}, row ${cell.sourceRow} → bank ${cell.targetBank}, row ${cell.targetRow}` : `${cell.side} bank ${cell.bank}, row ${cell.row}`} · Click to highlight` : "Click a buffer cell or moving element to highlight its route.";
    });
    byId("bridge").addEventListener("click", event => {
        const cell = bridgeHit(event);
        if (!cell) return;
        state.bridgeElement = state.bridgeElement === cell.index ? null : cell.index;
        byId("layout-element").value = state.bridgeElement ?? "";
        renderBridge();
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { pause(); stopBridge(); } });
    motionPreference.addEventListener("change", () => { stopBridge(); render(); renderBridge(); });
    new MutationObserver(() => { render(); renderBridge(); }).observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme"]});
    const redrawCanvases = () => {
        if (!state.chain) return;
        drawBoard("systolic"); drawBoard("feather"); renderBridge();
    };
    const canvasResize = new ResizeObserver(redrawCanvases);
    for (const id of Object.keys(canvasSizes)) canvasResize.observe(byId(id));
    window.addEventListener("resize", redrawCanvases);
    function watchPixelRatio() {
        window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener("change", () => {
            redrawCanvases(); watchPixelRatio();
        }, {once: true});
    }
    watchPixelRatio();
    document.fonts.ready.then(redrawCanvases);

    window.FeatherComparisonView = {
        inspect: () => ({presetId: state.presetId, baseline: state.baseline, scope: state.scope, layerIndex: state.layerIndex,
            cycle: state.cycle, fraction: state.fraction, effectiveFraction: motionPreference.matches ? .85 : state.fraction,
            reducedMotion: motionPreference.matches, playing: state.playing, chain: state.chain,
            systolic: state.boards.systolic, feather: state.boards.feather, bridge: state.bridge}),
        seek, play, pause, selectLayer, seekBridge, playBridge,
        selectPreset: id => { if (!model.presets().some(preset => preset.id === id)) throw new Error(`Unknown preset: ${id}`); state.presetId = id; byId("preset").value = id; state.layerIndex = 0; state.boundaryIndex = 0; rebuild(); },
        setBaseline: id => { if (!Object.hasOwn(names, id)) throw new Error(`Unknown baseline: ${id}`); state.baseline = id; byId("baseline").value = id; rebuild(); },
        setScope: scope => { if (!["layer", "chain"].includes(scope)) throw new Error(`Unknown scope: ${scope}`); pause(); state.scope = scope; state.cycle = 0; state.fraction = 0; render(); }
    };
    setOptions("preset", model.presets().map(preset => [preset.id, preset.name]), state.presetId);
    rebuild();
})();
