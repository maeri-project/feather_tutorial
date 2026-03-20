# Figure 7 HLS Dataflow Compliance and Synthesis Report

**Date:** 2026-02-24
**Status:** PASSED - CSim functional correctness verified, CSynth completes cleanly
**Commit:** `8d5904d` (minisa branch)

## Summary

This report documents the changes required to make the FEATHER+ Allo dataflow
design pass Vitis HLS C synthesis (`csynth_design`) for the MINISA Figure 7 case
study (`C[16,8] = A[16,12] x B[12,8]` on a 4x4 NEST with adaptive Gr).

The Allo-generated `kernel.cpp` originally violated two Vitis HLS dataflow
constraints.  Rather than patching the generated C++ post-hoc, the fixes were
made at the Allo dataflow level in `feather_minisa.py`, producing a clean
`#pragma HLS dataflow` region that passes all checks.

## HLS Dataflow Violations (Before)

When the Allo dataflow region is lowered to HLS C++ with `#pragma HLS dataflow`,
each kernel becomes a process function and each array argument becomes a local
buffer connected by `load_buf` (memory-to-buffer) and `store_res`
(buffer-to-memory) processes.  Two violations occurred:

### Violation 1: Multi-Reader on `instructions` Buffer

```
ERROR: [HLS 200-779] Non-shared array 'buf2' failed dataflow checking:
  it can only have a single reader and a single writer.
```

**Cause:** The `instructions` array (`int32[27][13]`) was passed as an argument
to both `crossbar_and_NEST` and `output_accum` kernels.  In the generated HLS
code, `load_buf2` wrote `buf2`, while `crossbar_and_NEST_0` and `output_accum_0`
both read from it — two readers, violating single-reader-single-writer.

```
load_buf2(v711, buf2);                              // writer
crossbar_and_NEST_0(buf0, buf1, buf2, v723);        // reader 1
output_accum_0(buf2, buf4, buf5, buf6, ...);        // reader 2  ← VIOLATION
```

### Violation 2: Multi-Writer on `C` Buffer

```
ERROR: [HLS 200-979] Variable 'buf6' failed dataflow checking:
  it can only be written in one process function.
```

**Cause:** The `C` output matrix (`int32[16][8]`) was an input/output argument.
The HLS backend generated a `load_buf6` process (loading C from memory), while
`output_accum_0` performed read-modify-write (`C[m][n] += tile_out`).  Both
processes wrote to `buf6`, and then `store_res6` read from it.

```
load_buf6(v715, buf6);                              // writer 1
output_accum_0(..., buf6, ...);                     // writer 2 (RMW) ← VIOLATION
store_res6(buf6, v715);                             // reader
```

## Fixes (Allo-Level)

### Fix 1: Separate Tile Bounds for `output_accum`

`output_accum` only reads two fields from the instruction array: `m_start`
(column 7) and `n_start` (column 9) per tile.  Instead of sharing the full
`instructions` buffer, these are precomputed by the wrapper and passed as
dedicated arrays:

```python
# New top-level parameters (feather_minisa.py)
def full_matrix_top(
    A, B,
    instructions,           # read ONLY by crossbar_and_NEST
    birrd_inst, output_col_map, output_num_m,
    accum_m_start,          # NEW: int32[num_tiles] — for output_accum
    accum_n_start,          # NEW: int32[num_tiles] — for output_accum
    C,
):
```

The `output_accum` kernel no longer receives `instructions`:

```python
# Before
@df.kernel(mapping=[1], args=[instructions, output_col_map, output_num_m, C])
def output_accum(local_instructions, ...):
    m_start = local_instructions[inst_idx, 7]
    n_start = local_instructions[inst_idx, 9]

# After
@df.kernel(mapping=[1], args=[output_col_map, output_num_m, accum_m_start, accum_n_start, C])
def output_accum(local_output_col_map, local_output_num_m,
                 local_accum_m_start, local_accum_n_start, local_C):
    m_start = local_accum_m_start[tile]
    n_start = local_accum_n_start[tile]
```

The `FeatherFullMatrixModule` wrapper extracts these at call time:

```python
m_start_per_tile = np.array(
    [int(instructions[3 + t, 7]) for t in range(num_tiles)], dtype=np.int32,
)
n_start_per_tile = np.array(
    [int(instructions[3 + t, 9]) for t in range(num_tiles)], dtype=np.int32,
)
```

**Result:** In the generated HLS code, `instructions` has one writer (`load_buf`)
and one reader (`crossbar_and_NEST_0`).  `accum_m_start` and `accum_n_start`
each have one writer (`load_buf`) and one reader (`output_accum_0`).  No shared
buffers.

### Fix 2: Local Accumulation Buffer in `output_accum`

The `output_accum` kernel now uses a local `accum[M,N]` array for tile
accumulation instead of performing read-modify-write on `local_C`:

```python
# Before: read-modify-write on local_C
for tile in range(num_tiles):
    ...
    local_C[m_start + om, n_start + on] = (
        local_C[m_start + om, n_start + on] + tile_out[on, col]
    )

# After: accumulate locally, then write-only to local_C
accum: int32[M, N]
for _ai in range(M):
    for _aj in range(N):
        accum[_ai, _aj] = 0

for tile in range(num_tiles):
    ...
    accum[m_start + om, n_start + on] = (
        accum[m_start + om, n_start + on] + tile_out[on, col]
    )

# Write-only pass
for _wi in range(M):
    for _wj in range(N):
        local_C[_wi, _wj] = accum[_wi, _wj]
```

**Result:** `local_C` (`buf6` in HLS) is never read by `output_accum_0`, only
written.  The Allo backend detects this write-only access pattern and does not
generate a `load_buf6` process, leaving `output_accum_0` as the sole writer and
`store_res6` as the sole reader.

## Generated HLS Dataflow (After Fixes)

```
full_matrix_top(v709..v717) {
  #pragma HLS dataflow

  // Load processes (one writer per buffer)
  load_buf0(v709, buf0);           // A[16][12]
  load_buf1(v710, buf1);           // B[12][8]
  load_buf2(v711, buf2);           // instructions[27][13]
  load_buf3(v712, buf3);           // birrd_inst[24][3][2]
  load_buf4(v713, buf4);           // output_col_map[24][4]
  load_buf5(v714, buf5);           // output_num_m[24]
  load_buf6(v715, buf6);           // accum_m_start[24]
  load_buf7(v716, buf7);           // accum_n_start[24]
  // No load for C — output_accum writes only

  // Dataflow pipeline
  crossbar_and_NEST_0(buf0, buf1, buf2, ...);    // reads buf0,buf1,buf2
  bus_0(...);
  inst_rw_0(buf3, ...);                          // reads buf3
  BIRRD_0_0..BIRRD_2_1(...);
  output_accum_0(buf4, buf5, buf6, buf7, buf8,   // reads buf4..7, writes buf8
                 ...streams...);
  store_res8(buf8, v717);                         // reads buf8 → C
}
```

Each buffer has exactly one writer and one reader.  No `config_dataflow
-strict_mode warning` is needed.

## Synthesis Results

**Tool:** Vitis HLS 2023.2
**Target:** xcu280-fsvh2892-2L-e (Alveo U280)
**Clock:** 3.33 ns (300 MHz target)

| Metric | Value |
|--------|-------|
| Worst-case latency | **1804 cycles** |
| Best-case latency | 1803 cycles |
| Initiation interval | 1443 cycles |
| Estimated clock period | 2.752 ns |
| Timing met | Yes (slack = 0.578 ns) |

| Resource | Used | Available | Utilization |
|----------|------|-----------|-------------|
| BRAM_18K | 21 | 4,032 | < 1% |
| DSP | 9 | 9,024 | < 1% |
| FF | 45,973 | 2,607,360 | 2% |
| LUT | 45,407 | 1,303,680 | 3% |
| URAM | 0 | 960 | 0% |

## Test Details

### CSim (`test_figure7_hls_csim`)

Builds the full FEATHER+ dataflow via `build_feather_full_matrix_hls(mode="csim")`
and runs through Vitis HLS C simulation (g++ compilation via nanobind).

- Input: random int8 matrices A[16,12], B[12,8] (seed=7)
- Program: 27 instructions (3 layout + 24 tile mappings with adaptive Gr=2/Gr=4)
- Output: `np.testing.assert_array_equal(C, A @ B)` — **PASSED**

### CSynth (`test_figure7_hls_csynth`)

Builds the dataflow via `get_feather_full_matrix_top` + `df.customize` +
`s.build(target="vitis_hls", mode="csyn")`.  No post-generation patching.
Runs `csynth_design` and parses the XML synthesis report at
`<project>/out.prj/solution1/syn/report/full_matrix_top_csynth.xml`.

- Reports latency, initiation interval, clock, and resource utilization
- Prints cycle count: **1804** — **PASSED**

## Files Modified

| File | Change |
|------|--------|
| `feather_minisa.py` | Added `accum_m_start`/`accum_n_start` parameters, local accumulation buffer in `output_accum`, wrapper precomputes tile bounds |
| `tests/test_figure7_hls.py` | New: HLS csim (functional) and csynth (cycle count) tests |
| `reports/parametric_mapping_figure7.md` | Updated with HLS sections (7-8), revised dataflow diagram and test results |

## Backward Compatibility

All pre-existing tests pass unchanged:

- 13/13 simulator tests (`test_full_matrix_gemm.py`)
- 8/8 Figure 7 mapping tests (`test_figure7_mapping.py`)
- 5/5 existing HLS csim tests (`test_full_matrix_hls_csim.py`)

The external interface (`mod(A, B, instructions, C)`) is unchanged — the
`FeatherFullMatrixModule` wrapper handles the new internal parameters
transparently.
