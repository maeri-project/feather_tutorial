# FEATHER+ Csynth vs. Cosim Accuracy Analysis

**Date**: 2026-03-16
**Architecture**: data_scatter(1) + nest_pe[AH,AW] + gather(1) + BIRRD[P0,P1] + output_accum(1) + inst_rw(1)

## 4x4 Array: Csynth vs. Cosim (Verified)

| Metric | Csynth Estimate | Cosim Actual | Ratio |
|--------|-----------------|--------------|-------|
| **Overall latency** | 1,027-1,029 cycles | **1,182 cycles** | cosim is 1.15x csynth |
| Absolute time | 3.42 us | 3.94 us | (at 300 MHz) |
| Dataflow interval | 657 cycles | -- | |
| DSP count | 50 | 50 | same |
| BRAM_18K | 24 | 24 | same |
| Cosim status | -- | **Pass** | functionally correct |

- **Workload:** C[8,8] = A[8,16] x B[16,8], AW=4, AH=4
- **Mapping:** Gr=2 (BIRRD 2-way reduction), 16 tiles, max_k_passes=1
- **Clock:** 3.33 ns target, 2.541 ns estimated (no timing violations)
- **Device:** xcu280-fsvh2892-2L-e (Alveo U280)
- **Build time:** 2.5 min total (LLVM JIT + csynth + cosim)

### Per-Kernel Csynth Latency (4x4)

| Kernel | Latency (cycles) | Interval | Role |
|--------|-----------------|----------|------|
| **output_accum** | **656** | 656 | Col remap + tile accumulation into C -- **pipeline bottleneck** |
| **data_scatter** | **524** | 524 | Read A/B/inst, compute crossbar, stream to 16 PEs |
| load_buf2 (inst_pe) | 256 | 247 | DRAM load for inst_pe (19x13 instruction array) |
| load_buf0 (A_pe) | 137 | 128 | DRAM load for A (8x16 int32) |
| load_buf1 (B_pe) | 137 | 128 | DRAM load for B (16x8 int32) |
| load_buf3 (birrd) | 105 | 96 | DRAM load for BIRRD instructions |
| load_buf4, load_buf6 | 73 | 64 | DRAM load for output_col_map, output_n_base |
| store_res10 (C) | 71-72 | 64 | Write C[8,8] to DRAM |
| **nest_pe** (each of 16) | **70** | 70 | Spatial PE: accumulate a*w over tiles and k_passes |
| **BIRRD** (each of 6) | **67** | 67 | Butterfly switch (3 stages x 2 switches, P0=3, P1=2) |
| **gather** | **66** | 66 | Collect 16 PE outputs into BIRRD |
| load_buf5, 7, 8 | 25 | 16 | Small metadata loads (output_num_m, etc.) |
| load_buf9 (accum_params) | 27 | 18 | Quant params + per-tile sr values |
| **inst_rw** | **18** | 18 | Distribute BIRRD per-tile switch instructions |
| entry_proc | 0 | 0 | Startup |

**Dataflow critical path:** Csynth identifies output_accum (656 cycles) as the pipeline bottleneck, with a dataflow interval of 657 cycles. The full sequential sum through the pipeline would be data_scatter(524) + nest_pe(70) + gather(66) + BIRRD(67) + output_accum(656) = 1,383 cycles, but dataflow overlap reduces it to 1,027-1,029.

### Why Cosim is 15% Higher

Csynth reports **1,029 cycles** (worst case). Cosim measures **1,182 cycles**. The 153-cycle gap (15%) comes from:

1. **FIFO handshaking overhead**: Each stream put/get requires handshake signals that add latency between kernels
2. **Pipeline fill latency**: data_scatter must produce AH=4 elements before the first PE can complete its tile accumulation
3. **Pipeline drain**: After data_scatter finishes its last tile, the results still propagate through gather -> BIRRD -> output_accum
4. **Backpressure stalls**: When output_accum (656 cycles) processes slower than upstream kernels produce, FIFOs back up and stall producers

This 15% gap is consistent with the older figure7 8x4 design (csynth 907, cosim 1,052 = 16% gap), suggesting it is a structural characteristic of the Allo-generated dataflow architecture.

### Resource Utilization (4x4)

| Resource | Count | SLR Avail | Util% |
|----------|-------|-----------|-------|
| DSP | **50** | 3,008 | 1.7% |
| BRAM_18K | 24 | 1,344 | 1.8% |
| FF | 29,277 | 869,120 | 3.4% |
| LUT | 35,665 | 434,560 | 8.2% |

**DSP breakdown:** 16 PEs x 3 DSP/PE = 48 (nest_pe) + 1 (output_accum mul) + 1 (load_buf2 addr) = 50 total.

---

## 16x16 Array: Csynth Estimate (Cosim Running)

| Metric | Csynth Estimate | Cosim (in progress) |
|--------|-----------------|---------------------|
| **Overall latency** | **12,607,515** cycles | Running (XSIM at 0%) |
| Absolute time | 41.98 ms | -- |
| Dataflow interval | 12,582,930 cycles | -- |
| DSP count | 775 | -- |
| BRAM_18K | 192 | -- |
| LUT | 464,490 **(106% of SLR!)** | -- |

- **Workload:** C[32,512] = A[32,48] x B[48,512], AW=16, AH=16
- **Mapping:** Gr=8, 64 tiles, max_k_passes=3 (from RTL trace m24k48n512)
- **Note:** M is padded from 24 to 32 (next multiple of Gr=8)
- **Note:** LUT exceeds single SLR capacity. Multi-SLR partitioning needed for deployment.

### Per-Kernel Csynth Latency (16x16)

| Kernel | Latency (cycles) | Notes |
|--------|-----------------|-------|
| **data_scatter** | **12,582,929** | **Massive bottleneck** -- 99.8% of total |
| output_accum | 84,107 | 0.67% of total |
| load_buf1 (B matrix) | 24,585 | 48x512 = 24,576 int32 elements |
| store_res10 (C) | 16,391 | 32x512 = 16,384 int32 elements |
| nest_pe (each of 256) | 3,079 | 64 tiles x 3 k_passes x 16 AH = 3,072 MACs + overhead |
| load_buf3 (BIRRD inst) | 4,105 | 64 tiles x P0=8 x P1=8 int8 |
| load_buf0 (A matrix) | 1,545 | 32x48 = 1,536 int32 elements |
| BIRRD (each of 64) | 1,027 | 8 stages x 8 switches (P0=8, P1=8) |
| gather | 1,026 | 256 PE outputs x 64 tiles x AH rows |
| load_buf4 (col_map) | 1,033 | 64 tiles x 16 cols |
| load_buf2 (inst_pe) | 880 | 67x13 instruction array |
| inst_rw | 66 | |

**16x16 bottleneck analysis:** data_scatter at 12.6M cycles completely dominates (99.8% of total). This is because it processes:
- 64 tiles x 3 k_passes x 16 AH steps = 3,072 outer iterations
- Each iteration computes 256 (a-zp, w-zp) pairs via AH x AW inner loop
- Per-value work: conditional check + address computation + A read + B read + zero-point subtraction
- 12,582,929 / 3,072 = ~4,096 cycles per outer iteration => ~16 cycles per PE per step

### Resource Utilization (16x16)

| Resource | Count | SLR Avail | Util% SLR | U280 Total | Util% |
|----------|-------|-----------|-----------|-----------|-------|
| DSP | **775** | 3,008 | 25.8% | 9,024 | 8.6% |
| BRAM_18K | 192 | 1,344 | 14.3% | 4,032 | 4.8% |
| FF | 408,790 | 869,120 | 47.0% | 2,607,360 | 15.7% |
| LUT | 464,490 | 434,560 | **106.9%** | 1,303,680 | 35.6% |
| URAM | 1 | 320 | ~0% | 960 | ~0% |

**DSP breakdown:** 256 PEs x 3 DSP/PE = 768 + 3 (data_scatter) + 3 (output_accum) + 1 (load_buf) = 775.

---

## Cross-Design Comparison

### Cycle Count Accuracy

| Design | Array | Workload | Csynth (worst) | Cosim (actual) | Gap |
|--------|-------|----------|----------------|----------------|-----|
| 4x4 data_scatter | 4x4 | M8K16N8 | 1,029 | **1,182** | +15% |
| 8x4 figure7 (old arch) | 4x4 | M16K12N8 | 907 | **1,052** | +16% |

Both show a consistent ~15% underestimate from csynth, suggesting this is a structural property of the Allo-generated dataflow pipelines. Csynth cannot model inter-kernel FIFO synchronization overhead.

**Projected 16x16 cosim:** 12,607,516 x 1.15 = ~14.5M cycles. However, for data_scatter-dominated workloads, the overhead may be smaller since the bottleneck kernel runs continuously with minimal stalling.

### Resource Scaling

| Metric | 4x4 | 16x16 | Scale Factor | Expected (16x PEs) |
|--------|-----|-------|-------------|---------------------|
| PEs | 16 | 256 | 16.0x | 16x |
| DSP | 50 | 775 | 15.5x | ~16x |
| FF | 29,277 | 408,790 | 14.0x | ~16x |
| LUT | 35,665 | 464,490 | 13.0x | ~16x |
| data_scatter latency | 524 | 12,582,929 | 24,013x | -- |
| nest_pe latency (each) | 70 | 3,079 | 44x | -- |
| Total csynth | 1,029 | 12,607,516 | 12,252x | -- |

Resource scaling is near-linear with PE count, as expected. Latency scaling is super-linear due to data_scatter processing more tiles (64 vs 16) and more k_passes (3 vs 1), plus 16x more PEs to feed per step.

### Per-PE Resource Efficiency

| Resource | 4x4 per-PE | 16x16 per-PE | Notes |
|----------|-----------|-------------|-------|
| DSP | 3.0 | 3.0 | Identical (int32 multiply) |
| FF | 473 | 807 | +71% (wider stream addressing) |
| LUT | 339 | 1,057 | +212% (wider loop bounds, more FIFO control) |

The 16x16 PEs are larger in FF/LUT because wider stream addressing logic is needed for 256-stream interconnect, and loop counters must handle larger tile/k_pass bounds.

---

## Conclusions

1. **Csynth is a consistent ~15% lower bound** on actual RTL cycle count for small dataflow workloads, due to FIFO synchronization overhead that csynth cannot model.

2. **For the 4x4 design (M8K16N8):** output_accum is the pipeline bottleneck at 656 cycles. Cosim confirms 1,182 cycles with functional correctness (Pass).

3. **For the 16x16 design (M24K48N512):** data_scatter completely dominates at 12.6M cycles (99.8% of total), making other optimizations moot until data_scatter is addressed.

4. **DSP utilization scales linearly:** 3 DSP48E2 per PE (int32 multiply on 27x18 cascaded DSPs), confirming structural parallelism is working as designed.

5. **16x16 LUT overflow:** At 106% of single-SLR capacity, the 16x16 design requires multi-SLR partitioning for actual deployment on U280.

6. **16x16 cosim ETA:** With 12.6M estimated cycles, XSIM simulation at typical 10-100 cycles/second rates may take 1.5-15 hours.

## Files

- 4x4 csynth report: `/scratch/nz264/feather_scatter_4x4_csyn/out.prj/solution1/syn/report/full_matrix_top_csynth.rpt`
- 4x4 cosim report: `/scratch/nz264/feather_4x4_cosim_test/out.prj/solution1/sim/report/full_matrix_top_cosim.rpt`
- 4x4 cosim log: `/scratch/nz264/feather_4x4_cosim_test/cosim.log`
- 16x16 csynth report: `/scratch/nz264/feather_16x16_cosim/out.prj/solution1/syn/report/full_matrix_top_csynth.rpt`
- 16x16 cosim (in progress): `/scratch/nz264/feather_16x16_cosim/` (XSIM running, started 22:05 EDT)
- Figure7 8x4 cosim (old arch): `/work/shared/users/phd/nz264/allo/examples/feather-isa/tests/figure7_cosim.prj/`
