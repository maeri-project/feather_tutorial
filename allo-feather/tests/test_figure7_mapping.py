# Copyright Allo authors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Test for MINISA Figure 7: irregular tiling with mapping adaptation.

Reproduces the walk-through case study from MINISA paper Figure 7:
  C[16, 8] = A[16, 12] x B[12, 8]  on a 4x4 NEST (AH=AW=4)

K=12 with AH=4 gives K/AH=3 WVN rows, which cannot be evenly split
across 2 PE-column groups.  The solution uses two compute tiles with
*different* Gr values:

  Tile 1: SetMapping(r0=0, c0=0, Gr=2, Gc=2, sr=1, sc=4)
    - Gr=2 splits 4 PE columns into 2 groups of 2
    - Covers WVN rows 0,1 (K elements [0,8))
    - All 16 PEs map to unique (r,c) pairs

  Tile 2: SetMapping(r0=2, c0=0, Gr=4, Gc=2, sr=1, sc=4)
    - Gr=4 means all 4 PE columns share WVN row 2
    - Covers WVN row 2 (K elements [8,12))
    - 8 unique (r,c) pairs, each replicated to 2 PEs
    - Replication processes different M indices in parallel

Key insight: the mapping *adapts* Gr between tiles so that all PEs
remain utilized even when the remaining K dimension is smaller.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from minisa.isa import SetMapping


# Hardware parameters
AH = 4
AW = 4

# Workload: C[16,8] = A[16,12] x B[12,8]
M, K, N = 16, 12, 8

# Figure 7 tile mappings
TILE1 = SetMapping(r0=0, c0=0, Gr=2, Gc=2, sr=1, sc=4)
TILE2 = SetMapping(r0=2, c0=0, Gr=4, Gc=2, sr=1, sc=4)


def _compute_all_pe_mappings(mapping):
    """Return dict {(ah, aw): (r, c)} for all PEs."""
    return {
        (ah, aw): mapping.get_pe_mapping(ah, aw)
        for ah in range(AH)
        for aw in range(AW)
    }


def test_figure7_tile1_pe_mapping():
    """Verify exact (r, c) indices for every PE in tile 1.

    Tile 1: r0=0, Gr=2 → aw//2 splits columns into 2 groups.
      Columns 0,1 → r=0;  Columns 2,3 → r=1
    Column index: c = ah + 4*(aw%2)
      aw even → c=ah;  aw odd → c=ah+4
    All 16 PEs map to unique (r, c) pairs covering WVN[0:2, 0:8].
    """
    # Expected mapping: (ah, aw) → (r, c)
    expected = {
        # r=0 group (aw=0,1)
        (0, 0): (0, 0), (0, 1): (0, 4),
        (1, 0): (0, 1), (1, 1): (0, 5),
        (2, 0): (0, 2), (2, 1): (0, 6),
        (3, 0): (0, 3), (3, 1): (0, 7),
        # r=1 group (aw=2,3)
        (0, 2): (1, 0), (0, 3): (1, 4),
        (1, 2): (1, 1), (1, 3): (1, 5),
        (2, 2): (1, 2), (2, 3): (1, 6),
        (3, 2): (1, 3), (3, 3): (1, 7),
    }

    actual = _compute_all_pe_mappings(TILE1)
    assert actual == expected, (
        f"Tile 1 PE mapping mismatch.\n"
        f"  Expected: {expected}\n"
        f"  Actual:   {actual}"
    )

    # All 16 pairs should be unique (no replication in tile 1)
    rc_pairs = list(actual.values())
    assert len(set(rc_pairs)) == AH * AW == 16


def test_figure7_tile2_pe_mapping():
    """Verify exact (r, c) indices for every PE in tile 2.

    Tile 2: r0=2, Gr=4 → aw//4=0 for all aw, so all PEs share r=2.
    Column index is the same formula: c = ah + 4*(aw%2).
    PE columns 0,2 produce the same (r,c) pair (replication for M
    parallelism); likewise columns 1,3.
    """
    expected = {
        # aw=0 and aw=2 are replicas
        (0, 0): (2, 0), (0, 2): (2, 0),
        (1, 0): (2, 1), (1, 2): (2, 1),
        (2, 0): (2, 2), (2, 2): (2, 2),
        (3, 0): (2, 3), (3, 2): (2, 3),
        # aw=1 and aw=3 are replicas
        (0, 1): (2, 4), (0, 3): (2, 4),
        (1, 1): (2, 5), (1, 3): (2, 5),
        (2, 1): (2, 6), (2, 3): (2, 6),
        (3, 1): (2, 7), (3, 3): (2, 7),
    }

    actual = _compute_all_pe_mappings(TILE2)
    assert actual == expected, (
        f"Tile 2 PE mapping mismatch.\n"
        f"  Expected: {expected}\n"
        f"  Actual:   {actual}"
    )

    # 8 unique pairs (each replicated to 2 PEs)
    rc_pairs = list(actual.values())
    assert len(set(rc_pairs)) == 8
    assert len(rc_pairs) == 16  # all PEs are assigned


def test_figure7_mapping_adaptation():
    """Verify the Gr and r0 changes between tiles.

    Tile 1 → Tile 2 adaptation:
      - Gr changes from 2 to 4 (fewer distinct WVN rows per tile)
      - r0 advances from 0 to 2 (starts at row after tile 1's coverage)
      - c0 stays 0 (both tiles cover all N=8 output columns)
      - Gc, sr, sc unchanged (same column-index pattern)
    """
    # Gr adapts to remaining K dimension
    assert TILE1.Gr == 2, "Tile 1: Gr=2 (2 WVN rows, 2 PE cols each)"
    assert TILE2.Gr == 4, "Tile 2: Gr=4 (1 WVN row, all 4 PE cols)"

    # r0 advances
    assert TILE1.r0 == 0, "Tile 1 starts at WVN row 0"
    assert TILE2.r0 == 2, "Tile 2 starts at WVN row 2"

    # c0 stays at 0 (both tiles process all N columns)
    assert TILE1.c0 == 0
    assert TILE2.c0 == 0

    # Column mapping parameters are identical
    assert TILE1.Gc == TILE2.Gc == 2
    assert TILE1.sr == TILE2.sr == 1
    assert TILE1.sc == TILE2.sc == 4

    # Number of distinct WVN rows per tile
    tile1_rows = {TILE1.get_pe_mapping(0, aw)[0] for aw in range(AW)}
    tile2_rows = {TILE2.get_pe_mapping(0, aw)[0] for aw in range(AW)}
    assert tile1_rows == {0, 1}, f"Tile 1 rows: {tile1_rows}"
    assert tile2_rows == {2}, f"Tile 2 rows: {tile2_rows}"


def test_figure7_full_pe_utilization():
    """Verify all 16 PEs produce useful work in both tiles.

    A PE is "useful" if its mapped (r, c) is within the weight matrix
    bounds: r < K/AH and c < N.
    """
    R_WVN = K // AH  # 3 WVN rows

    for name, tile in [("Tile 1", TILE1), ("Tile 2", TILE2)]:
        active = 0
        for ah in range(AH):
            for aw in range(AW):
                r, c = tile.get_pe_mapping(ah, aw)
                if r < R_WVN and c < N:
                    active += 1
        assert active == AH * AW, (
            f"{name}: only {active}/{AH * AW} PEs are within bounds"
        )


def test_figure7_k_coverage_per_output_column():
    """Verify full K-dimension coverage for every output column.

    For each output column n, the union of K ranges from both tiles
    must cover [0, K).  The K range contributed by WVN row r is
    [r*AH, (r+1)*AH).
    """
    for n in range(N):
        k_covered = set()
        for tile in [TILE1, TILE2]:
            for ah in range(AH):
                for aw in range(AW):
                    r, c = tile.get_pe_mapping(ah, aw)
                    if c == n:
                        for k in range(r * AH, (r + 1) * AH):
                            k_covered.add(k)
        assert k_covered == set(range(K)), (
            f"Output column {n}: K coverage = {sorted(k_covered)}, "
            f"expected [0, {K})"
        )


def test_figure7_no_k_overlap_between_tiles():
    """Verify tiles 1 and 2 cover disjoint K ranges (no double-counting).

    Tile 1 covers WVN rows {0,1} → K=[0,8).
    Tile 2 covers WVN row  {2}   → K=[8,12).
    No WVN row appears in both tiles.
    """
    tile1_rows = set()
    tile2_rows = set()
    for ah in range(AH):
        for aw in range(AW):
            tile1_rows.add(TILE1.get_pe_mapping(ah, aw)[0])
            tile2_rows.add(TILE2.get_pe_mapping(ah, aw)[0])

    assert tile1_rows == {0, 1}
    assert tile2_rows == {2}
    assert tile1_rows.isdisjoint(tile2_rows), (
        f"Tiles share WVN rows: {tile1_rows & tile2_rows}"
    )


def test_figure7_functional_gemm():
    """End-to-end GEMM verification using Figure 7 mapping through Allo FEATHER+.

    Runs the complete Allo dataflow hardware with the Figure 7 MINISA program
    (uniform Gr=4, k_passes=3) and verifies the result matches numpy reference.

    24 tiles: 2 N-passes × 4 M-batches × 3 K-passes, all Gr=4.
    """
    from allo.ir.types import int8
    from minisa.isa import create_figure7_program, encode_program
    from feather_minisa import build_feather_simulator

    program = create_figure7_program()
    instructions = encode_program(program)

    # k_passes = K / Kt where Kt = (AW/Gr)*AH = 4
    k_passes = K // ((AW // 4) * AH)  # 3

    np.random.seed(7)
    A = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)

    mod = build_feather_simulator(
        M, K, N, AW, AH, int8, len(instructions), k_passes=k_passes,
    )
    C = np.zeros((M, N), dtype=np.int32)
    mod(A, B, instructions, C)

    ref = A.astype(np.int32) @ B.astype(np.int32)
    np.testing.assert_array_equal(C, ref)


def test_figure7_tile2_replication_factor():
    """Verify the replication factor in tile 2.

    With Gr=4 (=AW) and only 1 WVN row, each unique (r,c) pair
    is assigned to exactly 2 PEs — doubling M throughput for the
    remaining K reduction.
    """
    rc_to_pes = {}
    for ah in range(AH):
        for aw in range(AW):
            rc = TILE2.get_pe_mapping(ah, aw)
            rc_to_pes.setdefault(rc, []).append((ah, aw))

    for rc, pes in rc_to_pes.items():
        assert len(pes) == 2, (
            f"W_VN{rc} assigned to {len(pes)} PEs, expected 2: {pes}"
        )

    # Replication is across PE columns (same ah, different aw)
    for rc, pes in rc_to_pes.items():
        ah_vals = {pe[0] for pe in pes}
        aw_vals = {pe[1] for pe in pes}
        assert len(ah_vals) == 1, f"W_VN{rc}: replicas at different rows {pes}"
        assert len(aw_vals) == 2, f"W_VN{rc}: replicas at same column {pes}"


def test_figure7_trace_parser():
    """Verify that parse_trace() correctly handles the mixed-Gr Figure 7 trace.

    Parses the RTL-format JSON trace with 2 ExecuteMapping instructions
    (Gr=2 and Gr=4) and verifies the generated MINISA program matches
    create_figure7_program().
    """
    from minisa.trace_parser import load_trace
    from minisa.isa import create_figure7_program, encode_program

    trace_path = os.path.join(
        os.path.dirname(__file__), "..", "instr_trace", "figure7_16x12x8_4x4.json"
    )
    trace_info = load_trace(trace_path)

    # Verify dimensions
    assert trace_info["M"] == M
    assert trace_info["K"] == K
    assert trace_info["N"] == N
    assert trace_info["AH"] == AH
    assert trace_info["AW"] == AW

    # Verify mixed-Gr handling (converted to uniform max-Gr)
    assert trace_info.get("mixed_gr", False), "Should detect mixed Gr"
    assert trace_info["k_passes"] == 3, "k_passes should be 3 (K=12 / Kt=4)"
    assert trace_info["n_inner"] == 1, "n_inner should be 1 for mixed-Gr"
    assert trace_info["Gr"] == 4, "Should use uniform Gr=max(Gr)=4"

    # Verify tile count: 2 N-passes × 4 M-batches × 3 K-passes = 24 tiles
    assert trace_info["n_tiles"] == 24, f"Expected 24 tiles, got {trace_info['n_tiles']}"

    # Verify tile decomposition matches create_figure7_program()
    ref_program = create_figure7_program()
    ref_instructions = encode_program(ref_program)
    trace_instructions = trace_info["instructions"]

    assert len(trace_instructions) == len(ref_instructions), (
        f"Instruction count mismatch: trace={len(trace_instructions)}, "
        f"ref={len(ref_instructions)}"
    )

    # Verify each tile's K-range and Gr
    for t in range(24):
        trace_tile = trace_instructions[3 + t]
        ref_tile = ref_instructions[3 + t]
        # Gr, k_start, k_end must match
        assert trace_tile[3] == ref_tile[3], (
            f"Tile {t} Gr mismatch: trace={trace_tile[3]}, ref={ref_tile[3]}"
        )
        assert trace_tile[11] == ref_tile[11], (
            f"Tile {t} k_start mismatch: trace={trace_tile[11]}, ref={ref_tile[11]}"
        )
        assert trace_tile[12] == ref_tile[12], (
            f"Tile {t} k_end mismatch: trace={trace_tile[12]}, ref={ref_tile[12]}"
        )


def test_figure7_trace_functional():
    """End-to-end GEMM verification using trace-parsed Figure 7 program.

    Parses the trace JSON, builds the simulator with trace-derived parameters,
    and verifies the result matches numpy reference.
    """
    from allo.ir.types import int8
    from minisa.trace_parser import load_trace
    from feather_minisa import build_feather_simulator

    trace_path = os.path.join(
        os.path.dirname(__file__), "..", "instr_trace", "figure7_16x12x8_4x4.json"
    )
    trace_info = load_trace(trace_path)

    instructions = trace_info["instructions"]
    k_passes = trace_info.get("k_passes", 1)

    np.random.seed(7)
    A = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)

    mod = build_feather_simulator(
        M, K, N, AW, AH, int8, len(instructions), k_passes=k_passes,
    )
    C = np.zeros((M, N), dtype=np.int32)
    mod(A, B, instructions, C)

    ref = A.astype(np.int32) @ B.astype(np.int32)
    np.testing.assert_array_equal(C, ref)


if __name__ == "__main__":
    tests = [
        test_figure7_tile1_pe_mapping,
        test_figure7_tile2_pe_mapping,
        test_figure7_mapping_adaptation,
        test_figure7_full_pe_utilization,
        test_figure7_k_coverage_per_output_column,
        test_figure7_no_k_overlap_between_tiles,
        test_figure7_functional_gemm,
        test_figure7_tile2_replication_factor,
        test_figure7_trace_parser,
        test_figure7_trace_functional,
    ]
    for t in tests:
        print(f"  {t.__name__} ... ", end="")
        t()
        print("PASSED")
    print(f"\nAll {len(tests)} Figure 7 tests passed.")
