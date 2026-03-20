---
id: TICKET-008
title: Multi-way BIRRD reduction for arbitrary Gr
status: resolved
priority: P1
---

# TICKET-008: Multi-Way BIRRD Reduction for Arbitrary Gr

## Problem

BIRRD instruction tables currently only support 2-way reduction (Gr=AW//2) and
pass-through (Gr=AW). Smaller Gr values (Gr=AW//4, AW//8, ..., 1) require
multi-stage reduction in the BIRRD butterfly network, which is not implemented.

## Why It Matters

- Weight stationary (Gr=1) requires AW-way BIRRD reduction
- Intermediate groupings (Gr=AW//4, etc.) enable more dataflow options
- The FEATHER paper demonstrates flexible reduction groups as a key differentiator
- Previous workaround: 2-way BIRRD + output_accum summing (functional but suboptimal)

## Implementation

### Greedy BIRRD Instruction Generation Algorithm

Added `generate_birrd_instructions(AW, Gr)` in `minisa/lowering.py`. Uses a
forward pass through the butterfly network:

1. Initialize all switches to PS (pass-through)
2. Track frozensets of contributing input indices at each wire
3. At each switch: if both inputs belong to the same reduction group (same
   `input_idx % Gr`) and combining them would increase the accumulated set,
   set the switch to AL (add-left)
4. The butterfly topology naturally brings together elements at the right
   distances for tree reduction at successive stages

This produces `log2(AW/Gr)` levels of pairwise reduction, fully reducing
each M-position's partial sums inside BIRRD hardware.

### Supporting Functions

- `_simulate_birrd_output_col_map_general(birrd_inst, AW, Gr)`: Generalized
  symbolic simulator that finds output columns containing fully-reduced values
  for arbitrary Gr (not just 2-way)
- `_simulate_birrd_frozensets(birrd_inst, AW)`: Core simulator returning
  frozenset map for any BIRRD configuration
- `_compute_routing_tables(AW)`: Shared routing table computation

### Integration

- `FeatherKStreamingModule.__init__`: Precomputes multi-way BIRRD tables for
  all Gr < AW//2 via `generate_birrd_instructions()`
- `FeatherKStreamingModule.__call__`: 3-way dispatch:
  - Gr == AW: passthrough (all-PS)
  - Gr == AW//2: hand-coded order-dependent 2-way tables (unchanged)
  - Gr < AW//2: generated multi-way tables with full tree reduction
- `compute_col_to_m_map()`: Updated to use generated BIRRD instructions for
  Gr < AW//2, producing correct col→M mapping from the generalized simulator

### Verified Combinations

| AW | Gr | Reduction | Status |
|----|-----|-----------|--------|
| 4  | 1   | 4-way     | OK     |
| 4  | 2   | 2-way     | OK     |
| 4  | 4   | pass      | OK     |
| 8  | 1   | 8-way     | OK     |
| 8  | 2   | 4-way     | OK     |
| 8  | 4   | 2-way     | OK     |
| 8  | 8   | pass      | OK     |
| 16 | 1   | 16-way    | OK     |
| 16 | 2   | 8-way     | OK     |
| 16 | 4   | 4-way     | OK     |
| 16 | 8   | 2-way     | OK     |
| 16 | 16  | pass      | OK     |

## Relevant Code

- `minisa/lowering.py`: `generate_birrd_instructions()`,
  `_simulate_birrd_output_col_map_general()`, `_simulate_birrd_frozensets()`,
  `_compute_routing_tables()`, updated `compute_col_to_m_map()`
- `feather_minisa.py`: `FeatherKStreamingModule.__init__` and `__call__`
- `tests/test_crossbar_flexibility.py`: `test_multiway_birrd_generation()`,
  `test_multiway_birrd_gr2_aw8_gemm()`, `test_multiway_birrd_gr1_aw8_gemm()`

## Acceptance Criteria

- [x] BIRRD instruction generation for arbitrary power-of-2 Gr (1 ≤ Gr ≤ AW)
- [x] Verified via simulation for AW=4: Gr=1 (4-way), Gr=2 (2-way), Gr=4 (pass)
- [x] Verified via simulation for AW=8: Gr=1 (8-way), Gr=2 (4-way), Gr=4 (2-way), Gr=8 (pass)
- [x] Correct GEMM output for Gr < AW//2 test cases (Gr=2 and Gr=1 on AW=8)
- [x] Existing 2-way reduction tests still pass (all 13 crossbar tests green)
- [x] Generated BIRRD programs produce valid col→M output maps (all 12 AW/Gr combos)
