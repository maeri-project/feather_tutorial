# TICKET-001: Multi-Way BIRRD Reduction — Implementation Report

## Summary

Extended FEATHER+ MINISA to support all power-of-2 Gr values (1, 2, ..., AW),
enabling weight-stationary and arbitrary dataflow mappings. Previously only
Gr=AW (pass-through) and Gr=AW//2 (2-way reduction) produced correct results.

## Key Insight

The BIRRD butterfly network does NOT need modification. It always performs 2-way
reduction: AW inputs → AW//2 reduced pairs. For Gr < AW//2, multiple BIRRD output
pairs map to the same M position via `pair_idx % Gr`. The `output_accum` kernel
simply accumulates all columns contributing to each M position — achieving
N-way reduction (where N = AW/Gr) without any hardware changes.

### Why This Works

PE column j handles M index `j % Gr`. BIRRD reduces pairs `{p, p+AW//2}`.
Both columns in a pair share the same M index because `(AW//2) % Gr == 0` for
all power-of-2 Gr ≤ AW//2. So pair p → M position `p % Gr`.

Example (AW=8, Gr=2):
- BIRRD pairs: {0,4}→pair_0, {1,5}→pair_1, {2,6}→pair_2, {3,7}→pair_3
- M positions: pair_0 → M=0, pair_1 → M=1, pair_2 → M=0, pair_3 → M=1
- output_accum: C[m=0,:] = tile_out[:,col_A] + tile_out[:,col_C] (4-way sum)

## Changes

### `minisa/lowering.py`

- **`_simulate_birrd_passthrough_perm(AW)`**: Traces singleton inputs through
  all-PS BIRRD routing to compute the actual output permutation. Fixes a latent
  bug where Gr=AW mode assumed identity permutation (wrong for AW>4).

- **`compute_col_to_m_map(AW, ovn_order, Gr)`**: Returns shape [AW] array
  mapping BIRRD output column → local M position. Uses sentinel value AW for
  unused columns (skipped by `m_pos < num_m` check in output_accum).

### `feather_minisa.py`

- **`output_accum` kernel**: Reversed loop direction from `for om → col`
  (M position → column, 1-to-1) to `for col → m_pos` (column → M position,
  many-to-one). This enables multi-way accumulation when multiple columns
  contribute to the same M position.

- **`FeatherKStreamingModule.__init__`**: Precomputes `_col_to_m_maps` dict
  keyed by `(order, Gr)` for all valid power-of-2 Gr values and 6 OVN orders.

- **`FeatherKStreamingModule.__call__`**: Uses `col_to_m_maps[(order, Gr)]`
  for all tiles, with `num_m = Gr` (was `AW//2` for reduction, `AW` for passthrough).

### `minisa/isa.py`

- **`create_gemm_program()`**: Added `gr: Optional[int]` parameter. When specified,
  derives tile sizes from Gr: `Mt = Gr`, `Kt = (AW // Gr) * AH`. Default behavior
  unchanged (output_stationary: Gr=AW//2, weight_stationary: Gr=1).

### `tests/test_figure7_cosim.py`

- Updated to use `compute_col_to_m_map()` instead of `compute_output_col_map()`.

## Test Results

### New Tests (test_crossbar_flexibility.py)

| Test | AW | Gr | Reduction | Workload | Result |
|------|----|----|-----------|----------|--------|
| test_gr_1_aw4 | 4 | 1 | 4-way | C[1,4] = A[1,16] × B[16,4] | **PASS** |
| test_gr_2_aw8 | 8 | 2 | 4-way | C[2,8] = A[2,32] × B[32,8] | **PASS** |
| test_gr_1_aw8 | 8 | 1 | 8-way | C[1,8] = A[1,64] × B[64,8] | **PASS** |

### Backward Compatibility (all existing tests)

| Test Suite | Tests | Result |
|-----------|-------|--------|
| test_crossbar_flexibility.py | 7/7 | **ALL PASS** |
| test_figure7_mapping.py | 8/8 | **ALL PASS** |
| test_full_matrix_gemm.py | 10/10 | **ALL PASS** |
| test_parameterized_gemm.py --aw 4 | 12/12 | **ALL PASS** |
| test_parameterized_gemm.py --aw 8 | 12/12 | **ALL PASS** |

## Backward Compatibility Analysis

- **Gr=AW//2** (output-stationary): pair p → M = p % (AW//2) = p. Each pair maps
  to unique M. Semantically identical to old 1-to-1 behavior. ✓
- **Gr=AW** (pass-through): `col_to_m[col] = perm[col]`. For AW=4 perm is identity
  (same as old code). For AW>4 perm may differ — but Gr=AW passthrough was only
  tested at AW=4, and the new code is correct for all AW. ✓

## Remaining Work

- HLS csim validation for Gr<AW//2 workloads (TICKET-001 acceptance criterion)
- Multi-tile Gr<AW//2 tests (multiple M tiles with small Gr)
