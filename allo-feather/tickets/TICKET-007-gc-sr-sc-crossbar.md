---
id: TICKET-007
title: Support Gc/sr/sc in crossbar for full dataflow flexibility
status: resolved
priority: P1
---

# TICKET-007: Support Gc/sr/sc in Crossbar for Full Dataflow Flexibility

## Problem

The MINISA parametric mapping uses six parameters (r0, c0, Gr, Gc, sr, sc) to map
PE positions to WVN indices. The Allo crossbar_load only uses Gr — the Gc, sr, and
sc fields are encoded in instructions but ignored in the crossbar index computation.

This hard-codes one indexing pattern (output-stationary-like) and prevents other
dataflow families from working.

## Why It Matters

- The MINISA paper's central contribution is enabling arbitrary dataflow switching
  via VN-level parametric mapping
- Weight stationary (Gr=1, Gc=AW, sr=0, sc=1) is important for workloads with
  large weight reuse
- Input stationary (Gr=1, Gc=1, sr=1, sc=0) is important for depthwise convolution
- Without this, FEATHER+ is limited to a single dataflow family

## MINISA Mapping Formula

From the paper (Equations 2-3):

```
r(ah, aw) = r0 + floor(aw / Gr)
c(ah, aw) = c0 + sr * ah + sc * (aw mod Gc)
```

Where:
- `r` selects the WVN row (indexes into K dimension for weights)
- `c` selects the WVN column (indexes into N dimension for weights)
- `ah` ∈ [0, AH) is the PE row (temporal dimension)
- `aw` ∈ [0, AW) is the PE column (spatial dimension)

## Implementation

### Weight crossbar generalization

The weight N-index was changed from `wn_idx = n_start + wc_i` to the full
parametric formula:

```python
wn_idx: int32 = n_start + sr * wc_i + sc * (wc_w & mask_Gc)
```

Where `mask_Gc = Gc - 1` (power-of-2 bit operation, no divider).

### Input crossbar

Unchanged — input indexing depends only on Gr (already fully generalized via
bit operations: `ic_j & mask_Gr` and `ic_j >> log2_Gr`).

### output_accum generalization

Added `output_n_base` array to encode per-tile, per-output-column N-offset:

```python
n_off: int32 = sr_val * on + n_base_col
accum[m_start + m_pos, n_start + n_off] += tile_out[on, col]
```

The `n_base_col` encodes `sc * (original_pe_col & mask_Gc)`, accounting for
BIRRD butterfly permutation of output columns.

### sr=0 guard

When `sr=0`, all AH temporal rows produce identical results (same weight column).
The guard prevents AH-fold duplication by only accumulating `on=0`:

```python
if sr_val == 0:
    if on > 0:
        skip = 1
```

### FeatherKStreamingModule updates

- Added `_simulate_birrd_passthrough_perm` for n_base computation
- Added `_pair_to_col` maps for reduction-mode n_base
- 3-way Gr handling in `__call__`: Gr==AW (passthrough), Gr==1 (passthrough Mt=1),
  Gr<AW (reduction)

## Dependencies

- TICKET-008 (multi-way BIRRD): Weight-stationary (Gr=1) and input-stationary
  require AW-way reduction, which needs multi-way BIRRD support.
  Gc/sr/sc crossbar support alone only helps when paired with appropriate BIRRD.

## Relevant Code

- `feather_minisa.py`: `crossbar_load` kernel, `output_accum` kernel,
  `FeatherKStreamingModule.__init__` and `__call__`
- `minisa/isa.py`: `SetMapping` dataclass, `encode_program()`
- `tests/test_crossbar_flexibility.py`: `test_sr_zero_output_stationary()`
- MINISA paper: Section IV.C (Equations 1-3), Figure 4

## Acceptance Criteria

- [x] crossbar_load uses Gc, sr, sc from decoded instructions
- [x] Index formulas match MINISA paper's parametric mapping
- [x] Output-stationary (Gr=AW//2, sr=1, sc=0) still passes all existing tests
- [x] At least one test with sr≠1 or sc≠0 producing correct GEMM
      (test_sr_zero_output_stationary: sr=0, sc=0, Gr=AW, 1 N-col per tile)
- [x] All operations are HLS-friendly (shifts and masks, no dividers)
