# FEATHER+ Allo Implementation

**Branch:** minisa | **Date:** 2026-03-05

---

## 1. Implementation Overview

The Allo implementation maps the FEATHER+ accelerator pipeline to 7 HLS dataflow kernels connected by FIFO streams. A single Allo invocation handles complete input matrices and the full MINISA instruction list, performing tiling, instruction decode, crossbar reordering, NEST computation, BIRRD reduction, and output accumulation on-chip.

### Dataflow Pipeline

```
crossbar_load ──(iacts_stream)──> nest_compute ──(nest_out)──> bus
                ──(weights_stream)──>                            |
                                                          connection[P0+1, P1*2]
                                                                |
                                                  inst_rw ──> BIRRD[P0, P1]
                                                                |
                                                          output_accum ──> C[M,N]
```

**Source:** `feather_minisa.py` — single file, ~450 lines.

### Kernel Descriptions

| # | Kernel | Role | I/O |
|---|--------|------|-----|
| 1 | `crossbar_load` | Decode per-tile instructions, apply input/weight crossbar index mapping with parametric Gr, pack data into UInt(128) streams | Reads A[M,K], B[K,N], instructions[num_inst,13] |
| 2 | `nest_compute` | Unpack streams, run AHxAW NEST MAC with int32 accumulation across K-passes, stream packed result | Reads iacts_stream, weights_stream; writes nest_out |
| 3 | `bus` | Unpack packed NEST output and distribute to BIRRD input connections | Reads nest_out; writes connection[0, :] |
| 4 | `inst_rw` | Distribute per-tile BIRRD switch instructions to each butterfly switch | Reads birrd_inst[num_tiles, P0, P1]; writes inst_input[P0, P1] |
| 5 | `BIRRD[P0,P1]` | Butterfly reduction/reorder network — P0 stages, P1 switches per stage | Reads connection[i,:], inst_input[i,j]; writes connection[i+1,:] |
| 6 | `output_accum` | Column remap via output_col_map + tile accumulation into output matrix C | Reads connection[P0,:]; writes C[M,N] |

### ISA Encoding

MINISA instructions are encoded as rows of an `int32[num_inst, 13]` array:

```
Row 0 (SetIVNLayout):  [0, order, ML0, ML1, JL0, JL1, 0, 0, 0, 0, 0, 0, 0]
Row 1 (SetWVNLayout):  [1, order, KL0, KL1, NL0, NL1, 0, 0, 0, 0, 0, 0, 0]
Row 2 (SetOVNLayout):  [2, order, PL0, PL1, QL0, QL1, 0, 0, 0, 0, 0, 0, 0]
Row 3+ (SetMapping):   [3, r0, c0, Gr, Gc, sr, sc, m_start, m_end, n_start, n_end, k_start, k_end]
```

The first 3 rows configure IVN/WVN/OVN layouts; each subsequent row triggers one tile execution.

### Wrapper: `FeatherKStreamingModule`

The Allo dataflow region takes 9 raw arrays. The `FeatherKStreamingModule` wrapper provides a clean `(A, B, instructions, C)` interface by:

1. Precomputing BIRRD instruction tables and column maps for all 6 OVN orders at build time
2. At call time, reading Gr per tile from instructions and selecting:
   - **Gr < AW**: Standard BIRRD reduction (Mt = AW//2 outputs per tile, uses precomputed BIRRD table + col_map)
   - **Gr = AW**: Pass-through BIRRD (all-PS switches, identity col_map, AW outputs per tile)
3. Computing `accum_m_start` and `accum_n_start` arrays from tile instructions

---

## 2. Key Optimizations

### 2.1 K-Streaming with Fused K-Passes

Instead of issuing separate tiles for each K-slice (the original MINISA mapping uses 24 tiles for Figure 7), all K-passes for a tile are fused into an inner loop within a single tile iteration. This reduces tile count from 24 to 8 for Figure 7.

**How it works:** Each tile covers the full K-range `[k_start, k_end)`. The kernel iterates `num_k_passes` times internally, accumulating NEST partial products in `int32` before streaming to BIRRD.

**Key parameter:** `Kt_per_pass = (AW / Gr) * AH` — the number of K elements each K-pass covers. For Gr=AW, this equals AH; for Gr=AW//2, this equals 2*AH.

### 2.2 Split Crossbar/NEST Kernels (WAR Dependency Break)

The original fused `crossbar_and_NEST` kernel wrote to `iActs`/`weights` arrays and then read from them within the same pipeline stage, creating a Write-After-Read dependency. HLS could not overlap K-passes, forcing pipeline II=14.

Splitting into `crossbar_load` and `nest_compute` as separate dataflow kernels connected by UInt(128) FIFO streams eliminates this dependency. Each kernel only writes OR reads its local arrays, never both. Result: **II=14 → II=4** (3.5x improvement).

**Stream depths for 2-tile buffering:**

| Stream | Type | Depth | Rationale |
|--------|------|-------|-----------|
| `iacts_stream` | UInt(128) | num_k_passes * 2 | 2 tiles of iActs buffering |
| `weights_stream` | UInt(128) | num_k_passes * AH * 2 | 2 tiles of weights buffering |
| `nest_out` | UInt(128) | AH * 2 | 2 tiles of NEST output buffering |

### 2.3 Flexible Crossbar via Power-of-2 Bit Operations

FEATHER+'s crossbar routes data based on the replication group size Gr. A naive implementation uses runtime `%` and `//` on Gr, which compiles to multi-cycle integer dividers (14 dividers, 72% of design FF).

Since Gr always divides AW and AW is a power of 2, Gr is always a power of 2. The implementation replaces:

```python
ic_j % Gr   →   ic_j & (Gr - 1)      # AND gate (1 LUT)
ic_j // Gr  →   ic_j >> log2_Gr       # barrel shifter / mux
```

`log2_Gr` is computed per-tile via a comparison chain (lines 154-162 of `feather_minisa.py`):
```python
log2_Gr: int32 = 0
if Gr >= 2:  log2_Gr = 1
if Gr >= 4:  log2_Gr = 2
if Gr >= 8:  log2_Gr = 3
if Gr >= 16: log2_Gr = 4
mask_Gr: int32 = Gr - 1
```

These compile to combinational logic: zero pipeline latency, no FF cost, no II degradation.

### 2.4 UInt(128) Stream Packing

Data between crossbar_load and nest_compute is packed into `UInt(AH * AW * Ty.bits)` = UInt(128) for int8 on a 4x4 array. This matches the VN data width and minimizes stream transaction count (1 iActs packet + AH weight packets per K-pass).

### 2.5 int32 Intermediate Accumulation

K-streaming accumulates partial products across multiple K-passes. With int8 inputs, products can reach `127 * 127 * AH * num_k_passes` which overflows int8/int16. All accumulation from NEST through BIRRD to output_accum uses `TyOut = int32`.

---

## 3. Test Cases

All tests are in `tests/`. Simulator tests require only the Allo environment; HLS tests additionally require Vitis HLS 2023.2.

### 3.1 test_figure7_mapping.py — ISA Mapping Correctness (8 tests)

Verifies the MINISA Figure 7 mapping (C[16,8] = A[16,12] x B[12,8] on 4x4 NEST) at the ISA level — no hardware execution.

| Test | What it verifies |
|------|-----------------|
| `test_figure7_tile1_pe_mapping` | Exact (r,c) WVN indices for all 16 PEs in tile 1 (Gr=2, 16 unique pairs) |
| `test_figure7_tile2_pe_mapping` | Exact (r,c) WVN indices for all 16 PEs in tile 2 (Gr=4, 8 unique pairs, 2x replication) |
| `test_figure7_mapping_adaptation` | Gr changes from 2→4 between tiles; r0 advances; Gc/sr/sc stay constant |
| `test_figure7_full_pe_utilization` | All 16 PEs produce useful work (within weight matrix bounds) in both tiles |
| `test_figure7_k_coverage_per_output_column` | Union of K ranges from both tiles covers [0,K) for every output column |
| `test_figure7_no_k_overlap_between_tiles` | Tile 1 covers WVN rows {0,1} (K=[0,8)), tile 2 covers {2} (K=[8,12)), disjoint |
| `test_figure7_functional_gemm` | End-to-end GEMM through full Allo dataflow hardware, output matches numpy |
| `test_figure7_tile2_replication_factor` | Each unique (r,c) in tile 2 is assigned to exactly 2 PEs (M-parallelism replication) |

```bash
source /home/nz264/.local/bin/allo-env.sh
cd /work/shared/users/phd/nz264/allo/examples/feather-isa
python tests/test_figure7_mapping.py
```

### 3.2 test_crossbar_flexibility.py — Multi-Gr Crossbar (4 tests)

Verifies that the parametric Gr crossbar (bit operations) produces correct GEMM for different dataflow configurations.

| Test | Gr | BIRRD mode | Workload | What it verifies |
|------|----|-----------|----------|-----------------|
| `test_gr_equals_aw` | 4 (=AW) | Pass-through | C[16,8] = A[16,12] x B[12,8] | Figure 7 regression — each PE column handles independent M row |
| `test_gr_half_aw` | 2 (=AW//2) | Reduction | C[8,4] = A[8,8] x B[8,4] | Paired columns handle different K-stripes, BIRRD reduces partial sums |
| `test_mixed_gr_tiles` | 2 and 4 | Mixed | C[8,4] = A[8,12] x B[12,4] | Gr=2 tiles for K=[0,8) + Gr=4 tiles for K=[8,12) in one program |
| `test_bit_ops_equivalence` | 1,2,AW//2,AW | N/A (unit) | All j in [0,AW) | Verifies `(j & (Gr-1)) == (j % Gr)` and `(j >> log2(Gr)) == (j // Gr)` for AW=4,8,16 |

```bash
source /home/nz264/.local/bin/allo-env.sh
cd /work/shared/users/phd/nz264/allo/examples/feather-isa
python tests/test_crossbar_flexibility.py
```

### 3.3 test_full_matrix_gemm.py — GEMM Regression (10 tests)

Verifies the full-matrix execution model on an AW=8 NEST across multiple GEMM sizes, instruction encoding correctness, OVN order variation, and tile advancement.

| Test | What it verifies |
|------|-----------------|
| `test_full_matrix_gemm_8x8x16` | GEMM C[8,8] = A[8,16] x B[16,8] on 8x8 array |
| `test_full_matrix_gemm_16x8x32` | GEMM C[16,8] = A[16,32] x B[32,8] — multiple M and K tiles |
| `test_full_matrix_gemm_16x16x32` | GEMM C[16,16] = A[16,32] x B[32,16] — multiple tiles in all dimensions |
| `test_full_matrix_instruction_encoding` | Encoded instruction array has correct shape, types, and field values |
| `test_full_matrix_single_invocation` | Single Allo invocation handles complete matrix (vs 16 invocations in old model) |
| `test_layout_instruction_decode_on_chip` | Layout order fields are correctly encoded and decoded for IVN/WVN/OVN |
| `test_pe_mapping_fields_encoded` | Output-stationary (Gr=4,Gc=1,sr=1,sc=0) and weight-stationary (Gr=1,Gc=8,sr=0,sc=1) encoded correctly |
| `test_ovn_order_produces_different_birrd` | All 6 OVN orders produce distinct BIRRD instruction tables for AW=4,8,16 |
| `test_ovn_order_all_correct` | All 6 OVN orders produce correct GEMM output (different BIRRD routing, same result) |
| `test_r0_c0_tile_advancement` | r0=k_start//AH, c0=n_start — matches MINISA paper equations (2)-(3) |

```bash
source /home/nz264/.local/bin/allo-env.sh
cd /work/shared/users/phd/nz264/allo/examples/feather-isa
python tests/test_full_matrix_gemm.py
```

### 3.4 test_figure7_hls.py — HLS Csim + Csynth (2 tests)

Requires Vitis HLS 2023.2.

| Test | What it verifies |
|------|-----------------|
| `test_figure7_hls_csim` | HLS C simulation produces output matching numpy reference |
| `test_figure7_hls_csynth` | Synthesis report: cycle count, resource usage, clock estimate, pipeline II |

```bash
source /home/nz264/.local/bin/allo-env.sh
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh
cd /work/shared/users/phd/nz264/allo/examples/feather-isa
python tests/test_figure7_hls.py
```

### 3.5 test_figure7_cosim.py — RTL Co-Simulation (1 test)

Requires Vitis HLS 2023.2. Runs for several minutes.

Generates a C testbench with Figure 7 data, patches `m_axi` depth specs into `kernel.cpp`, runs `csynth_design` + `cosim_design` via a TCL script, and extracts the cycle-accurate latency from the Verilog RTL simulation report.

```bash
source /home/nz264/.local/bin/allo-env.sh
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh
cd /work/shared/users/phd/nz264/allo/examples/feather-isa
python tests/test_figure7_cosim.py
```

---

## 4. Allo vs RTL: Feature Comparison

### What the Allo Implementation Supports

| Feature | Allo | RTL | Notes |
|---------|------|-----|-------|
| **NEST MAC (AHxAW)** | Yes (4x4 tested, 8x8 tested) | Yes | Fully unrolled, 48 DSPs for 4x4 |
| **BIRRD reduction network** | Yes (P0 stages, P1 switches) | Yes | Configurable per OVN order (6 orders) |
| **MINISA instruction decode** | Yes (on-chip decode from int32 array) | Yes | 4 instruction types: SetIVNLayout, SetWVNLayout, SetOVNLayout, SetMapping |
| **Per-tile dataflow switching (Gr)** | Gr=AW, Gr=AW//2 | All Gr values | Allo uses bit ops; RTL uses physical mux crossbar |
| **K-streaming** | Yes (fused K-passes per tile) | Yes | Reduces tile count, enables int32 accumulation |
| **Double-buffering** | Yes (HLS DATAFLOW PIPO) | Yes (ping-pong buffers) | Automatic in HLS via dataflow pragma |
| **Multi-tile programs** | Yes (loop over tiles in each kernel) | Yes | Up to num_tiles tiles per invocation |
| **Input/weight crossbar** | Index-arithmetic (bit ops) | Physical mux network | Functionally equivalent for power-of-2 Gr |
| **int8 input, int32 accumulation** | Yes | Yes | Prevents overflow across K-passes |

### Gaps (Allo does not yet support)

| Gap | Detail | Root Cause |
|-----|--------|------------|
| **Gr < AW//2** (e.g., Gr=1 weight stationary) | BIRRD only does pairwise reduction (column j + column j+Mt). Gr=1 needs AW-way reduction. | BIRRD butterfly network is hardwired for 2-way reduction. Supporting more requires multi-pass BIRRD or a different accumulation structure. |
| **IVN/WVN layout orders** | Crossbar always uses ORDER_012 for input/weight index arithmetic. Other IVN/WVN orders (ORDER_021 through ORDER_210) are encoded but not applied. | Only OVN order affects BIRRD routing. Applying IVN/WVN orders requires permuting the crossbar index expressions per order, which adds 6 cases to the inner loop. |
| **Mixed Kt_per_pass programs** | All tiles in one program must share the same `num_k_passes` and `Kt_per_pass`. | The K-pass loop bound is a compile-time constant in the HLS kernel. Mixed Kt_per_pass would require either runtime loop bounds (kills pipelining) or separate kernel invocations. |
| **Weight stationarity** | Gr=1 with Gc=AW: each PE column holds a different weight VN. Not functional yet. | Depends on Gr < AW//2 support (see above). |
| **Streaming buffer ping-pong** | Allo relies on HLS-inserted PIPO. RTL has explicit ping-pong buffer management. | Not a functional gap — HLS auto-inserts double-buffering for dataflow regions. |

---

## 5. Figure 7 Cycle Count Comparison

**Workload:** C[16,8] = A[16,12] x B[12,8] on 4x4 NEST (AH=AW=4)

### Results

| Implementation | Cosim Cycles | Csynth Estimate | vs RTL |
|----------------|-------------|-----------------|--------|
| **Allo (flexible Gr)** | **1004** | 770 | **0.90x** |
| RTL reference (Icarus Verilog) | 1120 | — | 1.00x |

**Allo is 10% faster than the handwritten RTL reference.**

### Per-Kernel Synthesis Breakdown

From Vitis HLS csynth report (`test_figure7_hls.py` output):

| Kernel | Cycles | Pipeline | Notes |
|--------|--------|----------|-------|
| crossbar_load | ~200 | II=8, trip=24 | Flattened tile+K-pass loop, 8 tiles x 3 K-passes |
| nest_compute | ~400 | K-pass II=4 | 50 cycles/tile, critical path |
| output_accum | ~400 | — | Init + accum + writeback |
| BIRRD[P0,P1] | ~100 | II=1 | Pass-through for Gr=AW, reduction for Gr<AW |
| bus | ~100 | II=1 | Unpacks int32 from UInt(128) |

### Resource Usage (Xilinx U280, Vitis HLS 2023.2)

| Resource | Used |
|----------|------|
| BRAM_18K | 20 |
| DSP | 49 |
| FF | 18,987 |
| LUT | 25,748 |

- 48 DSPs = 16 fully-unrolled MAC units in the 4x4 NEST array (+ 1 misc)
- 0 integer dividers (was 14 in the original implementation)
- Estimated clock: 2.792 ns

### Why Allo Beats RTL

1. **Aggressive HLS pipelining**: NEST MAC fully unrolled to 48 parallel DSPs, K-pass pipeline II=4
2. **Dataflow overlap via DATAFLOW pragma**: All 7 kernels + load/store execute concurrently with automatic PIPO double-buffering
3. **Stream-based decoupling**: FIFO streams between crossbar_load and nest_compute mask loading latency; crossbar_load runs ~2 tiles ahead

---

## 6. Reproducing Results

### Prerequisites

- Allo environment (Python 3.12 + LLVM + MLIR)
- Vitis HLS 2023.2 (for HLS tests)
- Server: zhang-21.ece.cornell.edu (or equivalent with Xilinx tools)

### Step-by-step

```bash
# 1. Activate environments
source /home/nz264/.local/bin/allo-env.sh
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh

# 2. Navigate to project
cd /work/shared/users/phd/nz264/allo/examples/feather-isa

# 3. Run simulator tests (no Vitis HLS required, ~30 seconds total)
python tests/test_figure7_mapping.py        # 8 tests — ISA mapping
python tests/test_crossbar_flexibility.py   # 4 tests — multi-Gr crossbar
python tests/test_full_matrix_gemm.py       # 10 tests — GEMM regression

# 4. Run HLS C simulation (requires Vitis HLS, ~2 minutes)
python tests/test_figure7_hls.py
#    Output includes:
#      - CSim: "Output matches numpy reference"
#      - CSynth: cycle count (770), resource table, clock estimate

# 5. Run RTL co-simulation (requires Vitis HLS, ~5-10 minutes)
python tests/test_figure7_cosim.py
#    Output includes:
#      - "RTL Co-Simulation Cycle Count: 1004"
#      - Cosim report and transaction report
```

### Interpreting Results

- **Simulator tests**: Print "PASSED" per test and a summary count. Any failure prints the assertion with expected/actual values.
- **HLS csim**: Builds the Allo design through Vitis HLS C simulation. "Output matches numpy reference" confirms functional correctness.
- **HLS csynth**: Prints synthesis report with cycle estimate, resource usage, and clock period. The csynth cycle count (770) is an estimate; cosim gives the accurate number.
- **RTL cosim**: Generates Verilog RTL, runs cycle-accurate simulation via Xilinx xsim, and reports exact cycle count. The cosim report table shows `Verilog|Pass|NNNN` where NNNN is the cycle count.

### Reproducing the RTL Reference (1120 cycles)

The RTL reference is a handwritten Verilog implementation of FEATHER+ located at `/work/shared/users/phd/nz264/FEATHER_GEMM/RTL/feather_plus/`. The testbench `tb_figure7.v` runs the same workload (C[16,8] = A[16,12] x B[12,8] on a 4x4 PE array) and measures cycle count from first computation to last BIRRD output.

**RTL source files** (all in `FEATHER_GEMM/RTL/feather_plus/`):

| File | Description |
|------|-------------|
| `feather_plus_top.v` | Top module: buffers, crossbars, NEST PE array, BIRRD+, output buffer, auto-quant |
| `crossbar.v` | Distribution crossbar (mux-tree, 2-cycle latency) |
| `birrd_plus_cmd_flow_seq.v` | BIRRD+ butterfly network (4 stages for AW=4) |
| `birrd_2x2_simple_cmd_flow_seq.v` | 2x2 EGG switch with command forwarding |
| `birrd_2x2_simple_seq.v` | 2x2 EGG switch (last stage, no forwarding) |
| `feather_pe.v` | Processing element with local weight buffer and MAC |
| `o_bus_autopick_seq.v` | Output bus auto-picker (selects valid PE row output) |
| `quant_post.v` | Post-quantization (combinational) |
| `sram_dp_1r1w.v` | Dual-port SRAM (1 read, 1 write) |
| `define.vh` | Global defines (buffer depths, opcodes) |
| `tb_figure7.v` | Figure 7 testbench with cycle measurement |

**Compile and run with Icarus Verilog:**

```bash
cd /work/shared/users/phd/nz264/FEATHER_GEMM/RTL/feather_plus

# Compile
iverilog -g2012 -I. -o tb_figure7.vvp \
    feather_plus_top.v crossbar.v \
    birrd_plus_cmd_flow_seq.v birrd_2x2_simple_cmd_flow_seq.v birrd_2x2_simple_seq.v \
    feather_pe.v o_bus_autopick_seq.v quant_post.v sram_dp_1r1w.v \
    tb_figure7.v

# Run
vvp tb_figure7.vvp
```

**Expected output** (last lines):

```
  Cycle measurement:
    Start cycle : 105
    End cycle   : 1224
TOTAL CYCLES: 1120

  GOLDEN MODEL COMPARISON: PASS (128 values verified)
```

**What the RTL testbench does:**

1. Pads K=12 to K_pad=16 (TILE_K = WEIGHTS_DEPTH * NEST_ROW_NUM = 16)
2. Loops: 2 N-tiles (cols 0-3, 4-7) x 1 K-tile x 4 M-batches (4 rows each)
3. Per batch: writes weights to streaming buffer, loads into PEs, writes iacts to stationary buffer, streams through NEST + BIRRD+
4. Timing: starts on first `pe_iacts_valid` assertion, ends on last BIRRD output capture
5. Verifies all 128 output values against golden model (C = A x B, deterministic data)

**Key differences from the Allo implementation:**

| Aspect | RTL | Allo HLS |
|--------|-----|----------|
| Crossbar | Physical 2-cycle mux network | Index arithmetic with bit ops |
| PE weight loading | Explicit multi-cycle SRAM→PE transfer | Implicit in crossbar_load kernel |
| Double-buffering | Explicit ping-pong buffer management | HLS-inserted PIPO (automatic) |
| K-pass overlap | Sequential (no K-streaming) | K-passes fused within tile, pipelined at II=4 |
| BIRRD+ stages | 4 (hardware pipeline, 1 cycle/stage) | 3 (Allo BIRRD uses `2*LOG2_AW-1` for AW=4) |
| Cycle count | 1120 | 1004 |

---

## 7. File Map

| File | Description |
|------|-------------|
| `feather_minisa.py` | All 7 dataflow kernels + FeatherKStreamingModule wrapper + build helpers (~450 lines) |
| `minisa/isa.py` | MINISA ISA definitions (SetIVNLayout, SetWVNLayout, SetOVNLayout, SetMapping), program creation, encoding |
| `minisa/lowering.py` | BIRRD instruction tables for (AW, order) combinations, output column map computation |
| `tests/test_figure7_mapping.py` | ISA-level mapping verification (8 tests) |
| `tests/test_crossbar_flexibility.py` | Multi-Gr crossbar correctness (4 tests) |
| `tests/test_full_matrix_gemm.py` | Full-matrix GEMM regression on AW=8 (10 tests) |
| `tests/test_figure7_hls.py` | HLS C simulation + synthesis (2 tests) |
| `tests/test_figure7_cosim.py` | RTL co-simulation for cycle-accurate measurement |
| `CLAUDE.md` | Environment setup and project conventions |
