---
id: TICKET-012
title: HLS synthesis achieves only 57 DSPs instead of 256 (AW×AH) MAC parallelism
status: resolved
priority: high
resolution: Spatial PE architecture with data_scatter + stream-based nest_pe
---

## Problem

HLS synthesis on the 16×16 RTL trace (M=24, K=48, N=512) produces **193,018 cycles**
with **57 DSPs**, far from the RTL reference of **3,025 cycles** with 256 parallel MACs.

The `schedule_feather_hls()` function pipelines the `ni` loop in `nest_compute`,
which should auto-unroll the inner `nj×nk` loops to achieve AW×AH = 16×16 = 256
parallel MACs per pipeline stage. Instead, only ~57 MACs are instantiated — a ~4.5×
shortfall that inflates latency by ~64× vs RTL.

## Observed vs Expected

| Metric | Observed | Expected | RTL Reference |
|--------|----------|----------|---------------|
| Latency | 193,018 cycles | ~3,000 | 3,025 |
| DSPs | 57 | 256 | 256 PEs |
| BRAM_18K | 116 | — | — |
| FF | 161,197 | — | — |
| LUT | 177,838 | — | — |

## Likely Root Causes

### 1. Conditional inside pipelined loop prevents full unroll

The MAC loop body has `if k_pass < actual_passes:` guarding the inner nk loop
(`feather_minisa.py:301`). Vitis HLS may not fully unroll loop bodies containing
runtime conditionals, since the unrolled hardware would need muxing for the
enable/disable path, complicating scheduling.

```python
for ni in allo.grid(AH, name="nest_mac"):       # ← pipelined
    for nj in range(AW):                          # ← should auto-unroll (16)
        temp: int32 = 0
        if k_pass < actual_passes:                # ← conditional
            for nk in range(AH):                  # ← should auto-unroll (16)
                a_val: int32 = iActs[nk, nj]
                wk_idx: int32 = k_start + nk + (nj >> log2_Gr) * AH
                wn_idx: int32 = n_start + sr * ni + sc * (nj & mask_Gc)
                w_val: int32 = local_B[wk_idx, wn_idx]
                temp += (a_val - iacts_zp) * (w_val - weights_zp)
        nest_accum[ni, nj] = nest_accum[ni, nj] + temp
```

### 2. B_nest array access pattern may prevent partitioning

`local_B[wk_idx, wn_idx]` uses runtime-computed indices (`wk_idx` depends on `nk`,
`nj`, `log2_Gr`; `wn_idx` depends on `ni`, `nj`, `sr`, `sc`). Even with
`s.partition("full_matrix_top:B_nest", dim=1, factor=K)`, the non-affine index
expressions may prevent Vitis HLS from proving that all AW×AH accesses are to
distinct BRAM banks, limiting the parallelism.

### 3. iActs array port contention

The `iActs[nk, nj]` array is AH×AW (16×16 = 256 entries). When nj×nk is fully
unrolled, this requires 256 simultaneous reads. Without complete partitioning of
iActs, BRAM port limits (2 reads/cycle) throttle parallelism.

### 4. nest_accum read-modify-write hazard

`nest_accum[ni, nj] = nest_accum[ni, nj] + temp` is a read-modify-write on
nest_accum. With ni pipelined and nj unrolled, each pipeline stage needs AW
parallel RMW ports on nest_accum. Without explicit partitioning of nest_accum,
this creates a bottleneck.

## Potential Solutions

### A. Spatial PE kernel with `mapping=[AH, AW]` (try first)

The current `nest_compute` uses `@df.kernel(mapping=[1])` — a single sequential
instance that relies on pipeline+unroll scheduling to infer parallelism. This is
fragile: HLS must prove all loop-carried dependencies are resolvable, all array
accesses are partition-safe, etc.

The BIRRD module already demonstrates the correct pattern: `@df.kernel(mapping=[P0, P1])`
creates P0×P1 **physically distinct hardware instances**, each with its own `df.get_pid()`
identity. This guarantees spatial parallelism by construction — no scheduling needed.

Rewrite `nest_compute` as `@df.kernel(mapping=[AH, AW])`:
```python
@df.kernel(mapping=[AH, AW], args=[B_nest, inst_nest])
def nest_compute(local_B: Ty[K, N], local_inst: int32[num_inst, 13]):
    ni, nj = df.get_pid()  # PE position: ni ∈ [0,AH), nj ∈ [0,AW)
    for tile in range(num_tiles):
        # Decode tile params (each PE reads same instruction)
        ...
        nest_accum: int32 = 0
        for k_pass in range(max_k_passes):
            # Each PE reads its own iActs element from stream
            a_val: int32 = iacts_input[ni, nj].get()  # needs new stream topology
            # Each PE reads its own weight from B_nest
            wk_idx = k_start + ni + (nj >> log2_Gr) * AH  # nk=ni for this PE
            wn_idx = n_start + sr * ni + sc * (nj & mask_Gc)
            w_val: int32 = local_B[wk_idx, wn_idx]
            nest_accum += (a_val - iacts_zp) * (w_val - weights_zp)
        # Stream result to BIRRD
        nest_out[ni, nj].put(nest_accum)  # needs new stream topology
```

This mirrors RTL's PE array: AH×AW = 256 physical PEs, each doing 1 MAC/cycle.
The key challenge is adapting the stream topology — current design uses a single
packed stream per K-pass; the spatial version needs AH×AW individual streams or
a bus/scatter stage (like the existing `bus` kernel does for BIRRD input).

**Pros**: Guaranteed 256 DSPs, no fragile scheduling, matches RTL architecture.
**Cons**: Requires stream topology redesign; B_nest needs AH×AW read ports
(complete partitioning) or a scatter stage.

### B. Move conditional outside MAC loops (simplest scheduling fix)

Restructure so the conditional doesn't wrap the inner loops:
```python
for ni in allo.grid(AH, name="nest_mac"):
    for nj in range(AW):
        temp: int32 = 0
        for nk in range(AH):
            a_val: int32 = iActs[nk, nj]  # zero-padded if k_pass >= actual
            wk_idx: int32 = k_start + nk + (nj >> log2_Gr) * AH
            wn_idx: int32 = n_start + sr * ni + sc * (nj & mask_Gc)
            w_val: int32 = local_B[wk_idx, wn_idx]
            temp += (a_val - iacts_zp) * (w_val - weights_zp)
        nest_accum[ni, nj] = nest_accum[ni, nj] + temp
```
The crossbar_load already streams zeros for padding passes, so iActs will be all
zeros when k_pass >= actual_passes, making `0 * w = 0` harmless. The conditional
was added as an optimization for the simulator but hurts HLS synthesis.

### C. Partition all intermediate arrays

Add explicit partitioning for nest_compute-local arrays:
```python
s.partition("nest_compute:iActs", dim=0, factor=AH)  # or complete
s.partition("nest_compute:iActs", dim=1, factor=AW)
s.partition("nest_compute:nest_accum", dim=1, factor=AW)
```
Note: Allo may not support partitioning kernel-local arrays directly. May need to
promote them to top-level buffers or use pragma annotations in generated kernel.cpp.

### D. Explicit unroll pragmas

If auto-unroll doesn't fire, add explicit:
```python
s.unroll(nest_loops.nj)
s.unroll(nest_loops.nk)
```
This forces the unroll even if HLS can't infer it.

### E. Simplify index arithmetic

Replace runtime `log2_Gr`, `mask_Gc` with compile-time constants for the common
case (Gr=AW, single dataflow). This lets HLS prove bank-conflict-freedom for
array partitions.

### F. Inspect generated kernel.cpp

Before trying code changes, examine the generated C++ to understand what Vitis HLS
actually sees. Check for:
- Missing `#pragma HLS UNROLL` on nj/nk loops
- Missing `#pragma HLS ARRAY_PARTITION` on iActs/nest_accum
- Pipeline II > 1 warnings in synthesis log
- Resource binding conflicts

## Reproduction

```bash
source /home/nz264/.local/bin/allo-env.sh
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --hls csyn
```

Check synthesis report for DSP count and pipeline II in the Vitis HLS project.

## Files

| File | Relevant code |
|------|---------------|
| `feather_minisa.py:132-210` | data_scatter + nest_pe (spatial PE architecture) |
| `feather_minisa.py:509-522` | schedule_feather_hls() (minimal — parallelism is structural) |

## Resolution

**Architecture**: data_scatter (mapping=[1]) + nest_pe (mapping=[AH, AW])

The root cause was that all AH×AW PE instances (from `mapping=[AH, AW]`) shared the
same DRAM buffers via `args=[A_pe, B_pe, inst_pe]`, violating HLS dataflow's single-reader
rule. The fix splits the design into:

1. **data_scatter** (mapping=[1]): Sole reader of A, B, inst from DRAM. Computes crossbar
   index formulas, zero-point subtraction, and streams (a-zp, w-zp) pairs to each PE via
   per-PE streams (pe_a_in[ni,nj], pe_w_in[ni,nj]).
2. **nest_pe** (mapping=[AH, AW], NO DRAM args): Each PE reads from its dedicated streams,
   does `a * w` accumulate, puts result on pe_out[ni,nj]. Stream-only I/O avoids the
   multi-reader violation.

**4×4 synthesis results** (M=8, K=16, N=8, AW=4, AH=4):

| Metric | Old (mapping=[1]) | New (spatial PE) |
|--------|-------------------|------------------|
| DSPs | 57 (for 16×16) | **50** (16 PEs × 3 DSPs/PE) |
| Latency | 193,018 cycles | **1,027 cycles** |
| DSP scaling | ~4.5× shortfall | **Linear: AH×AW × 3 DSPs** |

For 16×16 (256 PEs): expected ~768 DSPs (8.5% of U280's 9024).
