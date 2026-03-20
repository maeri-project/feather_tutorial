# FEATHER+ MINISA (Allo)

## Environment Setup

All commands require two environment activations:

```bash
source /home/nz264/.local/bin/allo-env.sh          # conda py312 + LLVM
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh  # Vitis HLS (for csim/csynth/cosim)
```

The first sets up Python 3.12, LLVM, and LD_LIBRARY_PATH.
The second adds `vitis_hls` to PATH (required for HLS tests).

## Running Tests

Two trace files, two test scripts.

```bash
# ISA unit tests — PE mapping, tile coverage, functional GEMM (fast, no HLS)
python tests/test_figure7_mapping.py

# Unified trace-based test runner — supports all test modes:
#   functional correctness (default), csim, csyn, cosim, deploy

# Figure 7: C[16,8] = A[16,12] x B[12,8] on 4x4 array (mixed Gr, fast)
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json             # functional
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csim  # HLS csim
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn  # HLS csynth
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls cosim # RTL cosim
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --deploy    # U280 FPGA

# Full workload: C[24,512] = A[24,48] x B[48,512] on 16x16 array
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json             # functional
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --hls csim  # HLS csim
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --hls csyn  # HLS csynth
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --hls cosim # RTL cosim
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --deploy    # U280 FPGA
```

### Regression (fast — 4x4 only)

```bash
python tests/test_figure7_mapping.py
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn
```

## Project Structure

- `feather_minisa.py` — Unified FEATHER+ dataflow kernel with spatial PE array
  - `get_feather_full_matrix_top()` — 5-kernel architecture: dram_loader(1) → pe_array[AH+1,AW] → BIRRD[P0,P1] → output_accum, plus inst_rw
  - `FeatherModule` — wrapper with per-tile BIRRD configuration
  - `schedule_feather_hls()` — HLS scheduling (minimal — parallelism is structural)
  - `build_feather_simulator()` / `build_feather_hls()` — build helpers
- `minisa/isa.py` — MINISA ISA definitions and program generation
- `minisa/lowering.py` — BIRRD lowering and output column mapping
- `minisa/trace_parser.py` — RTL trace parser (`load_trace()` entry point)
- `instr_trace/` — RTL instruction trace JSON files
  - `figure7_16x12x8_4x4.json` — 4x4 array, mixed Gr (adaptive mapping)
  - `trace_m24k48n512_16x16.json` — 16x16 array, full workload
- `tests/test_figure7_mapping.py` — ISA unit tests (PE mapping, tile coverage, functional GEMM)
- `tests/test_trace_input.py` — Unified test runner (functional/csim/csyn/cosim/deploy)

## Key Design Decisions

- `dram_loader` (mapping=[1]) is the sole reader of A_pe, B_pe, inst_pe, loader_m_start,
  loader_n_start. Column-streaming: sends to AW column heads only (col_a_in[AW],
  col_w_in[AW]), not to every PE. Uses meta_for(AW) only (not AW×AH), reducing
  compile instructions 16× for 16×16 arrays. A and B passed as int32 (int8 causes
  LLVM crashes in spatial kernels); `FeatherModule.__call__()` converts via `.astype(np.int32)`.
- `pe_array` (mapping=[AH+1, AW]) is stream-only (no DRAM args). Rows 0..AH-1 = AH*AW
  compute PEs with column-streaming (W broadcast). Row AH = AW gather instances.
  Uses nested `meta_if` on `get_pid()` for row specialization.
- Column-streaming: Row 0 reads from col_a_in/col_w_in. Rows 1+ read from
  pe_a_down/pe_w_down (inter-PE streams). W broadcast: each PE reads all AH W values,
  selects its own (index ni), forwards all to PE below.
- 5 dataflow kernels: dram_loader(1) → pe_array[AH+1,AW] → BIRRD[P0,P1] → output_accum,
  plus inst_rw. Each DRAM buffer has exactly one reader kernel (HLS single-reader compliance).
  13 DRAM args total: A_pe, B_pe, inst_pe, loader_m_start, loader_n_start (dram_loader);
  birrd_inst (inst_rw); output_col_map, output_num_m, output_n_base, accum_m_start,
  accum_n_start, accum_params, C (output_accum).
- Single unified kernel handles all Gr values via power-of-2 bit operations:
  `ic_j % Gr` → `ic_j & (Gr-1)`, `ic_j // Gr` → `ic_j >> log2_Gr`.
  Compiles to AND gates and shift muxes (zero pipeline penalty, no integer dividers).
- Per-tile BIRRD configuration: Gr=AW → all-PS pass-through with AW outputs;
  Gr=AW//2 → hand-coded 2-way reduction (order-dependent);
  Gr<AW//2 → algorithmically generated multi-way reduction via greedy forward pass.
- Each tile processes exactly one K-slice (k_start to k_end). The ISA decomposes K
  at the tile level. Kt = (AW/Gr)*AH elements per tile. K > Kt is handled by multiple tiles.
- Temporal N-iteration and M-batching (n_inner > 1): matches RTL's VN temporal iteration
  where each ExecuteMapping covers all M-batches and N-sub-tiles internally. Instead of
  creating n_spatial * n_m_batches * n_sub_tiles separate ISA tiles, these are folded into
  n_inner sub-operations per tile. Only K-decomposition creates separate tiles.
- RTL trace parser: `load_trace()` parses RTL-format JSON with ExecuteMapping entries.
  Supports both uniform-Gr (all EMs same params, n_inner > 1 folded) and mixed-Gr
  (adaptive Gr per EM, each tile independent with n_inner=1).
- LLVM JIT compilation scales with PE count: 4×4 (16 PEs) compiles in ~8s, 8×8 (64 PEs)
  with multi-tile loops takes 15+ min.
- For cosim, use `mode="csyn"` to generate kernel.cpp, then patch m_axi depths
  and write C testbench (handled by test_trace_input.py --hls cosim).
