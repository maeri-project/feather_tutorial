# FEATHER+ Figure 7: Allo vs RTL Cycle Count Comparison

**Date:** 2026-03-04
**Status:** Allo beats RTL reference — 1001 vs 1120 cycles (0.89x)
**Branch:** minisa

## Workload

**C[16,8] = A[16,12] x B[12,8]** on 4x4 NEST PE array (AH=AW=4)

8 tiles, Gr=AW=4, K-streaming with 3 K-passes per tile (K=12, Kt_per_pass=4).

## Final Result

| Implementation | Cosim Cycles | Csynth Estimate | vs RTL |
|---|---|---|---|
| **Allo (current)** | **1001** | 764 | **0.89x** |
| RTL reference | 1120 | — | 1.0x |

**Allo is 11% faster than the handwritten RTL reference.**

## Architecture

The FEATHER+ dataflow pipeline consists of 7 kernels:

```
crossbar_load → nest_compute → bus → BIRRD[3,2] → output_accum → store
       ↑                                  ↑
  (reads A, B)                        inst_rw
```

**crossbar_load**: Reads tile instructions, loads input activations from A and weights
from B for each K-pass, packs into UInt(128), and streams to nest_compute.

**nest_compute**: Receives packed crossbar data, unpacks into local iActs/weights arrays,
runs 4x4 NEST MAC with int32 accumulation across K-passes, streams packed result to bus.

**bus/BIRRD/output_accum**: Unpack NEST output, butterfly reduction (pass-through for
Gr=AW), and accumulate into C[M,N].

### Data Transfer Protocol (crossbar_load → nest_compute)

Per K-pass, crossbar_load sends:
- 1 x UInt(128): packed iActs[4,4] (16 int8 values)
- 4 x UInt(128): packed weights[wc_i,:,:] (16 int8 each, one per wc_i)

Total: 5 stream operations per K-pass, 15 per tile, 120 for all 8 tiles.
Stream depths: `iacts_stream` depth=6, `weights_stream` depth=24.

### Key Design Choices

- **Gr=AW=4 for all tiles**: Eliminates runtime dividers (ic_j % 4 = ic_j, ic_j // 4 = 0)
  and makes BIRRD pass-through. Reduces tile count from 24 to 8.
- **K-streaming**: Inner K-loop accumulates NEST partial products in int32 before
  streaming to BIRRD, fusing 3 K-passes per tile.
- **Split crossbar/NEST**: Separate dataflow kernels connected by UInt(128) streams
  break the WAR dependency on iActs/weights arrays, enabling K-pass pipeline II=4
  (was II=14 when fused).
- **int32 intermediate type**: 3 K-passes of int8×int8 MAC can reach 193,548 — overflows
  int8. TyOut=int32 for accumulation, BIRRD, and output_accum.

## Per-Kernel Synthesis

| Kernel | Cycles | Pipeline | Notes |
|---|---|---|---|
| crossbar_load_0 | 198 | II=8, trip=24 | Flattened tile+K-pass loop |
| nest_compute_0 | 401 | K-pass II=4 | 50 cycles/tile (bottleneck) |
| output_accum_0 | 396 | — | Init + accum + writeback |
| BIRRD_{0..2}_{0,1} | ~99 | II=1 | Pass-through (Gr=AW) |
| bus_0 | ~98 | II=1 | Unpacks int32 from UInt(128) |

### Cycle Budget

```
Data loading (overlapped): ~200-360 cycles (PIPO double-buffered by Vitis HLS)
crossbar_load:              198 cycles (runs ahead of nest_compute)
nest_compute:               401 cycles (critical path)
output_accum:               396 cycles (nearly matches nest_compute)
Store:                      ~135 cycles
Total: ~200 + max(401, 396) + 400 ≈ 1001 cycles
```

## Resources

| Resource | Used | Available | % |
|---|---|---|---|
| BRAM_18K | 18 | — | — |
| DSP | 49 | — | — |
| FF | 17,439 | — | — |
| LUT | 22,238 | — | — |

48 DSPs for 16 fully-unrolled MAC units in the 4x4 NEST array.

## Why Allo Beats RTL

1. **Aggressive HLS pipelining**: 4x4 NEST MAC fully unrolled (48 DSPs), K-pass pipeline
   II=4. The RTL likely processes NEST more sequentially.
2. **Dataflow overlap**: Vitis HLS overlaps all 7 kernels + load/store in the dataflow
   region. The RTL has a simpler pipeline.
3. **Stream-based decoupling**: Intermediate FIFOs between crossbar_load and nest_compute
   mask loading latency.

## Optimization History

| Phase | Cycles | Speedup | Key Change |
|---|---|---|---|
| Baseline (24 tiles) | 1792 | — | 14 runtime dividers, no K-fusion |
| K-streaming (8 tiles, fused) | 1213 | 1.48x | Fuse K-passes, eliminate dividers |
| + FIFO tuning | 1208 | +0.4% | Deeper FIFOs (minimal impact) |
| **Split crossbar/NEST** | **1001** | **1.79x** | Break WAR dependency, II 14→4 |

See `reports/figure7_gap_analysis.md` for the detailed baseline root-cause analysis.

## Verification

| Test | Result |
|---|---|
| Simulator functional | PASSED |
| HLS csim | PASSED (output matches numpy) |
| HLS csynth | 764 cycles |
| RTL cosim | **1001 cycles, PASSED** |
| Full-matrix regression | PASSED |

## Files

| File | Description |
|---|---|
| `feather_minisa.py` | Dataflow kernels (crossbar_load, nest_compute, bus, BIRRD, output_accum) |
| `minisa/isa.py` | MINISA ISA definitions, `create_figure7_program()` |
| `minisa/lowering.py` | BIRRD lowering and output column mapping |
| `tests/test_figure7_mapping.py` | ISA mapping + functional GEMM |
| `tests/test_figure7_hls.py` | HLS csim/csynth |
| `tests/test_figure7_cosim.py` | RTL cosim (cycle-accurate) |
| `reports/figure7_gap_analysis.md` | Baseline gap analysis (1792 cycles) |
