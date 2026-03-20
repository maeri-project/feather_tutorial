# Trace Input Support for FEATHER+ MINISA

## Overview

Added support for parsing RTL FEATHER+ instruction trace JSON files and
executing the described workloads through the Allo-implemented FEATHER+ dataflow.
This bridges the gap between the RTL compiler's output and our Allo model.

## Test Workload

**Trace**: `sample_input/trace_m24k48n512_16x16.json`
- GEMM: C[24, 512] = A[24, 48] × B[48, 512]
- FEATHER array: 16×16 (AH=16, AW=16)
- RTL mapping: Gr=16, Gc=16, sr=1, sc=16
- RTL reference: **3025 cycles**, 77.42% utilization
- 3 K-passes (n_EMs=3), 2 spatial tiles, 2 M-batches

## New Files

| File | Description |
|------|-------------|
| `minisa/trace_parser.py` | Parse trace JSON → MINISA program |
| `tests/test_trace_input.py` | Test harness: reference, HLS csim/csyn, deploy |
| `sample_input/trace_m24k48n512_16x16.json` | Input trace file |

## Key Design Decision: N-Dimension Decomposition

The RTL trace specifies `sc=16`, which is a VN buffer stride — each PE accesses
N-positions spaced 16 apart, yielding `Nt=256` unique N-columns per ExecuteMapping.
However, the RTL achieves full Nt coverage through WVN temporal iteration (`N_L1=16`),
where each ExecuteMapping is invoked 16 times with different weight subsets.

Our single-pass-per-tile model doesn't replicate this VN buffer temporal iteration.
With `sc=16`, each tile only writes 256 output values (16 M × 16 N per BIRRD column),
not the expected 4096 (16 M × 256 N).

**Solution**: Decompose each spatial tile's `Nt=256` N-columns into `n_sub_tiles = Nt/AH = 16`
sub-tiles of AH=16 columns each, using `sc=0` (direct sequential indexing):

| Parameter | RTL trace | Our model |
|-----------|-----------|-----------|
| Tiles per (spatial, M-batch) | 1 | 16 (N sub-tiles) |
| Total tiles | 4 | **64** (2 spatial × 2 M × 16 N) |
| Per-tile N coverage | 256 (via sc=16) | 16 (via sc=0) |
| Per-tile mapping | Gr=16, Gc=16, sr=1, sc=16 | Gr=16, Gc=1, sr=1, sc=0 |

## Results

### Correctness

| Test | Result |
|------|--------|
| Python reference (block-GEMM) | **PASS** |
| HLS C-simulation (csim) | **PASS** |

The reference model verifies that the 64-tile decomposition covers all (M, K, N) elements
and produces the correct GEMM output. The HLS csim confirms the actual Allo kernel
produces identical results.

### Cycle Count (HLS Synthesis Estimate)

| Metric | Value |
|--------|-------|
| Best-case latency | **966,482 cycles** |
| Worst-case latency | 966,484 cycles |
| RTL reference | 3,025 cycles |
| Ratio | ~319× |

The large gap is expected and explained by architectural differences:

1. **Tile serialization**: Our model processes 64 tiles sequentially through
   the full dataflow pipeline (crossbar_load → nest_compute → BIRRD → output_accum).
   The RTL overlaps tile processing with deeply pipelined execution.

2. **No VN buffer reuse**: The RTL's VN buffers enable data reuse (load once,
   iterate N_L1 times). Our model re-reads weights for every tile, multiplying
   memory traffic by N_L1=16.

3. **Tile count**: 64 tiles × 3 K-passes = 192 pipeline iterations.
   RTL: 4 conceptual tiles × 3 K-passes × 16 N-iterations = 192 iterations,
   but at pipeline II ~16 (1 cycle per PE row).

### Resource Utilization

Design uses UInt(2048) packed crossbar streams (16×16×8 bits), requiring
`#define AP_INT_MAX_W 4096` in kernel.cpp. Array partitioning applied to
A (dim=2, factor=K=48) and B (dim=2, factor=N=512).

### Deployment

On-board deployment project generated at `tests/trace_24x48x512_hw.prj/`
with HBM bank mapping (10 ports → separate HBM banks). Bitstream build
requires `make build TARGET=hw PLATFORM=$XDEVICE`.

## Trace Parser Architecture

```
trace JSON ──→ parse_trace() ──→ {M, K, N, AH, AW, program, instructions, ...}
                    │
                    ├── Extract FEATHER_spec (AH, AW)
                    ├── Extract VN layouts (IVN/WVN/OVN orders)
                    ├── Extract mapping (Gr, Gc, sr, sc) from ExecuteMapping
                    ├── Extract dimensions (Mt, Kt, Nt, n_EMs, n_spatial_tiles)
                    ├── Compute M padding (24 → 32)
                    ├── Verify K-passes: K / Kt_per_pass == n_EMs
                    ├── Decompose Nt into n_sub_tiles × AH
                    └── Generate MINISA tiles: n_spatial × n_m × n_sub
```

## M Padding

M=24 is not divisible by Gr=16, so A is padded from [24, 48] to [32, 48]
with zeros. Padded rows compute 0×B=0. Output is extracted as C[:24, :].
