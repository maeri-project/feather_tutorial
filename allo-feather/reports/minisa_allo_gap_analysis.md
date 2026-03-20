# MINISA Allo Implementation: Status and Gap Analysis

**Date**: 2026-03-13
**Scope**: Comparison of Allo FEATHER+ implementation against the MINISA paper,
FEATHER paper (ISCA '24), and RTL reference (`FEATHER_GEMM/RTL/feather_plus/`).

---

## 1. What Is Implemented

### 1.1 MINISA ISA (Complete)

All four MINISA instructions are defined, encoded, and decoded on-chip:

| Instruction | File | Status |
|-------------|------|--------|
| SetIVNLayout | `minisa/isa.py` | Encoded, decoded; all 6 orders tested |
| SetWVNLayout | `minisa/isa.py` | Encoded, decoded; all 6 orders tested |
| SetOVNLayout | `minisa/isa.py` | Encoded, decoded; all 6 orders tested |
| SetMapping | `minisa/isa.py` | Encoded with r0, c0, Gr, Gc, sr, sc, tile bounds |

Instruction encoding: 13-field int32 rows, passed as a flat array to the dataflow region.
On-chip decode extracts Gr, k_start, k_end, m_start, n_start per tile.

### 1.2 FEATHER+ Dataflow Architecture (7 Kernels)

The unified kernel in `feather_minisa.py` implements:

| Kernel | RTL Counterpart | Status |
|--------|----------------|--------|
| `crossbar_load` | Distribution crossbars + buffer read | Algebraic index computation via Gr-based bit ops |
| `nest_compute` | NEST PE array (AH×AW MACs) | int8 multiply, int32 accumulate across K-passes |
| `bus` | Column output bus | Unpacks packed NEST output to BIRRD streams |
| `inst_rw` | BIRRD command interface | Distributes per-tile BIRRD switch instructions |
| `BIRRD` | `birrd_plus_cmd_flow_seq.v` | Full butterfly topology with 4 EGG switch operations |
| `output_accum` | Output buffer + accumulation | Column remap via BIRRD simulation + tile accumulation |

### 1.3 Key Features Working

- **Flexible Gr via bit operations**: `ic_j % Gr` → `ic_j & (Gr-1)`, `ic_j // Gr` → `ic_j >> log2_Gr`.
  Compiles to AND gates and shift muxes in HLS (zero pipeline penalty).
- **Mixed Kt_per_pass** (TICKET-002): Per-tile `actual_passes` computed at runtime via shifts.
  `max_k_passes` is the compile-time loop bound; padding passes stream zeros.
- **All 6 IVN/WVN/OVN layout orders** (TICKET-003): Verified that IVN/WVN orders are transparent
  in direct-indexing model. OVN order affects BIRRD routing (correctly implemented).
- **BIRRD tables for AW=4, 8, 16**: All 6 OVN orders × 3 array widths have precomputed
  BIRRD instruction tables with verified 2-way reduction + output column maps.
- **K-streaming**: Single invocation handles all K-passes per tile. Crossbar streams
  1 iActs packet + AH weight packets per K-pass. NEST accumulates across passes.
- **HLS synthesis and RTL cosim**: Verified at AW=4 with Vitis HLS 2023.2.
  RTL cosim: 1001 cycles (Allo) vs 1120 cycles (Verilog RTL) = 10% faster.

### 1.4 Test Coverage

| Test File | Tests | What It Covers |
|-----------|-------|---------------|
| `test_figure7_mapping.py` | ISA encoding + functional GEMM | Figure 7 workload (16×12 × 12×8) |
| `test_full_matrix_gemm.py` | 13 tests | Multi-tile GEMM, all OVN orders, IVN/WVN orders, mixed layouts |
| `test_crossbar_flexibility.py` | 9 tests | Gr=AW, Gr=AW//2, mixed Gr, mixed Kt_per_pass, IVN/WVN on AW=4 |
| `test_parameterized_gemm.py` | Any AW/AH | Parameterized GEMM with optional HLS csim/csynth |
| `test_figure7_hls.py` | HLS csim + csynth | Vitis HLS verification |
| `test_figure7_cosim.py` | RTL cosim | Cycle-accurate comparison against RTL |

---

## 2. Functional Gaps

### 2.1 Post-Quantization Module — NOT IMPLEMENTED

**What the RTL has**: `quant_post.v` is a purely combinational module that rescales 32-bit
accumulation results to 8-bit for the next layer:

```
result[ch] = (sign_extend_64(data[ch]) * scale + zero_extend_64(zp))[7:0]
```

The auto-quantization pipeline in `feather_plus_top.v` chains: OB write (cycle N) →
auto OB read (cycle N+1) → quant + PONG write (cycle N+2). This runs at 1 row/cycle,
fully pipelined.

**Impact**: Without quantization, the Allo model cannot chain layers for end-to-end inference.
Real DNN workloads require int8 output for the next layer's input. The RTL testbenches
(`tb_feather_stress`, `tb_feather_scale`) verify quantization correctness for every test case.

**Effort**: Low-medium. Add an 8th kernel `quant_post` after `output_accum` that applies
`(accum * scale + zp)[7:0]` per element. The scale and zero-point can be passed as
additional scalar arguments or encoded in the instruction stream.

### 2.2 Zero Point Subtraction in NEST — NOT IMPLEMENTED

**What the RTL has**: Each PE (`feather_pe.v`) stores `iacts_zp` and `weights_zp` in
local registers and computes:

```verilog
w_iacts_sub_zp   = {1'b0, iacts}   - {1'b0, r_i_iacts_zp};
w_weights_sub_zp = {1'b0, weights}  - {1'b0, r_i_weights_zp};
w_product        = r_iacts_sub_zp * r_weights_sub_zp;
```

This is standard asymmetric quantization: `(x - zp_x) * (w - zp_w)` gives the correct
dequantized product for int8 inference.

**What Allo does**: Plain multiplication — `iActs[nk, nj] * weights[ni, nj, nk]`.
Zero points are not supported.

**Impact**: Incorrect results for any quantized model with non-zero zero points
(which is virtually all real models — only symmetric quantization has zp=0).

**Effort**: Low. Add `iacts_zp` and `weights_zp` as module-level constants or instruction
fields. Change the NEST inner loop to `(iActs[nk,nj] - iacts_zp) * (weights[ni,nj,nk] - weights_zp)`.
The subtraction widens to int9 × int9 → int18 → int32 accumulation (same as RTL).

### 2.3 Gc/sr/sc Crossbar Support — NOT IMPLEMENTED

**What the paper defines**: The full MINISA parametric mapping (Eq. 1-3 in the paper):

```
r(ah, aw) = r0 + floor(aw / Gr)
c(ah, aw) = c0 + sr * ah + sc * (aw mod Gc)
```

This supports all dataflow families:

| Dataflow | Gr | Gc | sr | sc | Description |
|----------|----|----|----|-----|-------------|
| Output stationary | AW | 1 | 0 | 0 | All PEs share same WVN row |
| Weight stationary | 1 | AW | 0 | 1 | Each PE gets unique column |
| Input stationary | 1 | 1 | 1 | 0 | Each PE gets unique row via temporal stride |
| FEATHER+ default | AW//2 | 1 | 1 | 0 | 2-way reduction groups |

**What Allo does**: The crossbar_load hard-codes one indexing pattern:

```python
# Input crossbar
m_idx = m_start + (ic_j & mask_Gr)           # Only uses Gr
k_idx = k_start + ic_i + (ic_j >> log2_Gr) * AH  # Fixed temporal pattern

# Weight crossbar
wk_idx = k_start + wc_k + (wc_w >> log2_Gr) * AH  # Same fixed pattern
wn_idx = n_start + wc_i                     # No sc term
```

`Gc`, `sr`, and `sc` are encoded in instructions but **not used** in the crossbar index
computation. Only Gr-based output-stationary-like mappings produce correct results.

**Impact**: Cannot express weight-stationary, input-stationary, or other dataflow families.
The MINISA paper's key contribution is enabling *arbitrary* dataflow switching — this gap
limits FEATHER+ to a single dataflow family.

**Effort**: Medium. The crossbar indexing needs to be generalized to use all six mapping
parameters. The challenge is keeping it HLS-friendly (no runtime dividers). Since Gc is
also power-of-2, `aw mod Gc` → `aw & (Gc-1)` works. The full formula becomes:

```python
# r(ah, aw) indexes into the K dimension
r = r0 + (aw >> log2_Gr)
# c(ah, aw) indexes into the N dimension
c = c0 + sr * ah + sc * (aw & mask_Gc)
```

### 2.4 Arbitrary Gr with Multi-Way BIRRD Reduction — PARTIAL

**What the paper defines**: Gr can be any power of 2 from 1 to AW. When Gr < AW,
AW/Gr partial sums per M-position are spatially distributed across PE columns and
must be reduced by BIRRD. For Gr=AW//2 this is 2-way reduction (one AL/AR stage).
For Gr=AW//4 this is 4-way reduction (two reduction stages). For Gr=1 (weight
stationary) this is AW-way reduction (full BIRRD tree).

**What Allo does**: BIRRD tables exist only for 2-way reduction (Gr=AW//2) and
pass-through (Gr=AW). The `compute_col_to_m_map` function handles the output
mapping but the BIRRD instruction generation for >2-way reduction is missing.

**Impact**: Cannot use Gr < AW//2. This blocks weight-stationary (Gr=1) and
intermediate reduction groupings. Even with Gc/sr/sc crossbar support (gap 2.3),
the results would be incorrect because BIRRD can't reduce >2 partial sums.

**Effort**: Medium-high. Requires a general BIRRD instruction generator that:
1. Routes AW/Gr partial sums for each of the Gr M-positions to designated
   output ports
2. Inserts AL/AR operations at the right stages to perform tree reduction
3. Handles the butterfly network topology (reverse-bits routing)

The existing `_simulate_birrd_output_col_map` infrastructure can verify correctness,
but generating optimal BIRRD programs for arbitrary reduction ratios is non-trivial.
The FEATHER paper describes using a multicasting routing algorithm ([4]) for this.

### 2.5 Convolution — NOT IMPLEMENTED

**What the papers describe**: Both papers treat convolution as a first-class workload.
The FEATHER paper (ISCA '24) demonstrates convolution dataflows with 7 dimensions
(N, C, H, W, K, R, S) and evaluates ResNet-50, MobileNet-V3 end-to-end on ZCU104 FPGA.
MINISA supports convolution by treating it as a generalized GEMM with appropriate
tiling and layout configuration.

**What Allo does**: Only GEMM (C = A × B). No im2col or direct convolution support.

**Impact**: Cannot run CNN workloads. The papers' primary evaluation target is CNNs.

**Effort**: Medium. Convolution can be lowered to GEMM via im2col (explicit or implicit).
The MINISA instructions already support the necessary tiling — the gap is in the
program generation (`create_gemm_program` → `create_conv_program`) and test infrastructure.

### 2.6 Multi-Layer Execution and RIR — NOT IMPLEMENTED

**What the papers describe**: MINISA supports multi-layer traces where the output VN
layout of layer i defines the input layout for layer i+1. BIRRD performs Reorder-In-
Reduction (RIR): during spatial reduction, oActs are written to the stationary buffer
in a layout concordant with the next layer's dataflow. This eliminates explicit
reordering latency from the critical path.

The execution model: `SetI/W/OVNLayout → {SetMapping}^T` per layer. For consecutive
layers, SetIVNLayout is issued once; subsequent layers reuse the output layout.

**What Allo does**: Single-layer execution. Each `__call__` produces raw int32 output
in a flat numpy array. No support for chaining layers or writing results back to
on-chip buffers in a specific layout.

**Impact**: Cannot demonstrate FEATHER's key advantage of zero-cost dataflow-layout
co-switching across layers.

**Effort**: High. Requires:
1. Post-quantization (gap 2.1) to produce int8 outputs
2. Output buffer modeling with layout-aware write addressing
3. Multi-invocation orchestration with shared on-chip state

---

## 3. Structural Differences (Not Bugs)

These are modeling differences between the Allo dataflow abstraction and the RTL
implementation. They don't affect functional correctness but represent different
abstraction levels.

| Feature | RTL | Allo | Notes |
|---------|-----|------|-------|
| Ping-pong buffering | Double-buffered SRAM | Streaming model | Allo overlaps via FIFO depth |
| Crossbar routing | 2-cycle mux pipeline with tags | Algebraic index computation | Same result, different mechanism |
| PE cascade | 1-cycle registered forwarding per row | Flat loop | Staggered timing not modeled |
| Output bus autopick | Priority mux (1 valid/cycle) | Direct array indexing | No contention modeled |
| BIRRD pipeline | 4-stage registered pipeline | Combinational per-stage | Functionally identical |
| OB read-modify-write | Multi-bank SRAM with adders | Flat accumulation array | Same semantics |
| OB port conflicts | Controller masks offending PEs | Not modeled | ~6.67% utilization loss at 8×8 |

---

## 4. Priority Assessment

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| **Zero point subtraction** | Correctness for quantized models | Low | **P0** |
| **Post-quantization** | Layer chaining, end-to-end inference | Low-Med | **P0** |
| **Gc/sr/sc crossbar** | Dataflow flexibility (paper's key claim) | Medium | **P1** |
| **Multi-way BIRRD** | Weight-stationary and other dataflows | Med-High | **P1** |
| **Convolution** | CNN workload support | Medium | **P2** |
| **Multi-layer / RIR** | End-to-end demo | High | **P3** |

P0 = needed for correct quantized inference on a single layer
P1 = needed to demonstrate MINISA's dataflow flexibility
P2 = needed for CNN workloads
P3 = needed for full end-to-end multi-layer demonstration

---

## 5. Performance Comparison

| Metric | RTL Reference | Allo HLS | Notes |
|--------|--------------|----------|-------|
| Figure 7 cycles | 1120 (Icarus Verilog) | 1001 (RTL cosim) | Allo is 10% faster |
| HLS csynth estimate | — | 764 cycles | Optimistic (no memory stalls) |
| Array sizes tested | 4×4 | 4×4, 8×8, 16×16 | Allo scales to larger arrays |
| Workloads | GEMM only (testbenches) | GEMM only | Both lack convolution tests |
