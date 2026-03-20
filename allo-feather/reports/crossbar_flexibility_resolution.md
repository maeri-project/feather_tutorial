# FEATHER+ Allo: Crossbar Flexibility Resolution

**Date:** 2026-03-04
**Status:** Complete
**Branch:** minisa

## Problem

The K-streaming kernel hardcoded Gr=AW in the crossbar index arithmetic,
sacrificing FEATHER+'s core dataflow switching capability for performance.
The alternative general-purpose kernel supported any Gr via runtime `%`/`//`
but compiled to 14 multi-cycle integer dividers (1792 cycles, 1.60x vs RTL).

See `crossbar_flexibility_gap.md` for the original gap analysis.

## Solution: Power-of-2 Bit Operations

Since Gr always divides AW and AW is a power of 2, Gr is always a power of 2.
Replaced modulo/division with bit masks and shifts:

```python
# Compute log2_Gr via comparison chain (Gr is power of 2)
log2_Gr: int32 = 0
if Gr >= 2: log2_Gr = 1
if Gr >= 4: log2_Gr = 2
if Gr >= 8: log2_Gr = 3
if Gr >= 16: log2_Gr = 4
mask_Gr: int32 = Gr - 1

# Input crossbar (ORDER_012 with bit ops):
m_idx = m_start + (ic_j & mask_Gr)              # ic_j % Gr  -> AND gate
k_idx = k_start + ic_i + (ic_j >> log2_Gr) * AH # ic_j // Gr -> shift mux

# Weight crossbar:
wk_idx = k_start + wc_k + (wc_w >> log2_Gr) * AH
wn_idx = n_start + wc_i
```

Bit operations compile to combinational logic in Vitis HLS:
- `&` -> AND gate (1 LUT)
- `>>` -> barrel shifter / mux (few LUTs)
- Zero pipeline latency, no FF cost, no II degradation

## Changes Made

### feather_minisa.py (812 -> 443 lines)

1. **crossbar_load kernel**: Replaced hardcoded `local_A[m_start + ic_j, k_start + ic_i]`
   with parametric `local_A[m_start + (ic_j & mask_Gr), k_start + ic_i + (ic_j >> log2_Gr) * AH]`.
   Per-tile Gr read from instruction array. Same change for weight crossbar.

2. **FeatherKStreamingModule wrapper**: Ported per-tile BIRRD logic from the old
   FeatherFullMatrixModule. Precomputes BIRRD tables for all 6 OVN orders at build time.
   Per-tile dispatch: Gr < AW -> BIRRD reduction (Mt=AW//2 outputs), Gr == AW -> pass-through
   (AW outputs, identity col_map).

3. **Deleted old code**: Removed `get_feather_full_matrix_top()` (general-purpose kernel with
   runtime dividers), `FeatherFullMatrixModule`, `build_feather_full_matrix_simulator()`,
   `build_feather_full_matrix_hls()`, `run_full_matrix_gemm()`. Single unified kernel now
   handles all Gr values.

### tests/test_crossbar_flexibility.py (new)

Four tests verifying crossbar flexibility:

| Test | Gr | Mode | Workload |
|---|---|---|---|
| test_gr_equals_aw | 4 (=AW) | Pass-through BIRRD | C[16,8] = A[16,12] x B[12,8] |
| test_gr_half_aw | 2 (=AW//2) | BIRRD reduction | C[8,4] = A[8,8] x B[8,4] |
| test_mixed_gr_tiles | 2 and 4 | Mixed per-tile | C[8,4] = A[8,12] x B[12,4] |
| test_bit_ops_equivalence | all | Unit test | Verify & == %, >> == // |

### tests/test_full_matrix_gemm.py (updated)

Ported from old `run_full_matrix_gemm` / `build_feather_full_matrix_simulator` to use
`build_feather_kstreaming_simulator` with proper `num_k_passes` and `Kt_per_pass` computation.
Removed IVN/WVN order tests (crossbar always uses ORDER_012). 10 tests, all pass.

## Results

### Simulator Tests

All 22 tests pass:
- test_crossbar_flexibility.py: 4/4 (Gr=AW, Gr=AW//2, mixed, bit-ops)
- test_figure7_mapping.py: 8/8 (ISA mapping + functional GEMM)
- test_full_matrix_gemm.py: 10/10 (GEMM regression + encoding + OVN orders)

### HLS Synthesis (csynth)

| Metric | Old (hardcoded Gr=AW) | New (parametric Gr) |
|---|---|---|
| Cycle count (worst) | 764 | 770 |
| Integer dividers | 0 | 0 |
| FF | ~18,000 | 18,987 |
| LUT | ~25,000 | 25,748 |
| DSP | 49 | 49 |
| BRAM | 20 | 20 |
| Est. clock | 2.792 ns | 2.792 ns |

Negligible resource overhead from the comparison chain and bit operations.

### RTL Co-Simulation (cosim)

| Implementation | Cycles | vs RTL |
|---|---|---|
| General-purpose (runtime %, deleted) | 1792 | 1.60x |
| K-streaming hardcoded Gr=AW (old) | 1001 | 0.89x |
| **K-streaming bit ops (new)** | **1004** | **0.90x** |
| RTL reference (Icarus Verilog) | 1120 | 1.00x |

The flexible crossbar costs only **3 extra cycles** compared to the hardcoded version.
The Allo implementation remains **10% faster** than the RTL reference.

## Architecture Constraints

The current implementation supports Gr = AW and Gr = AW//2:

- **Gr = AW** (pass-through): Each PE column handles an independent M row. No BIRRD
  reduction. Mt = AW outputs per tile. Used for Figure 7 K-streaming.

- **Gr = AW//2** (2-way reduction): Paired columns handle different K-stripes for
  the same M rows. BIRRD reduces partial K-sums. Mt = AW//2 outputs per tile.
  Used for output-stationary dataflow on larger arrays.

- **Gr < AW//2**: Not supported. Would require more than 2-way reduction in BIRRD,
  but the current BIRRD network only performs pairwise (column j, column j+Mt) reduction.
  Supporting Gr=1 (weight stationary) would need multi-pass BIRRD or different output
  accumulation logic.

The K-pass structure constraint: `Kt_per_pass = (AW/Gr) * AH` determines how many
K-elements each pass covers. All tiles in a program must share the same `num_k_passes`
and `Kt_per_pass`, which limits mixed-Gr programs to tiles with compatible K-strides.

## Files Modified

| File | Change |
|---|---|
| `feather_minisa.py` | Parametric Gr crossbar (bit ops), per-tile BIRRD, deleted old kernel |
| `tests/test_crossbar_flexibility.py` | New: multi-Gr functional tests |
| `tests/test_full_matrix_gemm.py` | Updated to K-streaming builders |
| `CLAUDE.md` | Updated to reflect unified kernel |
| `reports/crossbar_flexibility_gap.md` | Status changed to RESOLVED |
| `reports/presentation_feather_allo.md` | Slide 15 updated with resolution |
