# MINISA Allo Integration Design

**Date:** 2026-01-22
**Status:** Implementation Plan

## Overview

This document specifies how MINISA instructions integrate with the FEATHER Allo
dataflow implementation. The key principle is that **all compute is performed by
Allo kernels**, while Python handles ISA definitions, program construction, and
configuration tensor generation.

## Component Implementation Matrix

| Component | Implementation | Must use Allo? | Justification |
|-----------|----------------|----------------|---------------|
| MINISA ISA structs | Python dataclasses | No | Data structures only, no compute |
| Layout/mapping lowering | Python | No | Generates config arrays, no compute |
| VN input buffer stage | Allo df.kernel | **YES** | Hardware data staging |
| VN weight buffer stage | Allo df.kernel | **YES** | Hardware data staging |
| Input crossbar | Allo df.kernel + Stream | **YES** | Hardware routing network |
| Weight crossbar | Allo df.kernel + Stream | **YES** | Hardware routing network |
| Compute array (NEST) | Allo df.kernel | **YES** | Core MAC computation |
| Reduction network (BIRRD) | Allo df.kernel | **YES** | Hardware reduction/reorder |
| Output buffer stage | Allo df.kernel | **YES** | Hardware output collection |
| Tile execution loop | Python interpreter | No | Control flow only, calls Allo |
| Test input generation | Python numpy | No | Test fixture generation |
| Reference computation | Python numpy | No | Verification only |

## Architecture Diagram

```
                    MINISA Program
                         |
                         v
              +---------------------+
              |   Python Lowering   |   <- Generates config tensors
              +---------------------+
                         |
          +--------------+--------------+
          |              |              |
          v              v              v
     +--------+    +----------+   +----------+
     | IVN    |    | WVN      |   | BIRRD    |
     | Config |    | Config   |   | Inst     |
     +--------+    +----------+   +----------+
          |              |              |
          v              v              v
    ==================================================
    |              ALLO DATAFLOW REGION              |
    ==================================================
          |              |              |
          v              v              v
    +-----------+  +-----------+  +-----------+
    | Input VN  |  | Weight VN |  | Inst      |
    | Buffer    |  | Buffer    |  | Loader    |
    | (kernel)  |  | (kernel)  |  | (kernel)  |
    +-----------+  +-----------+  +-----------+
          |              |              |
          v              v              |
    +-----------+  +-----------+        |
    | Input     |  | Weight    |        |
    | Crossbar  |  | Crossbar  |        |
    | (kernel)  |  | (kernel)  |        |
    +-----------+  +-----------+        |
          |              |              |
          +------+-------+              |
                 |                      |
                 v                      |
          +-------------+               |
          |    NEST     |               |
          | Compute PE  |               |
          |  (kernel)   |               |
          +-------------+               |
                 |                      |
                 v                      |
          +-------------+               |
          |     Bus     |<--------------+
          |  (kernel)   |
          +-------------+
                 |
                 v
          +-------------+
          |   BIRRD     |
          | Reduction   |
          |  (kernel)   |
          +-------------+
                 |
                 v
          +-------------+
          |   Output    |
          |   Buffer    |
          |  (kernel)   |
          +-------------+
                 |
                 v
            Output Tensor
    ==================================================
```

## MINISA Instruction Set

### SetIVNLayout
Configures input Virtual Neuron layout for streaming buffer.

```python
@dataclass
class SetIVNLayout:
    order: int   # 3-bit encoding (0-5) for dimension order
    ML0: int     # Inner M factor (always = AH, VN constraint)
    ML1: int     # Outer M factor = M / AH
    JL0: int     # Inner J factor (always = AH, VN constraint)
    JL1: int     # Outer J factor = J / AH
```

**Maps to Allo:** Generates input buffer addressing tables and crossbar select patterns.

### SetWVNLayout
Configures weight Virtual Neuron layout for stationary buffer.

```python
@dataclass
class SetWVNLayout:
    order: int   # 3-bit encoding for dimension order
    KL0: int     # Inner K factor (always = AH)
    KL1: int     # Outer K factor = K / AH
    NL0: int     # Inner N factor (1 <= NL0 <= AW)
    NL1: int     # Outer N factor
```

**Maps to Allo:** Generates weight buffer layout and crossbar select patterns.

### SetOVNLayout
Configures output Virtual Neuron layout.

```python
@dataclass
class SetOVNLayout:
    order: int   # 3-bit encoding for dimension order
    PL0: int     # Inner P factor (always = AH)
    PL1: int     # Outer P factor = P / AH
    QL0: int     # Inner Q factor (always = AH)
    QL1: int     # Outer Q factor = Q / AH
```

**Maps to Allo:** Generates BIRRD instruction arrays for reduction/reordering.

### SetMapping
Triggers tile execution with VN-level mapping parameters.

```python
@dataclass
class SetMapping:
    r0: int      # Base WVN row index
    c0: int      # Base WVN column index
    Gr: int      # Replication group size (rows)
    Gc: int      # Replication group size (cols)
    sr: int      # Temporal stride
    sc: int      # Spatial stride
```

**Maps to Allo:** Each SetMapping invokes the Allo dataflow region with:
- Input tile data (sliced from global input tensor)
- Weight tile data (sliced from global weight tensor)
- BIRRD instruction array (computed from layouts)
- Output buffer (receives Allo-computed results)

## Allo Kernel Specifications

### 1. Input VN Buffer Kernel
```python
@df.kernel(mapping=[1], args=[iActs, ivn_config])
def input_vn_buffer(local_iActs, local_config):
    # Reads input data according to IVN layout configuration
    # Outputs to input crossbar stream
```

### 2. Weight VN Buffer Kernel
```python
@df.kernel(mapping=[1], args=[weights, wvn_config])
def weight_vn_buffer(local_weights, local_config):
    # Reads weight data according to WVN layout configuration
    # Outputs to weight crossbar stream
```

### 3. NEST Compute Kernel (from FEATHER)
```python
@df.kernel(mapping=[1], args=[iActs, weights])
def NEST(local_iActs, local_weights):
    # AH x AW PE array performing AH-way dot products
    # Temporal reduction within each PE
    # Outputs packed results to nest_out stream
```

### 4. BIRRD Reduction Kernel (from FEATHER)
```python
@df.kernel(mapping=[P0, P1])
def BIRRD():
    # Multi-stage butterfly reduction/reorder network
    # Each instance is one switch in the network
    # Four operations: PS, AR, AL, SW
```

### 5. Output Buffer Kernel (from FEATHER)
```python
@df.kernel(mapping=[1], args=[output_buffer])
def output(local_output):
    # Collects reduced results from BIRRD final stage
    # Writes to output tensor
```

## Configuration Tensor Formats

### BIRRD Instruction Array
```python
inst: int8[P0, P1]  # P0 stages, P1 switches per stage
# Values: 0=PS (pass), 1=AR (add-right), 2=AL (add-left), 3=SW (swap)
```

### Input Layout Configuration
```python
ivn_config: struct {
    order: int8,
    dims: int32[4]  # ML0, ML1, JL0, JL1
}
```

### Weight Layout Configuration
```python
wvn_config: struct {
    order: int8,
    dims: int32[4]  # KL0, KL1, NL0, NL1
}
```

## Tile Execution Flow

1. **Python Lowering Phase:**
   ```python
   # Generate configuration tensors from MINISA instructions
   ivn_config = lower_ivn_layout(set_ivn_layout_instr)
   wvn_config = lower_wvn_layout(set_wvn_layout_instr)
   birrd_inst = lower_ovn_to_birrd(set_ovn_layout_instr)
   ```

2. **Allo Execution Phase:**
   ```python
   # For each SetMapping tile:
   for mapping in mappings:
       # Extract tile data (Python slicing)
       iActs_tile = extract_input_tile(inputs, mapping, ivn_config)
       weights_tile = extract_weight_tile(weights, mapping, wvn_config)

       # Execute through Allo (ALL COMPUTE HERE)
       allo_module(iActs_tile, weights_tile, birrd_inst, output_tile)

       # Store results (Python, no compute)
       store_output_tile(outputs, output_tile, mapping)
   ```

## Verification Strategy

To prove Allo performs the compute (not numpy):

1. **Output buffer ownership:** Only Allo kernels write to output tensors
2. **Module call tracing:** Interpreter logs each Allo module invocation
3. **No numpy compute:** Interpreter never performs matrix operations
4. **Configuration-only Python:** Lowering produces arrays, not results

## File Organization

```
examples/feather-isa/
+-- feather_minisa.py          # Allo dataflow entry point
+-- minisa/
|   +-- __init__.py
|   +-- isa.py                 # ISA dataclass definitions
|   +-- lowering.py            # MINISA -> Allo config tensors
|   +-- interpreter.py         # Tile execution via Allo
+-- design/
|   +-- minisa_allo_integration.md  # This document
+-- tests/
|   +-- test_feather_baseline.py
|   +-- test_minisa_gemm_allo.py
|   +-- test_minisa_layout_switching_allo.py
+-- reports/
    +-- baseline.md
    +-- minisa_allo_verification.md
```

## HLS Backend Support

The MINISA interpreter supports multiple Allo build targets for different
validation and synthesis flows.

### Build Targets

| Target | Mode | Use Case | Performance | Validation Level |
|--------|------|----------|-------------|------------------|
| `simulator` | N/A | Fast development | Fastest | Functional only |
| `vitis_hls` | `csim` | HLS code validation | Slower | HLS C compile check |
| `vitis_hls` | `csyn` | Synthesis reports | N/A (no exec) | Full HLS synthesis |
| `vitis_hls` | `sw_emu` | Software emulation | Slow | Xilinx SW emulation |
| `vitis_hls` | `hw_emu` | Hardware emulation | Very slow | Xilinx HW emulation |

### Switching Build Target

```python
# Default: LLVM simulator (fast)
interpreter = MINISAInterpreter(AW=8, AH=8, build_target="simulator")

# HLS C simulation (validates generated code)
interpreter = MINISAInterpreter(
    AW=8, AH=8,
    build_target="vitis_hls",
    build_mode="csim",
    project_dir="./hls_project"
)

# HLS synthesis only (no execution)
from feather_minisa import build_feather_minisa_hls
mod = build_feather_minisa_hls(AW=8, AH=8, Ty=int8, mode="csyn", project="./hls_project")
print(mod.hls_code)  # Inspect generated code
```

### HLS Code Generation Flow

```
    Allo Dataflow Region (Python)
              |
              v
    MLIR Representation (allo.ir)
              |
              v
    HLS C Code Generation (allo_d.emit_vhls())
              |
              v
    kernel.cpp + kernel.h (HLS project)
              |
              +---> csim: Compile via nanobind -> IPModule (executable)
              |
              +---> csyn: Run Vitis HLS synthesis -> HLSModule (reports)
              |
              +---> sw_emu/hw_emu: Xilinx emulation -> HLSModule
```

### HLS-Specific Optimizations

When building for HLS targets, the following optimizations are applied:

```python
# Array partitioning for parallel access
s.partition("top:output_buffer", dim=1, factor=AW)
s.partition("top:iActs", dim=1, factor=AH)
s.partition("top:weights", dim=2, factor=AW)
s.partition("top:weights", dim=3, factor=AH)
```

These partitioning directives enable parallel array access in the NEST
compute kernel, which is essential for achieving high throughput on FPGA.

### Testing HLS Backend

```bash
# Run HLS-specific tests (requires Vitis HLS)
cd examples/feather-isa
python -m pytest tests/test_minisa_hls_csim.py -v

# Generate HLS code for inspection
python -c "
from feather_minisa import get_hls_code
from allo.ir.types import int8
code = get_hls_code(AW=8, AH=8, Ty=int8)
print(code)
"
```

## Summary

- **Allo executes all compute:** NEST, BIRRD, and buffer kernels
- **Python generates configs:** ISA lowering produces configuration tensors
- **Python controls execution:** Interpreter loops over tiles, calling Allo
- **Verification proves correctness:** Tests cannot pass with numpy-only compute
- **Multiple backends:** Simulator for fast dev, HLS for synthesis validation
