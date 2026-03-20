#!/usr/bin/env python3
# Copyright Allo authors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""Unified FEATHER+ test runner for instruction trace JSON files.

Parses an RTL trace JSON, generates the MINISA program, and runs through
one of four test modes: functional correctness, HLS csynth, RTL cosim,
or U280 FPGA deployment.

Traces:
    instr_trace/figure7_16x12x8_4x4.json   — 4x4 array, mixed Gr (fast)
    instr_trace/trace_m24k48n512_16x16.json — 16x16 array, full workload

Usage:
    # Functional correctness (reference model, no HLS)
    python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json

    # HLS C-simulation
    python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csim

    # HLS C-synthesis (cycle count + resource report)
    python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn

    # RTL co-simulation (cycle-accurate)
    python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls cosim

    # U280 FPGA deployment
    python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --deploy
"""

import argparse
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../.."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import numpy as np
from allo.ir.types import int8
import allo.dataflow as df

from minisa.trace_parser import load_trace
from feather_minisa import (
    get_feather_full_matrix_top,
    FeatherModule,
    compute_birrd_params,
    schedule_feather_hls,
)

TESTS_DIR = os.path.dirname(os.path.abspath(__file__))


def patch_kernel_for_wide_apint(project_dir, max_bits):
    """Insert #define AP_INT_MAX_W before ap_int.h include if needed."""
    if max_bits <= 1024:
        return
    max_w = 4096
    kernel_path = os.path.join(project_dir, "kernel.cpp")
    if not os.path.isfile(kernel_path):
        return
    with open(kernel_path, "r") as f:
        code = f.read()
    define = f"#define AP_INT_MAX_W {max_w}\n"
    if define in code:
        return
    code = code.replace(
        "#include <ap_int.h>",
        f"{define}#include <ap_int.h>",
    )
    with open(kernel_path, "w") as f:
        f.write(code)
    print(f"  Patched kernel.cpp: AP_INT_MAX_W={max_w}")


def run_reference_test(trace_info, seed=42):
    """Verify trace-based GEMM using Python block-GEMM reference model.

    For 16x16 arrays, the Allo NumPy simulator cannot handle UInt(2048).
    This uses a pure-Python block-GEMM reference that verifies the trace
    parser generates correct tile decompositions without needing the Allo
    kernel. Each tile contributes C[m_range, n_range] += A[m_range, k_range] @ B[k_range, n_range].
    """
    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    instructions = trace_info["instructions"]
    Nt = trace_info["Nt"]
    num_tiles = trace_info["n_tiles"]

    print(f"\n{'=' * 70}")
    print(f"REFERENCE MODEL TEST (Python block-GEMM)")
    print(f"{'=' * 70}")
    print(f"  Workload: C[{M},{N}] = A[{M},{K}] x B[{K},{N}]")
    print(f"  Array: {AH}x{AW}")
    print(f"  Mapping: Gr={trace_info['Gr']}, Gc={trace_info['Gc']}, "
          f"sr={trace_info['sr']}, sc={trace_info['sc']}")
    n_sub = trace_info.get('n_sub_tiles', 1)
    n_inner = trace_info.get('n_inner', 1)
    print(f"  Tiles: {num_tiles} "
          f"({trace_info['n_m_batches']}M x {trace_info['n_spatial_tiles']}N"
          f"{f' x {n_sub}sub' if n_sub > 1 else ''}"
          f"{f', n_inner={n_inner}' if n_inner > 1 else ''})")
    if M_padded != M:
        print(f"  M padded: {M} -> {M_padded} (next multiple of Gr={trace_info['Gr']})")

    # Generate test data
    np.random.seed(seed)
    A_orig = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)
    C_ref = A_orig.astype(np.int32) @ B.astype(np.int32)

    # Pad A
    if M_padded != M:
        A = np.zeros((M_padded, K), dtype=np.int8)
        A[:M, :] = A_orig
    else:
        A = A_orig

    # Block-GEMM via tile decomposition
    C_sim = np.zeros((M_padded, N), dtype=np.int32)
    for t in range(num_tiles):
        row = instructions[3 + t]
        ms, me = int(row[7]), int(row[8])
        ns, ne = int(row[9]), int(row[10])
        ks, ke = int(row[11]), int(row[12])
        C_sim[ms:me, ns:ne] += (
            A[ms:me, ks:ke].astype(np.int32) @ B[ks:ke, ns:ne].astype(np.int32)
        )

    # Extract unpadded result
    C = C_sim[:M, :]
    passed = np.array_equal(C, C_ref)

    print(f"\n  OUTPUT VERIFICATION: {'PASS' if passed else 'FAIL'}")
    if not passed:
        diff = np.abs(C.astype(np.int64) - C_ref.astype(np.int64))
        mismatches = np.sum(C != C_ref)
        print(f"  Mismatches: {mismatches}/{C.size} ({100*mismatches/C.size:.1f}%)")
        print(f"  Max abs diff: {np.max(diff)}")
        indices = np.argwhere(C != C_ref)[:5]
        for idx in indices:
            i, j = idx
            print(f"    C[{i},{j}]: got {C[i,j]}, expected {C_ref[i,j]}")

    return passed, C_ref


def run_hls_test(trace_info, mode="csim", seed=42):
    """Run trace-based GEMM through HLS (csim, csyn, or cosim)."""
    from allo.backend.hls import is_available
    if not is_available("vitis_hls"):
        print("ERROR: Vitis HLS not available. Source settings64.sh first.")
        return False

    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    instructions = trace_info["instructions"]

    print(f"\n{'=' * 70}")
    print(f"HLS {mode.upper()} TEST")
    print(f"{'=' * 70}")
    print(f"  Workload: C[{M},{N}] = A[{M},{K}] x B[{K},{N}]")
    print(f"  Array: {AH}x{AW}")

    trace_name = f"trace_{M}x{K}x{N}"

    # Cosim uses its own build flow (csyn + custom testbench + cosim_design)
    if mode == "cosim":
        project_dir = os.path.join(TESTS_DIR, f"{trace_name}_cosim.prj")
        return _run_cosim(trace_info, project_dir, seed)

    project_dir = os.path.join(TESTS_DIR, f"{trace_name}_{mode}.prj")

    n_inner = trace_info.get('n_inner', 1)
    k_passes = trace_info.get('k_passes', 1)

    print(f"  Building HLS project ({mode})...")
    top = get_feather_full_matrix_top(
        M_padded, K, N, AW, AH, int8, len(instructions), n_inner, k_passes,
    )
    s = df.customize(top)
    schedule_feather_hls(s, K, N, AH, AW)
    hls_mod = s.build(target="vitis_hls", mode=mode, project=project_dir)
    allo_mod = FeatherModule(hls_mod, AW, n_inner)

    # Patch for wide ap_uint (16x16 array → UInt(2048))
    patch_kernel_for_wide_apint(project_dir, AW * AH * int8.bits)

    if mode == "csim":
        np.random.seed(seed)
        A_orig = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
        B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)
        C_ref = A_orig.astype(np.int32) @ B.astype(np.int32)

        if M_padded != M:
            A = np.zeros((M_padded, K), dtype=np.int8)
            A[:M, :] = A_orig
        else:
            A = A_orig

        C_padded = np.zeros((M_padded, N), dtype=np.int32)
        inner_params = None
        if 'inner_m_starts' in trace_info:
            inner_params = {
                'm_starts': trace_info['inner_m_starts'],
                'n_starts': trace_info['inner_n_starts'],
            }
        allo_mod(A, B, instructions, C_padded, inner_params=inner_params)
        C = C_padded[:M, :]

        passed = np.array_equal(C, C_ref)
        print(f"  OUTPUT VERIFICATION: {'PASS' if passed else 'FAIL'}")
        if not passed:
            diff = np.abs(C.astype(np.int64) - C_ref.astype(np.int64))
            n_mismatch = np.sum(C != C_ref)
            print(f"  Mismatches: {n_mismatch}/{C.size}")
            print(f"  Max abs diff: {np.max(diff)}")
            print(f"  C all zeros: {np.all(C == 0)}")
            print(f"  C nonzero: {np.count_nonzero(C)}/{C.size}")
            print(f"  C[0,:8] = {C[0,:8]}")
            print(f"  Ref[0,:8] = {C_ref[0,:8]}")
            # Check row sums
            c_rowsum = np.sum(C, axis=1)
            r_rowsum = np.sum(C_ref, axis=1)
            print(f"  Row sums match: {np.array_equal(c_rowsum, r_rowsum)}")
            # Check column sums
            c_colsum = np.sum(C, axis=0)
            r_colsum = np.sum(C_ref, axis=0)
            print(f"  Col sums match: {np.array_equal(c_colsum, r_colsum)}")
            # Check if permutation issue (same values, wrong locations)
            print(f"  Sorted values match: {np.array_equal(np.sort(C.flat), np.sort(C_ref.flat))}")
        return passed

    elif mode == "csyn":
        _patch_load_bufs_for_throughput(project_dir)
        print(f"  Running Vitis HLS csyn...")
        hls_mod()
        _report_synthesis(project_dir)
        return True

    return False


def _patch_load_bufs_for_throughput(project_dir):
    """Optimize load_buf DRAM loaders: widen m_axi + partition + pipeline outer.

    Auto-generated load_buf functions read from DRAM one element per cycle.
    For 2D+ output arrays, we can read multiple elements per cycle by:
    1. Widening m_axi ports to 512 bits (16 int32 per AXI beat)
    2. Partitioning inner dims of output arrays (enable parallel writes)
    3. Moving pipeline from inner to outer loop (inner gets fully unrolled)

    This reduces load_buf latencies from O(D0*D1) to O(D0).
    """
    kernel_path = os.path.join(project_dir, "kernel.cpp")
    if not os.path.isfile(kernel_path):
        return

    with open(kernel_path, "r") as f:
        code = f.read()

    # Step 1: Widen all m_axi ports for burst reads
    code = re.sub(
        r'(#pragma HLS interface m_axi port=\w+ offset=slave bundle=\w+)'
        r'(?!\s+max_widen_bitwidth)',
        r'\1 max_widen_bitwidth=512',
        code,
    )

    # Step 2: Rewrite 2D load_bufs to use wide pointers (ap_uint<COLS*32>)
    # for row-at-a-time reads. Applies to any load_buf with signature:
    #   void load_bufN(int32_t in[FLAT], int32_t out[ROWS][COLS])
    # Rewrite: ap_uint<COLS*32> in_wide[ROWS] → extract 32-bit fields, 1 row/cycle
    # Key targets: load_buf0 (A matrix), load_buf1/4 (instructions), load_buf3 (B)
    for buf_id in range(13):
        fn = f'load_buf{buf_id}'
        # Match: void load_bufN(\n  int32_t INVAR[FLAT],\n  int32_t OUTVAR[R][C]\n) {
        sig = re.search(
            rf'void {fn}\(\s*\n'
            rf'\s*int32_t\s+(\w+)\[(\d+)\],\s*\n'
            rf'\s*int32_t\s+(\w+)\[(\d+)\]\[(\d+)\]\s*\n'
            rf'\) \{{',
            code,
        )
        if not sig:
            continue
        in_var, flat_sz, out_var = sig.group(1), int(sig.group(2)), sig.group(3)
        rows, cols = int(sig.group(4)), int(sig.group(5))
        wide_bits = cols * 32

        # Find the end of this function (matching closing brace)
        brace_depth, func_end = 0, sig.start()
        for idx in range(sig.start(), len(code)):
            if code[idx] == '{':
                brace_depth += 1
            elif code[idx] == '}':
                brace_depth -= 1
                if brace_depth == 0:
                    func_end = idx + 1
                    break

        # Build replacement function with wide pointer
        new_func = (
            f'void {fn}(\n'
            f'  ap_uint<{wide_bits}> {in_var}[{rows}],\n'
            f'  int32_t {out_var}[{rows}][{cols}]\n'
            f') {{\t//\n'
            f'  #pragma HLS array_partition variable={out_var} complete dim=2\n'
            f'  l_S_{fn}_{fn}_l_0: for (int {fn}_l_0 = 0;'
            f' {fn}_l_0 < {rows}; {fn}_l_0++) {{\t//\n'
            f'  #pragma HLS pipeline II=1 rewind\n'
            f'    ap_uint<{wide_bits}> row = {in_var}[{fn}_l_0];\t//\n'
        )
        for j in range(cols):
            lo, hi = j * 32, j * 32 + 31
            new_func += (
                f'    {out_var}[{fn}_l_0][{j}] ='
                f' (int32_t)row.range({hi}, {lo});\t//\n'
            )
        new_func += '  }\n}\n'

        code = code[:sig.start()] + new_func + code[func_end:]

    # Step 2b: Rewrite 3D int8 load_bufs (e.g., birrd_inst[D0][D1][D2])
    # Read D1*D2 int8 values per cycle using ap_uint<D1*D2*8>
    for buf_id in range(13):
        fn = f'load_buf{buf_id}'
        sig = re.search(
            rf'void {fn}\(\s*\n'
            rf'\s*int8_t\s+(\w+)\[(\d+)\],\s*\n'
            rf'\s*int8_t\s+(\w+)\[(\d+)\]\[(\d+)\]\[(\d+)\]\s*\n'
            rf'\) \{{',
            code,
        )
        if not sig:
            continue
        in_var, flat_sz = sig.group(1), int(sig.group(2))
        out_var = sig.group(3)
        d0, d1, d2 = int(sig.group(4)), int(sig.group(5)), int(sig.group(6))
        inner_elems = d1 * d2
        wide_bits = inner_elems * 8

        # Find function end
        brace_depth, func_end = 0, sig.start()
        for idx in range(sig.start(), len(code)):
            if code[idx] == '{':
                brace_depth += 1
            elif code[idx] == '}':
                brace_depth -= 1
                if brace_depth == 0:
                    func_end = idx + 1
                    break

        new_func = (
            f'void {fn}(\n'
            f'  ap_uint<{wide_bits}> {in_var}[{d0}],\n'
            f'  int8_t {out_var}[{d0}][{d1}][{d2}]\n'
            f') {{\t//\n'
            f'  #pragma HLS array_partition variable={out_var} complete dim=2\n'
            f'  #pragma HLS array_partition variable={out_var} complete dim=3\n'
            f'  l_S_{fn}_{fn}_l_0: for (int {fn}_l_0 = 0;'
            f' {fn}_l_0 < {d0}; {fn}_l_0++) {{\t//\n'
            f'  #pragma HLS pipeline II=1 rewind\n'
            f'    ap_uint<{wide_bits}> row = {in_var}[{fn}_l_0];\t//\n'
        )
        for i1 in range(d1):
            for i2 in range(d2):
                bit_idx = (i1 * d2 + i2) * 8
                lo, hi = bit_idx, bit_idx + 7
                new_func += (
                    f'    {out_var}[{fn}_l_0][{i1}][{i2}] ='
                    f' (int8_t)row.range({hi}, {lo});\t//\n'
                )
        new_func += '  }\n}\n'
        code = code[:sig.start()] + new_func + code[func_end:]

    # Step 3: Update top-level parameter types for all widened load_bufs
    # Change int32_t/int8_t *vNNNN to ap_uint<WIDE> *vNNNN for widened ports
    for buf_id in range(13):
        gmem_id = buf_id
        fn = f'load_buf{buf_id}'
        # Find the function to get the wide_bits value
        sig = re.search(rf'void {fn}\(\s*\n\s*ap_uint<(\d+)>', code)
        if not sig:
            continue
        wide_bits = sig.group(1)
        # Find the m_axi pragma for this gmem
        pragma_pattern = (
            rf'(#pragma HLS interface m_axi port=(\w+) offset=slave'
            rf' bundle=gmem{gmem_id})'
        )
        pm = re.search(pragma_pattern, code)
        if not pm:
            continue
        port_var = pm.group(2)
        # Change parameter type in full_matrix_top signature
        for base_type in ('int32_t', 'int8_t'):
            old_decl = f'  {base_type} *{port_var}'
            new_decl = f'  ap_uint<{wide_bits}> *{port_var}'
            if old_decl in code:
                code = code.replace(old_decl, new_decl, 1)
                break

    # Step 4: Widen store_res functions (2D local → 1D DRAM)
    # Pattern: void store_resN(int32_t local[R][C], int32_t dram[FLAT])
    # Rewrite: pack C int32 values per row into ap_uint<C*32>, write 1 row/cycle
    for match in re.finditer(
        r'void (store_res\d+)\(\s*\n'
        r'\s*int32_t\s+(\w+)\[(\d+)\]\[(\d+)\],\s*\n'
        r'\s*int32_t\s+(\w+)\[(\d+)\]\s*\n'
        r'\) \{',
        code,
    ):
        fn = match.group(1)
        local_var, rows, cols = match.group(2), int(match.group(3)), int(match.group(4))
        dram_var, flat_sz = match.group(5), int(match.group(6))
        wide_bits = cols * 32

        brace_depth, func_end = 0, match.start()
        for idx in range(match.start(), len(code)):
            if code[idx] == '{':
                brace_depth += 1
            elif code[idx] == '}':
                brace_depth -= 1
                if brace_depth == 0:
                    func_end = idx + 1
                    break

        new_func = (
            f'void {fn}(\n'
            f'  int32_t {local_var}[{rows}][{cols}],\n'
            f'  ap_uint<{wide_bits}> {dram_var}[{rows}]\n'
            f') {{\t//\n'
            f'  #pragma HLS array_partition variable={local_var} complete dim=2\n'
            f'  l_S_{fn}_{fn}_l_0: for (int {fn}_l_0 = 0;'
            f' {fn}_l_0 < {rows}; {fn}_l_0++) {{\t//\n'
            f'  #pragma HLS pipeline II=1 rewind\n'
            f'    ap_uint<{wide_bits}> row = 0;\t//\n'
        )
        for j in range(cols):
            lo, hi = j * 32, j * 32 + 31
            new_func += (
                f'    row.range({hi}, {lo}) ='
                f' (ap_uint<32>){local_var}[{fn}_l_0][{j}];\t//\n'
            )
        new_func += f'    {dram_var}[{fn}_l_0] = row;\t//\n'
        new_func += '  }\n}\n'
        code = code[:match.start()] + new_func + code[func_end:]

        # Update top-level parameter type for the store port
        # Find gmem for this store_res by looking at its DRAM port in the top function
        # The store_res buf number is in the function name
        store_num = re.search(r'store_res(\d+)', fn).group(1)
        gmem_pattern = (
            rf'#pragma HLS interface m_axi port=(\w+) offset=slave'
            rf' bundle=gmem{store_num}'
        )
        sm = re.search(gmem_pattern, code)
        if sm:
            port_var = sm.group(1)
            code = code.replace(
                f'  int32_t *{port_var}',
                f'  ap_uint<{wide_bits}> *{port_var}',
                1,
            )
        break  # only one store_res expected

    # Step 5: Add DEPENDENCE pragma to output_accum block loop
    # The output_accum writes to C with runtime-computed indices, causing HLS
    # to assume inter-iteration dependence on C (II=16). Different blocks write
    # to non-overlapping regions, so inter-iteration dependence is false.
    oa_match = re.search(
        r'void output_accum_0\([^)]+\) \{[^}]*?'
        r'#pragma HLS array_partition variable=(\w+) complete dim=2',
        code,
        re.DOTALL,
    )
    if oa_match:
        c_var = oa_match.group(1)
        block_loop = re.search(
            r'(l_S_block_0_block: for \([^)]+\) \{[^\n]*\n)',
            code,
        )
        if block_loop:
            pragma = f'  #pragma HLS DEPENDENCE variable={c_var} type=inter false\n'
            insert_pos = block_loop.end()
            code = code[:insert_pos] + pragma + code[insert_pos:]

    with open(kernel_path, "w") as f:
        f.write(code)
    print(f"  Patched kernel.cpp: widened m_axi + optimized load_buf/store throughput")


def _patch_maxi_depths(project_dir, trace_info):
    """Patch m_axi interface depths in kernel.cpp for cosim.

    Without explicit depth hints, Vitis HLS cosim uses default buffer
    sizes that may be too small for the actual data transfers.
    """
    M_padded = trace_info["M_padded"]
    K = trace_info["K"]
    N = trace_info["N"]
    num_inst = len(trace_info["instructions"])
    num_tiles = trace_info["n_tiles"]
    AW = trace_info["AW"]
    n_inner = trace_info.get("n_inner", 1)
    total_ops = num_tiles * n_inner
    P0, P1 = compute_birrd_params(AW)
    num_accum_params = 2 + num_tiles

    kernel_path = os.path.join(project_dir, "kernel.cpp")
    if not os.path.isfile(kernel_path):
        return

    with open(kernel_path, "r") as f:
        code = f.read()

    # Compute sizes for each m_axi port (14 args, kernel-grouped order)
    # a_loader: A_pe (int32), inst_pe (int32), loader_m_start (int32)
    # w_loader: B_pe (int32), inst_w (int32), loader_n_start (int32)
    # inst_rw: birrd_inst (int8)
    # output_accum: output_col_map, output_num_m, output_n_base,
    #               accum_m_start, accum_n_start, accum_params, C
    sizes = {
        "A_pe": M_padded * K,
        "inst_pe": num_inst * 13,
        "loader_m_start": total_ops,
        "B_pe": K * N,
        "inst_w": num_inst * 13,
        "loader_n_start": total_ops,
        "birrd_inst": num_tiles * P0 * P1,
        "output_col_map": num_tiles * AW,
        "output_num_m": num_tiles,
        "output_n_base": num_tiles * AW,
        "accum_m_start": total_ops,
        "accum_n_start": total_ops,
        "accum_params": num_accum_params,
        "C": M_padded * N,
    }

    # Add depth to m_axi pragmas
    for port_name, depth in sizes.items():
        old = f'depth={depth}'  # skip if already patched
        if old in code:
            continue
        # Match #pragma HLS interface m_axi port=vXXX ... (no depth)
        # We need to add depth=N to the pragma
        import re as re_mod
        pattern = rf'(#pragma HLS interface m_axi port=\w+ offset=slave bundle=\w+)'
        # Find pragmas and add depth — use line-by-line approach
    # Simpler approach: just add depth to all m_axi pragmas if not present
    lines = code.split("\n")
    new_lines = []
    port_idx = 0
    port_order = list(sizes.keys())
    for line in lines:
        if "#pragma HLS interface m_axi" in line and "depth=" not in line:
            if port_idx < len(port_order):
                depth = sizes[port_order[port_idx]]
                line = line.rstrip() + f" depth={depth}"
                port_idx += 1
        new_lines.append(line)

    with open(kernel_path, "w") as f:
        f.write("\n".join(new_lines))
    print(f"  Patched kernel.cpp: m_axi depths for cosim")


def _report_synthesis(project_dir):
    """Parse and report HLS synthesis results."""
    try:
        import xmltodict
    except ImportError:
        print("  (install xmltodict for detailed synthesis report)")
        return

    xml_path = os.path.join(
        project_dir, "out.prj", "solution1", "syn", "report",
        "full_matrix_top_csynth.xml",
    )
    if not os.path.isfile(xml_path):
        print(f"  Synthesis report not found: {xml_path}")
        return

    with open(xml_path, "r", encoding="utf-8") as f:
        profile = xmltodict.parse(f.read())["profile"]

    perf = profile["PerformanceEstimates"]
    latency = perf["SummaryOfOverallLatency"]
    area = profile["AreaEstimates"]["Resources"]

    print(f"\n  === Synthesis Results ===")
    print(f"  Best-case latency:  {latency['Best-caseLatency']} cycles")
    print(f"  Worst-case latency: {latency['Worst-caseLatency']} cycles")
    print(f"\n  === Resource Utilization ===")
    for resource in ("BRAM_18K", "DSP", "DSP48E", "FF", "LUT", "URAM"):
        if resource in area:
            print(f"  {resource}: {area[resource]}")


def _report_cosim(project_dir):
    """Parse and report RTL co-simulation results."""
    log_path = os.path.join(
        project_dir, "out.prj", "solution1", "sim", "report",
        "full_matrix_top_cosim.rpt",
    )
    if not os.path.isfile(log_path):
        # Try alternative path
        log_path = os.path.join(project_dir, "out.prj", "solution1", "sim", "report", "verilog")
        if os.path.isdir(log_path):
            for f in os.listdir(log_path):
                if f.endswith(".rpt"):
                    log_path = os.path.join(log_path, f)
                    break

    if os.path.isfile(log_path):
        with open(log_path) as f:
            content = f.read()
        print(f"\n  === Co-simulation Report ===")
        for line in content.split("\n"):
            if line.strip():
                print(f"  {line}")


def _c_array_1d(name, dtype, data):
    """Generate a C array initializer for a flattened array."""
    vals = ", ".join(str(int(x)) for x in data.flat)
    return f"{dtype} {name}[{data.size}] = {{{vals}}};\n"


def _generate_cosim_testbench(project_dir, trace_info, A, B, instructions,
                               C_ref, M_padded):
    """Write a C testbench that calls full_matrix_top for cosim."""
    from minisa.isa import SetOVNLayout
    from minisa.lowering import (
        lower_ovn_layout, compute_col_to_m_map,
        compute_output_col_map, _simulate_birrd_passthrough_perm,
    )

    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    num_inst = len(instructions)
    num_tiles = num_inst - 3
    n_inner = trace_info.get("n_inner", 1)
    total_ops = num_tiles * n_inner
    P0, P1 = compute_birrd_params(AW)

    # Compute BIRRD configs (same logic as FeatherModule.__call__)
    ovn_order = int(instructions[2, 1])
    ovn = SetOVNLayout(order=ovn_order, PL0=AW, PL1=1, QL0=AW, QL1=1)
    birrd_table = lower_ovn_layout(ovn, AW, AW)
    passthrough_perm = _simulate_birrd_passthrough_perm(AW)
    pair_to_col = compute_output_col_map(AW, ovn_order)

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
            col_map_per_tile[t] = compute_col_to_m_map(AW, ovn_order, AW)
            num_m_per_tile[t] = AW
            for col in range(AW):
                orig_pe = int(passthrough_perm[col])
                n_base_per_tile[t, col] = sc * (orig_pe & mask_Gc)
        elif Gr == 1:
            col_map_per_tile[t] = np.zeros(AW, dtype=np.int32)
            num_m_per_tile[t] = 1
            for col in range(AW):
                orig_pe = int(passthrough_perm[col])
                n_base_per_tile[t, col] = sc * (orig_pe & mask_Gc)
        else:
            birrd_per_tile[t] = birrd_table
            col_map_per_tile[t] = compute_col_to_m_map(AW, ovn_order, Gr)
            num_m_per_tile[t] = Gr
            for pair_idx in range(AW // 2):
                col = int(pair_to_col[pair_idx])
                n_base_per_tile[t, col] = sc * (pair_idx & mask_Gc)

    # Per-sub-operation m_start/n_start
    if 'inner_m_starts' in trace_info:
        m_start_per_op = trace_info['inner_m_starts']
        n_start_per_op = trace_info['inner_n_starts']
    else:
        m_start_per_op = np.array(
            [int(instructions[3 + t, 7]) for t in range(num_tiles)], dtype=np.int32
        )
        n_start_per_op = np.array(
            [int(instructions[3 + t, 9]) for t in range(num_tiles)], dtype=np.int32
        )

    # Build accum_params: [quant_scale, quant_zp, sr[0], sr[1], ...]
    num_accum_params = 2 + num_tiles
    accum_params = np.zeros(num_accum_params, dtype=np.int32)
    accum_params[0] = int(instructions[2, 6])  # quant_scale
    accum_params[1] = int(instructions[2, 7])  # quant_zp
    for t in range(num_tiles):
        accum_params[2 + t] = int(instructions[3 + t, 5])  # sr

    # Write testbench
    tb_path = os.path.join(project_dir, "tb.cpp")
    with open(tb_path, "w") as f:
        f.write('#include <cstdint>\n#include <cstdio>\n#include <cstring>\n\n')
        f.write('#include "kernel.h"\n\n')
        f.write("int main() {\n")

        # 14 args in kernel-grouped order:
        # a_loader: A_pe (int32), inst_pe (int32), loader_m_start (int32)
        # w_loader: B_pe (int32), inst_w (int32), loader_n_start (int32)
        # inst_rw: birrd_inst (int8)
        # output_accum: output_col_map, output_num_m, output_n_base,
        #               accum_m_start, accum_n_start, accum_params, C
        f.write("  // A_pe[M_padded, K] (a_loader, int32)\n")
        f.write("  " + _c_array_1d("A_pe", "int32_t", A.astype(np.int32).flatten()))
        f.write("  // inst_pe[num_inst, 13] (a_loader)\n")
        f.write("  " + _c_array_1d("inst_pe", "int32_t", instructions.flatten()))
        f.write("  // loader_m_start[total_ops] (a_loader)\n")
        f.write("  " + _c_array_1d("loader_m_start", "int32_t", m_start_per_op.flatten()))
        f.write("  // B_pe[K, N] (w_loader, int32)\n")
        f.write("  " + _c_array_1d("B_pe", "int32_t", B.astype(np.int32).flatten()))
        f.write("  // inst_w[num_inst, 13] (w_loader, separate instruction copy)\n")
        f.write("  " + _c_array_1d("inst_w", "int32_t", instructions.flatten()))
        f.write("  // loader_n_start[total_ops] (w_loader)\n")
        f.write("  " + _c_array_1d("loader_n_start", "int32_t", n_start_per_op.flatten()))
        f.write("  // birrd_inst[num_tiles, P0, P1] (inst_rw)\n")
        f.write("  " + _c_array_1d("birrd_inst", "int8_t", birrd_per_tile.flatten()))
        f.write("  // output_col_map[num_tiles, AW]\n")
        f.write("  " + _c_array_1d("output_col_map", "int32_t", col_map_per_tile.flatten()))
        f.write("  // output_num_m[num_tiles]\n")
        f.write("  " + _c_array_1d("output_num_m", "int32_t", num_m_per_tile.flatten()))
        f.write("  // output_n_base[num_tiles, AW]\n")
        f.write("  " + _c_array_1d("output_n_base", "int32_t", n_base_per_tile.flatten()))
        f.write("  // accum_m_start[total_ops]\n")
        f.write("  " + _c_array_1d("accum_m_start", "int32_t", m_start_per_op.flatten()))
        f.write("  // accum_n_start[total_ops]\n")
        f.write("  " + _c_array_1d("accum_n_start", "int32_t", n_start_per_op.flatten()))
        f.write("  // accum_params[num_accum_params] — quant_scale, quant_zp, sr[...]\n")
        f.write("  " + _c_array_1d("accum_params", "int32_t", accum_params.flatten()))
        f.write(f"  // C[M_padded, N] output\n")
        f.write(f"  int32_t C[{M_padded * N}];\n")
        f.write(f"  memset(C, 0, sizeof(C));\n\n")

        # Call top function (14 args, kernel-grouped order)
        f.write("  // Run FEATHER+ dataflow\n")
        f.write("  full_matrix_top(A_pe, inst_pe, loader_m_start, "
                "B_pe, inst_w, loader_n_start, birrd_inst, "
                "output_col_map, output_num_m, output_n_base, "
                "accum_m_start, accum_n_start, accum_params, C);\n\n")

        # Verify output (only first M rows, ignore padding)
        f.write("  // Reference output\n")
        f.write("  " + _c_array_1d("C_ref", "int32_t", C_ref.flatten()))
        f.write("  // Verify (skip padded rows)\n")
        f.write("  int errors = 0;\n")
        f.write(f"  for (int i = 0; i < {M}; i++) {{\n")
        f.write(f"    for (int j = 0; j < {N}; j++) {{\n")
        f.write(f"      int idx = i * {N} + j;\n")
        f.write(f"      if (C[idx] != C_ref[idx]) {{\n")
        f.write('        printf("MISMATCH at [%d,%d]: got %d, expected %d\\n", i, j, C[idx], C_ref[idx]);\n')
        f.write("        errors++;\n")
        f.write("      }\n")
        f.write("    }\n")
        f.write("  }\n")
        f.write('  if (errors == 0) printf("COSIM PASSED: all outputs match\\n");\n')
        f.write(f'  else printf("COSIM FAILED: %d mismatches\\n", errors);\n')
        f.write("  return errors;\n")
        f.write("}\n")

    print(f"  Wrote testbench: {tb_path}")
    return tb_path


def _generate_cosim_tcl(project_dir):
    """Write a TCL script that runs csynth + cosim."""
    tcl_path = os.path.join(project_dir, "run_cosim.tcl")
    with open(tcl_path, "w") as f:
        f.write("set hls_prj out.prj\n")
        f.write("open_project ${hls_prj} -reset\n")
        f.write("open_solution -reset solution1 -flow_target vivado\n")
        f.write("set_top full_matrix_top\n")
        f.write("add_files kernel.cpp\n")
        f.write('add_files -tb tb.cpp -cflags "-std=gnu++0x"\n')
        f.write('open_solution "solution1"\n')
        f.write("set_part {xcu280-fsvh2892-2L-e}\n")
        f.write("create_clock -period 3.33\n")
        f.write("csynth_design\n")
        f.write("cosim_design\n")
        f.write("exit\n")
    return tcl_path


def _run_cosim(trace_info, project_dir, seed=42):
    """Run RTL co-simulation for trace workload.

    Uses csyn mode to generate kernel.cpp, then writes a custom C testbench,
    patches m_axi depths, and runs cosim_design for cycle-accurate latency.
    """
    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    instructions = trace_info["instructions"]

    n_inner = trace_info.get('n_inner', 1)
    k_passes = trace_info.get('k_passes', 1)

    # Step 1: Build csyn project to get kernel.cpp
    print(f"  Step 1: Generating HLS project (csyn)...")
    top = get_feather_full_matrix_top(
        M_padded, K, N, AW, AH, int8, len(instructions), n_inner, k_passes,
    )
    s = df.customize(top)
    schedule_feather_hls(s, K, N, AH, AW)
    hls_mod = s.build(target="vitis_hls", mode="csyn", project=project_dir)

    # Patch wide ap_uint
    patch_kernel_for_wide_apint(project_dir, AW * AH * int8.bits)

    # Step 2: Patch m_axi depths
    print(f"  Step 2: Patching m_axi depths...")
    _patch_maxi_depths(project_dir, trace_info)

    # Step 3: Generate test data and testbench
    print(f"  Step 3: Generating testbench with test data...")
    np.random.seed(seed)
    A_orig = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)
    C_ref = A_orig.astype(np.int32) @ B.astype(np.int32)

    if M_padded != M:
        A = np.zeros((M_padded, K), dtype=np.int8)
        A[:M, :] = A_orig
    else:
        A = A_orig

    _generate_cosim_testbench(project_dir, trace_info, A, B, instructions,
                               C_ref, M_padded)

    # Step 4: Generate cosim TCL
    _generate_cosim_tcl(project_dir)

    # Step 5: Run csynth + cosim
    print(f"  Step 5: Running csynth + cosim (this may take a long time)...")
    cmd = f"cd {project_dir}; vitis_hls -f run_cosim.tcl"
    process = subprocess.Popen(
        cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    stdout, _ = process.communicate()
    log = stdout.decode("utf-8", errors="replace")

    # Save log
    log_path = os.path.join(project_dir, "cosim.log")
    with open(log_path, "w") as f:
        f.write(log)

    if process.returncode != 0:
        print(f"  Cosim failed (exit code {process.returncode})")
        print(f"  See log: {log_path}")
        for line in log.strip().split("\n")[-30:]:
            print(f"    {line}")
        return False

    # Parse cycle count
    _report_cosim(project_dir)

    # Also search log for cycle info
    cycles = None
    for line in log.split("\n"):
        m = re.search(r"Verilog\|\s*Pass\|\s*(\d+)", line)
        if m:
            cycles = int(m.group(1))

    if cycles:
        print(f"\n  RTL Co-Simulation Cycle Count: {cycles}")
        if trace_info['rtl_latency']:
            ratio = cycles / trace_info['rtl_latency']
            print(f"  RTL reference: {trace_info['rtl_latency']} cycles")
            print(f"  Ratio: {ratio:.1f}x")
    else:
        print(f"\n  Check log for results: {log_path}")

    return True


def run_deploy(trace_info, seed=42):
    """Build and deploy the trace workload to U280 FPGA."""
    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    instructions = trace_info["instructions"]

    trace_name = f"trace_{M}x{K}x{N}"
    project_dir = os.path.join(TESTS_DIR, f"{trace_name}_hw.prj")

    print(f"\n{'=' * 70}")
    print(f"U280 DEPLOYMENT")
    print(f"{'=' * 70}")
    print(f"  Workload: C[{M},{N}] = A[{M},{K}] x B[{K},{N}]")
    print(f"  Array: {AH}x{AW}")
    print(f"  Project: {project_dir}")

    n_inner = trace_info.get('n_inner', 1)
    k_passes = trace_info.get('k_passes', 1)

    # Step 1: Generate HW project
    print(f"\n--- Step 1: Generate HW Project ---")
    top = get_feather_full_matrix_top(
        M_padded, K, N, AW, AH, int8, len(instructions), n_inner, k_passes,
    )
    s = df.customize(top)
    schedule_feather_hls(s, K, N, AH, AW)
    hls_mod = s.build(target="vitis_hls", mode="hw", project=project_dir)

    # Patch for wide ap_uint
    patch_kernel_for_wide_apint(project_dir, AW * AH * int8.bits)
    # Apply throughput patches (wide DRAM, DEPENDENCE pragma, etc.)
    _patch_load_bufs_for_throughput(project_dir)

    # Step 2: Write input data
    print(f"\n--- Step 2: Write Input Data ---")
    _write_deploy_input_data(trace_info, project_dir, seed)

    # Step 3: Generate HBM config
    print(f"\n--- Step 3: Generate HBM Config ---")
    _generate_hbm_config(project_dir)

    # Step 4: Build bitstream
    print(f"\n--- Step 4: Build Bitstream ---")
    xdevice = os.environ.get("XDEVICE", "")
    if not xdevice:
        print("  XDEVICE not set. Set it and run:")
        print(f"    cd {project_dir} && make build TARGET=hw PLATFORM=$XDEVICE")
        print("  Then re-run with --deploy to execute.")
        return

    # Check if xclbin already exists
    xsa = xdevice.rsplit("/", 1)[-1].split(".")[0]
    xclbin_path = os.path.join(project_dir, f"build_dir.hw.{xsa}", "full_matrix_top.xclbin")

    if os.path.exists(xclbin_path):
        print(f"  Bitstream already exists: {xclbin_path}")
    else:
        print(f"  Building bitstream (this takes hours)...")
        cmd = f"cd {project_dir} && make build TARGET=hw PLATFORM=$XDEVICE"
        print(f"  Command: {cmd}")
        process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        stdout, _ = process.communicate()
        log = stdout.decode("utf-8", errors="replace")
        log_path = os.path.join(project_dir, "build_hw.log")
        with open(log_path, "w") as f:
            f.write(log)
        if process.returncode != 0:
            print(f"  BUILD FAILED (exit code {process.returncode})")
            for line in log.strip().split("\n")[-20:]:
                print(f"    {line}")
            return
        print(f"  Build complete.")

    # Step 5: Run on device
    print(f"\n--- Step 5: Run on Device ---")
    _run_on_device(trace_info, project_dir, seed)


def _write_deploy_input_data(trace_info, project_dir, seed=42):
    """Write binary input data files for the host executable."""
    from minisa.isa import SetOVNLayout
    from minisa.lowering import (
        lower_ovn_layout, compute_col_to_m_map,
        compute_output_col_map, _simulate_birrd_passthrough_perm,
        generate_birrd_instructions, _simulate_birrd_output_col_map_general,
    )

    M = trace_info["M"]
    K = trace_info["K"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]
    AH = trace_info["AH"]
    AW = trace_info["AW"]
    instructions = trace_info["instructions"]
    num_tiles = trace_info["n_tiles"]
    P0, P1 = compute_birrd_params(AW)

    np.random.seed(seed)
    A_orig = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B_orig = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)
    C_ref = A_orig.astype(np.int32) @ B_orig.astype(np.int32)

    # Kernel uses int32 for A and B (FeatherModule does int8->int32 conversion)
    B = B_orig.astype(np.int32)

    # Pad A
    if M_padded != M:
        A = np.zeros((M_padded, K), dtype=np.int32)
        A[:M, :] = A_orig.astype(np.int32)
    else:
        A = A_orig.astype(np.int32)

    # Compute BIRRD tables (same logic as FeatherModule.__call__)
    ovn_order = int(instructions[2, 1])
    ovn = SetOVNLayout(order=ovn_order, PL0=AW, PL1=1, QL0=AW, QL1=1)
    birrd_table = lower_ovn_layout(ovn, AW, AW)
    passthrough_perm = _simulate_birrd_passthrough_perm(AW)
    pair_to_col = compute_output_col_map(AW, ovn_order)

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
            col_map_per_tile[t] = compute_col_to_m_map(AW, ovn_order, AW)
            num_m_per_tile[t] = AW
            for col in range(AW):
                orig_pe = int(passthrough_perm[col])
                n_base_per_tile[t, col] = sc * (orig_pe & mask_Gc)
        elif Gr == AW // 2:
            birrd_per_tile[t] = birrd_table
            col_map_per_tile[t] = compute_col_to_m_map(AW, ovn_order, Gr)
            num_m_per_tile[t] = Gr
            for pair_idx in range(AW // 2):
                col = int(pair_to_col[pair_idx])
                n_base_per_tile[t, col] = sc * (pair_idx & mask_Gc)
        elif Gr == 1:
            col_map_per_tile[t] = np.zeros(AW, dtype=np.int32)
            num_m_per_tile[t] = 1
            for col in range(AW):
                orig_pe = int(passthrough_perm[col])
                n_base_per_tile[t, col] = sc * (orig_pe & mask_Gc)
        else:
            birrd_inst_gen = generate_birrd_instructions(AW, Gr)
            birrd_per_tile[t] = birrd_inst_gen
            col_map_per_tile[t] = compute_col_to_m_map(AW, ovn_order, Gr)
            num_m_per_tile[t] = Gr
            m_to_col = _simulate_birrd_output_col_map_general(birrd_inst_gen, AW, Gr)
            for m_idx in range(Gr):
                col = int(m_to_col[m_idx])
                n_base_per_tile[t, col] = sc * (m_idx & mask_Gc)

    # Per-sub-operation m_start/n_start
    if 'inner_m_starts' in trace_info:
        m_start_per_op = trace_info['inner_m_starts']
        n_start_per_op = trace_info['inner_n_starts']
    else:
        m_start_per_op = np.array(
            [int(instructions[3 + t, 7]) for t in range(num_tiles)], dtype=np.int32
        )
        n_start_per_op = np.array(
            [int(instructions[3 + t, 9]) for t in range(num_tiles)], dtype=np.int32
        )

    # Build accum_params for deploy
    num_accum_params = 2 + num_tiles
    deploy_accum_params = np.zeros(num_accum_params, dtype=np.int32)
    deploy_accum_params[0] = int(instructions[2, 6])
    deploy_accum_params[1] = int(instructions[2, 7])
    for t in range(num_tiles):
        deploy_accum_params[2 + t] = int(instructions[3 + t, 5])

    C = np.zeros((M_padded, N), dtype=np.int32)

    # 14 arrays in kernel-grouped order (matching full_matrix_top signature)
    arrays = [
        ("A", A),
        ("instructions", instructions),
        ("loader_m_start", m_start_per_op),
        ("B", B),
        ("inst_w", instructions.copy()),
        ("loader_n_start", n_start_per_op),
        ("birrd_inst", birrd_per_tile),
        ("output_col_map", col_map_per_tile),
        ("output_num_m", num_m_per_tile),
        ("output_n_base", n_base_per_tile),
        ("accum_m_start", m_start_per_op),
        ("accum_n_start", n_start_per_op),
        ("accum_params", deploy_accum_params),
        ("C", C),
    ]

    for i, (name, arr) in enumerate(arrays):
        path = os.path.join(project_dir, f"input{i}.data")
        with open(path, "wb") as f:
            f.write(arr.tobytes())
        print(f"    input{i}.data: {name:20s} shape={str(arr.shape):20s} {arr.nbytes} bytes")

    ref_path = os.path.join(project_dir, "c_ref.npy")
    np.save(ref_path, C_ref)
    print(f"    c_ref.npy: reference output saved ({C_ref.shape})")


def _generate_hbm_config(project_dir):
    """Generate HBM bank mapping config for the v++ linker."""
    # Read kernel.h to find port names
    kernel_h = os.path.join(project_dir, "kernel.h")
    if not os.path.isfile(kernel_h):
        print("  WARNING: kernel.h not found, skipping HBM config")
        return

    with open(kernel_h) as f:
        content = f.read()

    # Extract port names from function signature
    import re as re_mod
    ports = re_mod.findall(r'\*(\w+)', content)
    if not ports:
        print("  WARNING: No ports found in kernel.h")
        return

    # Generate connectivity config
    cfg_lines = ["[connectivity]\n"]
    cfg_lines.append("# Map each m_axi port to a separate HBM bank for parallel access\n")
    for i, port in enumerate(ports):
        cfg_lines.append(f"sp=full_matrix_top_1.{port}:HBM[{i}]\n")

    cfg_path = os.path.join(project_dir, "full_matrix_top.cfg")
    with open(cfg_path, "w") as f:
        f.writelines(cfg_lines)
    print(f"  Generated {cfg_path} ({len(ports)} ports mapped to HBM[0..{len(ports)-1}])")

    # Ensure Makefile references the config
    mk_path = os.path.join(project_dir, "makefile_us_alveo.mk")
    if os.path.isfile(mk_path):
        with open(mk_path, "r") as f:
            mk_content = f.read()
        if "--config full_matrix_top.cfg" not in mk_content:
            mk_content = mk_content.replace(
                "VPP_LDFLAGS :=",
                "VPP_LDFLAGS := --config full_matrix_top.cfg",
            )
            with open(mk_path, "w") as f:
                f.write(mk_content)
            print(f"  Updated Makefile with --config full_matrix_top.cfg")


def _run_on_device(trace_info, project_dir, seed=42):
    """Run the compiled design on U280 FPGA and verify."""
    import glob

    M = trace_info["M"]
    N = trace_info["N"]
    M_padded = trace_info["M_padded"]

    # Find xclbin
    xclbin_matches = glob.glob(os.path.join(project_dir, "build_dir.hw.*", "full_matrix_top.xclbin"))
    if not xclbin_matches:
        print("  ERROR: No xclbin found. Build first.")
        return None

    xclbin_path = xclbin_matches[0]
    host_exe = os.path.join(project_dir, "full_matrix_top")

    if not os.path.exists(host_exe):
        print("  Building host executable...")
        cmd = f"cd {project_dir} && make host PLATFORM=$XDEVICE"
        subprocess.run(cmd, shell=True, check=True)

    print(f"  Running on U280...")
    cmd = f"cd {project_dir} && ./full_matrix_top {xclbin_path}"
    process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    stdout, _ = process.communicate()
    output = stdout.decode("utf-8", errors="replace")

    print(f"\n  === Device Output ===")
    for line in output.strip().split("\n"):
        print(f"    {line}")

    # Parse execution time
    exe_time_ns = None
    for line in output.split("\n"):
        m = re.search(r"\|\s*\w+\s*\|\s*(\d+)\s*\|", line)
        if m:
            exe_time_ns = int(m.group(1))

    # Verify output
    ref_path = os.path.join(project_dir, "c_ref.npy")
    out_path = os.path.join(project_dir, "output0.data")
    if os.path.exists(ref_path) and os.path.exists(out_path):
        C_ref = np.load(ref_path)
        # Output has padded M dimension
        C_raw = np.fromfile(out_path, dtype=np.int32).reshape(M_padded, N)
        C_out = C_raw[:M, :]
        if np.array_equal(C_out, C_ref):
            print(f"\n  OUTPUT VERIFICATION: PASSED")
        else:
            mismatches = np.sum(C_out != C_ref)
            print(f"\n  OUTPUT VERIFICATION: FAILED ({mismatches}/{C_out.size} mismatches)")

    if exe_time_ns is not None:
        freq_mhz = 300
        clock_period_ns = 1000.0 / freq_mhz
        cycles = exe_time_ns / clock_period_ns
        rtl_ref = trace_info.get("rtl_latency", None)

        print(f"\n  === Latency Results ===")
        print(f"  Wall-clock time:  {exe_time_ns} ns")
        print(f"  Clock frequency:  {freq_mhz} MHz ({clock_period_ns:.2f} ns period)")
        print(f"  Estimated cycles: {cycles:.0f}")
        if rtl_ref:
            print(f"  RTL reference:    {rtl_ref} cycles")
            print(f"  Ratio vs RTL:     {cycles/rtl_ref:.2f}x")

    return exe_time_ns


def main():
    parser = argparse.ArgumentParser(description="FEATHER+ trace-based test")
    parser.add_argument("trace", help="Path to trace JSON file")
    parser.add_argument("--hls", choices=["csim", "csyn", "cosim"], default=None,
                        help="HLS mode (default: simulator only)")
    parser.add_argument("--deploy", action="store_true",
                        help="Build and deploy to U280 FPGA")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    # Resolve trace path relative to feather-isa directory
    trace_path = args.trace
    if not os.path.isabs(trace_path):
        # Try relative to CWD first, then relative to feather-isa dir
        if not os.path.exists(trace_path):
            feather_dir = os.path.join(os.path.dirname(__file__), "..")
            trace_path = os.path.join(feather_dir, args.trace)

    if not os.path.exists(trace_path):
        print(f"ERROR: Trace file not found: {args.trace}")
        sys.exit(1)

    print(f"Parsing trace: {trace_path}")
    trace_info = load_trace(trace_path)

    print(f"\n  Trace summary:")
    print(f"    GEMM: C[{trace_info['M']},{trace_info['N']}] = "
          f"A[{trace_info['M']},{trace_info['K']}] x B[{trace_info['K']},{trace_info['N']}]")
    print(f"    Array: {trace_info['AH']}x{trace_info['AW']}")
    print(f"    Mapping: Gr={trace_info['Gr']}, Gc={trace_info['Gc']}, "
          f"sr={trace_info['sr']}, sc={trace_info['sc']}")
    n_sub = trace_info.get('n_sub_tiles', 1)
    n_inner_main = trace_info.get('n_inner', 1)
    print(f"    Tiles: {trace_info['n_tiles']} "
          f"({trace_info['n_m_batches']}M x {trace_info['n_spatial_tiles']}N"
          f"{f' x {n_sub}sub' if n_sub > 1 else ''}"
          f"{f', n_inner={n_inner_main}' if n_inner_main > 1 else ''})")
    if trace_info['M_padded'] != trace_info['M']:
        print(f"    M padded: {trace_info['M']} -> {trace_info['M_padded']}")
    if trace_info.get('rtl_latency'):
        print(f"    RTL reference: {trace_info['rtl_latency']} cycles")
    if trace_info.get('utilization'):
        print(f"    RTL utilization: {trace_info['utilization']}%")

    # Always run reference model first
    passed, _ = run_reference_test(trace_info, seed=args.seed)
    if not passed:
        print("\nReference model test FAILED — aborting")
        sys.exit(1)

    if args.deploy:
        run_deploy(trace_info, seed=args.seed)
    elif args.hls:
        run_hls_test(trace_info, mode=args.hls, seed=args.seed)
    else:
        sys.exit(0)


if __name__ == "__main__":
    main()
