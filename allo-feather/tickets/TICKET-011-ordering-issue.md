---
id: TICKET-011
title: Ordering encoding mismatch between paper and RTL implementation
status: resolved
priority: high
---

I just identify one "Ordering Encoding" issue when connecting MINISA with ACT.
Specifically, the order encoding in the original MINISA paper is outdated, because I changed the order encoding in the actual implementation to enforce the same order index giving the same layout order for IVN and WVN.

if we did use the ordering listed in the paper, in which case, we need to update them into the following encoding.

```
TABLE_II_OUTER_TO_INNER: Dict[int, Dict[str, Tuple[str, str, str]]] = {
    0: {"W": ("kL1", "nL0", "nL1"), "I": ("jL1", "mL0", "mL1"), "O": ("pL1", "pL0", "qL1")},
    1: {"W": ("kL1", "nL1", "nL0"), "I": ("jL1", "mL1", "mL0"), "O": ("pL1", "qL1", "pL0")},
    2: {"W": ("nL0", "kL1", "nL1"), "I": ("mL0", "jL1", "mL1"), "O": ("pL0", "pL1", "qL1")},
    3: {"W": ("nL0", "nL1", "kL1"), "I": ("mL0", "mL1", "jL1"), "O": ("pL0", "qL1", "pL1")},
    4: {"W": ("nL1", "kL1", "nL0"), "I": ("mL1", "jL1", "mL0"), "O": ("qL1", "pL1", "pL0")},
    5: {"W": ("nL1", "nL0", "kL1"), "I": ("mL1", "mL0", "jL1"), "O": ("qL1", "pL0", "pL1")},
}
```

---

## Analysis

### What changed from the paper

The paper had different dimension assignments for IVN vs WVN, so `order=X` would produce
different structural loop nestings for inputs vs weights. The corrected encoding enforces
**symmetry**: same order index → same structural layout for both IVN and WVN.

### Canonical dimension assignments (corrected)

Each VN type has 3 logical dimensions. The order index `X` in `ORDER_XYZ` selects a
permutation of these dimensions (outer-to-inner):

| VN  | dim0          | dim1          | dim2          |
|-----|---------------|---------------|---------------|
| IVN | jL1 (K outer) | mL0 (M inner) | mL1 (M outer) |
| WVN | kL1 (K outer) | nL0 (N inner) | nL1 (N outer) |
| OVN | pL1 (P outer) | pL0 (P inner) | qL1 (Q outer) |

`ORDER_012` = (dim0, dim1, dim2), `ORDER_021` = (dim0, dim2, dim1), etc.

The key symmetry: replacing IVN-specific names (jL1, mL0, mL1) with WVN-specific names
(kL1, nL0, nL1) at the same order index yields the same tuple structure. This means
order=0 always puts the reduction dimension (K) outermost for both I and W.

### Impact on our Allo implementation

1. **IVN/WVN orders**: Functionally unused — our simulator uses direct indexing via
   Gr/Gc/sr/sc from SetMapping, bypassing VN buffer addressing entirely. The order
   values are stored in instructions but don't affect crossbar routing. No change needed.

2. **OVN order**: Actively used — selects BIRRD instruction tables in `lowering.py` and
   determines `col_to_m_map` for output accumulation. Different OVN orders produce
   different butterfly reduction configurations with different output column permutations.

3. **BIRRD table correctness**: Our `_BIRRD_INST_TABLES` were designed independently
   (not derived from the paper's TABLE_II). Each (AW, order) entry produces a valid
   2-way reduction. For **order=0**, correctness is validated against the RTL trace
   (trace_m24k48n512_16x16.json matches RTL's 3025-cycle reference). For non-zero
   orders, tables produce correct GEMM (verified by OVN sweep tests) but haven't been
   validated against RTL — RTL traces with non-zero orders are needed for full interop
   verification.

### Changes made

1. Added `TABLE_II_OUTER_TO_INNER` constant to `minisa/isa.py` as canonical reference
2. Updated `LayoutOrder` docstring to document per-VN dimension semantics
3. Updated VN layout docstrings with corrected dimension names

### Verification

- All existing tests pass (order=0 RTL trace, OVN order 1-5 sweep, mixed Gr, etc.)
- No functional changes to kernel or BIRRD logic