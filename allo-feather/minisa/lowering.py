# Copyright Allo authors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""MINISA lowering: convert MINISA instructions to Allo configuration tensors.

This module translates high-level MINISA instructions into low-level
configuration arrays that drive the FEATHER+ Allo dataflow hardware.

The lowering produces:
- BIRRD instruction arrays from SetOVNLayout
- Output column maps for output accumulation
"""

from math import log2
from typing import Tuple

import numpy as np

from .isa import SetOVNLayout


# BIRRD switch operation codes
PS = 0  # Pass
AR = 1  # Add Right
AL = 2  # Add Left
SW = 3  # Swap


def compute_birrd_params(AW: int) -> Tuple[int, int]:
    """Compute BIRRD network parameters from array width.

    Args:
        AW: Array width (must be power of 2)

    Returns:
        (P0, P1): Number of stages, switches per stage
    """
    LOG2_AW = int(log2(AW))
    P0 = 2 * LOG2_AW if AW > 4 else 2 * LOG2_AW - 1
    P1 = AW // 2
    return P0, P1


def _simulate_birrd_output_col_map(birrd_inst, AW):
    """Simulate BIRRD network to derive the output column map.

    Traces symbolic inputs through the BIRRD butterfly network to determine
    which output positions contain the reduced values for each M-position.
    Inputs at positions j and j+Mt (where Mt=AW//2) are paired for reduction.

    Args:
        birrd_inst: BIRRD instruction array [P0, P1]
        AW: Array width

    Returns:
        int32 array of shape [Mt] mapping M-position to BIRRD output column,
        or None if the BIRRD config doesn't produce valid 2-way reduction.
    """
    from feather_minisa import reverse_bits

    Mt = AW // 2
    P0, P1 = birrd_inst.shape
    LOG2_AW = int(log2(AW))

    # Compute routing tables
    route_left_table = np.zeros((P0, P1), dtype=int)
    route_right_table = np.zeros((P0, P1), dtype=int)
    for stage in range(P0):
        if stage == P0 - 1:
            for sw in range(P1):
                route_left_table[stage, sw] = 2 * sw
                route_right_table[stage, sw] = 2 * sw + 1
        else:
            rev_bits_factor = (
                2 if stage == 0
                else min(LOG2_AW, 2 + stage, 2 * LOG2_AW - stage)
            )
            for sw in range(P1):
                route_left_table[stage, sw] = reverse_bits(2 * sw, rev_bits_factor)
                route_right_table[stage, sw] = reverse_bits(2 * sw + 1, rev_bits_factor)

    # Represent each wire value as a frozenset of contributing input indices
    buf = {}
    for pos in range(AW):
        buf[(0, pos)] = frozenset({pos})

    for stage in range(P0):
        for sw in range(P1):
            left_in = buf.get((stage, 2 * sw), frozenset())
            right_in = buf.get((stage, 2 * sw + 1), frozenset())
            op = int(birrd_inst[stage, sw])

            if op == PS:
                left_out, right_out = left_in, right_in
            elif op == AR:
                left_out = left_in
                right_out = left_in | right_in
            elif op == AL:
                left_out = left_in | right_in
                right_out = right_in
            else:  # SW
                left_out, right_out = right_in, left_in

            left_dest = int(route_left_table[stage, sw])
            right_dest = int(route_right_table[stage, sw])
            buf[(stage + 1, left_dest)] = left_out
            buf[(stage + 1, right_dest)] = right_out

    # Find output columns containing reduced pairs (m, m+Mt)
    col_map = []
    for m in range(Mt):
        target = frozenset({m, m + Mt})
        found = False
        for col in range(AW):
            if buf.get((P0, col), frozenset()) == target:
                col_map.append(col)
                found = True
                break
        if not found:
            return None  # This BIRRD config doesn't produce valid 2-way reduction
    return np.array(col_map, dtype=np.int32)


def _simulate_birrd_passthrough_perm(AW):
    """Simulate all-PS BIRRD to get passthrough output permutation.

    When BIRRD uses all-PS (pass-through) instructions, the butterfly
    routing network still permutes wire positions. This traces each input
    through the network to find where it ends up.

    Args:
        AW: Array width (must be power of 2)

    Returns:
        int32 array of shape [AW] where perm[output_col] = input_position
    """
    from feather_minisa import reverse_bits

    P0, P1 = compute_birrd_params(AW)
    LOG2_AW = int(log2(AW))

    # Compute routing tables (same structure as _simulate_birrd_output_col_map)
    route_left_table = np.zeros((P0, P1), dtype=int)
    route_right_table = np.zeros((P0, P1), dtype=int)
    for stage in range(P0):
        if stage == P0 - 1:
            for sw in range(P1):
                route_left_table[stage, sw] = 2 * sw
                route_right_table[stage, sw] = 2 * sw + 1
        else:
            rev_bits_factor = (
                2 if stage == 0
                else min(LOG2_AW, 2 + stage, 2 * LOG2_AW - stage)
            )
            for sw in range(P1):
                route_left_table[stage, sw] = reverse_bits(2 * sw, rev_bits_factor)
                route_right_table[stage, sw] = reverse_bits(2 * sw + 1, rev_bits_factor)

    # Trace each input through the all-PS network
    buf = np.zeros((P0 + 1, AW), dtype=int)
    for pos in range(AW):
        buf[0, pos] = pos

    for stage in range(P0):
        for sw in range(P1):
            left_in = buf[stage, 2 * sw]
            right_in = buf[stage, 2 * sw + 1]
            # All-PS: pass through unchanged
            left_dest = int(route_left_table[stage, sw])
            right_dest = int(route_right_table[stage, sw])
            buf[stage + 1, left_dest] = left_in
            buf[stage + 1, right_dest] = right_in

    return buf[P0].astype(np.int32)


def _compute_routing_tables(AW):
    """Compute BIRRD butterfly routing tables for all stages.

    Returns (route_left, route_right) arrays of shape [P0, P1].
    """
    from feather_minisa import reverse_bits

    P0, P1 = compute_birrd_params(AW)
    LOG2_AW = int(log2(AW))
    route_left = np.zeros((P0, P1), dtype=int)
    route_right = np.zeros((P0, P1), dtype=int)
    for stage in range(P0):
        if stage == P0 - 1:
            for sw in range(P1):
                route_left[stage, sw] = 2 * sw
                route_right[stage, sw] = 2 * sw + 1
        else:
            rev_bits_factor = (
                2 if stage == 0
                else min(LOG2_AW, 2 + stage, 2 * LOG2_AW - stage)
            )
            for sw in range(P1):
                route_left[stage, sw] = reverse_bits(2 * sw, rev_bits_factor)
                route_right[stage, sw] = reverse_bits(2 * sw + 1, rev_bits_factor)
    return route_left, route_right


def _simulate_birrd_frozensets(birrd_inst, AW):
    """Simulate BIRRD with frozenset tracking, return final output map.

    Returns dict mapping output column → frozenset of contributing inputs.
    """
    P0, P1 = birrd_inst.shape
    route_left, route_right = _compute_routing_tables(AW)

    buf = {}
    for pos in range(AW):
        buf[(0, pos)] = frozenset({pos})

    for stage in range(P0):
        for sw in range(P1):
            left_in = buf.get((stage, 2 * sw), frozenset())
            right_in = buf.get((stage, 2 * sw + 1), frozenset())
            op = int(birrd_inst[stage, sw])

            if op == PS:
                left_out, right_out = left_in, right_in
            elif op == AR:
                left_out = left_in
                right_out = left_in | right_in
            elif op == AL:
                left_out = left_in | right_in
                right_out = right_in
            else:  # SW
                left_out, right_out = right_in, left_in

            buf[(stage + 1, int(route_left[stage, sw]))] = left_out
            buf[(stage + 1, int(route_right[stage, sw]))] = right_out

    return {col: buf.get((P0, col), frozenset()) for col in range(AW)}


def _simulate_birrd_output_col_map_general(birrd_inst, AW, Gr):
    """Find output columns containing fully-reduced values for each M-position.

    For M-position m, the target frozenset is {m, m+Gr, m+2*Gr, ...}.

    Args:
        birrd_inst: BIRRD instruction array [P0, P1]
        AW: Array width
        Gr: Replication group size

    Returns:
        int32 array of shape [Gr] mapping M-position to output column,
        or None if the BIRRD config doesn't produce valid reduction.
    """
    outputs = _simulate_birrd_frozensets(birrd_inst, AW)

    # Build target groups
    targets = {}
    for m in range(Gr):
        targets[m] = frozenset(range(m, AW, Gr))

    col_map = []
    for m in range(Gr):
        found = False
        for col in range(AW):
            if outputs[col] == targets[m]:
                col_map.append(col)
                found = True
                break
        if not found:
            return None
    return np.array(col_map, dtype=np.int32)


def generate_birrd_instructions(AW, Gr):
    """Generate BIRRD instructions for multi-way reduction via greedy algorithm.

    Uses a forward pass through the butterfly network, setting switches to AL
    (add-left) whenever both inputs belong to the same reduction group and
    combining them increases the accumulated set. The butterfly topology
    naturally brings together elements at the right distances for tree reduction.

    Args:
        AW: Array width (power of 2)
        Gr: Replication group size (power of 2, 1 <= Gr <= AW)

    Returns:
        int8 array of shape [P0, P1] with switch operations
    """
    if Gr == AW:
        P0, P1 = compute_birrd_params(AW)
        return np.zeros((P0, P1), dtype=np.int8)

    P0, P1 = compute_birrd_params(AW)
    route_left, route_right = _compute_routing_tables(AW)

    birrd_inst = np.zeros((P0, P1), dtype=np.int8)

    # Track frozensets at each wire
    buf = {}
    for pos in range(AW):
        buf[(0, pos)] = frozenset({pos})

    def get_group(fset):
        """Return group id if all elements belong to same group, else -1."""
        if not fset:
            return -1
        g = next(iter(fset)) % Gr
        for x in fset:
            if x % Gr != g:
                return -1
        return g

    for stage in range(P0):
        for sw in range(P1):
            left_in = buf.get((stage, 2 * sw), frozenset())
            right_in = buf.get((stage, 2 * sw + 1), frozenset())

            g_left = get_group(left_in)
            g_right = get_group(right_in)

            if (g_left >= 0 and g_right >= 0 and g_left == g_right
                    and len(left_in | right_in) > len(left_in)):
                # Same group, beneficial to accumulate into left
                birrd_inst[stage, sw] = AL
                left_out = left_in | right_in
                right_out = right_in
            else:
                # Pass through
                left_out = left_in
                right_out = right_in

            buf[(stage + 1, int(route_left[stage, sw]))] = left_out
            buf[(stage + 1, int(route_right[stage, sw]))] = right_out

    # Verify the generated instructions produce valid reduction
    col_map = _simulate_birrd_output_col_map_general(birrd_inst, AW, Gr)
    if col_map is not None:
        return birrd_inst

    # Greedy failed — shouldn't happen for power-of-2 on Benes topology
    raise ValueError(
        f"Greedy BIRRD generation failed for AW={AW}, Gr={Gr}. "
        f"This is unexpected for power-of-2 parameters."
    )


# BIRRD instruction tables for all (AW, order) combinations.
# Order 0: standard reduction pattern from FEATHER paper.
# Orders 1-5: variations that produce different output permutations
# by modifying switch operations at different stages.

_BIRRD_INST_TABLES = {
    # AW=4: P0=3 stages, P1=2 switches
    # Pairs to reduce: (0,2) and (1,3)
    # Stage 0 must be all-PS or all-SW to keep pairs co-located at stage 1
    (4, 0): np.array([
        [PS, PS],
        [AR, AL],
        [SW, PS],
    ], dtype=np.int8),
    (4, 1): np.array([
        [PS, PS],
        [AL, AR],
        [SW, PS],
    ], dtype=np.int8),
    (4, 2): np.array([
        [PS, PS],
        [AR, AL],
        [PS, PS],
    ], dtype=np.int8),
    (4, 3): np.array([
        [PS, PS],
        [AR, AL],
        [PS, SW],
    ], dtype=np.int8),
    (4, 4): np.array([
        [SW, SW],
        [AR, AL],
        [PS, PS],
    ], dtype=np.int8),
    (4, 5): np.array([
        [SW, SW],
        [AR, AL],
        [SW, PS],
    ], dtype=np.int8),

    # AW=8: P0=6 stages, P1=4 switches
    (8, 0): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AR, AR, AL, AL],
        [SW, SW, SW, SW],
        [SW, PS, PS, SW],
        [PS, PS, PS, PS],
    ], dtype=np.int8),
    (8, 1): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AL, AL, AR, AR],
        [SW, SW, SW, SW],
        [SW, PS, PS, SW],
        [PS, PS, PS, PS],
    ], dtype=np.int8),
    (8, 2): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AR, AR, AL, AL],
        [PS, PS, PS, PS],
        [SW, PS, PS, SW],
        [PS, PS, PS, PS],
    ], dtype=np.int8),
    (8, 3): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AL, AL, AR, AR],
        [PS, PS, PS, PS],
        [SW, PS, PS, SW],
        [PS, PS, PS, PS],
    ], dtype=np.int8),
    (8, 4): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AR, AR, AL, AL],
        [PS, PS, PS, PS],
        [PS, SW, SW, PS],
        [PS, PS, PS, PS],
    ], dtype=np.int8),
    (8, 5): np.array([
        [PS, PS, PS, PS],
        [PS, PS, PS, PS],
        [AL, AL, AR, AR],
        [PS, PS, PS, PS],
        [PS, SW, SW, PS],
        [PS, PS, PS, PS],
    ], dtype=np.int8),

    # AW=16: P0=8 stages, P1=8 switches
    (16, 0): np.array([
        [PS, SW, PS, SW, PS, SW, PS, SW],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AL, AL, AL, AL, AR, AR, AR, AR],
        [SW, SW, SW, SW, SW, SW, SW, SW],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
    (16, 1): np.array([
        [PS, SW, PS, SW, PS, SW, PS, SW],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AR, AR, AR, AR, AL, AL, AL, AL],
        [SW, SW, SW, SW, SW, SW, SW, SW],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
    (16, 2): np.array([
        [PS, SW, PS, SW, PS, SW, PS, SW],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AL, AL, AL, AL, AR, AR, AR, AR],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
    (16, 3): np.array([
        [PS, SW, PS, SW, PS, SW, PS, SW],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AR, AR, AR, AR, AL, AL, AL, AL],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
    (16, 4): np.array([
        [SW, PS, SW, PS, SW, PS, SW, PS],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AL, AL, AL, AL, AR, AR, AR, AR],
        [SW, SW, SW, SW, SW, SW, SW, SW],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
    (16, 5): np.array([
        [SW, PS, SW, PS, SW, PS, SW, PS],
        [PS, PS, SW, PS, PS, PS, SW, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [AR, AR, AR, AR, AL, AL, AL, AL],
        [SW, SW, SW, SW, SW, SW, SW, SW],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
        [PS, PS, PS, PS, PS, PS, PS, PS],
    ], dtype=np.int8),
}


def lower_ovn_layout(
    ovn: SetOVNLayout,
    AW: int,
    AH: int
) -> np.ndarray:
    """Lower SetOVNLayout to BIRRD instruction array.

    The OVN layout determines how partial sums are reduced and reordered
    in the BIRRD network. Different orders produce different switch
    operation patterns that implement different reduction/reorder trees.

    Args:
        ovn: Output VN layout configuration
        AW: Array width
        AH: Array height

    Returns:
        BIRRD instruction array [P0, P1]
    """
    key = (AW, ovn.order)
    if key in _BIRRD_INST_TABLES:
        return _BIRRD_INST_TABLES[key].copy()
    raise ValueError(f"Unsupported (AW={AW}, order={ovn.order}) combination")


def compute_output_col_map(AW: int, ovn_order: int = 0) -> np.ndarray:
    """Compute the BIRRD output column to M-position mapping.

    The BIRRD butterfly network produces outputs in a permuted order.
    This function returns the mapping from local M position to the
    BIRRD output column that contains the corresponding reduced value.

    The mapping depends on both AW and the OVN order, since different
    OVN orders use different BIRRD switch patterns that route reduced
    values to different output positions.

    Args:
        AW: Array width (4, 8, or 16)
        ovn_order: OVN layout order (0-5)

    Returns:
        int32 array of shape [Mt] where Mt = AW // 2
    """
    key = (AW, ovn_order)
    if key not in _BIRRD_INST_TABLES:
        raise ValueError(f"Unsupported (AW={AW}, order={ovn_order})")

    birrd_inst = _BIRRD_INST_TABLES[key]
    col_map = _simulate_birrd_output_col_map(birrd_inst, AW)
    if col_map is None:
        raise ValueError(
            f"BIRRD config for (AW={AW}, order={ovn_order}) does not "
            f"produce valid 2-way reduction"
        )
    return col_map


def compute_col_to_m_map(AW: int, ovn_order: int, Gr: int) -> np.ndarray:
    """Compute BIRRD output column → M-position mapping for any Gr value.

    Maps each BIRRD output column to the local M position it contributes to.
    Supports all power-of-2 Gr values:
    - Gr=AW: passthrough, each column maps to its permuted input position
    - Gr=AW//2: standard 2-way reduction via hand-coded tables (order-dependent)
    - Gr<AW//2: multi-way reduction via generated BIRRD instructions

    Unused columns (those not containing valid reduced values) get sentinel
    value AW, which ensures they are skipped in output_accum (AW < num_m
    is always false).

    Args:
        AW: Array width (4, 8, or 16)
        ovn_order: OVN layout order (0-5)
        Gr: Replication group size (power of 2, 1 ≤ Gr ≤ AW)

    Returns:
        int32 array of shape [AW] mapping output column → M position
    """
    if Gr == AW:
        # Passthrough: trace through all-PS BIRRD routing
        return _simulate_birrd_passthrough_perm(AW)

    if Gr == AW // 2:
        # 2-way reduction: use hand-coded order-dependent tables
        pair_to_col = compute_output_col_map(AW, ovn_order)  # shape [AW//2]
        col_to_m = np.full(AW, AW, dtype=np.int32)
        for pair_idx in range(AW // 2):
            col = int(pair_to_col[pair_idx])
            m_pos = pair_idx % Gr
            col_to_m[col] = m_pos
        return col_to_m

    # Multi-way reduction: use generated BIRRD instructions
    birrd_inst = generate_birrd_instructions(AW, Gr)
    m_to_col = _simulate_birrd_output_col_map_general(birrd_inst, AW, Gr)
    col_to_m = np.full(AW, AW, dtype=np.int32)
    for m in range(Gr):
        col_to_m[int(m_to_col[m])] = m
    return col_to_m
