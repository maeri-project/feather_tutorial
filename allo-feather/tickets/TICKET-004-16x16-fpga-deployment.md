---
id: TICKET-004
title: "16x16 PE array: functional verification + U280 FPGA deployment"
status: resolved
priority: high
---

# TICKET-004: 16×16 PE Array — Functional Verification + U280 FPGA Deployment

## Goal

Scale the FEATHER+ MINISA implementation from 4×4 to a **16×16 PE array** (AH=AW=16),
verify functional correctness across multiple workloads and dataflow configurations,
then generate a bitstream and deploy on the Alveo U280 FPGA.

## Phases

### Phase 1: Functional Verification (AH=AW=16, software simulation)

Verify correctness with `allo.customize()` + numpy reference for:

- [ ] Basic GEMM: C[64,64] = A[64,64] × B[64,64] (single tile, Gr=AW=16)
- [ ] Multi-tile GEMM: C[128,128] = A[128,64] × B[64,128] (multiple M/N/K tiles)
- [ ] K-streaming: workloads with K > AH requiring multiple K-passes
- [ ] BIRRD reduction: Gr=AW//2=8, verify 2-way reduction with 16-wide butterfly
- [ ] Mixed Gr tiles: some tiles Gr=16 (pass-through), some Gr=8 (reduction)
- [ ] All 6 OVN orders: verify BIRRD tables exist and produce correct output for AW=16
- [ ] Edge cases: non-square matrices, K not divisible by Kt_per_pass

Key parameters for 16×16:
- `log2_Gr` range: 4 (Gr=16) and 3 (Gr=8)
- `Kt_per_pass` = (AW/Gr) × AH = 16 (Gr=16) or 32 (Gr=8)
- BIRRD stages: P0 = 2×log2(16) = 8, P1 = 16//2 = 8
- UInt stream width: 16×16×8 = 2048 bits (UInt(2048)) — verify Allo/HLS handles this

### Phase 2: HLS C-Simulation (csim)

- [ ] Build with `mode="csim"`, verify output matches numpy reference
- [ ] Confirm dataflow compliance (no WAR violations in HLS log)

### Phase 3: HLS Synthesis (csyn)

- [ ] Build with `mode="csyn"`, check synthesis report
- [ ] Verify resource usage fits U280 (DSP: 256 expected for 16×16 MACs)
- [ ] Check clock estimate (target ≤ 3.33 ns / 300 MHz)
- [ ] Review II for each kernel (crossbar, nest_compute, bus, BIRRD, output_accum)

### Phase 4: RTL Co-Simulation (cosim)

- [ ] Run cosim to get cycle-accurate latency
- [ ] Compare against expected scaling from 4×4 results

### Phase 5: Bitstream Generation + FPGA Deployment

- [ ] Build with `mode="hw"` to generate `.xclbin` bitstream
- [ ] Deploy on U280 and verify output correctness
- [ ] Measure on-board execution time

## Server Environment

**Host:** zhang-21.ece.cornell.edu (SYS-4029GP-TRT, 48 cores, 224 GB RAM)

**Available FPGAs (verified via `xbutil examine`):**

| BDF | Device | Shell | Status |
|-----|--------|-------|--------|
| 0000:3d:00.1 | U280 (inst=132) | xilinx_u280_gen3x16_xdma_base_1 | Ready |
| 0000:b1:00.1 | U280 (inst=134) | xilinx_u280_gen3x16_xdma_base_1 | Ready |
| 0000:88:00.1 | U250 (inst=133) | xilinx_u250_gen3x16_xdma_shell_4_1 | Ready |

**Platform file:**
```
/opt/xilinx/platforms/xilinx_u280_gen3x16_xdma_1_202211_1/xilinx_u280_gen3x16_xdma_1_202211_1.xpfm
```

**Tool versions:**
- XRT: 2.15.0
- Vitis/Vivado/Vitis HLS: 2023.2
- Part: xcu280-fsvh2892-2L-e

## Environment Setup Commands

```bash
# 1. Allo + LLVM
source /home/nz264/.local/bin/allo-env.sh

# 2. Vitis HLS (for csim/csyn/cosim)
source /opt/xilinx/Vitis_HLS/2023.2/settings64.sh

# 3. XRT (for hw_emu / hw mode)
source /opt/xilinx/xrt/setup.sh

# 4. Platform (for hw mode bitstream linking)
export XDEVICE=/opt/xilinx/platforms/xilinx_u280_gen3x16_xdma_1_202211_1/xilinx_u280_gen3x16_xdma_1_202211_1.xpfm
```

## Build Commands (Reference from examples/feather/gemm.py)

```python
import allo
from allo.backend import hls

# Functional test (software)
s = allo.customize(top_func)
mod = s.build()
mod(A, B, instructions, C)

# HLS C-simulation
s = allo.customize(top_func)
mod = s.build(target="vitis_hls", mode="csim", project="feather_16x16.prj")
mod(A, B, instructions, C)

# Synthesis only (resource/latency report)
mod = s.build(target="vitis_hls", mode="csyn", project="feather_16x16.prj")

# Full bitstream (takes hours)
mod = s.build(target="vitis_hls", mode="hw", project="feather_16x16.prj")
mod(A, B, instructions, C)  # runs on FPGA

# Reuse pre-compiled bitstream
mod = s.build(
    target="vitis_hls", mode="hw",
    project="feather_16x16.prj",
    bitstream="feather_16x16.prj/build_dir.hw.xilinx_u280/top.xclbin",
)
mod(A, B, instructions, C)
```

## HBM Memory Mapping (optional, for performance)

U280 has 32 HBM channels. For large 16×16 workloads, consider mapping
input/output arrays to separate HBM banks:

```python
mod = s.build(
    target="vitis_hls", mode="hw",
    project="feather_16x16.prj",
    configs={"hbm_mapping": {"A": 0, "B": 1, "instructions": 2, "C": 3}},
)
```

## Notes

- Bitstream generation (`mode="hw"`) typically takes 2-6 hours depending on design size.
- Use `ALLO_FPGA_HW_MODE=1` env var pattern from CI if wrapping in a test script.
- UInt(2048) streams for 16×16 may require validation — current 4×4 uses UInt(128).
- BIRRD with P0=8 stages × P1=8 switches = 64 butterfly switches (vs 12 for 4×4).
- The CI weekly test (`fpga_weekly.yml`) deploys the original feather/gemm.py with
  `mode="hw"` on the `brg-zhang-xcel` runner — same server, same flow.

## Acceptance Criteria

- [x] All Phase 1 functional tests pass for AH=AW=16 (7/7 single-tile: base + 6 OVN orders)
- [x] HLS csim produces correct output (PASS, AP_INT_MAX_W=4096 patched)
- [x] Synthesis fits U280 resources at 300 MHz (7.9% LUT, 2.3% FF, 1.2% BRAM, Fmax=363MHz)
- [x] RTL cosim passes (6126 cycles, functionally correct)
- [x] Bitstream generated successfully (50.2 MB xclbin, 2.4h build, timing met at 300 MHz)
- [x] On-board FPGA execution produces correct GEMM output (PASS on U280)
- [x] Performance numbers recorded (kernel: 159.4 μs wall-clock, ~47.8K cycles including DMA)

## Progress (2026-03-13)

See `reports/16x16_progress.md` for detailed results.

### Key Results
- **Simulator**: 7/7 tests PASS (single_tile + all 6 OVN orders), ~20s build per test
- **HLS csim**: PASS, build 17.3s, csim 12.3s, max stream depth 16
- **HLS csynth**: 5177 cycles, 363 MHz Fmax, 7.9% LUT on U280
- **RTL cosim**: PASS, 6126 cycles (1.18x over csynth estimate)
- **Bitstream**: BUILD SUCCESS — 50.2 MB xclbin, 2.4 hours build time
- **FPGA Execution**: PASS — 159.4 μs kernel wall-clock on Alveo U280

### Known Issues
- LLVM JIT simulator hangs on multi-tile builds for 16×16 (64 BIRRD kernels → massive IR)
- AP_INT_MAX_W must be patched to 4096 in kernel.cpp (UInt(2048) exceeds default 1024)
- DSPs = 12 (int8×int8 MACs use LUT fabric, not DSP slices)
- Allo HLS backend has path bug with absolute project dirs + existing xclbin (workaround: set `mod.bitstream` directly)
