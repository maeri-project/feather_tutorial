# FEATHER+ MINISA: HLS Optimization Report

## 1. Executive Summary

This report documents the optimization of the FEATHER+ MINISA accelerator — a spatial
dataflow GEMM engine implemented in Allo and synthesized through Vitis HLS. Over the
course of development, the design went from an initial 1792-cycle csynth estimate down
to **234 cycles**, beating the RTL reference design (240 cycles) by 2.5%. RTL
co-simulation confirms functional correctness at 878 cycles (including DRAM overhead).

| Milestone | Csynth (cycles) | vs RTL (240) | Key Change |
|---|---|---|---|
| Initial K-streaming | 1792 | 7.5x | Baseline dataflow |
| Split crossbar/NEST | 1001 | 4.2x | Architecture restructuring |
| Block output_accum | 743 | 3.1x | Fused accumulation |
| Column-streaming | 806 | 3.4x | 16×16 scalability (was OOM) |
| Split a_loader/w_loader | 766 | 3.2x | Parallel DRAM reads |
| Fused output_accum | 538 | 2.2x | Single-pipeline accumulate+writeback |
| Wide DRAM + A partition | 262 | 1.09x | ap_uint wide pointers + BRAM partitioning |
| **DEPENDENCE pragma** | **234** | **0.975x** | False inter-iteration dependence on C |

The final architecture has 7 pipelined dataflow kernels with AH×AW spatial PEs,
column-streaming data distribution, BIRRD butterfly reduction, and fused output
accumulation — totaling ~35 hardware processes for a 4×4 array configuration.

---

## 2. Architecture Evolution

### 2.1 Phase 1: Monolithic Kernel (1792 → 1001 cycles)

The initial design used a single large crossbar+NEST kernel processing all PEs. HLS
could not effectively pipeline this because all AW×AH data paths were in one function
body, creating massive multiplexer trees and port conflicts.

**Lesson**: In Allo/HLS, *structural parallelism* (separate dataflow kernels) is far
more effective than *directive parallelism* (unroll/pipeline pragmas). Splitting the
crossbar and NEST into separate spatial kernels let HLS treat each PE as an independent
pipeline, immediately halving cycle count.

### 2.2 Phase 2: Spatial PE Array (1001 → 743 cycles)

The unified PE array architecture (mapping=[AH+1, AW]) eliminated intermediate
buffers. Each PE became an independent dataflow process connected by streams. The
gather row (AH) collected results and fed the BIRRD network. Block-based output
accumulation replaced the per-tile writeback, reducing output_accum from O(total_ops)
to O(num_blocks) iterations.

### 2.3 Phase 3: Column-Streaming (806 cycles, 16×16 enabled)

The 16×16 array configuration failed csynth — Clang OOM-killed at 18 GB RAM. Root
cause: `dram_loader` used `meta_for(AW) × meta_for(AH)` = 256 parallel code paths to
stream directly to every PE. This generated 160K compile instructions and 320K after
array partition expansion (91% of total).

**Fix**: Column-streaming — dram_loader streams to AW column heads only (16 paths
instead of 256). Data flows down through inter-PE streams. This was a **16× reduction**
in generated code paths.

**Lesson**: `meta_for` creates compile-time parallel hardware instances. Each instance
generates its own instruction sequence in HLS. The instruction count scales as
O(meta_for_depth²) when nested, which can overwhelm the HLS compiler for large arrays.
Always prefer structural parallelism (more kernels) over deep meta_for nesting.

### 2.4 Phase 4: Split Loaders + W Broadcast (766 cycles)

Splitting `dram_loader` into separate `a_loader` and `w_loader` kernels (each with its
own instruction copy) enabled true parallel DRAM access. Adding `w_broadcast[AW]`
intermediate kernels solved the W distribution problem without requiring each PE to read
from the same FIFO.

The `w_loader` inner loop was restructured from a flat `meta_for(AW)` to
`meta_for(AW) × meta_for(AH)`, giving each PE row its own col_w_in FIFO. This reduced
per-FIFO writes from AH² to AH per pipeline iteration, cutting w_loader II from 16 to 4.

**Lesson**: HLS dataflow requires single-reader-single-writer FIFO discipline. When
multiple consumers need the same data, add intermediate broadcast kernels rather than
trying to share FIFOs. The BRAM cost is negligible compared to the scheduling benefit.

---

## 3. HLS-Specific Optimizations (538 → 234 cycles)

### 3.1 Wide Pointer DRAM Access (load_buf/store_res patching)

Allo generates `load_buf` and `store_res` functions that transfer data between DRAM
(m_axi) and local BRAMs one element at a time. For a 16×12 matrix, this means 192
sequential reads — each taking one AXI transaction.

**Fix**: Post-synthesis patching of kernel.cpp to use `ap_uint<N>` wide pointers that
read an entire row per cycle:

```cpp
// Before (auto-generated): 192 cycles for A[16][12]
void load_buf0(int32_t v1[192], int32_t v2[16][12]) {
  for (i = 0; i < 16; i++)
    for (j = 0; j < 12; j++)
      v2[i][j] = v1[i*12+j];  // 1 element per cycle
}

// After (patched): 16 cycles for A[16][12]
void load_buf0(ap_uint<384> v1[16], int32_t v2[16][12]) {
  #pragma HLS array_partition variable=v2 complete dim=2
  for (i = 0; i < 16; i++) {
    #pragma HLS pipeline II=1 rewind
    ap_uint<384> row = v1[i];  // 12 int32s in one AXI beat
    v2[i][0] = (int32_t)row.range(31, 0);
    v2[i][1] = (int32_t)row.range(63, 32);
    // ... all 12 columns extracted in parallel
  }
}
```

This patching is automated in `_patch_load_bufs_for_throughput()` for all load_buf
variants (2D int32, 3D int8, store_res). The function uses regex to detect buffer
signatures and generate the optimized versions.

**Impact**: load_buf0 (A matrix): 201 → 25 cycles. load_buf3 (B matrix): 105 → 21
cycles. store_res13 (C output): 135 → 23 cycles.

**Lesson**: Allo's auto-generated DRAM transfer code is a major bottleneck. The
framework doesn't yet support wide pointer types or row-at-a-time transfers. Until this
is added upstream, post-synthesis kernel.cpp patching is the most effective workaround.
The key HLS primitives are `ap_uint<N>` for wide ports, `array_partition complete` for
parallel BRAM writes, and `pipeline II=1 rewind` for burst loops.

### 3.2 Array Partitioning Strategy

| Array | Partition | Rationale |
|---|---|---|
| `local_A[M,K]` dim=1 | Cyclic(AW) | AW parallel row reads via meta_for |
| `local_A[M,K]` dim=2 | Complete | Eliminate K-column port conflicts when Gr<AW |
| `local_B[K,N]` (small) | Complete both | Runtime Gr/sr/sc → can't predict access pattern |
| `local_B[K,N]` (large) | Cyclic(AH) dim=2 | Avoid mux explosion for large arrays |
| `C[M,N]` dim=2 | Complete | Parallel column writes in output_accum |
| `tile_acc[AW,AH]` | Complete both | Fixed compile-time indices from meta_for |

**Key insight**: `Partition.Complete` is essential when access addresses are
runtime-computed (from decoded instructions). HLS assumes worst-case bank conflicts for
runtime addresses — Complete partition (registers) eliminates this entirely but doesn't
scale for large arrays. Use Cyclic partitioning for large arrays and accept the II
penalty, or restructure the algorithm to use compile-time constant indices.

**Pitfall**: Making C fully registered (`Complete` on both dims) caused the HLS
scheduler to hang for over an hour. The combinatorial explosion from 128 register write
ports with runtime-computed addresses overwhelmed scheduling. For large output arrays,
partition only the dimension with compile-time-known access patterns.

### 3.3 False Dependence Pragma (262 → 234 cycles)

The `output_accum` block loop achieved II=16 instead of the theoretical minimum II=12.
The verbose HLS schedule report identified the bottleneck:

```
WARNING: [HLS 200-880] The II Violation in module 'output_accum_0_Pipeline_l_S_block_0_block':
  Unable to enforce a carried dependence constraint (II = 15, distance = 1, offset = 1)
  between 'store' on array 'v1632_0' and 'store' on array 'v1632_0'.
```

HLS assumed that C writes from consecutive block iterations might alias (same row/col).
In reality, different blocks write to non-overlapping output regions (different
m_start/n_start). The fix:

```cpp
l_S_block_0_block: for (int block = 0; block < 8; block++) {
  #pragma HLS DEPENDENCE variable=v1632 type=inter false
  // ... block body
}
```

**Impact**: output_accum II dropped from 16 → 12 (FIFO-read-limited minimum), saving
28 cycles across 8 blocks. Total: 262 → 234 cycles.

**Lesson**: When HLS reports II violations due to "carried dependence constraints" on
arrays with runtime-computed addresses, check whether consecutive loop iterations
actually access overlapping addresses. If they don't (as in tiled output accumulation),
`#pragma HLS DEPENDENCE type=inter false` is safe and can yield significant II
improvements. Always verify the safety condition before applying — incorrect false
dependence assertions cause silent data corruption.

The `DEPENDENCE` pragma must be injected via post-synthesis patching since Allo doesn't
expose HLS dependence directives. The patching code automatically detects the C array
variable name and block loop label in the generated kernel.cpp.

---

## 4. Cosim Debugging: FIFO Depth and Dataflow Deadlocks

### 4.1 The Column-Streaming Deadlock

RTL co-simulation deadlocked with the column-streaming architecture. The Vitis HLS
deadlock detector reported:

```
Dependence cycle:
(1) w_broadcast_0: Blocked by full output FIFO pe_w_in[3,0]
(2) pe_array_3_0:  Blocked by empty input FIFO pe_a_down[2,0]
(3) pe_array_2_0:  Blocked by empty input FIFO pe_a_down[1,0]
```

**Root cause**: `w_broadcast` uses `meta_for(AH)` to write W values to all PE rows in
the same pipeline stage. In RTL, if *any* row's FIFO is full, the entire pipeline
stalls — blocking writes to *all* rows, including row 0. This creates a cascade:

1. `pe_w_in[3]` fills up (row 3 is delayed by column-streaming cascade)
2. `w_broadcast` stalls → can't write to `pe_w_in[0]`
3. Row 0 starves (no W) → stops forwarding A to row 1
4. Rows 1, 2, 3 all stall → row 3 never consumes W → **deadlock**

### 4.2 The Fix: Deep FIFO Buffering

The FIFO depth must absorb the worst-case backlog, which includes:
- Column-streaming cascade delay: AH-1 cycles (row 3 starts 3 cycles after row 0)
- Load_buf startup latency gap: B loads faster than A (different matrix sizes)
- HLS pipeline fill time: iteration latency overhead at pipeline startup

Setting `pe_w_in` and `col_w_in` depth to `total_ops` (= num_tiles × n_inner) provides
sufficient buffering for any startup transient:

```python
pe_w_in: Stream[int32, total_ops][AH, AW]   # was: depth AH
col_w_in: Stream[int32, total_ops][AH, AW]  # was: depth AH
```

**Lesson**: In Allo/HLS dataflow, `meta_for` inside stream-connected kernels creates
*atomic multi-FIFO operations*. A blocking write to any FIFO in the group blocks all
writes. This is fundamentally different from software threading where each write is
independent. FIFO depths must account for the *maximum* backlog across all FIFOs in the
atomic group, not just the average.

**Rule of thumb for column-streaming**: If a broadcast kernel writes to N FIFOs
atomically and downstream consumers have an O(N) cascade delay, set FIFO depth to at
least 2×N + pipeline_startup_latency. For production designs, use `total_ops` depth to
guarantee deadlock freedom at modest BRAM cost.

### 4.3 Distinguishing Deadlock from Slow Simulation

Vitis HLS cosim always generates "Dependence cycle" diagnostic messages during
elaboration — these are *static analysis* of potential deadlock paths, not confirmation
of actual deadlock. To determine if a simulation is truly deadlocked:

- Check `xsim` process CPU usage: **>90% CPU = actively simulating** (healthy).
  **<1% CPU for >5 minutes = deadlocked** (stuck).
- Check the simulation log for `RTL Simulation : 0 / 1` — if stuck at 0 completed
  transactions for extended time, it's deadlocked.

---

## 5. Allo Framework Lessons

### 5.1 What Allo Does Well

- **Structural parallelism**: `df.kernel(mapping=[AH+1, AW])` creates an AH+1 × AW
  grid of independent hardware processes. This maps perfectly to spatial arrays.
- **Compile-time specialization**: `meta_if(ni == 0)` / `meta_else()` on `df.get_pid()`
  creates row-specialized PE variants without code duplication.
- **Stream abstraction**: `Stream[int32, depth][dims]` maps cleanly to HLS FIFO
  interfaces with automatic depth configuration.
- **Rapid iteration**: Python-level architecture changes (kernel split, stream
  restructuring) that would take days in manual HLS take minutes in Allo.

### 5.2 Current Allo Limitations for HLS

| Limitation | Workaround | Impact |
|---|---|---|
| No wide pointer types (`ap_uint`) | Post-synthesis kernel.cpp patching | 5× DRAM bottleneck |
| No `DEPENDENCE` pragma support | Post-synthesis patching | 12% cycle penalty |
| No per-stream depth control† | Use expression (e.g., `total_ops`) | Deadlock risk |
| No `array_partition` on DRAM args‡ | Manual `s.partition()` in schedule | Must know internal var names |
| `meta_for` instruction explosion | Column-streaming architecture | OOM for large arrays |
| LLVM JIT scales with PE count | Accept long compile times | 8×8 takes 15+ min |

†Allo Stream depth is uniform across all instances of a Stream array. Row-dependent
depths (e.g., depth=AH for row 0, depth=AH+3 for row 3) aren't supported.

‡Allo's `s.partition()` requires knowing the internal variable name in the generated
HLS code (e.g., `"output_accum_0:tile_acc"`), which couples the schedule to the
code-generation naming convention.

### 5.3 The Patching Pattern

The most impactful optimizations in this project required **post-synthesis patching** of
the generated kernel.cpp. This is a pragmatic but fragile approach:

```python
def _patch_load_bufs_for_throughput(project_dir):
    """5-step kernel.cpp patching pipeline:
    Step 1: Widen m_axi ports (max_widen_bitwidth=512)
    Step 2: Rewrite 2D int32 load_bufs with ap_uint wide pointers
    Step 2b: Rewrite 3D int8 load_bufs (birrd_inst)
    Step 3: Update top-level parameter types
    Step 4: Widen store_res functions
    Step 5: Add DEPENDENCE pragma to output_accum block loop
    """
```

Each step uses regex to match Allo's code-generation patterns. This works because
Allo's code generation is deterministic — the same Python program always produces the
same kernel.cpp structure. However, it creates a maintenance burden: any change to
Allo's code generator could break the patches.

**Recommendation**: The most impactful additions to Allo's HLS backend would be:
1. Wide pointer support for DRAM interfaces (eliminates Steps 1-4)
2. User-specified HLS pragmas on dataflow loops (eliminates Step 5)

---

## 6. Optimization Decision Framework

Based on this project's experience, here is a decision framework for optimizing
Allo/HLS dataflow designs:

### Step 1: Check the dataflow interval
Run csynth and identify the bottleneck kernel. The dataflow interval equals the
slowest kernel's latency. Optimize that kernel first.

### Step 2: Check pipeline II
For each pipelined loop, compare achieved II to target II=1. If II > 1, check the
HLS log for "II Violation" warnings. Common causes:
- **BRAM port conflicts**: Add `array_partition` (Complete for small arrays, Cyclic for
  large)
- **FIFO port conflicts**: Each FIFO supports 1 read + 1 write per cycle. Restructure
  to avoid multiple reads from the same FIFO per pipeline stage.
- **Carried dependence**: Check if inter-iteration dependence is real. If not, add
  `DEPENDENCE type=inter false`.

### Step 3: Check DRAM transfer overhead
Compare load_buf/store_res latencies to compute kernel latencies. If DRAM transfers
dominate, apply wide pointer patching.

### Step 4: Verify with cosim
Always run RTL cosimulation after optimization. Csynth cycle counts are estimates —
cosim gives the true cycle count including FIFO backpressure, pipeline bubbles, and
dataflow scheduling overhead. Watch for deadlocks caused by insufficient FIFO depths.

---

## 7. Final Results

### 4×4 Array (C[16,8] = A[16,12] × B[12,8], 24 tiles, k_passes=3)

| Metric | Value |
|---|---|
| Csynth best-case latency | **234 cycles** |
| RTL cosim latency | **878 cycles** (includes DRAM load/store) |
| RTL reference | 240 cycles (compute only) |
| Csynth vs RTL | **0.975×** (2.5% faster) |
| Clock target | 300 MHz (3.33 ns) |
| Estimated clock | 2.50 ns (meets timing) |
| BRAM_18K | 154 |
| DSP | 64 |
| FF | 67,612 |
| LUT | 76,613 |

### Cycle Breakdown (csynth, dataflow)

| Kernel | Latency | II | Notes |
|---|---|---|---|
| a_loader | 104 | 4 | Column-streaming, AW parallel |
| w_loader | 104 | 4 | Tile-pipelined, AW×AH parallel |
| w_broadcast[4] | 98 | 1 | FIFO-to-FIFO relay |
| pe_array[4,4] | 102 | 4 | Column-streaming MACs |
| pe_array gather[4] | 98 | - | Collect + send to BIRRD |
| BIRRD[3,2] | 99 | 4 | Butterfly reduction |
| output_accum | 117 | 12 | Fused accumulate + writeback |
| load_buf0 (A) | 26 | 1 | Wide pointer, 16 rows |
| load_buf3 (B) | 22 | 1 | Wide pointer, 12 rows |
| store_res13 (C) | 24 | 1 | Wide pointer, 16 rows |
