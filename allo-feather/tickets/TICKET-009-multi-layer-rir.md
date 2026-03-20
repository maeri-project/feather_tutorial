---
id: TICKET-009
title: Multi-layer execution with RIR (Reorder-In-Reduction)
status: resolved (Phase 1)
priority: P3
---

# TICKET-009: Multi-Layer Execution with RIR

## Problem

The Allo FEATHER+ implementation handles one layer at a time. Each call produces
raw int32 (or int8 after TICKET-006) output in a flat numpy array. There is no
support for chaining layers or writing results back to on-chip buffers in a
layout concordant with the next layer's dataflow.

## Why It Matters

- FEATHER's key innovation is zero-cost dataflow-layout co-switching across layers
- RIR (Reorder-In-Reduction) hides reordering latency behind BIRRD reduction,
  eliminating the explicit reorder step from the critical path
- Without multi-layer support, the Allo model cannot demonstrate end-to-end
  inference or FEATHER's advantage over fixed-dataflow accelerators
- The MINISA paper shows up to 99.4× speedup from eliminating instruction-fetch
  stalls, but the multi-layer amortization of layout instructions is a key part

## Paper Description

### MINISA Execution Model (Section IV.E)

Single-layer trace:
```
SetI/W/OVNLayout → {SetMapping}^T
```

Multi-layer trace with output reuse:
```
Layer 1: SetIVNLayout, SetWVNLayout, SetOVNLayout → {SetMapping}^T₁
Layer 2: SetWVNLayout, SetOVNLayout → {SetMapping}^T₂
  (SetIVNLayout reused — layer 1's output layout = layer 2's input layout)
```

### RIR (FEATHER Paper, Section III.B.2)

During spatial reduction in BIRRD, oActs are simultaneously reduced and reordered.
The write addresses to the stationary buffer PONG are chosen to match the next
layer's desired input layout. This means:
1. Reduction and reordering happen in the same pipeline stages
2. No explicit reorder step between layers
3. The next layer can start computing immediately from PONG

### Auto-Quantization Pipeline

Between layers, the auto-quant pipeline (TICKET-006) converts int32 → int8:
```
OB write → auto OB read → quant_post → StaB PONG write
```
This produces int8 oActs in the correct layout in PONG, ready as int8 iActs
for the next layer.

## Proposed Implementation

### Phase 1: Sequential multi-layer (no RIR)

1. After TICKET-005 (zero points) and TICKET-006 (quantization):
   - Layer output is int8 in a numpy array
   - Feed layer i's output as layer i+1's input (host-side orchestration)
   - No on-chip buffer modeling, but functionally correct multi-layer inference

2. Add `run_multi_layer()` helper that takes a list of (weights, instructions)
   per layer and chains execution

### Phase 2: On-chip buffer modeling with RIR

1. Model the stationary buffer as an on-chip array with layout-aware addressing
2. BIRRD writes reduced results to specific buffer addresses (RIR)
3. Next layer reads from the same buffer without host intervention
4. This requires:
   - Output buffer → quant → PONG write pipeline
   - Layout-aware addressing in PONG (determined by next layer's SetIVNLayout)
   - SetOVNLayout driving BIRRD write addresses

### Phase 3: Full dataflow overlap

1. Ping-pong execution: layer i computes from PING while layer i+1 loads
   weights into PONG streaming buffer
2. Overlap SetWVNLayout (weight loading) with SetMapping (compute)

## Dependencies

- **TICKET-005** (zero points): Required for correct quantized intermediate values
- **TICKET-006** (post-quantization): Required for int8 layer outputs
- **TICKET-007** (Gc/sr/sc): Beneficial for demonstrating dataflow switching
- **TICKET-008** (multi-way BIRRD): Beneficial for weight-stationary layers

## Implementation (Phase 1)

### `run_sequential_gemm_layers()` helper

Added to `feather_minisa.py`. Takes initial input, list of weight matrices, and
list of `create_gemm_program()` kwargs per layer. For each non-final layer:

1. Builds a separate simulator (dimensions differ per layer)
2. Runs GEMM with post-quantization: `(accum * scale + zp) & 255` → uint8
3. Reinterprets uint8 output as int8 via `C.astype(np.uint8).view(np.int8)`
4. Passes int8 as next layer's input

This matches the RTL pipeline: OB → quant_post → StaB PONG → next layer iActs.

### Test Suite

5 tests in `tests/test_multi_layer.py`:

| Test | Layers | Features |
|------|--------|----------|
| `test_two_layer_gemm` | 2 | Basic chaining, end-to-end golden |
| `test_three_layer_gemm` | 3 | Two quantized intermediates |
| `test_two_layer_with_zero_points` | 2 | Zero points + quantization |
| `test_two_layer_different_dataflow` | 2 | OS (Gr=4) → passthrough (Gr=8) |
| `test_two_layer_aw4` | 2 | AW=4 array |

## Relevant Code

- `feather_minisa.py`: `run_sequential_gemm_layers()` — multi-layer chaining helper
- `feather_minisa.py`: `FeatherKStreamingModule.__call__()` — per-layer execution
- `tests/test_multi_layer.py` — 5 multi-layer tests
- `minisa/isa.py`: `MINISAProgram` — per-layer program structure
- FEATHER paper: Section III.B.2 (RIR), Section IV (FEATHER in action)
- MINISA paper: Section IV.E.4 (execution model)

## Acceptance Criteria

### Phase 1 (sequential multi-layer)
- [x] Helper function chains layer execution with int8 intermediate values
- [x] 2-layer GEMM test: layer1 output (quantized int8) fed as layer2 input
- [x] 3-layer GEMM test: two quantized intermediates
- [x] Tests with zero points, different dataflows, and AW=4
- [x] Results match golden reference computed in numpy

### Phase 2 (on-chip RIR)
- [ ] BIRRD write addresses determined by next layer's layout
- [ ] Buffer read for next layer matches written layout (no host reorder)
- [ ] 2-layer test with different dataflows per layer

### Phase 3 (full overlap)
- [ ] Ping-pong execution model
- [ ] Weight pre-loading overlaps with compute
- [ ] Performance model accounts for overlap
