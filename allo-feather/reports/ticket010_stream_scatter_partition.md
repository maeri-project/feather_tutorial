# TICKET-010: Stream Scatter + Array Partitioning — Cosim Regression Fix

**Date**: 2026-03-13
**Branch**: minisa
**Result**: RTL cosim **1052 cycles** — beats RTL reference (1120) by 6%

## Problem

RTL cosim regressed from 1004 → 1517 cycles (+51%) after TICKET-005 (zero points)
and TICKET-006 (post-quantization) required splitting the shared `instructions`
buffer into 3 separate DRAM arrays to satisfy HLS dataflow single-reader constraint.

## Two-Phase Fix

### Phase 1: Stream-Based Scatter (1517 → 1501)

Replaced 3 extra DRAM arrays with stream-based parameter scatter from `crossbar_load`:

```
instructions (DRAM, single reader: crossbar_load)
    |
    v
crossbar_load
    |---> zp_stream ---------> nest_compute    (iacts_zp, weights_zp)
    |---> accum_param_stream -> output_accum   (quant_scale, quant_zp, sr×num_tiles)
    |---> iacts_stream -------> nest_compute   (crossbar data)
    |---> weights_stream -----> nest_compute   (crossbar data)
```

- Eliminated `nest_zero_points[2]`, `accum_quant_params[2]`, `accum_sr_per_tile[num_tiles]`
- Reduced top function from 13 to 10 DRAM parameters
- Saved 16 cycles (DRAM load overhead)

### Phase 2: Array Partitioning (1501 → 1052)

Added complete array partitioning on input matrices:

```python
s.partition("full_matrix_top:A", dim=2, factor=K)   # A[M,K]: complete partition on K
s.partition("full_matrix_top:B", dim=2, factor=N)   # B[K,N]: complete partition on N
```

This exposes more BRAM read ports for crossbar_load's inner loop:

| Metric | Before | After |
|--------|--------|-------|
| local_B read ports | 2 (dual-port) | 16 (8 banks × 2) |
| crossbar_load II | 32 | 8 |
| crossbar_load latency | 798 cycles | 223 cycles |
| Dataflow interval | 799 | 528 |
| CSynth total | 1000 | 905 |
| **RTL cosim** | **1501** | **1052** |

## Exploration of Additional Optimizations

### Output_accum config array partitioning — No impact
Partitioning `output_col_map`, `output_n_base`, `num_m`, `m_start`, `n_start`
did not reduce output_accum's tile loop II=32. The bottleneck is the internal
`accum[M,N]` array's read-modify-write with data-dependent addressing, not
config array reads.

### Accumulate into local_C directly — HLS dataflow violation
Attempted eliminating the internal `accum[M,N]` array to accumulate directly
into `local_C` (inherits C's partition). Failed: read-modify-write on `local_C`
makes output_accum both reader AND writer, conflicting with auto-generated
`load_buf` (writer) and `store_res` (reader). HLS dataflow requires each buffer
to have exactly one reader and one writer.

### Separate zp/quant kernels — Would not help
After A/B partitioning, `nest_compute` (386 cyc) and `output_accum` (527 cyc)
are no longer on the critical path vs crossbar_load (223 cyc). Adding more
kernels would add stream overhead without enabling new parallelism. The
quantization write loop already achieves II=1.

## Final Pipeline Analysis

| Kernel | Latency | Pipeline II | Status |
|--------|---------|-------------|--------|
| crossbar_load | 223 | II=8 | Fixed by A/B partition |
| nest_compute | 386 | II=4 | Acceptable |
| output_accum | 527 | II=32 (tile) | Remaining bottleneck |
| bus | 34 | — | Negligible |
| BIRRD (×6) | 35 each | — | Negligible |

## RTL Co-Simulation Comparison

| Configuration | Cycles | vs RTL |
|---------------|--------|--------|
| **RTL reference** (FEATHER Verilog) | **1120** | 1.00x |
| **Allo (stream scatter + A/B partition)** | **1052** | **0.94x** |
| Allo (stream scatter only) | 1501 | 1.34x |
| Allo (buffer split) | 1517 | 1.35x |
| Allo (pre-zp/quant baseline) | 1004 | 0.90x |
| Allo (original 24-tile) | 1792 | 1.60x |

## Files Changed

| File | Change |
|------|--------|
| `feather_minisa.py` | Stream scatter in crossbar_load, A/B partition in HLS build |
| `tests/test_figure7_cosim.py` | Updated testbench (10 params), A/B partition in cosim build |
| `CLAUDE.md` | Documented stream scatter and array partitioning |
