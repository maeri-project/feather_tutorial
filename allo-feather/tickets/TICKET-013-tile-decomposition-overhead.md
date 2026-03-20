# TICKET-013: Excessive tile decomposition — 192 tiles instead of 3

## Status: RESOLVED

## Resolution

Implemented Option A — inner N-loop and M-batching inside the tile. Key changes:

1. **feather_minisa.py**: Added `n_inner` parameter to `get_feather_full_matrix_top_kstreaming()`.
   When n_inner > 1, each ISA tile contains n_inner sub-operations with different
   (m_start, n_start) stored in DRAM lookup tables (loader_m_start, loader_n_start for
   dram_loader; accum_m_start, accum_n_start for output_accum — separate buffers for
   HLS single-reader compliance). All 5 kernels updated:
   - dram_loader: outer tile loop + inner n_inner loop, reads per-op m/n from DRAM
   - pe_array: loop bound = total_ops (num_tiles * n_inner), transparent to inner structure
   - inst_rw: repeats each tile's BIRRD instruction n_inner times
   - BIRRD: loop bound = total_ops, same switch config per tile's sub-operations
   - output_accum: outer tile loop + inner n_inner loop, per-tile col_map/num_m/n_base

2. **trace_parser.py**: `parse_trace()` now produces only k_passes tiles (3 for this
   workload) instead of 192. Temporal M/N iteration is folded into n_inner = n_spatial_tiles
   * n_m_batches * n_sub_tiles = 64. Each tile's instruction covers the full M and N range
   (for the reference test's block-GEMM). Per-op lookup tables generated for m_start/n_start.

3. **test_trace_input.py**: Updated HLS build paths, cosim testbench, and deploy data
   generation to pass n_inner and inner_params through.

Backward compatible: n_inner defaults to 1. All existing tests (create_gemm_program,
parse_minisa_trace, parse_manual_trace, Figure 7, crossbar flexibility) unchanged.

Result: 192 tiles → 3 tiles with 64 inner iterations each (same 192 total compute ops)

## Problem

The trace parser (`minisa/trace_parser.py:169-187`) decomposes the RTL's 3
ExecuteMapping entries into **192 MINISA tiles** for the M=24, K=48, N=512
workload on a 16x16 array. This produces a csynth latency of **946,523 cycles**
vs the RTL reference of **3,025 cycles** (313x worse).

The decomposition is a 4-deep nested loop:

```python
for n_tile in range(n_spatial_tiles):     # 2
    for m_batch in range(n_m_batches):    # 2  (M_padded=32, Mt=Gr=16)
        for n_sub in range(n_sub_tiles):  # 16 (Nt=256, AH=16)
            for k_tile in range(k_passes):# 3  (K=48, Kt_per_pass=16)
                program.add_mapping(...)  # = 2*2*16*3 = 192 tiles
```

## Root Cause

The current PE model processes exactly **AH elements per tile** in the inner
loop (`feather_minisa.py:213-218`):

```python
for tile in range(num_tiles):
    tile_accum: int32 = 0
    for nk in range(AH):           # fixed at AH=16 MACs
        a_val = pe_a_in[ni, nj].get()
        w_val = pe_w_in[ni, nj].get()
        tile_accum += a_val * w_val
    pe_out[ni, nj].put(tile_accum)
```

Each tile covers a fixed region: Gr M-rows, AH N-columns, and Kt_per_pass=(AW/Gr)*AH
K-elements. There is no temporal iteration within a tile. So to cover
256 N-columns, the trace parser creates 256/16 = 16 N-sub-tiles per EM.

The RTL handles this differently: each ExecuteMapping covers **all Nt=256
N-columns** via WVN temporal iteration (N_L1 = Nt/AH = 16 iterations inside
the hardware). The VN buffers rotate through N-columns without creating new
tiles. Similarly, M-batching (IVN M_L1=2) is done inside the EM.

In other words: the RTL has 3 EMs because temporal looping over M and N happens
**inside** each EM. Our model has no temporal looping inside a tile, so it must
create separate tiles for every (m_batch, n_sub, k_pass) combination.

## Impact

Each tile must traverse the full dataflow pipeline:
dram_loader → pe_array → gather → BIRRD → output_accum.

With 192 tiles, the per-tile pipeline stall/synchronization overhead dominates.
The dram_loader itself streams continuously, but the tile boundary
synchronization (each PE waits for all AH values, gather collects, BIRRD
processes, output_accum writes) must happen 192 times instead of 3.

Additionally, the 192-tile instruction array is baked into the HLS design as
compile-time loop bounds, bloating the generated kernel.cpp (17K+ lines,
147K HLS instructions before optimization).

## Proposed Fix

Add temporal N-iteration and M-batching **inside** the tile, matching the RTL's
VN buffer behavior. Each tile would then process the full Nt N-columns and
all M-batches, with only K-decomposition creating separate tiles.

### Option A: Inner N-loop in dram_loader + pe_array

Add a loop over `n_sub` inside `dram_loader`'s per-tile body:

```python
for tile in range(num_tiles):       # 3 tiles (K-decomposition only)
    # ... decode tile params ...
    for n_sub in range(Nt // AH):   # 16 N-iterations per tile
        for m_batch in range(n_m_batches):  # 2 M-batches per tile
            # load buffers and stream to PEs for this (n_sub, m_batch)
```

The PE accumulator resets per (n_sub, m_batch) iteration. Gather and BIRRD
process AH outputs per iteration as before. Output_accum writes to the
correct (m, n) location using the iteration indices.

This reduces tiles from 192 to 3. Each tile does 16*2=32 internal iterations
of the same pipeline work, but without inter-tile synchronization overhead.

**Challenge**: The inner loop bounds (Nt//AH, n_m_batches) vary per tile in
the general case. They could be encoded in the instruction word, or we could
require them to be uniform across tiles (which they are for this workload).

### Option B: Encode temporal loops in ISA

Extend the SetMapping instruction to include `n_iterations` and `m_iterations`
fields. The hardware (dram_loader) reads these from the instruction and loops
internally. This is closer to the RTL's VN approach where the temporal loop
counts are part of the mapping configuration.

### Option C: Two-level tile structure

Keep the current single-pass tile model but add a "tile group" concept where
consecutive tiles sharing the same EM are fused into a single pipeline
invocation with internal looping. This avoids changing the ISA but requires
the dataflow kernels to detect tile boundaries.

## Recommendation

Option A is the most straightforward — it matches the RTL's structure directly
and requires no ISA changes. The dram_loader already has on-chip buffers
(iacts_buf, weight_buf) that can be reloaded per N-iteration without DRAM
re-reads for weights (stationary buffer reuse within a tile).

## Verification

After fixing, re-run csynth with the same trace:

```bash
python /scratch/nz264/run_16x16_csynth_unified.py
```

Expected: ~3K cycles (matching RTL reference of 3,025), with only 3 tiles.
