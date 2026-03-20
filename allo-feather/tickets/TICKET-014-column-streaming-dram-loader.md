# TICKET-014: Column-streaming dram_loader for scalable HLS synthesis

## Status: OPEN

## Problem

The 16×16 FEATHER+ design fails csynth — Clang's optimization pass exceeds
18 GB RAM and gets OOM-killed. The 4×4 design (743 cycles) synthesizes fine.

The csynth_design_size.rpt pinpoints the bottleneck:

| Function | Compile/Link | Array/Struct | % of total |
|---|---|---|---|
| **dram_loader_0** | **160,908** | **320,180** | **91%** |
| output_accum_0 | 2,322 | 7,726 | 2.2% |
| All 272 PE instances | ~67,000 | ~8,000 | 2.3% |
| All 64 BIRRD instances | ~30,000 | ~2,400 | 0.7% |

The PE array, BIRRD, and output_accum are all fine. `dram_loader_0` alone
accounts for 91% of instructions after array partition expansion.

## Root Cause

The current dram_loader streams directly to **every individual PE** via
`pe_a_in[AH, AW]` and `pe_w_in[AH, AW]` — that's AH×AW = 256 stream
bundles for a 16×16 array. The inner loop has:

```python
for nk in range(AH):
    with allo.meta_for(AW) as nj:          # 16 parallel columns
        a_val = local_A[m_idx, k_idx]
        with allo.meta_for(AH) as pe_row:  # 16 parallel rows
            w_val = local_B[k_idx, wn_idx]
            pe_a_in[pe_row, nj].put(a_val)   # 256 stream puts
            pe_w_in[pe_row, nj].put(w_val)   # 256 stream puts
```

`meta_for(AW=16) × meta_for(AH=16)` generates 256 parallel code paths in a
single function. Each path reads from partitioned arrays `local_A` and
`local_B`, creating bank-select logic that is replicated 256 times. This
produces 160K instructions at Compile/Link and 320K after array partition
expansion — too large for Vitis HLS's Clang optimizer.

**This does not match the RTL architecture.** Per Figure 2 of the MINISA
paper, the all-to-all crossbar connects to the **top of each column**, not to
every individual PE. Input activations and weights are streamed **down through
the column** from PE[0,j] to PE[AH-1,j]. The dram_loader should only produce
AW output streams (one per column), not AH×AW.

## Analysis of Current Access Patterns

Looking at the inner loop (lines 204–212 of feather_minisa.py):

- **A (activations)**: `a_val` depends on `nj` (column) but NOT on `pe_row`.
  The same A value is broadcast to all PEs in a column. This is a natural
  fit for column streaming — send one A value to the top of the column and
  let it propagate down.

- **W (weights)**: `w_val` depends on `pe_row` via
  `wn_idx = n_start + sr * pe_row + sc * (nj & mask_Gc)`.
  Each PE in a column needs a **different** W value. The dram_loader must
  send AH weight values per column per cycle, and each PE peels off its
  value as data streams down.

## Proposed Solution: Column-Streaming Architecture

Replace the AH×AW direct-to-PE streams with AW column streams. Data flows
down each column through inter-PE streams.

### Stream Changes

Replace:
```python
# Current: AH×AW = 256 stream bundles
pe_a_in: Stream[int32, AH][AH, AW]
pe_w_in: Stream[int32, AH][AH, AW]
```

With:
```python
# Column input streams: dram_loader -> top of each column (AW streams)
col_a_in: Stream[int32, AH][AW]       # 1 A value per column per nk cycle
col_w_in: Stream[int32, AH * AH][AW]  # AH W values per column per nk cycle

# Inter-PE column streams: PE[row] -> PE[row+1]
pe_a_down: Stream[int32, AH][AH, AW]  # A forwarded down column
pe_w_down: Stream[int32, AH * AH][AH, AW]  # remaining W values forwarded down
```

### dram_loader Changes

Remove `meta_for(AH)` from the inner loop. Only iterate over columns:

```python
for nk in range(AH):
    with allo.meta_for(AW) as nj:              # 16 parallel columns (NOT 256)
        # A: one value per column (same for all PEs in column)
        m_idx = m_start + (nj & mask_Gr)
        k_idx = k_start_tile + nk + (nj >> log2_Gr) * AH
        a_val = local_A[m_idx, k_idx] - iacts_zp
        col_a_in[nj].put(a_val)

        # W: AH values per column (one per PE row)
        for pe_row in range(AH):
            wn_idx = n_start + sr * pe_row + sc * (nj & mask_Gc)
            w_val = local_B[k_idx, wn_idx] - weights_zp
            col_w_in[nj].put(w_val)
```

This reduces dram_loader from `meta_for(AW) × meta_for(AH)` = 256 parallel
paths to `meta_for(AW)` = 16 parallel paths — a **16× reduction**.

Estimated instruction counts:
- Compile/Link: ~160K → ~10K (16× reduction from removing meta_for(AH))
- Array/Struct: ~320K → ~20K (partition bank-select replicated 16× not 256×)

### pe_array Changes

Each compute PE (rows 0..AH-1) reads from the PE above (or column input for
row 0) and forwards to the PE below:

```python
ni, nj = df.get_pid()

with allo.meta_if(ni < AH):  # compute PEs
    for _op in range(total_ops):
        tile_accum: int32 = 0
        for nk in range(AH):
            # Row 0 reads from column input; rows 1+ read from PE above
            if ni == 0:
                a_val = col_a_in[nj].get()
                w_val = col_w_in[nj].get()    # peel off first W
                # forward remaining AH-1 W values to PE below
                for fwd in range(AH - 1):
                    w_fwd = col_w_in[nj].get()
                    pe_w_down[ni, nj].put(w_fwd)
            else:
                a_val = pe_a_down[ni - 1, nj].get()
                w_val = pe_w_down[ni - 1, nj].get()  # peel off first W
                # forward remaining AH-1-ni W values to PE below (if not last row)
                if ni < AH - 1:
                    for fwd in range(AH - 1 - ni):
                        w_fwd = pe_w_down[ni - 1, nj].get()
                        pe_w_down[ni, nj].put(w_fwd)

            # forward A down the column (all rows except last)
            if ni < AH - 1:
                pe_a_down[ni, nj].put(a_val)

            tile_accum += a_val * w_val
        pe_out[ni, nj].put(tile_accum)
```

**Note**: The W forwarding pattern above assumes dram_loader sends W values
in row order (row 0 first, row AH-1 last). PE at row `i` peels off its own
W and forwards the remaining `AH-1-i` values. This creates a triangular
forwarding pattern. An alternative is to send all AH weights to every PE and
have each PE index into its own value (simpler but more data movement).

### Alternative: Simpler W Broadcast

Instead of the triangular peel-off pattern, broadcast all AH W values through
the column and have each PE select its own:

```python
# dram_loader sends AH W values per column per nk cycle
# Each PE reads all AH values, uses only its own (index ni)

for nk in range(AH):
    a_val = pe_a_down[ni-1, nj].get()  # or col_a_in for row 0
    for row in range(AH):
        w_candidate = pe_w_down[ni-1, nj].get()  # or col_w_in for row 0
        if row == ni:
            w_val = w_candidate
        # forward to PE below
        if ni < AH - 1:
            pe_w_down[ni, nj].put(w_candidate)
    tile_accum += a_val * w_val
```

This is simpler but each PE reads/forwards AH values per cycle instead of
only the values it needs. Since PE instances are separate dataflow kernels
(26 instructions each), the overhead per PE is small.

## Impact on Other Kernels

- **pe_array gather (row AH)**: Unchanged — still collects from pe_out.
- **BIRRD**: Unchanged — still reads from connection streams.
- **output_accum**: Unchanged — still reads BIRRD output.
- **inst_rw**: Unchanged.

Only dram_loader and compute PEs (rows 0..AH-1) change.

## Verification

### Test 1: 4×4 functional + csynth regression
```bash
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json
python tests/test_trace_input.py instr_trace/figure7_16x12x8_4x4.json --hls csyn
```
Target: PASS, 743 cycles.

### Test 2: 16×16 csynth (the blocker)
```bash
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json --hls csyn
```
Target: synthesis completes (any cycle count). Compare with RTL ref (3,025 cycles).

### Test 3: 16×16 functional
```bash
python tests/test_trace_input.py instr_trace/trace_m24k48n512_16x16.json
```
Target: PASS.

## Risk

- The W streaming order must be consistent between dram_loader and PE
  forwarding. Off-by-one or ordering bugs will produce wrong GEMM results.
  Functional test (Test 3) catches this.
- The `meta_if(ni == 0)` vs `meta_else` branching for row-0 vs other rows
  may need careful handling with Allo's meta programming. Test with 4×4 first.
- Column streaming adds AH-1 forwarding latency per column (pipeline depth).
  This should be hidden by dataflow pipelining but may affect II in edge cases.
