# MINISA: Minimal ISA for FEATHER+ Accelerator

MINISA (Minimal ISA) is a Virtual Neuron (VN)-level programming interface for the FEATHER+ accelerator. It provides a high-level abstraction that configures the FEATHER+ hardware for efficient dataflow computation while hiding low-level PE array details.

## Architecture Overview

```
Programmer → Virtual Neurons (VNs) → Physical PE Array [AH × AW]
```

All computation is performed by Allo dataflow kernels. Python handles ISA definitions, configuration generation (lowering), and control flow (tile iteration).

## Virtual Neurons

A **Virtual Neuron (VN)** is an abstraction layer between the programmer and the physical PE (Processing Element) array.

### Why Virtual Neurons?

1. **Hides hardware complexity**: The physical PE array has fixed dimensions (AH × AW), but workloads have varying sizes. VNs abstract this mismatch.

2. **Logical grouping**: A VN represents a logical unit of computation (like computing one output neuron in a neural network), which may map to multiple PEs or share PEs with other VNs.

3. **Flexible mapping**: The same VN can be mapped differently depending on the dataflow strategy:
   - **Output stationary**: Each VN holds partial sums, accumulating over time
   - **Weight stationary**: Each VN holds weights, streaming inputs through
   - **Input stationary**: Each VN holds inputs, streaming weights through

### The Three VN Types

| VN Type | Abbreviation | Role |
|---------|--------------|------|
| Input Virtual Neuron | IVN | Manages input activation distribution to PEs |
| Weight Virtual Neuron | WVN | Manages weight distribution/stationary storage |
| Output Virtual Neuron | OVN | Manages output collection and reduction via BIRRD |

For a matrix multiply `C = A × B`:
- **IVNs** handle how rows of A are streamed into the array
- **WVNs** handle how columns of B are tiled and held stationary
- **OVNs** handle how partial products are reduced and C is assembled

---

## MINISA Instruction Set

MINISA has exactly **4 instruction types**:

### 1. SetIVNLayout - Input Virtual Neuron Buffer Configuration

Configures how **input activations** are laid out in the streaming buffer.

| Field | Type | Description |
|-------|------|-------------|
| `order` | int (0-5) | 3-bit encoding for dimension ordering (6 permutations of 3 logical dimensions) |
| `ML0` | int | Inner M factor - must equal AH (array height) |
| `ML1` | int | Outer M factor - M/AH tiles in M dimension |
| `JL0` | int | Inner J factor - must equal AH |
| `JL1` | int | Outer J factor - J/AH tiles in reduction dimension |

**Purpose:** Maps input tiles from `[Mt, Kt]` → `[AH, AW]` format for the PE array.

**Constraints:**
- `ML0` must equal `AH`
- `JL0` must equal `AH`
- `order` must be in range 0-5

---

### 2. SetWVNLayout - Weight Virtual Neuron Buffer Configuration

Configures how **weights** are laid out in the stationary buffer.

| Field | Type | Description |
|-------|------|-------------|
| `order` | int (0-5) | 3-bit encoding for dimension ordering |
| `KL0` | int | Inner K factor - must equal AH |
| `KL1` | int | Outer K factor - K/AH tiles in K dimension |
| `NL0` | int | Inner N factor - flexible, 1 ≤ NL0 ≤ AW |
| `NL1` | int | Outer N factor - N/NL0 tiles in N dimension |

**Purpose:** Maps weight tiles from `[Kt, Nt]` → `[AH, AW, AH]` (3D format for PE array).

**Constraints:**
- `KL0` must equal `AH`
- `NL0` must be in range [1, AW]
- `order` must be in range 0-5

---

### 3. SetOVNLayout - Output Virtual Neuron Buffer Configuration

Configures how **outputs** are laid out and how reduction/reordering is performed in the BIRRD network.

| Field | Type | Description |
|-------|------|-------------|
| `order` | int (0-5) | 3-bit encoding for dimension ordering |
| `PL0` | int | Inner P factor - must equal AH |
| `PL1` | int | Outer P factor - P/AH tiles in output rows |
| `QL0` | int | Inner Q factor - must equal AH |
| `QL1` | int | Outer Q factor - Q/AH tiles in output cols |

**Purpose:** Generates BIRRD instruction array `[P0, P1]` for butterfly network reduction/reordering.

**Constraints:**
- `PL0` must equal `AH`
- `QL0` must equal `AH`
- `order` must be in range 0-5

---

### 4. SetMapping - Tile Execution Trigger

Specifies **VN-to-PE array mapping** and triggers execution of one tile.

| Field | Type | Description |
|-------|------|-------------|
| `r0` | int | Base WVN (Weight VN) row index |
| `c0` | int | Base WVN column index |
| `Gr` | int | Replication group size for rows (1 to AW) |
| `Gc` | int | Replication group size for columns (1 to AW) |
| `sr` | int | Temporal stride (across rows) |
| `sc` | int | Spatial stride (across columns) |
| `m_start` | int | Input M dimension tile start |
| `m_end` | int | Input M dimension tile end |
| `n_start` | int | Weight N dimension tile start |
| `n_end` | int | Weight N dimension tile end |
| `k_start` | int | Reduction K dimension tile start |
| `k_end` | int | Reduction K dimension tile end |

**PE Mapping Formula:**
```
r(ah, aw) = r0 + floor(aw / Gr)
c(ah, aw) = c0 + sr * ah + sc * (aw mod Gc)
```

**Common Dataflow Mappings:**

| Dataflow | Gr | Gc | sr | sc | Description |
|----------|----|----|----|----|-------------|
| Output stationary | AW | 1 | 0 | 0 | Outputs stay in PEs |
| Weight stationary | 1 | AW | 0 | 1 | Weights stay in PEs |
| Input stationary | 1 | 1 | 1 | 0 | Inputs stay in PEs |

---

## BIRRD Instruction Set

The BIRRD (Butterfly Interconnect for Reduction and ReorDering) network uses 4 operations:

| Code | Mnemonic | Operation | Effect |
|------|----------|-----------|--------|
| 0 | PS | Pass | `out_left = in_left`, `out_right = in_right` |
| 1 | AR | Add-Right | `out_left = in_left`, `out_right = in_left + in_right` |
| 2 | AL | Add-Left | `out_left = in_left + in_right`, `out_right = in_right` |
| 3 | SW | Swap | `out_left = in_right`, `out_right = in_left` |

**BIRRD Instruction Array Format:**
- Shape: `[P0, P1]` where P0 = stages, P1 = switches per stage
- Data type: int8

---

## MINISAProgram Container

Wraps a complete program:

| Field | Description |
|-------|-------------|
| `name` | Program identifier |
| `AH` | Hardware array height (typically 8 or 16) |
| `AW` | Hardware array width (4, 8, or 16) |
| `ivn_layout` | SetIVNLayout instance |
| `wvn_layout` | SetWVNLayout instance |
| `ovn_layout` | SetOVNLayout instance |
| `mappings` | List[SetMapping] - sequence of tile executions |

---

## Tiling and Partial Sum Accumulation

### Execution Flow

For GEMM: `C[M,N] = A[M,K] × B[K,N]`

Tiles iterate in order: N tiles → M tiles → K tiles (innermost)

For each `SetMapping`:

```python
# 1. Extract tile from full tensors (no compute)
iActs_tile = inputs[m_start:m_end, k_start:k_end]    # [AH, AW]
weights_tile = weights[k_start:k_end, n_start:n_end] # [AH, AW, AH]

# 2. Allo computes ONE tile's partial product
tile_output = allo_module(iActs_tile, weights_tile, birrd_inst)  # [AH, AW]

# 3. Accumulate in host memory
output[m_slice, n_slice] += tile_output
```

### Where Partial Sums Live

| Location | In This Simulator | In Real Hardware |
|----------|-------------------|------------------|
| Tile computation | Allo kernel | PE array |
| Partial sum storage | Host memory (numpy) | On-chip accumulation buffer |
| Accumulation | Python `+=` operator | Hardware accumulator |

### Example: 16×16 × 16×16 GEMM with AH=8, AW=8

```
Tile sizes: Mt=4, Nt=8, Kt=16
Tiles: 4 M-tiles × 2 N-tiles × 1 K-tile = 8 tiles

Each SetMapping produces one [8,8] tile output
```

If K=32 (2 K-tiles), reduction across K happens via host accumulation:

```
For output[0:8, 0:8]:
  Tile 1: partial_sum  = A[0:8, 0:16]  × B[0:16, 0:8]
  Tile 2: partial_sum += A[0:8, 16:32] × B[16:32, 0:8]  ← accumulated in host
```

### Spatial vs Temporal Reduction

- **BIRRD network**: Handles spatial reduction *within* a tile (reducing across AW columns)
- **Host accumulation**: Handles temporal reduction *across* K-tiles

In actual FEATHER+ hardware, on-chip buffers would hold partial sums between K-tile iterations, avoiding round-trips to external memory.

---

## File Organization

```
examples/feather-isa/
├── feather_minisa.py          # Allo dataflow implementation
├── minisa/
│   ├── __init__.py            # Module exports
│   ├── isa.py                 # ISA definitions (4 instruction types)
│   ├── lowering.py            # MINISA → Allo config conversion
│   └── interpreter.py         # Execution engine
├── tests/
│   ├── test_feather_baseline.py
│   ├── test_minisa_gemm_allo.py
│   └── test_minisa_layout_switching_allo.py
├── design/                    # Design documents
└── reports/                   # Verification reports
```

---

## Usage Example

```python
from minisa import MINISAProgram, MINISAInterpreter, create_gemm_program

# Create a GEMM program
program = create_gemm_program(M=16, N=16, K=32, AH=8, AW=8)

# Create interpreter
interpreter = MINISAInterpreter(AW=8, AH=8)

# Execute
output = interpreter.execute_program(program, inputs, weights)
```

## Build Targets

| Target | Mode | Description |
|--------|------|-------------|
| `simulator` | - | LLVM OMP-based (fastest, for development) |
| `vitis_hls` | `csim` | C simulation |
| `vitis_hls` | `csyn` | Synthesis only |
| `vitis_hls` | `sw_emu` | Software emulation |
| `vitis_hls` | `hw_emu` | Hardware emulation |
