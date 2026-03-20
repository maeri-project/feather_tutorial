# FEATHER+ Figure 7: Baseline Gap Analysis (1792 cycles)

**Date:** 2026-03-04
**Status:** Historical — all root causes resolved (see `figure7_rtl_comparison.md`)
**Cosim project:** `tests/figure7_cosim.prj/`

## Workload

**C[16,8] = A[16,12] x B[12,8]** on 4x4 NEST PE array (AH=AW=4)

24 MINISA tile mappings: 16 Gr=2 tiles (K=[0,8)) + 8 Gr=4 tiles (K=[8,12))

## Results

| Implementation | Cycles | Source |
|---|---|---|
| **Allo RTL cosim** | **1792** | Vitis HLS cosim_design (Verilog, xsim) |
| Allo HLS csynth estimate | 2257-2308 | csynth_design worst-case (conservative) |
| **RTL reference** | **1120** | Icarus Verilog, 8 tiles with K-distribution |

**Gap: 1.6x** (1792 / 1120).

## Dataflow Kernel Breakdown (csynth reports)

| Kernel | Min cycles | Max cycles | Notes |
|---|---|---|---|
| crossbar_and_NEST_0 | 914 | 1946 | **Bottleneck** — 24 tiles, 38-81 cycles/tile |
| output_accum_0 | 652 | 652 | 130 (init) + 387 (accum) + 130 (writeback) |
| BIRRD_{0..2}_{0,1} (6x) | 99 | 99 | Butterfly network, parallel |
| bus_0 | 98 | 98 | Unpack packed NEST output |
| inst_rw_0 | 26 | 26 | Distribute BIRRD switch instructions |
| load_buf2 (instructions) | 360 | 361 | Slowest loader (27x13 int32) |
| store_res8 (C) | 135 | 136 | Output writeback |

## Root Cause 1: 24 Tiles vs 8 Tiles (Dominant)

The MINISA program emits one `SetMapping` per (M-block, N-group, K-group):
- 16 Gr=2 tiles: 8 M-blocks x 2 N-groups, K=[0,8)
- 8 Gr=4 tiles: 4 M-blocks x 2 N-groups, K=[8,12)

Each tile pays full pipeline overhead (~9 cycles for instruction decode + startup/flush).
With weight stationarity, per-tile cost:
- With weight load: 19 (input xbar) + 42 (weight xbar) + 10 (NEST) + 10 (overhead) = 81 cycles
- Without weight load: 19 (input xbar) + 10 (NEST) + 9 (overhead) = 38 cycles

Out of 24 tiles: 4 load weights, 20 skip. Estimated: 4x81 + 20x38 = 1084 cycles.

## Root Cause 2: Runtime Integer Dividers (14 instances)

`ic_j % Gr` and `ic_j // Gr` use runtime `Gr`, compiled to multi-cycle sdiv/srem.

**Input crossbar** (`l_S_ic_i_0_ic_i`):
- II=2 (target: 1), 6 dividers, 19 cycles/tile
- Divider area: 6 x (2283 FF + 1738 LUT) = 13,698 FF + 10,428 LUT

**Weight crossbar** (`l_S_wc_i_2_wc_i`):
- II=8 (target: 1), 8 dividers, 42 cycles/tile
- Divider area: 8 x (2283 FF + 1738 LUT) = 18,264 FF + 13,904 LUT

**Total divider area:** 31,962 FF + 24,332 LUT (72% of design FF, 54% of LUT).

## Root Cause 3: No Ping-Pong Buffering

RTL double-buffers crossbars to overlap next tile's data loading with current tile's
NEST compute. Allo processes crossbar fill and NEST sequentially within each tile.

## Cycle Budget Reconstruction

```
Phase 1: Data loading (overlapped)
  load_buf2 (instructions): 361 cycles — gates crossbar_and_NEST start

Phase 2: Compute (critical path)
  crossbar_and_NEST: ~1084 cycles (4 weight-load + 20 cached tiles)
  bus + BIRRD + output_accum: pipeline behind, ~200 cycles tail

Phase 3: Store
  store_res8: ~136 cycles

Total: 361 + 1084 + 136 + pipeline_tail ≈ 1792 cycles (matches cosim)
```

## Previous Optimization Attempts (Did Not Help)

1. **Remove if/elif branches**: 2547 cycles (worse — HLS flattened loops, lost parallelism)
2. **Compile-time Gr constants**: 2547 cycles (same loop flattening issue)
3. **Partition input arrays**: 4156 cycles (much worse — expensive load_buf processes)
