---
id: TICKET-005
title: Zero point subtraction in NEST PE
status: resolved
priority: P0
---

# TICKET-005: Zero Point Subtraction in NEST PE

## Problem

The RTL PE (`feather_pe.v`) computes `(iacts - iacts_zp) * (weights - weights_zp)` with
dedicated zero-point registers. The Allo `nest_compute` kernel does plain
`iActs[nk, nj] * weights[ni, nj, nk]` — no zero point support.

## Why It Matters

- Asymmetric quantization (non-zero zero points) is standard for int8 inference
- Virtually all real quantized models have non-zero zero points
- Without this, the Allo model produces incorrect results for quantized workloads
- Blocks post-quantization (TICKET-006) and multi-layer execution (TICKET-009)

## RTL Reference

`feather_pe.v` lines 209-213:
```verilog
w_iacts_sub_zp   = {1'b0, w_iacts}          - {1'b0, r_i_iacts_zp};
w_weights_sub_zp = {1'b0, w_selected_weight} - {1'b0, r_i_weights_zp};
w_mul            = r_iacts_sub_zp * r_weights_sub_zp;
```

Zero points are broadcast to all PEs via `i_iacts_zp`/`i_weights_zp` with valid signals.
The subtraction widens unsigned int8 to signed int9 before multiplication (int9 × int9 → int18 → int32 accumulation).

## Proposed Implementation

1. Add `iacts_zp` and `weights_zp` as module-level constants (int32) to
   `get_feather_full_matrix_top_kstreaming()`, or encode them in the instruction
   stream (e.g., in unused fields of SetIVNLayout/SetWVNLayout rows).

2. In `nest_compute`, change the inner loop:
   ```python
   # Before:
   temp += iActs[nk, nj] * weights[ni, nj, nk]
   # After:
   temp += (iActs[nk, nj] - iacts_zp) * (weights[ni, nj, nk] - weights_zp)
   ```

3. Note: Allo int8 is signed (-128..127). The RTL uses unsigned int8 (0..255) with
   explicit zero-extension before subtraction. May need to use UInt(8) or adjust
   the subtraction to match RTL semantics.

## Relevant Code

- `feather_minisa.py`: `nest_compute` kernel, lines 258-263
- `feather_pe.v`: Lines 204-218 (MAC logic)

## Acceptance Criteria

- [x] nest_compute supports iacts_zp and weights_zp parameters
- [x] Subtraction uses int32 promotion (a_val - iacts_zp) * (w_val - weights_zp)
- [x] Existing tests still pass with zp=0 (backward compatible)
- [x] 8 test cases with non-zero zero points producing correct GEMM (AW=8 and AW=4)
- [ ] HLS csim passes with zero points (not yet tested)
