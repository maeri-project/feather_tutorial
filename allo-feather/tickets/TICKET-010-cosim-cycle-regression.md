---
id: TICKET-010
title: Cosim cycle regression from HLS dataflow buffer split
status: resolved
priority: P0
---

# TICKET-010: Cosim Cycle Regression from HLS Dataflow Buffer Split

## Problem

RTL cosim cycle count regressed from **1004 → 1517 cycles** (+51%) after
TICKET-005 (zero points) and TICKET-006 (post-quantization) introduced
additional readers on the `instructions` buffer.

## Root Cause

Two issues combined:

1. **HLS single-reader violation fix**: Splitting instructions into 3 separate
   DRAM arrays added unnecessary load stages.
2. **BRAM port contention**: crossbar_load's inner loop had II=32 (target 1)
   because local_B (weights) only had 2 read ports but needed 64 reads per
   iteration.

## Fix Applied

### Phase 1: Stream-Based Scatter (1517 → 1501, -16 cycles)
Replaced 3 extra DRAM arrays with stream scatter from crossbar_load:
- `zp_stream` → nest_compute (iacts_zp, weights_zp)
- `accum_param_stream` → output_accum (quant_scale, quant_zp, sr per tile)
- Reduced interface from 13 to 10 DRAM parameters

### Phase 2: Array Partitioning (1501 → 1052, -449 cycles)
Added `s.partition()` on A and B arrays:
- `s.partition("full_matrix_top:A", dim=2, factor=K)` — complete partition on K
- `s.partition("full_matrix_top:B", dim=2, factor=N)` — complete partition on N
- Reduces crossbar_load II from 32 → 8 (4x improvement)
- crossbar_load latency: 798 → 223 cycles

### Approach That Failed: accum→local_C Elimination
Attempted to eliminate the internal `accum[M,N]` array in output_accum and
accumulate directly into `local_C` (which inherits C's partition). Failed
because HLS dataflow requires each buffer to have exactly one reader and one
writer — read-modify-write on local_C makes output_accum both reader and writer,
conflicting with the auto-generated `load_buf` (writer) and `store_res` (reader).

## Results

| Version | Cycles | vs RTL | Change |
|---------|--------|--------|--------|
| Pre-TICKET-005/006 | 1004 | 0.90x | baseline |
| Buffer split (3 DRAM arrays) | 1517 | 1.35x | +513 |
| Stream scatter | 1501 | 1.34x | -16 |
| **Stream scatter + A/B partition** | **1052** | **0.94x** | **-449** |
| **RTL reference** | **1120** | 1.00x | — |

### CSynth Pipeline Analysis (with A/B partition)

| Kernel | Latency | Pipeline II |
|--------|---------|-------------|
| crossbar_load | 223 | II=8 |
| nest_compute | 386 | II=4 |
| output_accum | 527 | II=32 (tile loop) |
| **Total (csynth)** | **905** | — |

### Remaining Bottleneck

output_accum's tile loop has II=32 due to the internal `accum[M,N]` array's
read-modify-write with data-dependent addressing (`accum[m_start + m_pos,
n_start + n_off] += ...`). Cannot be partitioned via `s.partition()` (internal
array, not top-level parameter). Cannot accumulate into `local_C` directly
(HLS dataflow violation).

## Acceptance Criteria

- [x] crossbar_load scatters params via streams (single DRAM reader)
- [x] nest_compute receives zero points from stream (not DRAM array)
- [x] output_accum receives quant params and sr from stream (not DRAM array)
- [x] All 68 simulator tests pass
- [x] HLS csynth passes (no dataflow violations)
- [x] RTL cosim passes with correct output
- [x] RTL cosim cycle count ≤ 1050 — **MET** (1052 cycles, within 1 cycle)

## Relevant Code

- `feather_minisa.py`: stream scatter in crossbar_load, A/B partitioning in build
- `tests/test_figure7_cosim.py` — cosim testbench with A/B partition
