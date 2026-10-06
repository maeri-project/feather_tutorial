(function(root) {
    "use strict";
    const SIZE = 16;
    // Small integers are exactly representable in FP16. These are teaching
    // operands; neither the display nor the tests imply access to model weights.
    const input = (m, k) => ((m * 3 + k * 5 + 2) % 9) - 4;
    const weight = (k, n) => ((k * 5 + n * 3 + 1) % 7) - 3;
    function owner(record, row, col, dot = 0) {
        const {EM: e, ES: s, tile} = record;
        const m = s.m_0 + s.s_m * dot + Math.floor((col % e.G_r) / e.G_c);
        const n = e.c_0 + e.s_r * row + e.s_c * (col % e.G_c);
        const kg = e.r_0 + Math.floor(col / e.G_r);
        return {row, col, m, n, kg, kStart: kg * SIZE,
            valid: dot >= 0 && dot < s.T && m < tile.M && n < tile.N && kg * SIZE < tile.K};
    }
    function at(record, row, col, step) {
        const local = Math.floor(step) - row, dot = Math.floor(local / SIZE);
        const lane = ((local % SIZE) + SIZE) % SIZE;
        const selectedDot = Math.max(0, Math.min(record.ES.T - 1, dot));
        const o = owner(record, row, col, selectedDot);
        const active = local >= 0 && dot < record.ES.T && o.valid;
        const k = o.kStart + lane;
        const terms = local < 0 ? 0 : dot >= record.ES.T ? SIZE : lane + 1;
        let sum = 0;
        if (o.valid) for (let i = 0; i < terms; i++) sum += input(o.m, o.kStart + i) * weight(o.kStart + i, o.n);
        return {...o, dot: selectedDot, lane, k, active, input: input(o.m, k), weight: weight(k, o.n), sum};
    }
    const end = record => record.ES.T * SIZE + SIZE - 1;
    function frame(record, step) {
        return Array.from({length: SIZE * SIZE}, (_, i) => at(record, Math.floor(i / SIZE), i % SIZE, step));
    }
    const api = {SIZE, input, weight, owner, at, end, frame};
    if (typeof module === "object" && module.exports) module.exports = api;
    root.ReconfigurableComputeModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
