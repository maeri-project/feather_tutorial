# FEATHER+ Allo: Crossbar Flexibility Gap

**Date:** 2026-03-04
**Status:** RESOLVED — power-of-2 bit operations (Approach 1) implemented
**Branch:** minisa

## Problem Statement

The optimized K-streaming kernel (`get_feather_full_matrix_top_kstreaming`) hardcodes
Gr=AW in the crossbar index arithmetic, **sacrificing dataflow switching flexibility for
performance**. This contradicts FEATHER+'s core value proposition: the ability to
co-switch dataflow and layout per tile via the all-to-all crossbar.

FEATHER+'s physical crossbar is a mux network that routes any-to-any in 1 cycle
regardless of Gr. Our HLS "crossbar" is index arithmetic — and runtime `%`/`//` on
variable Gr compiles to multi-cycle integer dividers that destroy pipeline initiation
interval.

## Current State

### K-streaming kernel (1001 cycles, beats RTL) — inflexible

`crossbar_load` at `feather_minisa.py:550-566`:

```python
# Hardcoded for Gr=AW: ic_j % AW = ic_j, ic_j // AW = 0
local_A[m_start + ic_j, k_start + ic_i]       # no Gr in index
local_B[k_start + wc_k, n_start + wc_i]       # no Gr in index
```

- Only supports Gr=AW (output-stationary-like mapping)
- Cannot vary Gr between tiles
- Cannot support weight-stationary (Gr=1) or mixed dataflows

### General-purpose kernel (1792 cycles) — flexible but slow

`crossbar_and_NEST` at `feather_minisa.py:187-189, 227-228`:

```python
# Parametric Gr (ORDER_012):
m_idx = m_start + (ic_j % Gr)                  # runtime modulo
k_idx = k_start + ic_i + (ic_j // Gr) * AH     # runtime division
wk_idx = k_start + wc_k + (wc_w // Gr) * AH    # runtime division
```

- Supports any Gr value per tile (full dataflow switching)
- 14 runtime dividers → 72% of design FF, 54% of LUT
- Input crossbar: II=2 (target: 1), 6 dividers
- Weight crossbar: II=8 (target: 1), 8 dividers

### Performance vs flexibility tradeoff

| Kernel | Gr support | Dividers | II | Cosim cycles | vs RTL |
|---|---|---|---|---|---|
| General-purpose | Any Gr (runtime) | 14 | 2-8 | 1792 | 1.60x |
| K-streaming | Gr=AW only | 0 | 4 | 1001 | 0.89x |

## Why This Matters

FEATHER+'s key differentiator from fixed-dataflow accelerators (TPU, Gemmini, NVDLA) is
per-tile dataflow switching. The MINISA paper demonstrates this across 58 GEMM workloads
spanning AI, HE, and ZKP domains. Many workloads benefit from adaptive Gr:

- **Figure 7 original mapping**: uses Gr=2 (16 tiles) and Gr=4 (8 tiles) to handle
  irregular K-dimension (K=12 on AH=4 array)
- **Weight stationary**: Gr=1, Gc=AW — each PE column holds a different weight VN
- **Input stationary**: Gr=1, Gc=1 — maximum reuse of input activations

Our K-streaming kernel can only do Gr=AW, which is a single point in this space.

## Root Cause

The RTL crossbar is a **combinational mux network** — routing is configured by control
signals, no arithmetic required. The HLS crossbar is **index computation** — we compute
memory addresses, and `ic_j % Gr` with runtime Gr compiles to a 32-bit integer divider.

Vitis HLS integer dividers:
- Latency: ~36 cycles for 32-bit sdiv/srem
- Area: 2,283 FF + 1,738 LUT per divider
- Pipeline impact: forces II ≥ 2 (divider not fully pipelined)

## Proposed Solutions

### Approach 1: Power-of-2 Gr with bit operations

FEATHER+ constrains Gr to divide AW, and AW is a power of 2 (4, 8, 16). Therefore
Gr is always a power of 2. Replace `%` and `//` with bit masks and shifts:

```python
log2_Gr = local_instructions[inst_idx, LOG2_GR_FIELD]  # pre-computed
mask_Gr = (1 << log2_Gr) - 1                           # Gr - 1

m_idx = m_start + (ic_j & mask_Gr)          # ic_j % Gr (1 cycle, 1 AND gate)
k_idx = k_start + ic_i + (ic_j >> log2_Gr) * AH  # ic_j // Gr (1 cycle, 1 shift)
```

**Pros:** Zero-cost at runtime, Vitis HLS compiles shifts/masks to wires.
**Cons:** Requires ISA encoding change (add log2_Gr field or derive from Gr).
Need to verify Allo supports `<<` and `>>` with runtime shift amounts.

### Approach 2: Compile-time specialization per Gr

Generate separate crossbar_load kernels for each valid Gr value, select at runtime:

```python
if Gr == 1:
    crossbar_load_gr1(...)   # weight stationary
elif Gr == 2:
    crossbar_load_gr2(...)   # partial reduction
elif Gr == AW:
    crossbar_load_grAW(...)  # output stationary (current fast path)
```

**Pros:** Each variant is fully optimized (no runtime arithmetic).
**Cons:** Code duplication (one kernel per Gr value). Allo may not support
runtime kernel selection in a dataflow region. The if/else may itself
become a sequential bottleneck.

### Approach 3: Lookup table for PE-to-VN mapping

Pre-compute the index mapping outside the kernel and pass it as an array:

```python
# Host pre-computes per tile:
iact_m_offset[tile, ic_i, ic_j] = ic_j % Gr
iact_k_offset[tile, ic_i, ic_j] = ic_i + (ic_j // Gr) * AH

# Kernel just does table lookup:
local_A[m_start + iact_m_offset[tile, ic_i, ic_j],
        k_start + iact_k_offset[tile, ic_i, ic_j]]
```

**Pros:** No runtime arithmetic at all, fully flexible.
**Cons:** Extra memory for lookup tables (small: num_tiles x AH x AW x 2 int32).
Additional m_axi port or BRAM for the table. May increase load_buf latency.

### Approach 4: Hybrid — fast path + general fallback

Keep the optimized Gr=AW path, add a general path for other Gr values using
Approach 1 (bit operations):

```python
if Gr == AW:
    # Fast path: no Gr arithmetic (current optimized code)
    local_A[m_start + ic_j, k_start + ic_i]
else:
    # General path: bit-shift Gr arithmetic
    local_A[m_start + (ic_j & mask_Gr), k_start + ic_i + (ic_j >> log2_Gr) * AH]
```

**Pros:** No regression for Gr=AW case, general support for others.
**Cons:** Branch in inner loop may confuse HLS pipelining. Need to test
whether Vitis HLS can pipeline both paths at the target II.

## Recommended Approach

**Approach 1 (power-of-2 bit operations)** is the most promising:

1. Gr is always a power of 2 by FEATHER+ architectural constraint
2. Bit shifts and masks compile to combinational logic (0 cycles, ~tens of LUTs)
3. No code duplication or extra memory
4. Closest analog to the RTL mux-based crossbar
5. Unified code path — no branches in inner loop

The only risk is whether Allo/MLIR properly lowers variable-amount shifts
(`ic_j >> log2_Gr`) to HLS. This needs a small prototype to validate.

## Verification Plan

Once implemented, verify with:
1. Figure 7 original mapping (mixed Gr=2 and Gr=4 tiles) — functional test
2. Pure weight-stationary mapping (Gr=1) — functional test
3. HLS csynth — verify no integer dividers in resource report
4. HLS csynth — verify pipeline II is not degraded
5. RTL cosim — cycle count comparison across Gr values

## Files Affected

| File | Change |
|---|---|
| `minisa/isa.py` | Add `log2_Gr` field to SetMapping encoding (or compute in kernel) |
| `feather_minisa.py` | Replace `%`/`//` with `&`/`>>` in crossbar index arithmetic |
| `tests/test_figure7_mapping.py` | Add mixed-Gr functional test |
| `tests/test_figure7_hls.py` | Verify no dividers in csynth report |
