# TICKET-015: Reduce w_loader pipeline II from 16 to 1

## Status: DONE

## Result

Option C3 implemented with nested `meta_for(AW) × meta_for(AH)` in w_loader.
Split fused `nk_row` loop into `for nk in range(AH)` + `meta_for(AH) as pe_row`.
`col_w_in` changed from `Stream[int32, AH*AH][AW]` to `Stream[int32, AH][AH, AW]`.

| Metric | Before | After |
|--------|--------|-------|
| w_loader II | 16 | **4** |
| w_loader latency | 394 cycles | **106 cycles** (3.7x) |
| w_broadcast latency | 386 cycles | **98 cycles** (3.9x) |
| Dataflow interval | 395 | **351** (bounded by B DRAM load) |
| Top-level | 806 cycles | **766 cycles** |

New bottleneck: `load_buf1_1` (B DRAM→BRAM, 351 cycles interval).

## Problem

After TICKET-014, the 4×4 csynth achieves 806 cycles (down from 1,523). The
w_loader kernel is the dataflow bottleneck at 394 cycles (interval 395). Its
inner pipeline `l_S_tile_0_tile1` achieves II=16 against a target of 1.

**Root cause**: The `nk_row` loop (AH×AH=16 iterations) is fully unrolled by
the tile-level pipeline pragma. This creates 16 FIFO write operations per
`col_w_in[nj]` port per pipeline iteration. Each FIFO has 1 write port, so
16 writes must be serialized → II≥16.

From the Vitis log:
```
Unable to enforce a carried dependence constraint (II = 1, distance = 1, offset = 1)
between fifo write operation ('v1424_write_ln374') on port 'v1424'
and fifo write operation ('v1424_write_ln374') on port 'v1424'
```

The BRAM port bottleneck (II=32 before TICKET-014 Complete partition fix) is
fully resolved — no memory port violations remain.

## Current Architecture

```
w_loader (mapping=[1]):
  for tile in range(num_tiles):         ← pipelined (s.pipeline("w_loader_0:tile"))
    [instruction decode: 6 inst_w reads, log2_Gr if-chain]
    for inner in range(n_inner):        ← flattened with tile (trip count = 24)
      for nk_row in range(AH * AH):    ← fully unrolled (16 iterations)
        meta_for(AW):                   ← 4 parallel hardware copies
          B read + col_w_in[nj].put()
```

- Trip count: 24 (tile × inner flattened; nk_row unrolled)
- II: 16 (16 FIFO writes per port per iteration)
- Latency: 16 × 23 + 22 = 390 cycles (pipeline) + 4 (overhead) = 394

## Target

Reduce II to 1–4, bringing w_loader to ~100–200 cycles. This would shift the
dataflow bottleneck to w_broadcast (386 cycles) or output_accum (216 cycles).

## Options

### Option A: Split nk_row, pipeline nk (not tile)

Split the fused `nk_row` loop back into `nk` + `pe_row`. Pipeline `nk` instead
of `tile`. HLS unrolls only `pe_row` (innermost, 4 iters), keeping `nk` as a
pipelined loop.

```
w_loader:
  for tile in range(num_tiles):         ← outer loop (not pipelined)
    [instruction decode]
    for inner in range(n_inner):
      for nk in range(AH):             ← pipelined
        for pe_row in range(AH):       ← unrolled (4 iters)
          meta_for(AW):
            B read + col_w_in[nj].put()
```

**Expected II**: 4 (4 FIFO writes per port from pe_row unrolling).
**Expected trip count per tile**: 4 (nk iterations).
**Per-tile overhead**: ~10 cycles (instruction decode: 6 inst_w reads on 2-port
BRAM = 3 cycles + log2_Gr if-chain ~3 cycles + loop setup ~4 cycles).
**Total**: 24 tiles × (4×3 + 10 + 4) ≈ 24 × 26 = 624 cycles.

**Pros**: Simple code change (loop split + pipeline target). No new arrays.
**Cons**: Per-tile overhead dominates (240 of 624 cycles). Worse than current
394 if the overhead estimate is too optimistic.

**Risk**: HLS might not achieve II=4 if the 16 B reads (4 pe_row × 4 meta_for)
cause port conflicts even with Complete partition. Need to verify.

### Option B: Single flat loop (fuse all levels)

Fuse tile, inner, nk, pe_row into a single loop with trip count =
num_tiles × n_inner × AH × AH = 384. Derive tile/nk/pe_row indices from the
loop counter using bit operations. Pipeline this single loop.

```
w_loader:
  weights_zp = inst_w[1, 6]
  for step in range(num_tiles * n_inner * AH * AH):   ← pipelined, trip=384
    tile_idx = step >> (LOG2_AH + LOG2_AH)             ← bit ops
    nk_pe    = step & (AH * AH - 1)
    nk_val   = nk_pe >> LOG2_AH
    pe_row   = nk_pe & (AH - 1)
    [instruction decode every iteration]
    meta_for(AW):
      B read + col_w_in[nj].put()
```

**Expected II**: Limited by inst_w reads. Each iteration needs Gr, Gc, sr, sc,
k_start_tile (5 values) from inst_w (2-port BRAM) + n_start from
loader_n_start (1-port BRAM). That's ceil(5/2) + 1 = 4 cycles minimum.
**Total**: 4 × 384 + pipeline fill ≈ 1540 cycles. **Much worse.**

**To achieve II=1**: Must eliminate per-iteration inst_w reads. Options:
- Precompute instruction fields into separate Complete-partitioned arrays
  (register access, 0 port conflicts).
- Cache instruction values and only re-read at tile boundaries (needs
  persistent state across iterations — Allo's SSA semantics make this hard).

### Option B2: Flat loop + precomputed instruction arrays

Before the main loop, decode all instructions into small arrays partitioned
Complete (registers). Main loop reads from registers → no port conflicts.

```
w_loader:
  weights_zp = inst_w[1, 6]

  # Precompute (separate pipelined loop, ~24 iterations)
  Gr_arr:   int32[num_tiles]   # Complete partition → registers
  sr_arr:   int32[num_tiles]
  sc_arr:   int32[num_tiles]
  kst_arr:  int32[num_tiles]
  lg2_arr:  int32[num_tiles]
  mgc_arr:  int32[num_tiles]
  for t in range(num_tiles):
    Gr_arr[t]  = inst_w[t+3, 3]
    sr_arr[t]  = inst_w[t+3, 5]
    sc_arr[t]  = inst_w[t+3, 6]
    kst_arr[t] = inst_w[t+3, 11]
    [compute log2_Gr, mask_Gc, store in lg2_arr, mgc_arr]

  # Main loop
  for step in range(num_tiles * n_inner * AH * AH):   ← pipelined, trip=384
    tile_idx = step >> (LOG2_AH + LOG2_AH)
    nk_val   = (step >> LOG2_AH) & (AH - 1)
    pe_row   = step & (AH - 1)
    op_idx   = tile_idx * n_inner + (step >> (LOG2_AH + LOG2_AH)) & (n_inner - 1)
    n_start  = loader_n_start[op_idx]                  ← 1 BRAM read
    sr       = sr_arr[tile_idx]                        ← register (Complete)
    sc       = sc_arr[tile_idx]                        ← register
    ...
    meta_for(AW):
      B read + col_w_in[nj].put()
```

**Expected II**: 1 if all instruction arrays are Complete-partitioned (register
access). The only BRAM read is loader_n_start[op_idx] — 1 read on 1-port BRAM.
But op_idx only changes every AH×AH=16 steps, so HLS may share the read.
If not shared: II=1 (1 BRAM read on 1 port, 1 B register read, 1 FIFO write —
all independent resources).
**Total**: 384 + pipeline fill (~22) + precompute (~30) ≈ 436 cycles.

With II=1: 384 + 22 + 30 = 436 cycles (worse than current 394 due to
precompute overhead and pipeline fill on 384 iterations vs 24).

**Hmm**: Even at II=1, trip count 384 > current II=16 × 24 = 384 effective.
So II=1 with 384 trip count is roughly equal to II=16 with 24 trip count.
The improvement only comes from reducing pipeline fill (22 vs 22) — negligible.

**Key insight**: Total work = II × trip_count + fill. Currently: 16 × 24 + 22
= 406. Option B2: 1 × 384 + 22 = 406. **Identical.** The bottleneck is
fundamental: 384 FIFO writes must be serialized per port.

### Option C: Reduce total FIFO writes per port

The fundamental constraint: w_loader writes AH×AH values per col_w_in[nj] per
tile (AH nk cycles × AH pe_rows). With 24 tiles × 16 values = 384 total writes
per FIFO. At 1 write/cycle, minimum = 384 cycles. Current = 390 (near optimal).

**To do better than 384**: Reduce the number of writes per FIFO. Options:

**C1: Wider FIFO data (pack multiple values per write)**
Pack 2 or 4 W values into a single int64 or int128 FIFO write. This requires
changing the FIFO type and unpacking in w_broadcast.

- Pack 2 values (int64): 384 → 192 writes/FIFO → ~192 cycles
- Pack 4 values (int128): 384 → 96 writes/FIFO → ~96 cycles

**Feasibility**: Allo Stream supports int32 only? Need to verify if wider types
(int64, int128) work with `Stream[int64, depth]`. The w_broadcast kernel would
unpack: read 1 int64, extract 2 int32 values, write to 2 pe_w_in FIFOs.

**C2: Eliminate w_broadcast, widen col_w_in to carry packed data**
If col_w_in carries packed AH values per write (one int32×AH packet per nk
cycle), w_loader does AH writes per FIFO per tile instead of AH×AH. Total:
24 × 4 = 96 writes. But packing AH int32 values into one FIFO element requires
a 128-bit (AH=4) or 512-bit (AH=16) type.

**C3: Multiple output FIFOs per column**
Instead of 1 col_w_in[nj] per column, use AH FIFOs per column:
col_w_in[pe_row, nj]. w_loader writes to AH different FIFOs per nk cycle
(1 write each). With AH FIFOs having independent write ports, all AH writes
happen in 1 cycle. Total writes per FIFO: 24 × AH = 96 (not 384). II could
drop to 1 with trip count 96.

This is equivalent to replacing `col_w_in: Stream[..][AW]` with
`col_w_in: Stream[..][AH, AW]` — a 2D stream array. w_loader writes to
col_w_in[pe_row_val, nj] instead of col_w_in[nj]. w_broadcast reads from
col_w_in[row, nj] and writes to pe_w_in[row, nj].

**Expected**: Trip count stays 24 (tile-level pipeline, nk_row unrolled).
But now each iteration writes 16 values to 16 DIFFERENT FIFOs (4 pe_row × 4 nj),
each getting only 1 write → II=1 for FIFO writes. B reads: Complete partition →
no conflict. **II=1, trip count 24, total = 24 + 22 = 46 cycles!**

Wait — with 16 different FIFOs (col_w_in[AH, AW] = [4,4]), each nk_row
iteration writes to col_w_in[pe_row_val, nj]. For the 16 unrolled nk_row iters:
- (nk=0,pe_row=0): writes to col_w_in[0, nj]
- (nk=0,pe_row=1): writes to col_w_in[1, nj]
- (nk=0,pe_row=2): writes to col_w_in[2, nj]
- (nk=0,pe_row=3): writes to col_w_in[3, nj]
- (nk=1,pe_row=0): writes to col_w_in[0, nj] ← **conflict with nk=0,pe_row=0!**

Each pe_row value appears AH=4 times (once per nk). So each col_w_in[pe_row, nj]
gets 4 writes per iteration → II≥4. Still better than 16!

**Expected**: II=4, trip count 24, total = 4 × 23 + 22 = 114 cycles + overhead.
w_loader ≈ 120 cycles (vs current 394).

**Pros**: 3× improvement. No packing/unpacking complexity.
**Cons**: AH×AW = 16 col_w_in FIFOs (vs 4 currently). For 16×16: 256 FIFOs.
w_broadcast changes from [AW] to [AH, AW] mapping or stays [AW] with AH reads.

## Recommendation

**Option C3 (2D col_w_in streams)** is the most promising:
- Reduces II from 16 → 4 by distributing writes across AH FIFOs per column
- w_loader: ~120 cycles (vs 394 current, 3.3× improvement)
- Top-level: ~530 cycles (vs 806 current), bounded by w_broadcast (386)
- Simple implementation: change col_w_in from [AW] to [AH, AW], update
  w_loader/w_broadcast addressing
- Scales to 16×16 (256 FIFOs is within HLS limits for stream arrays)

Options A and B/B2 don't help because total serialized work (384 writes) is
unchanged — they just redistribute the same work between II and trip count.

Option C1/C2 (wider FIFO packing) could achieve II=1 but requires non-standard
Allo types and adds packing/unpacking logic.

## Implementation Plan (Option C3)

### Step 1: Change stream declaration
```python
# Before:
col_w_in: Stream[int32, AH * AH][AW]
# After:
col_w_in: Stream[int32, AH][AH, AW]  # depth=AH (was AH*AH)
```
Depth drops from AH×AH to AH because each FIFO now carries only AH values per
tile (one per nk cycle) instead of AH×AH.

### Step 2: Update w_loader writes
```python
# Before:
col_w_in[nj].put(w_val)
# After (nk_row still fused):
col_w_in[pe_row_val, nj].put(w_val)
```

### Step 3: Update w_broadcast reads
```python
# Before:
@df.kernel(mapping=[AW])
def w_broadcast():
    nj = df.get_pid()
    for _op in range(total_ops):
        for nk in range(AH):
            with allo.meta_for(AH) as row:
                w_val = col_w_in[nj].get()
                pe_w_in[row, nj].put(w_val)

# After:
@df.kernel(mapping=[AW])
def w_broadcast():
    nj = df.get_pid()
    for _op in range(total_ops):
        for nk in range(AH):
            with allo.meta_for(AH) as row:
                w_val = col_w_in[row, nj].get()
                pe_w_in[row, nj].put(w_val)
```
Each w_broadcast instance (per column nj) reads from AH separate FIFOs
(col_w_in[0..AH-1, nj]) instead of 1 FIFO (col_w_in[nj]). Since row is
meta_for (compile-time), each read is from a distinct FIFO port — no conflicts.

### Step 4: Keep pipeline and partition directives unchanged
- `s.pipeline("w_loader_0:tile")` — same as current
- B partition: Complete for small arrays, Cyclic for large — same as current

### Verification
```bash
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json           # functional
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn # csynth
```
Target: w_loader II=4, ~120 cycles. Top-level ~530 cycles.

## Current Kernel Latencies (4×4 reference)

| Kernel | Latency | Interval | Notes |
|--------|---------|----------|-------|
| w_loader_0 | 394 | 394 | **Bottleneck** (II=16) |
| w_broadcast_0..3 | 386 | 386 | Next bottleneck |
| output_accum_0 | 216 | 216 | |
| a_loader_0 | 201 | 201 | |
| pe_array_0_0..3_3 | 102 | 102 | |
| BIRRD_0_0..2_1 | 99 | 99 | |
| pe_array_4_0..4_3 | 98 | 98 | Gather row |
| load_buf1_1 (B) | 361 | 351 | DRAM→BRAM |
| Dataflow interval | — | 395 | |
| **Top-level** | **806** | — | load_buf(361) + w_loader(394) |
