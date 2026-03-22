# Copyright Allo authors. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

"""FEATHER Tutorial Support Module.

Infrastructure code for the Allo-FEATHER hands-on tutorial.
Handles trace parsing, ISA lowering, data generation, simulation,
and HLS synthesis — so the notebook stays focused on Allo concepts.
"""

import os
import re
import sys

import numpy as np

# ─── Path setup ───────────────────────────────────────────────────
_TUTORIAL_DIR = os.path.dirname(os.path.abspath(__file__))

# Find the FEATHER dev copy: either relative (in dev tree) or in /opt (container)
_FEATHER_DIR_CANDIDATES = [
    os.path.dirname(_TUTORIAL_DIR),                     # dev tree: tutorial/ is inside feather-isa/
    "/opt/feather_tutorial/allo-feather",                # JupyterHub container
]
_FEATHER_DIR = next(
    (p for p in _FEATHER_DIR_CANDIDATES
     if os.path.isfile(os.path.join(p, "feather_minisa.py"))),
    _FEATHER_DIR_CANDIDATES[0],
)

for _p in [_FEATHER_DIR]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ─── Allo imports ─────────────────────────────────────────────────
import allo
from allo.ir.types import int8, int32, UInt, Stream
import allo.dataflow as df
from allo.customize import Partition

from minisa.trace_parser import load_trace
from feather_minisa import (
    get_feather_full_matrix_top,
    FeatherModule,
    compute_birrd_params,
    schedule_feather_hls,
)

# ─── Trace ────────────────────────────────────────────────────────
_TRACE_PATH = os.path.join(
    _FEATHER_DIR, "instr_trace", "figure7_16x12x8_4x4.json"
)


def load_tutorial_trace():
    """Load the Figure 7 trace: C[16,8] = A[16,12] x B[12,8] on 4x4 array."""
    return load_trace(_TRACE_PATH)


def print_trace_summary(trace_info):
    """Pretty-print the trace in a format similar to ACT compiler output."""
    M, K, N = trace_info["M"], trace_info["K"], trace_info["N"]
    AH, AW = trace_info["AH"], trace_info["AW"]
    program = trace_info["program"]
    n_tiles = trace_info["n_tiles"]
    util = trace_info.get("utilization", 0)

    print(f"FEATHER Trace: C[{M},{N}] = A[{M},{K}] x B[{K},{N}]")
    print(f"  Array: {AH}x{AW} ({AH*AW} PEs), utilization: {util:.1f}%")
    print()

    # Show ISA instructions (matching ACT trace format)
    ivn = program.ivn_layout
    print(f"  SetIVNLayout(order={ivn.order}, ML1={ivn.ML1}, ML0={ivn.ML0}, JL1={ivn.JL1})")
    wvn = program.wvn_layout
    print(f"  SetWVNLayout(order={wvn.order}, NL1={wvn.NL1}, NL0={wvn.NL0}, KL1={wvn.KL1})")
    ovn = program.ovn_layout
    print(f"  SetOVNLayout(order={ovn.order}, PL1={ovn.PL1}, PL0={ovn.PL0}, QL1={ovn.QL1})")

    # Show first few ExecuteMapping instructions
    mappings = program.mappings
    max_show = min(4, len(mappings))
    for i in range(max_show):
        m = mappings[i]
        print(f"  ExecuteMapping(Gr={m.Gr}, Gc={m.Gc}, r0={m.r0}, c0={m.c0}, "
              f"sr={m.sr}, sc={m.sc}, "
              f"m=[{m.m_start}:{m.m_end}], n=[{m.n_start}:{m.n_end}], "
              f"k=[{m.k_start}:{m.k_end}])")
    if len(mappings) > max_show:
        print(f"  ... ({len(mappings) - max_show} more tiles, {n_tiles} total)")


# ─── Test Data ────────────────────────────────────────────────────
def generate_test_data(trace_info, seed=42):
    """Generate random int8 test matrices and NumPy reference result."""
    M, K, N = trace_info["M"], trace_info["K"], trace_info["N"]
    M_padded = trace_info["M_padded"]
    np.random.seed(seed)
    A_orig = np.random.randint(-4, 4, size=(M, K)).astype(np.int8)
    B = np.random.randint(-4, 4, size=(K, N)).astype(np.int8)
    C_ref = A_orig.astype(np.int32) @ B.astype(np.int32)
    if M_padded != M:
        A = np.zeros((M_padded, K), dtype=np.int8)
        A[:M, :] = A_orig
    else:
        A = A_orig
    return A, B, C_ref


# ─── Simulation ──────────────────────────────────────────────────
def run_feather_simulation(trace_info, seed=42):
    """Build and run the full FEATHER dataflow simulation.

    Returns (C_result, passed).
    """
    M_padded = trace_info["M_padded"]
    M, K, N = trace_info["M"], trace_info["K"], trace_info["N"]
    AH, AW = trace_info["AH"], trace_info["AW"]
    instructions = trace_info["instructions"]
    k_passes = trace_info.get("k_passes", 1)
    n_inner = trace_info.get("n_inner", 1)

    A, B, C_ref = generate_test_data(trace_info, seed)

    print("Building FEATHER simulator (compiling dataflow to LLVM)...")
    # Reload allo.dataflow to clear any state from prior df.build() calls
    # (e.g., from tutorial exercises running in the same Jupyter kernel)
    import importlib
    importlib.reload(allo.dataflow)
    import allo.dataflow as df_fresh
    from feather_minisa import get_feather_full_matrix_top as _get_top
    top = _get_top(
        M_padded, K, N, AW, AH, int8, len(instructions), n_inner, k_passes,
    )
    allo_mod = df_fresh.build(top, target="simulator")
    mod = FeatherModule(allo_mod, AW, n_inner)

    C = np.zeros((M_padded, N), dtype=np.int32)
    print("Running simulation...")
    mod(A, B, instructions, C)

    result = C[:M, :]
    passed = np.array_equal(result, C_ref)
    if passed:
        print(f"\nOUTPUT VERIFICATION: PASS")
        print(f"  C[0,:] = {result[0, :]}")
        print(f"  Reference matches.")
    else:
        n_mismatch = np.sum(result != C_ref)
        print(f"\nOUTPUT VERIFICATION: FAIL "
              f"({n_mismatch}/{result.size} mismatches)")
    return result, passed


# ─── HLS Synthesis ────────────────────────────────────────────────
def run_feather_csynth(trace_info, schedule_fn=None, project_dir=None):
    """Build HLS project and run C-synthesis.

    Args:
        trace_info: Dict from load_tutorial_trace().
        schedule_fn: Optional function(s, K, N, AH, AW) that applies
            scheduling directives. If None, uses the reference schedule.
        project_dir: HLS project directory. Default: tutorial/builds/
    """
    if project_dir is None:
        project_dir = os.path.join(_TUTORIAL_DIR, "builds", "feather_csyn.prj")
    os.makedirs(os.path.dirname(project_dir), exist_ok=True)

    M_padded = trace_info["M_padded"]
    K, N = trace_info["K"], trace_info["N"]
    AH, AW = trace_info["AH"], trace_info["AW"]
    instructions = trace_info["instructions"]
    k_passes = trace_info.get("k_passes", 1)
    n_inner = trace_info.get("n_inner", 1)

    print("Building HLS project...")
    # Reload allo.dataflow to clear any state from prior df.build() calls
    import importlib
    importlib.reload(allo.dataflow)
    import allo.dataflow as df_fresh
    from feather_minisa import get_feather_full_matrix_top as _get_top
    top = _get_top(
        M_padded, K, N, AW, AH, int8, len(instructions), n_inner, k_passes,
    )
    s = df_fresh.customize(top)

    if schedule_fn is not None:
        schedule_fn(s, K, N, AH, AW)
    else:
        schedule_feather_hls(s, K, N, AH, AW)

    hls_mod = s.build(target="vitis_hls", mode="csyn", project=project_dir)

    # Optimize auto-generated load/store functions (transparent to user)
    # Import the full optimization pass from the dev test runner
    sys.path.insert(0, os.path.join(_FEATHER_DIR, "tests"))
    from test_trace_input import _patch_load_bufs_for_throughput
    _patch_load_bufs_for_throughput(project_dir)

    print("Running Vitis HLS csynth (this takes ~2 minutes)...")

    # Suppress verbose HLS output, only show final report
    import io, contextlib
    hls_output = io.StringIO()
    with contextlib.redirect_stdout(hls_output), \
         contextlib.redirect_stderr(hls_output):
        hls_mod()

    print("Synthesis complete!")
    print_synthesis_report(project_dir)


def print_synthesis_report(project_dir):
    """Parse and display HLS synthesis results."""
    try:
        import xmltodict
    except ImportError:
        _print_report_from_text(project_dir)
        return

    xml_path = os.path.join(
        project_dir, "out.prj", "solution1", "syn", "report",
        "full_matrix_top_csynth.xml",
    )
    if not os.path.isfile(xml_path):
        print("  Synthesis report not found.")
        return

    with open(xml_path) as f:
        report = xmltodict.parse(f.read())

    perf = report["profile"]["PerformanceEstimates"]
    summary = perf["SummaryOfOverallLatency"]
    res = report["profile"]["AreaEstimates"]["Resources"]

    print()
    print("  ┌─────────────────────────────────────────┐")
    print("  │          Synthesis Results               │")
    print("  ├─────────────────────────────────────────┤")
    print(f"  │  Best-case latency:  {summary['Best-caseLatency']:>8s} cycles   │")
    print(f"  │  Worst-case latency: {summary['Worst-caseLatency']:>8s} cycles   │")

    # Dataflow initiation interval
    df_ii = summary.get('Interval-min', summary.get('Best-caseRealTimeLatency'))
    if df_ii and df_ii != summary['Best-caseLatency']:
        print(f"  │  Dataflow II:        {df_ii:>8s} cycles   │")

    # Try to get estimated Fmax from the text report
    rpt_path = os.path.join(
        project_dir, "out.prj", "solution1", "syn", "report",
        "full_matrix_top_csynth.rpt",
    )
    if os.path.isfile(rpt_path):
        with open(rpt_path) as f:
            rpt_text = f.read()
        import re as _re
        fmax_match = _re.search(r'Estimated Fmax:\s+([\d.]+)\s+MHz', rpt_text)
        if fmax_match:
            print(f"  │  Estimated Fmax:     {fmax_match.group(1):>5s} MHz      │")

    print("  ├─────────────────────────────────────────┤")
    print("  │          Resource Utilization            │")
    print("  ├─────────────────────────────────────────┤")
    print(f"  │  DSP:      {res['DSP']:>8s}                    │")
    print(f"  │  LUT:      {res['LUT']:>8s}                    │")
    print(f"  │  FF:       {res['FF']:>8s}                    │")
    print(f"  │  BRAM_18K: {res['BRAM_18K']:>8s}                    │")
    print(f"  │  URAM:     {res['URAM']:>8s}                    │")
    print("  └─────────────────────────────────────────┘")


def _print_report_from_text(project_dir):
    """Fallback: grep latency from text report."""
    rpt_path = os.path.join(
        project_dir, "out.prj", "solution1", "syn", "report",
        "full_matrix_top_csynth.rpt",
    )
    if not os.path.isfile(rpt_path):
        print("  Synthesis report not found.")
        return
    with open(rpt_path) as f:
        lines = f.readlines()
    in_summary = False
    for line in lines:
        if "Summary:" in line:
            in_summary = True
        if in_summary:
            print("  " + line.rstrip())
            if line.strip().startswith("+--"):
                if in_summary and "|" not in line:
                    in_summary = False
