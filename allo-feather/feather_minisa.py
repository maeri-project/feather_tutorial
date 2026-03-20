# Copyright Allo authors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""FEATHER+ accelerator with MINISA support using Allo dataflow.

This module provides the full-matrix Allo dataflow implementation for FEATHER+.
A single Allo invocation handles complete input matrices and the full MINISA
instruction list, performing tiling, instruction decode, crossbar reordering,
NEST computation, BIRRD reduction, and output accumulation on-chip.

Supports all Gr values (1, 2, ..., AW) per tile via power-of-2 bit operations,
enabling full dataflow switching (output/weight/input stationary and mixed).

Architecture (7 pipelined dataflow kernels):
1. a_loader: Reads A from DRAM, column-streams to AW column heads
2. w_loader: Reads W from DRAM, decodes own instructions, streams to w_broadcast
3. w_broadcast[AW]: Distributes W to per-row PE FIFOs
4. pe_array[AH+1,AW]: Compute PEs (rows 0..AH-1, column-streaming) + gather (row AH)
5. inst_rw: Distribute BIRRD switch instructions
6. BIRRD[P0,P1]: Butterfly reduction/reorder (per-tile configuration)
7. output_accum: Column remap + tile accumulation into output matrix

The MINISA instructions (SetIVNLayout, SetWVNLayout, SetOVNLayout, SetMapping)
are encoded as an int32 array and decoded on-chip by the dataflow kernels.

Temporal N-iteration and M-batching (n_inner > 1):
When n_inner > 1, each ISA tile contains multiple inner sub-operations that
share the same K-range and BIRRD configuration but have different (m_start,
n_start) offsets. This matches the RTL's VN buffer temporal iteration, where
each ExecuteMapping covers all M-batches and N-sub-tiles internally. The
per-sub-operation m_start/n_start are stored in separate DRAM lookup tables.
"""

from math import log2
from typing import Tuple

import allo
from allo.ir.types import int8, int32, UInt, Stream
import allo.dataflow as df
from allo.customize import Partition
import numpy as np

# BIRRD switch operations
PS = 0  # Pass: outputs = inputs
AR = 1  # Add Right: left_out = left, right_out = left + right
AL = 2  # Add Left: left_out = left + right, right_out = right
SW = 3  # Swap: left_out = right, right_out = left


def reverse_bits(data: int, bit_range: int) -> int:
    """Reverse the lower bit_range bits of data.

    Used for butterfly network routing in BIRRD.
    """
    mask = (1 << bit_range) - 1
    reversed_bits = 0
    for i in range(0, bit_range):
        if data & (1 << i):
            reversed_bits |= 1 << (bit_range - 1 - i)
    return (data & ~mask) | reversed_bits


def compute_birrd_params(AW: int) -> Tuple[int, int]:
    """Compute BIRRD network parameters from array width.

    Returns:
        P0: Number of stages in BIRRD network
        P1: Number of switches per stage
    """
    LOG2_AW = int(log2(AW))
    P0 = 2 * LOG2_AW if AW > 4 else 2 * LOG2_AW - 1
    P1 = AW // 2
    return P0, P1


def get_feather_full_matrix_top(M, K, N, AW, AH, Ty, num_inst,
                                            n_inner=1, k_passes=1,
                                            Nt_local=None):
    """Create FEATHER+ dataflow region with unified PE array.

    a_loader(mapping=[1]) reads A from DRAM, w_loader(mapping=[1]) reads W —
    they run in parallel (different BRAMs, separate instruction copies).
    Column-streaming: data flows to AW column heads then down through
    inter-PE streams. pe_array (mapping=[AH+1, AW]): rows 0..AH-1 =
    compute PEs, row AH = gather.

    Architecture (7 dataflow kernels):
    1. a_loader(1): Reads A, decodes instructions, column-streams to PE row 0
    2. w_loader(1): Reads W, decodes own instruction copy, streams to w_broadcast
    3. w_broadcast[AW]: Distributes W to per-row PE FIFOs
    4. pe_array[AH+1,AW]: Column-streaming compute PEs + per-column gather
    5. inst_rw(1): Distribute BIRRD switch instructions
    6. BIRRD[P0,P1]: Butterfly reduction/reorder (per-tile configuration)
    7. output_accum(1): Column remap + block accumulation into output matrix

    Each tile covers exactly Kt = (AW // Gr) * AH K-elements (one pass).
    K-decomposition is handled at the ISA level, not inside the PE.

    When n_inner > 1, each tile contains n_inner sub-operations with different
    (m_start, n_start) offsets, matching the RTL's temporal VN iteration.

    Args:
        M, K, N: Matrix dimensions
        AW: Array width (must be power of 2)
        AH: Array height
        Ty: Input data type (e.g., int8)
        num_inst: Total instruction count (3 layout + tile mappings)
        n_inner: Inner iterations per tile (default 1). When > 1, each tile
            processes n_inner sub-operations with different m_start/n_start.
        k_passes: Number of K-decomposition tiles per output block (default 1).
            Consecutive k_passes tiles share the same (m_start, n_start) and
            are accumulated in a local register buffer before flushing to C.
        Nt_local: N-dimension of local accumulation buffer (default AH).
            Must be >= max N-coverage per tile. For sc>0 mappings (e.g.,
            Figure 7 with sc=4, Gc=2), Nt_local = sr*(AH-1)+sc*(Gc-1)+1.
    """
    if Nt_local is None:
        Nt_local = AH
    TyOut = int32
    LOG2_AW = int(log2(AW))
    LOG2_AH = int(log2(AH))
    P0, P1 = compute_birrd_params(AW)
    num_tiles = num_inst - 3
    total_ops = num_tiles * n_inner
    num_blocks = num_tiles // k_passes

    num_accum_params = 2 + num_tiles  # quant_scale, quant_zp, sr[0..num_tiles-1]

    @df.region()
    def full_matrix_top(
        A_pe: int32[M, K],
        B_pe: int32[K, N],
        inst_pe: int32[num_inst, 13],
        loader_m_start: int32[total_ops],
        inst_w: int32[num_inst, 13],
        loader_n_start: int32[total_ops],
        birrd_inst: int8[num_tiles, P0, P1],
        output_col_map: int32[num_tiles, AW],
        output_num_m: int32[num_tiles],
        output_n_base: int32[num_tiles, AW],
        accum_m_start: int32[total_ops],
        accum_n_start: int32[total_ops],
        accum_params: int32[num_accum_params],
        C: int32[M, N],
    ):
        """Unified PE array FEATHER+ dataflow region.

        a_loader reads A_pe, inst_pe, loader_m_start — sends A to col_a_in.
        w_loader reads B_pe, inst_w, loader_n_start — sends W to col_w_in.
        A and W loading run in parallel (separate instruction copies,
        different BRAMs, different FIFOs). Each DRAM buffer has exactly
        one reader kernel (HLS single-reader).
        """

        # Column input streams: a_loader -> PE row 0 (A), w_loader -> w_broadcast (W)
        col_a_in: Stream[int32, AH][AW]
        col_w_in: Stream[int32, total_ops][AH, AW]  # w_loader -> w_broadcast
        # Per-row W streams: w_broadcast -> PE[row, col]
        # Depth total_ops: w_broadcast writes all rows atomically (meta_for),
        # so if bottom row's FIFO is full, all row writes stall → cascade
        # deadlock. Load_buf startup latency difference between A and W paths
        # plus column-streaming cascade delay requires deep buffering.
        pe_w_in: Stream[int32, total_ops][AH, AW]
        # Inter-PE column streams: A forwarded down columns
        pe_a_down: Stream[int32, AH][AH, AW]

        # pe_array internal streams: rows 0..AH-1 -> row AH (gather)
        pe_out: Stream[int32, total_ops][AH, AW]

        # BIRRD streams
        connection: Stream[TyOut, AH][P0 + 1, P1 * 2]
        inst_input: Stream[int8, total_ops][P0, P1]

        @df.kernel(mapping=[1], args=[A_pe, inst_pe, loader_m_start])
        def a_loader(
            local_A: int32[M, K],
            local_inst: int32[num_inst, 13],
            local_loader_m_start: int32[total_ops],
        ):
            """Reads A from DRAM, decodes instructions, column-streams to PEs.

            Sends A values to col_a_in[AW] (1 per column per nk).
            """
            iacts_zp: int32 = local_inst[0, 6]

            for tile in range(num_tiles):
                inst_idx: int32 = tile + 3
                Gr: int32 = local_inst[inst_idx, 3]
                k_start_tile: int32 = local_inst[inst_idx, 11]

                # Compute log2_Gr via comparison chain (Gr is power of 2)
                log2_Gr: int32 = 0
                if Gr >= 2:
                    log2_Gr = 1
                if Gr >= 4:
                    log2_Gr = 2
                if Gr >= 8:
                    log2_Gr = 3
                if Gr >= 16:
                    log2_Gr = 4
                mask_Gr: int32 = Gr - 1

                for inner in range(n_inner):
                    op_idx: int32 = tile * n_inner + inner
                    m_start: int32 = local_loader_m_start[op_idx]

                    # Send A values (1 per column per nk cycle)
                    for nk in range(AH):
                        with allo.meta_for(AW) as nj:
                            m_idx: int32 = m_start + (nj & mask_Gr)
                            k_idx: int32 = k_start_tile + nk + (nj >> log2_Gr) * AH
                            a_val: int32 = local_A[m_idx, k_idx] - iacts_zp
                            col_a_in[nj].put(a_val)

        @df.kernel(mapping=[1], args=[B_pe, inst_w, loader_n_start])
        def w_loader(
            local_B: int32[K, N],
            local_inst_w: int32[num_inst, 13],
            local_loader_n_start: int32[total_ops],
        ):
            """Reads W from DRAM, sends to col_w_in[pe_row, nj]. Runs parallel with a_loader.

            Decodes its own instruction copy (no FIFO dependency on a_loader).
            Split nk + meta_for(AH) pe_row: each pe_row writes to its own FIFO,
            reducing per-FIFO writes from AH*AH to AH per pipeline iteration.
            """
            weights_zp: int32 = local_inst_w[1, 6]

            for tile in range(num_tiles):
                inst_idx: int32 = tile + 3
                Gr: int32 = local_inst_w[inst_idx, 3]
                Gc: int32 = local_inst_w[inst_idx, 4]
                sr: int32 = local_inst_w[inst_idx, 5]
                sc: int32 = local_inst_w[inst_idx, 6]
                k_start_tile: int32 = local_inst_w[inst_idx, 11]

                log2_Gr: int32 = 0
                if Gr >= 2:
                    log2_Gr = 1
                if Gr >= 4:
                    log2_Gr = 2
                if Gr >= 8:
                    log2_Gr = 3
                if Gr >= 16:
                    log2_Gr = 4
                mask_Gc: int32 = Gc - 1

                for inner in range(n_inner):
                    op_idx: int32 = tile * n_inner + inner
                    n_start: int32 = local_loader_n_start[op_idx]

                    for nk in range(AH):
                        with allo.meta_for(AW) as nj:
                            with allo.meta_for(AH) as pe_row:
                                k_idx: int32 = k_start_tile + nk + (nj >> log2_Gr) * AH
                                wn_idx: int32 = n_start + sr * pe_row + sc * (nj & mask_Gc)
                                w_val: int32 = local_B[k_idx, wn_idx] - weights_zp
                                col_w_in[pe_row, nj].put(w_val)

        @df.kernel(mapping=[AW])
        def w_broadcast():
            """Distributes W values from col_w_in to per-row pe_w_in FIFOs.

            Each row reads from its own col_w_in[row, nj] FIFO (written by
            w_loader per pe_row), and forwards to pe_w_in[row, nj].
            Trivial FIFO-to-FIFO kernel with no BRAM access.
            """
            nj = df.get_pid()
            for _op in range(total_ops):
                for nk in range(AH):
                    with allo.meta_for(AH) as row:
                        w_val: int32 = col_w_in[row, nj].get()
                        pe_w_in[row, nj].put(w_val)

        @df.kernel(mapping=[AH + 1, AW])
        def pe_array():
            """Compute PEs (rows 0..AH-1) + gather (row AH).

            Rows 0..AH-1 (AH*AW instances): MAC units.
                A: column-streaming (row 0 from col_a_in, rows 1+ from pe_a_down).
                W: per-row FIFOs from w_broadcast (pe_w_in[ni, nj]).
            Row AH (AW instances): Collects PE results from its column,
                sends to BIRRD input connections.
            """
            ni, nj = df.get_pid()

            with allo.meta_if(ni == AH):
                # === ROW AH: GATHER (AW parallel instances) ===
                for _op in range(total_ops):
                    buf: int32[AH]
                    with allo.meta_for(AH) as pe_row:
                        buf[pe_row] = pe_out[pe_row, nj].get()
                    for row in range(AH):
                        connection[0, nj].put(buf[row])

            with allo.meta_else():
                # === ROWS 0..AH-1: COMPUTE PEs ===
                # A: column-streaming (row 0 from col_a_in, others from pe_a_down)
                # W: per-row FIFOs from w_broadcast
                for _op in range(total_ops):
                    tile_accum: int32 = 0
                    for nk in range(AH):
                        # Read A: row 0 from column input, others from PE above
                        a_val: int32 = 0
                        with allo.meta_if(ni == 0):
                            a_val = col_a_in[nj].get()
                        with allo.meta_else():
                            a_val = pe_a_down[ni - 1, nj].get()

                        # Read W from per-row FIFO (via w_broadcast)
                        w_val: int32 = pe_w_in[ni, nj].get()

                        # Forward A down (not last row)
                        with allo.meta_if(ni < AH - 1):
                            pe_a_down[ni, nj].put(a_val)

                        tile_accum += a_val * w_val
                    pe_out[ni, nj].put(tile_accum)

        @df.kernel(mapping=[1], args=[birrd_inst])
        def inst_rw(local_birrd_inst: int8[num_tiles, P0, P1]):
            """Distribute per-tile BIRRD switch instructions.

            Each tile's instruction is repeated n_inner times so that
            the BIRRD network receives one instruction per sub-operation.
            """
            for tile in range(num_tiles):
                for _rep in range(n_inner):
                    with allo.meta_for(P0) as i:
                        with allo.meta_for(P1) as j:
                            inst_input[i, j].put(local_birrd_inst[tile, i, j])

        @df.kernel(mapping=[P0, P1])
        def BIRRD():
            """BIRRD butterfly reduction/reorder network (int32 values)."""
            i, j = df.get_pid()

            for _op in range(total_ops):
                inst_val = inst_input[i, j].get()

                for _ in range(AH):
                    in_left: TyOut = connection[i, 2 * j].get()
                    in_right: TyOut = connection[i, 2 * j + 1].get()

                    out_left: TyOut = 0
                    out_right: TyOut = 0

                    if inst_val == 0:  # PS: pass
                        out_left = in_left
                        out_right = in_right
                    elif inst_val == 1:  # AR: add-right
                        out_left = in_left
                        out_right = in_left + in_right
                    elif inst_val == 2:  # AL: add-left
                        out_left = in_left + in_right
                        out_right = in_right
                    else:  # SW: swap
                        out_left = in_right
                        out_right = in_left

                    with allo.meta_if(i != P0 - 1):
                        connection[
                            i + 1,
                            reverse_bits(
                                2 * j,
                                2 if i == 0 else min(LOG2_AW, 2 + i, 2 * LOG2_AW - i),
                            ),
                        ].put(out_left)
                        connection[
                            i + 1,
                            reverse_bits(
                                2 * j + 1,
                                2 if i == 0 else min(LOG2_AW, 2 + i, 2 * LOG2_AW - i),
                            ),
                        ].put(out_right)
                    with allo.meta_else():
                        connection[P0, 2 * j].put(out_left)
                        connection[P0, 2 * j + 1].put(out_right)

        @df.kernel(mapping=[1], args=[output_col_map, output_num_m, output_n_base, accum_m_start, accum_n_start, accum_params, C])
        def output_accum(
            local_output_col_map: int32[num_tiles, AW],
            local_output_num_m: int32[num_tiles],
            local_output_n_base: int32[num_tiles, AW],
            local_accum_m_start: int32[total_ops],
            local_accum_n_start: int32[total_ops],
            local_accum_params: int32[num_accum_params],
            local_C: int32[M, N],
        ):
            """Fused BIRRD read + accumulate into C[M,N].

            Reads BIRRD outputs and accumulates per-block into tile_acc[AW,AH]
            using fixed compile-time indices (col from meta_for, d from loop).
            Eliminates the all_tile_out[total_ops,AH,AW] intermediate buffer
            and the two-phase sequential bottleneck.

            Within each block, all k_passes tiles share the same col→m mapping
            (only k_start differs), so tile_acc[col, d] is a 1-to-1 mapping
            to unique (m_pos, n_off) output positions.
            """
            quant_scale: int32 = local_accum_params[0]
            quant_zp: int32 = local_accum_params[1]

            # Accumulator indexed by (col, d) — fixed indices for II=1
            tile_acc: int32[AW, AH]

            for block in range(num_blocks):
                # Zero tile_acc (meta_for on outer dim for AW-parallel zeroing)
                with allo.meta_for(AW) as _i0:
                    for _j0 in range(AH):
                        tile_acc[_i0, _j0] = 0

                base_tile: int32 = block * k_passes

                # Fused: read from BIRRD streams + accumulate with fixed indices
                for k in range(k_passes):
                    for inner in range(n_inner):
                        for d in range(AH):
                            with allo.meta_for(AW) as col:
                                tile_acc[col, d] = tile_acc[col, d] + connection[P0, col].get()

                # Writeback: apply col→m mapping and write to C
                num_m: int32 = local_output_num_m[base_tile]
                sr_val: int32 = local_accum_params[2 + base_tile]
                m_start: int32 = local_accum_m_start[base_tile * n_inner]
                n_start: int32 = local_accum_n_start[base_tile * n_inner]
                for col in range(AW):
                    m_pos: int32 = local_output_col_map[base_tile, col]
                    n_base_col: int32 = local_output_n_base[base_tile, col]
                    col_mask: int32 = 0
                    m_safe: int32 = 0
                    if m_pos < num_m:
                        col_mask = 1
                        m_safe = m_pos
                    for on in range(AH):
                        sr_mask: int32 = 0
                        if sr_val != 0:
                            sr_mask = 1
                        if on == 0:
                            sr_mask = 1
                        n_off: int32 = sr_val * on + n_base_col
                        val: int32 = tile_acc[col, on] * col_mask * sr_mask
                        if quant_scale != 0:
                            val = (val * quant_scale + quant_zp) & 255
                        local_C[m_start + m_safe, n_start + n_off] = val

    return full_matrix_top


class FeatherModule:
    """Wrapper for FEATHER+ with clean (A, B, instructions, C) interface.

    Supports all Gr values per tile. Precomputes BIRRD tables for all
    OVN orders at build time. At call time, selects per-tile BIRRD
    configuration based on Gr: reduction (Gr < AW) or pass-through (Gr == AW).

    When n_inner > 1, the caller must provide inner_params dict with
    per-sub-operation m_starts and n_starts arrays.
    """

    def __init__(self, allo_mod, AW, n_inner=1):
        from minisa.lowering import (
            lower_ovn_layout, compute_col_to_m_map,
            compute_output_col_map, _simulate_birrd_passthrough_perm,
            generate_birrd_instructions, _simulate_birrd_output_col_map_general,
        )
        from minisa.isa import SetOVNLayout

        self._mod = allo_mod
        self._AW = AW
        self._n_inner = n_inner
        P0, P1 = compute_birrd_params(AW)
        self._P0 = P0
        self._P1 = P1
        log2_aw = int(log2(AW))
        valid_grs = set()
        for i in range(log2_aw + 1):
            valid_grs.add(1 << i)  # 1, 2, 4, ..., AW

        # Precompute BIRRD tables for all (order, Gr) combinations
        # - Gr=AW: all-PS passthrough
        # - Gr=AW//2: hand-coded order-dependent 2-way tables
        # - Gr<AW//2: algorithmically generated multi-way tables
        self._birrd_tables = {}
        self._multiway_birrd = {}  # generated tables keyed by Gr
        for order in range(6):
            ovn = SetOVNLayout(order=order, PL0=AW, PL1=1, QL0=AW, QL1=1)
            self._birrd_tables[order] = lower_ovn_layout(ovn, AW, AW)
        for gr in valid_grs:
            if gr < AW // 2:
                self._multiway_birrd[gr] = generate_birrd_instructions(AW, gr)

        # Precompute col->M maps for all (order, Gr) combinations
        self._col_to_m_maps = {}
        for order in range(6):
            for gr in valid_grs:
                self._col_to_m_maps[(order, gr)] = compute_col_to_m_map(AW, order, gr)

        # Precompute passthrough permutation (for n_base computation)
        self._passthrough_perm = _simulate_birrd_passthrough_perm(AW)
        # Precompute pair->col maps for 2-way reduction n_base
        self._pair_to_col = {}
        for order in range(6):
            self._pair_to_col[order] = compute_output_col_map(AW, order)
        # Precompute m->col maps for multi-way reduction n_base
        self._multiway_m_to_col = {}
        for gr in valid_grs:
            if gr < AW // 2:
                inst = self._multiway_birrd[gr]
                self._multiway_m_to_col[gr] = _simulate_birrd_output_col_map_general(
                    inst, AW, gr
                )

    def __call__(self, A, B, instructions, C, inner_params=None):
        """Execute FEATHER+ dataflow.

        Args:
            A: Input activations [M, K] (int8)
            B: Weight matrix [K, N] (int8)
            instructions: Encoded MINISA program [num_inst, 13] (int32)
            C: Output matrix [M, N] (int32), modified in-place
            inner_params: Optional dict with per-sub-operation arrays:
                'm_starts': int32[total_ops] — m_start per sub-operation
                'n_starts': int32[total_ops] — n_start per sub-operation
                Required when n_inner > 1.
        """
        ovn_order = int(instructions[2, 1])
        AW = self._AW
        P0, P1 = self._P0, self._P1
        n_inner = self._n_inner
        num_tiles = len(instructions) - 3
        total_ops = num_tiles * n_inner

        # Build per-tile BIRRD instructions, output mappings, and N-base offsets
        birrd_per_tile = np.zeros((num_tiles, P0, P1), dtype=np.int8)
        col_map_per_tile = np.zeros((num_tiles, AW), dtype=np.int32)
        num_m_per_tile = np.zeros(num_tiles, dtype=np.int32)
        n_base_per_tile = np.zeros((num_tiles, AW), dtype=np.int32)

        for t in range(num_tiles):
            Gr = int(instructions[3 + t, 3])
            Gc = int(instructions[3 + t, 4])
            sc = int(instructions[3 + t, 6])
            mask_Gc = Gc - 1

            if Gr == AW:
                # Pass-through: each column is a unique M row
                col_map_per_tile[t] = self._col_to_m_maps[(ovn_order, AW)]
                num_m_per_tile[t] = AW
                for col in range(AW):
                    orig_pe = int(self._passthrough_perm[col])
                    n_base_per_tile[t, col] = sc * (orig_pe & mask_Gc)
            elif Gr == AW // 2:
                # 2-way reduction: hand-coded order-dependent BIRRD tables
                birrd_per_tile[t] = self._birrd_tables[ovn_order]
                col_map_per_tile[t] = self._col_to_m_maps[(ovn_order, Gr)]
                num_m_per_tile[t] = Gr
                pair_to_col = self._pair_to_col[ovn_order]
                for pair_idx in range(AW // 2):
                    col = int(pair_to_col[pair_idx])
                    n_base_per_tile[t, col] = sc * (pair_idx & mask_Gc)
            else:
                # Multi-way reduction (Gr < AW//2): generated BIRRD tables
                birrd_per_tile[t] = self._multiway_birrd[Gr]
                col_map_per_tile[t] = self._col_to_m_maps[(ovn_order, Gr)]
                num_m_per_tile[t] = Gr
                m_to_col = self._multiway_m_to_col[Gr]
                for m in range(Gr):
                    col = int(m_to_col[m])
                    n_base_per_tile[t, col] = sc * (m & mask_Gc)

        # Per-sub-operation m_start/n_start arrays
        if inner_params is not None:
            m_start_per_op = inner_params['m_starts'].astype(np.int32)
            n_start_per_op = inner_params['n_starts'].astype(np.int32)
        else:
            # n_inner=1: extract from instructions (backward compat)
            m_start_per_op = np.array(
                [int(instructions[3 + t, 7]) for t in range(num_tiles)],
                dtype=np.int32,
            )
            n_start_per_op = np.array(
                [int(instructions[3 + t, 9]) for t in range(num_tiles)],
                dtype=np.int32,
            )

        # Prepare accum_params: [quant_scale, quant_zp, sr[0], sr[1], ...]
        accum_params = np.zeros(2 + num_tiles, dtype=np.int32)
        accum_params[0] = int(instructions[2, 6])  # quant_scale
        accum_params[1] = int(instructions[2, 7])  # quant_zp
        for t in range(num_tiles):
            accum_params[2 + t] = int(instructions[3 + t, 5])  # sr

        # Call order matches Allo's kernel-grouped reordering:
        # a_loader args (A_pe, inst_pe, loader_m_start),
        # w_loader args (B_pe, inst_w, loader_n_start),
        # inst_rw args (birrd_inst),
        # output_accum args (output_col_map, ..., C)
        # (w_broadcast, pe_array, BIRRD have no DRAM args — streams only)
        self._mod(
            A.astype(np.int32),         # a_loader: A_pe
            instructions,               # a_loader: inst_pe
            m_start_per_op.copy(),      # a_loader: loader_m_start
            B.astype(np.int32),         # w_loader: B_pe
            instructions.copy(),        # w_loader: inst_w (separate copy)
            n_start_per_op.copy(),      # w_loader: loader_n_start
            birrd_per_tile,             # inst_rw: birrd_inst
            col_map_per_tile,           # output_accum: output_col_map
            num_m_per_tile,             # output_accum: output_num_m
            n_base_per_tile,            # output_accum: output_n_base
            m_start_per_op,             # output_accum: accum_m_start
            n_start_per_op,             # output_accum: accum_n_start
            accum_params,               # output_accum: accum_params
            C,
        )


def build_feather_simulator(M, K, N, AW, AH, Ty, num_inst,
                                        n_inner=1, k_passes=1, Nt_local=None):
    """Build FEATHER+ dataflow for simulation."""
    top = get_feather_full_matrix_top(
        int(M), int(K), int(N), int(AW), int(AH), Ty, int(num_inst),
        int(n_inner), int(k_passes), Nt_local=Nt_local,
    )
    allo_mod = df.build(top, target="simulator")
    return FeatherModule(allo_mod, AW, n_inner)


def schedule_feather_hls(s, K, N, AH, AW):
    """Apply HLS scheduling optimizations to FEATHER+ dataflow.

    a_loader and w_loader run in parallel as separate dataflow kernels.
    w_loader's fused nk_row loop is pipelined. Array partitions enable
    parallel reads across meta_for copies.

    Args:
        s: Allo schedule object from df.customize()
        K: K dimension (for array partitioning)
        N: N dimension (for B partitioning decisions)
        AH: Array height (for C partitioning)
        AW: Array width (for A/B partitioning, optional)
    """
    # a_loader: sends A values via nk loop — auto-pipelined by HLS.
    # w_loader: tile loop pipelined to flatten tile+inner+nk_row.
    # a_loader and w_loader run in parallel (separate instruction copies).
    # w_broadcast distributes col_w_in -> per-row pe_w_in FIFOs.
    s.pipeline("w_loader_0:tile")
    # Partition C dim=2 (N-dimension) — Complete for parallel column writes.
    s.partition("full_matrix_top:C", dim=2, partition_type=Partition.Complete)
    # Partition A along M (dim=1) for AW parallel row reads
    s.partition("a_loader_0:local_A", dim=1, factor=AW, partition_type=Partition.Cyclic)
    # Partition A along K (dim=2) — Complete for parallel column reads.
    # Eliminates BRAM port conflicts when Gr<AW (different meta_for instances
    # access different k_idx values that may collide in the same bank).
    s.partition("a_loader_0:local_A", dim=2, partition_type=Partition.Complete)
    # Partition B for parallel reads across unrolled nk_row iterations.
    # Small arrays: Complete partition (registers) eliminates BRAM port conflicts
    # that arise from runtime-dependent addresses (Gr, sr, sc from instructions).
    # Large arrays: Cyclic to avoid mux explosion.
    if K * N <= 256:
        s.partition("w_loader_0:local_B", dim=1, partition_type=Partition.Complete)
        s.partition("w_loader_0:local_B", dim=2, partition_type=Partition.Complete)
    else:
        s.partition("w_loader_0:local_B", dim=2, factor=AH, partition_type=Partition.Cyclic)
    # Partition tile_acc for output accumulation (fixed-index, always safe to fully partition).
    s.partition("output_accum_0:tile_acc", dim=1, partition_type=Partition.Complete)
    s.partition("output_accum_0:tile_acc", dim=2, partition_type=Partition.Complete)


def build_feather_hls(M, K, N, AW, AH, Ty, num_inst,
                                  mode="csim", project=None, n_inner=1,
                                  k_passes=1, Nt_local=None):
    """Build FEATHER+ dataflow for Vitis HLS."""
    if project is None:
        project = "feather.prj"
    top = get_feather_full_matrix_top(
        int(M), int(K), int(N), int(AW), int(AH), Ty, int(num_inst),
        int(n_inner), int(k_passes), Nt_local=Nt_local,
    )
    s = df.customize(top)
    schedule_feather_hls(s, int(K), int(N), int(AH), int(AW))
    allo_mod = s.build(target="vitis_hls", mode=mode, project=project)
    return FeatherModule(allo_mod, AW, n_inner)


def run_sequential_gemm_layers(A_input, layer_weights, layer_program_kwargs,
                                AW, AH):
    """Execute multiple GEMM layers sequentially with int8 intermediates.

    Each non-final layer must enable post-quantization (quant_scale != 0)
    so that its int32 accumulator is quantized to uint8 via
    (accum * scale + zp) & 255. The uint8 output is reinterpreted as
    signed int8 for the next layer's input — matching the RTL auto-quant
    pipeline (OB -> quant_post -> StaB PONG write).

    Args:
        A_input: Initial input matrix (int8, shape [M, K0])
        layer_weights: List of weight matrices (int8), one per layer
        layer_program_kwargs: List of dicts passed to create_gemm_program(),
            e.g. [dict(M=8, N=8, K=16, quant_scale=1, quant_zp=128), ...]
        AW, AH: Array dimensions

    Returns:
        List of output arrays (int32), one per layer.
        Non-final layers contain post-quantized uint8 values (0-255) in int32.
    """
    from minisa.isa import create_gemm_program, encode_program

    outputs = []
    current_input = A_input

    for i, (B, kwargs) in enumerate(zip(layer_weights, layer_program_kwargs)):
        program = create_gemm_program(AH=AH, AW=AW, **kwargs)
        instructions = encode_program(program)

        M_i = current_input.shape[0]
        K_i = current_input.shape[1]
        N_i = B.shape[1]

        mod = build_feather_simulator(
            M_i, K_i, N_i, AW, AH, int8, len(instructions),
        )
        C = np.zeros((M_i, N_i), dtype=np.int32)
        mod(current_input, B, instructions, C)
        outputs.append(C)

        # Convert quantized output to int8 for next layer's input
        if i < len(layer_weights) - 1:
            current_input = C.astype(np.uint8).view(np.int8)

    return outputs
