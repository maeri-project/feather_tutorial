# Parametric Mapping and Figure 7 End-to-End Verification Report

**Date:** 2026-02-24
**Status:** VERIFIED - All 28 tests pass (13 simulator + 8 Figure 7 mapping + 5 HLS csim + 2 Figure 7 HLS)

## Executive Summary

This report documents the implementation of parametric mapping support in the
FEATHER+ Allo dataflow hardware, enabling the MINISA paper's Figure 7 case
study to run end-to-end through the actual Allo-implemented hardware. The key
contribution is that the `Gr` field from `SetMapping` instructions is now
decoded on-chip and controls K-group splitting in the crossbar, BIRRD
reduction mode, and output accumulation -- rather than being ignored metadata.

Previously, `test_figure7_functional_gemm()` only verified the mapping logic
using numpy slicing. It now runs through the complete 5-kernel Allo dataflow
pipeline: crossbar, NEST, bus, BIRRD, and output accumulation.

## Problem Statement

The MINISA paper Figure 7 demonstrates irregular tiling with mapping adaptation:

```
C[16, 8] = A[16, 12] x B[12, 8]   on a 4x4 NEST (AH=AW=4)
```

K=12 with AH=4 gives K/AH=3 WVN rows. With AW=4, the standard Gr=AW//2=2
configuration splits PE columns into 2 groups of 2, processing 2 WVN rows per
tile. This handles rows 0 and 1 (K=[0,8)), but the remaining row 2 (K=[8,12))
cannot fill 2 groups. The solution adapts Gr between tiles:

| Tile Type | Gr | K Groups | K Range  | M/tile | BIRRD Mode    |
|-----------|----|----------|----------|--------|---------------|
| Tile 1    | 2  | 2        | [0, 8)   | 2      | Reduction     |
| Tile 2    | 4  | 1        | [8, 12)  | 4      | Pass-through  |

The Allo hardware previously hardcoded `HalfAW = AW // 2` in the crossbar and
used a single BIRRD instruction for all tiles, making it impossible to support
adaptive Gr.

## Changes

### 1. ISA Parameter Fix (`minisa/isa.py`)

`create_gemm_program` declared output-stationary mapping as `Gr=AW, sr=0, sc=0`,
but the order-0 crossbar actually computed `ic_j % (AW//2)` and
`ic_j // (AW//2)`, which corresponds to `Gr=AW//2, sr=1, sc=0`. The declared
parameters now match the hardware behavior:

```python
# Before (incorrect declaration)
Gr, Gc, sr, sc = AW, 1, 0, 0

# After (matches crossbar behavior)
Gr, Gc, sr, sc = AW // 2, 1, 1, 0
```

### 2. Figure 7 Program Generator (`minisa/isa.py`)

Added `create_figure7_program()` that generates the complete MINISA program for
the Figure 7 workload with 24 tile mappings:

- **16 Gr=2 tiles**: 2 N-tiles x 8 M-tiles x 1 K-step, covering K=[0,8)
- **8 Gr=4 tiles**: 2 N-tiles x 4 M-tiles x 1 K-step, covering K=[8,12)

Each tile's SetMapping encodes the paper's parameters (Gr, Gc=2, sr=1, sc=4)
along with concrete m_start/n_start/k_start bounds.

### 3. Parametric Crossbar (`feather_minisa.py`)

The order-0 IVN and WVN crossbar branches now decode `Gr` from the instruction
array at runtime instead of using the compile-time constant `HalfAW`:

```python
# Decode from SetMapping instruction
Gr: int32 = local_instructions[inst_idx, 3]

# IVN order-0 (was: ic_j % Mt, ic_j // Mt)
m_idx = m_start + (ic_j % Gr)
k_idx = k_start + ic_i + (ic_j // Gr) * AH

# WVN order-0 (was: wc_w // HalfAW)
wk_idx = k_start + wc_k + (wc_w // Gr) * AH
```

When `Gr = AW//2` (all existing programs), this produces identical behavior to
the previous hardcoded crossbar. When `Gr = AW` (Figure 7 tile 2), all PE
columns share the same K group, and each column processes a distinct M position.

Orders 1-5 remain unchanged (hardcoded `HalfAW`/`Mt`).

### 4. Per-Tile BIRRD Instructions (`feather_minisa.py`)

The BIRRD instruction array changed from 2D `[P0, P1]` (single instruction for
all tiles) to 3D `[num_tiles, P0, P1]` (one instruction set per tile):

- **`inst_rw` kernel**: Now loops over tiles, sending P0*P1 switch instructions
  per tile
- **`BIRRD` kernel**: Reads a new instruction at the start of each tile's AH
  iterations (previously read once before the combined `num_tiles * AH` loop)
- **Wrapper logic**: For each tile, selects BIRRD configuration based on Gr:
  - `Gr < AW`: Standard reduction BIRRD (from precomputed OVN-order table)
  - `Gr == AW`: All-PS pass-through (zeros, since PS=0)

### 5. Parametric Output Accumulation (`feather_minisa.py`)

The output column map changed from 1D `[Mt]` to 2D `[num_tiles, AW]`, with an
additional `output_num_m[num_tiles]` array:

| Mode          | num_m  | col_map                | Behavior                       |
|---------------|--------|------------------------|--------------------------------|
| Reduction     | Mt     | BIRRD output permutation | Mt reduced values via col_map |
| Pass-through  | AW     | Identity [0,1,...,AW-1] | AW unreduced values directly  |

The inner accumulation loop iterates over `AW` with a runtime bounds check
`if om < num_m`, writing `C[m_start + om, n_start + on] += tile_out[on, col]`.

### 6. End-to-End Test (`tests/test_figure7_mapping.py`)

`test_figure7_functional_gemm()` was rewritten from a numpy-only computation to
a full Allo hardware test:

```python
program = create_figure7_program()
instructions = encode_program(program)
mod = build_feather_full_matrix_simulator(M, K, N, AW, AH, int8, len(instructions))
C = np.zeros((M, N), dtype=np.int32)
mod(A, B, instructions, C)
ref = A.astype(np.int32) @ B.astype(np.int32)
np.testing.assert_array_equal(C, ref)
```

This exercises the complete dataflow path: instruction decode, parametric
crossbar with Gr=2 and Gr=4, NEST computation, per-tile BIRRD
(reduction/pass-through), and parametric output accumulation.

### 7. HLS Dataflow Compliance (`feather_minisa.py`)

Two structural changes ensure the generated HLS kernel passes Vitis HLS dataflow
checking without post-generation patching:

**Separate instruction arrays for crossbar and output_accum:**
HLS dataflow requires single-reader-single-writer per buffer.  The original
design passed `instructions` to both `crossbar_and_NEST` and `output_accum`,
creating two readers of the same buffer.  The fix precomputes `accum_m_start`
and `accum_n_start` arrays (the only fields `output_accum` needs from
instructions) and passes them as separate parameters.  The wrapper extracts
these from the instruction array at call time.

**Local accumulation buffer in output_accum:**
The original `output_accum` performed read-modify-write on `C`, causing the
HLS backend to generate both `load_buf` (to load C from memory) and
`store_res` (to write C back).  Since `output_accum` also writes to C, this
creates a multi-writer violation.  The fix uses a local `accum[M,N]` buffer
(zero-initialized inside the kernel) for tile accumulation, then copies the
final result to `local_C` in a single write pass.  This makes C output-only
in the kernel, eliminating the load-buf process.

### 8. HLS Tests (`tests/test_figure7_hls.py`)

Added two HLS tests for the Figure 7 case study:

- **CSim**: Builds the full FEATHER+ dataflow with `build_feather_full_matrix_hls`
  and runs through Vitis HLS C simulation.  Verifies output matches numpy reference.

- **CSynth**: Builds the dataflow in `csyn` mode, runs Vitis HLS C synthesis,
  and parses the synthesis report to extract cycle count and resource utilization.

Synthesis results (Vitis HLS 2023.2, xcu280, 3.33 ns clock):

| Metric | Value |
|--------|-------|
| Latency (worst) | 1804 cycles |
| Estimated clock | 2.752 ns |
| BRAM_18K | 21 |
| DSP | 9 |
| FF | 45,973 |
| LUT | 45,407 |

### 9. Existing Test Update (`tests/test_full_matrix_gemm.py`)

`test_pe_mapping_fields_encoded` expectations updated from `Gr=8, sr=0` to
`Gr=4, sr=1` for output-stationary dataflow, matching the corrected ISA
parameters.

## Dataflow Diagram

```
  instructions[num_inst, 13]         accum_m_start[num_tiles]
         │                           accum_n_start[num_tiles]
         │                                    │
         ▼                                    │
  ┌──────────────────────────────────────────┐│
  │        crossbar_and_NEST                 ││
  │                                          ││
  │  Decode: Gr = instructions[tile+3, 3]    ││
  │                                          ││
  │  IVN order-0:                            ││
  │    m_idx = m_start + (aw % Gr)           ││
  │    k_idx = k_start + ah + (aw//Gr)*AH    ││
  │                                          ││
  │  WVN order-0:                            ││
  │    wk_idx = k_start + wk + (ww//Gr)*AH   ││
  │    wn_idx = n_start + wi                 ││
  │                                          ││
  │  NEST: AH x AW PE dot products          ││
  └────────────────┬─────────────────────────┘│
                   │ nest_out [TyPacked, AH]  │
                   ▼                          │
  ┌──────────────────────┐                    │
  │        bus            │                    │
  │  Unpack to AW streams │                    │
  └────────────┬─────────┘                    │
               │ connection[0, 0..AW-1]       │
               ▼                              │
  ┌──────────────────────────────────────┐    │   birrd_inst
  │  inst_rw                             │    │  [num_tiles, P0, P1]
  │  Send per-tile BIRRD instructions    │────│──┐
  └──────────────────────────────────────┘    │  │
                                              │  ▼
  ┌──────────────────────────────────────────────────┐
  │  BIRRD [P0 x P1 switches]                        │
  │                                                  │
  │  Per tile: read inst_val, process AH iterations  │
  │                                                  │
  │  Gr < AW:  reduction BIRRD (AR/AL/SW/PS)         │
  │  Gr == AW: pass-through BIRRD (all PS)           │
  └────────────────────┬─────────────────────────────┘
                       │ connection[P0, 0..AW-1]
                       ▼
  ┌──────────────────────────────────────────────────┐
  │  output_accum                                    │◄──── accum_m_start,
  │                                                  │      accum_n_start,
  │  Local accum[M,N] buffer (zero-init)             │      output_col_map,
  │  Per tile: read num_m, col_map from arrays       │      output_num_m
  │                                                  │
  │  Reduction (num_m=Mt):                           │
  │    accum[m+om, n+on] += out[on, col[om]]         │
  │                                                  │
  │  Pass-through (num_m=AW):                        │
  │    accum[m+om, n+on] += out[on, om]              │
  │                                                  │
  │  Final: C[i,j] = accum[i,j]  (write-only)       │
  └──────────────────────────────────────────────────┘
```

**HLS dataflow compliance:** The `instructions` buffer is only read by
`crossbar_and_NEST` (single reader). The `output_accum` kernel receives
precomputed `accum_m_start`/`accum_n_start` arrays instead of sharing
`instructions`. The `C` output is write-only in `output_accum` (uses a
local accumulation buffer), so no `load_buf` process is generated.

## Test Results

### Existing Simulator Tests (backward compatibility): 13/13 PASSED

```
tests/test_full_matrix_gemm.py::test_full_matrix_gemm_8x8x16         PASSED
tests/test_full_matrix_gemm.py::test_full_matrix_gemm_16x8x32        PASSED
tests/test_full_matrix_gemm.py::test_full_matrix_gemm_16x16x32       PASSED
tests/test_full_matrix_gemm.py::test_full_matrix_instruction_encoding PASSED
tests/test_full_matrix_gemm.py::test_full_matrix_single_invocation    PASSED
tests/test_full_matrix_gemm.py::test_layout_instruction_decode_on_chip PASSED
tests/test_full_matrix_gemm.py::test_pe_mapping_fields_encoded        PASSED
tests/test_full_matrix_gemm.py::test_order0_backward_compatible       PASSED
tests/test_full_matrix_gemm.py::test_ovn_order_produces_different_birrd PASSED
tests/test_full_matrix_gemm.py::test_ivn_order_affects_output         PASSED
tests/test_full_matrix_gemm.py::test_wvn_order_affects_output         PASSED
tests/test_full_matrix_gemm.py::test_ovn_order_all_correct            PASSED
tests/test_full_matrix_gemm.py::test_r0_c0_tile_advancement           PASSED
```

### Figure 7 Mapping Tests: 8/8 PASSED

```
tests/test_figure7_mapping.py::test_figure7_tile1_pe_mapping          PASSED
tests/test_figure7_mapping.py::test_figure7_tile2_pe_mapping          PASSED
tests/test_figure7_mapping.py::test_figure7_mapping_adaptation        PASSED
tests/test_figure7_mapping.py::test_figure7_full_pe_utilization       PASSED
tests/test_figure7_mapping.py::test_figure7_k_coverage_per_output_column PASSED
tests/test_figure7_mapping.py::test_figure7_no_k_overlap_between_tiles PASSED
tests/test_figure7_mapping.py::test_figure7_functional_gemm           PASSED  <-- Allo e2e
tests/test_figure7_mapping.py::test_figure7_tile2_replication_factor  PASSED
```

### Existing HLS CSim Tests: 5/5 PASSED

```
tests/test_full_matrix_hls_csim.py::test_hls_csim_gemm_8x8x16       PASSED
tests/test_full_matrix_hls_csim.py::test_hls_csim_gemm_16x8x32      PASSED
tests/test_full_matrix_hls_csim.py::test_hls_csim_gemm_16x16x32     PASSED
tests/test_full_matrix_hls_csim.py::test_hls_csim_ovn_orders         PASSED
tests/test_full_matrix_hls_csim.py::test_hls_csim_matches_simulator  PASSED
```

### Figure 7 HLS Tests: 2/2 PASSED

```
tests/test_figure7_hls.py::test_figure7_hls_csim                     PASSED
tests/test_figure7_hls.py::test_figure7_hls_csynth                   PASSED
```

CSynth results (Vitis HLS 2023.2, xcu280-fsvh2892-2L-e, 3.33 ns clock):
- Latency: 1804 cycles (worst case)
- Estimated clock: 2.752 ns
- Resources: 21 BRAM_18K, 9 DSP, 45,973 FF, 45,407 LUT

## Files Modified

| File | Change |
|------|--------|
| `minisa/isa.py` | Fixed output-stationary Gr/sr; added `create_figure7_program()` |
| `feather_minisa.py` | Parametric crossbar, per-tile BIRRD, parametric output_accum, HLS dataflow compliance, wrapper |
| `tests/test_figure7_mapping.py` | Replaced numpy test with Allo end-to-end test |
| `tests/test_full_matrix_gemm.py` | Updated expected Gr/sr values for output-stationary |
| `tests/test_figure7_hls.py` | New: HLS csim (functional) and csynth (cycle count) tests |
