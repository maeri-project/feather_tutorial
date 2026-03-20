# FEATHER+ MINISA Allo Implementation

This directory contains the [Allo](https://github.com/cornell-zhang/allo) dataflow implementation of the FEATHER+ accelerator, programmed via the MINISA (Minimal ISA) interface. MINISA provides a Virtual Neuron (VN)-level programming model that abstracts away low-level PE array details while enabling efficient dataflow configuration.

## Setup

Requires the Allo conda environment with LLVM/MLIR. Inside the JupyterHub container:

```bash
# Allo environment is pre-configured in the "Python (Allo)" Jupyter kernel
# For command-line use:
export LLVM_BUILD_DIR=/work/shared/common/llvm-project-main/build
export PATH="$LLVM_BUILD_DIR/bin:/opt/conda-envs/allo/bin:$PATH"
```

For HLS targets (csim/csynth/cosim), also source Vitis HLS:

```bash
source /opt/xilinx/Xilinx_Vivado_Vitis_2022.1/Vitis_HLS/2022.1/settings64.sh
```

## Architecture

The implementation uses a 7-kernel pipelined Allo dataflow architecture:

```
a_loader ──→ pe_array[AH+1, AW] ──→ BIRRD[P0, P1] ──→ output_accum
w_loader ──↗                          ↑
                                   inst_rw
```

1. **a_loader**: Reads input activations from DRAM, column-streams to AW column heads
2. **w_loader**: Reads weights from DRAM, decodes instructions, streams to w_broadcast
3. **w_broadcast[AW]**: Distributes weights to per-row PE FIFOs
4. **pe_array[AH+1, AW]**: Compute PEs (rows 0..AH-1) with column-streaming + gather row (AH)
5. **inst_rw**: Distributes BIRRD switch instructions
6. **BIRRD[P0, P1]**: Butterfly reduction/reorder network (per-tile configuration)
7. **output_accum**: Column remap + tile accumulation into output matrix

## MINISA Instruction Set

MINISA has 4 instruction types:

| Instruction | Purpose |
|-------------|---------|
| `SetIVNLayout` | Configure input VN buffer layout (how input activations map to PE array) |
| `SetWVNLayout` | Configure weight VN buffer layout (how weights are tiled and held stationary) |
| `SetOVNLayout` | Configure output VN buffer layout (BIRRD reduction/reordering) |
| `SetMapping` | Specify VN-to-PE mapping and trigger tile execution |

The `SetMapping` instruction supports all dataflow strategies via the `Gr` parameter:

| Dataflow | Gr | Description |
|----------|----|-------------|
| Output stationary | AW | All PE columns share one WVN group |
| Weight stationary | 1 | Each PE column has its own WVN |
| Mixed/adaptive | 1 < Gr < AW | Adapts per tile for irregular dimensions |

## Running Tests

```bash
# ISA unit tests — PE mapping, tile coverage, functional GEMM (fast, no HLS)
python tests/test_figure7_mapping.py

# Trace-based test runner — supports multiple modes:
#   functional (default), csim, csyn, cosim, deploy

# Figure 7: C[16,8] = A[16,12] x B[12,8] on 4x4 array (mixed Gr)
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csim
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls cosim

# Full workload: C[24,512] = A[24,48] x B[48,512] on 16x16 array
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json
```

## File Organization

```
allo-feather/
├── feather_minisa.py              # Allo dataflow implementation (7-kernel architecture)
├── minisa/
│   ├── __init__.py                # Module exports
│   ├── isa.py                     # ISA definitions (4 instruction types + encoding)
│   ├── lowering.py                # MINISA → Allo config (BIRRD arrays, column maps)
│   └── trace_parser.py            # RTL trace JSON parser (load_trace entry point)
├── instr_trace/                   # RTL instruction trace files
│   ├── figure7_16x12x8_4x4.json  # 4x4 array, mixed Gr (adaptive mapping)
│   └── trace_m24k48n512_16x16.json # 16x16 array, full workload
├── tests/
│   ├── test_figure7_mapping.py    # ISA unit tests (PE mapping, tile coverage)
│   └── test_trace_input.py        # Unified test runner (functional/csim/csyn/cosim/deploy)
├── hls_project/                   # Vitis HLS project files (Makefiles, host/kernel code)
├── tutorial/
│   ├── allo-feather.ipynb         # Tutorial notebook
│   └── _support.py                # Tutorial support utilities
├── design/                        # Design documents
├── reports/                       # Verification and analysis reports
├── tickets/                       # Development tickets
├── feather.pdf                    # FEATHER paper
└── MINISA.pdf                     # MINISA paper
```

## Key Design Details

- **Unified kernel**: A single kernel handles all Gr values via power-of-2 bit operations (`ic_j & (Gr-1)` instead of modulo), compiling to AND gates and shift muxes with zero pipeline penalty.
- **Per-tile BIRRD**: BIRRD configuration changes per tile. `Gr=AW` uses all-PS pass-through; `Gr<AW` uses algorithmically generated multi-way reduction.
- **Temporal N-iteration**: When `n_inner > 1`, each ISA tile contains multiple sub-operations sharing the same K-range and BIRRD config but different (m, n) offsets, matching RTL's VN temporal iteration.
- **Column streaming**: Row 0 reads from column inputs; rows 1+ read from inter-PE streams. Weight broadcast forwards all AH values per PE, selecting its own index.
- **Trace-driven**: Programs are defined via RTL instruction trace JSON files, parsed by `minisa/trace_parser.py`. Supports both uniform-Gr and mixed-Gr (adaptive) mappings.

## In-Container Test Results

Tested inside the JupyterHub Docker container (`raic-jupyterhub`) with the following environment setup:

```bash
# 1. Run allo setup (one-time, after container rebuild)
docker exec -it raic-jupyterhub bash /srv/jupyterhub/setup_allo.sh

# 2. Inside the container, set environment
export LLVM_BUILD_DIR=/work/shared/common/llvm-project-main/build
export PATH="$LLVM_BUILD_DIR/bin:/opt/conda-envs/allo/bin:/usr/local/bin:/usr/bin:/bin"

# 3. For HLS tests, also source Vitis HLS
source /opt/xilinx/Xilinx_Vivado_Vitis_2022.1/Vitis_HLS/2022.1/settings64.sh

# 4. Run from the allo-feather directory
cd /opt/feather_tutorial/allo-feather
```

### Figure 7 test case: C[16,8] = A[16,12] x B[12,8] on 4x4 array

| Test | Command | Result |
|------|---------|--------|
| Functional | `python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json` | PASS |
| HLS C-sim | `python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csim` | PASS |
| HLS C-synth | `python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn` | PASS |

### C-Synthesis Report (4x4 array, Vitis HLS 2022.1)

| Metric | Value |
|--------|-------|
| Best-case latency | 235 cycles |
| Worst-case latency | 237 cycles |
| Estimated Fmax | 411.37 MHz |
| DSP | 184 |
| FF | 85,011 |
| LUT | 107,738 |
| BRAM_18K | 0 |
| URAM | 0 |
