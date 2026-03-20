---
id: TICKET-002
title: Support mixed Kt_per_pass across tiles
status: resolved
priority: medium
---

# TICKET-002: Support Mixed Kt_per_pass Across Tiles

## Problem

All tiles in a program must currently share the same `num_k_passes` value.
This means every tile must have the same `Kt_per_pass = (AW / Gr) * AH`,
which forces uniform Gr across all tiles or restricts K-dimension tiling.

## Why It Matters

- Real workloads may have tiles with different Gr values that imply different Kt_per_pass
- Irregular matrix shapes may need different K-tile counts per output tile
- Limits the flexibility that MINISA is designed to provide

## Root Cause

The `nest_compute` kernel uses a single `num_k_passes` loop bound shared across
all tiles. The crossbar similarly assumes uniform K-pass count. Allowing per-tile
variation requires either:
1. Encoding num_k_passes per tile in the instruction word, or
2. Grouping tiles by Kt_per_pass and processing groups sequentially

## Relevant Code

- `feather_minisa.py`: `nest_compute` kernel — `num_k_passes` loop
- `feather_minisa.py`: `crossbar_load` kernel — K-pass iteration
- `minisa/isa.py`: `SetMapping` instruction — k_start/k_end fields

## Acceptance Criteria

- [ ] Program with tiles having different Gr (and thus different Kt_per_pass) runs correctly
- [ ] num_k_passes is derived per-tile from instruction fields
- [ ] Existing uniform-Kt_per_pass tests still pass
- [ ] At least one test with mixed Gr tiles producing correct GEMM
