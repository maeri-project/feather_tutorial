# Reconfigurable compute: Qwen3 on FEATHER 16×16

`RECONFIGURABLE_COMPUTE.html` compares two compiler-validated WO-S spatial
mapping policies for one complete Qwen3-0.6B query projection. It uses the same
16×16 array, 16 PE-local weights, and StaB/StrB/OB depths 128/64/64 throughout.
Prefill is M×K×N = 768×1024×2048; decode is 1×1024×2048.

| Policy | Maximum tile M×K×N | Gr / Gc | Prefill cycles | Decode cycles |
|---|---|---|---:|---:|
| A: reuse across tokens | 32×32×32 | 8 / 2 | 31,865,858 | 879,234 |
| B: cover more outputs | 16×32×64 | 8 / 4 | 33,438,722 | 506,178 |

M clips to the available rows. Both policies use sr=1, sc=16, W/O orders 2/0;
the legal I order is 2 for prefill and 0 for decode. Thus the fixed baseline
fixes spatial mapping, not every instruction or layout field. A and B are
supported examples, not an exhaustive proof about every fixed mapping.
Reconfiguration selects A for prefill and B for decode: 4.7% fewer cycles than
B in prefill and 42.4% fewer than A in decode (1.05× / 1.74×).

Predictions use `serialized_minisa_v2` including dispatch, operand transfers,
PE preload, streaming, gaps/drain, and stores. Operand layouts are assumed
already packed; conversion, memory stalls, host launch, and non-GEMM operations
are excluded. These are not new RTL measurements or complete inference times.

The animation shows the first M/N/K tile. At PE (r,c), n=r+16(c mod Gc),
kg=floor(c/8), and m=dot·(8/Gc)+floor((c mod 8)/Gc). Sixteen stationary weights
W[16kg:16kg+16,n] meet a row-skewed input stream. A scalar reaches row r at
dot·16+lane+r. The two K halves contribute to the same logical output through
BIRRD. The display illustrates local compute; it does not animate BIRRD or
pretend its animation steps are the scheduler's total cycles. Values are
deterministic small integers, not Qwen model parameters.

The diagram shows useful PE ownership separately from instantaneous active
MACs. Invalid token replicas are gray but still have physically loaded weights.
The resident slot inspector includes actual symbolic tensor identities and
sample dot-product arithmetic. Mouse, keyboard, and native selectors select a
PE. Nothing autoplays; reduced motion removes fractional packet movement.

## Regenerate and verify

Use a FEATHER_GEMM environment with its NumPy/pandas dependencies:

```sh
python tools/build_reconfigurable_compute.py --source-root ../FEATHER_GEMM
python tools/build_reconfigurable_compute.py --source-root ../FEATHER_GEMM --check
node tests/reconfigurable_compute_model_test.cjs
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers \
node tests/reconfigurable_compute_browser_test.cjs
```

The exporter checks instruction encoding, bank/layout legality, SRAM and HBM
limits, and unique useful tile MAC ownership. It stores source hashes, model
revision, hardware, mappings and complete cycle components in the data asset.
The independent JS test exhaustively verifies all four animated tiles against
direct GEMM, checks column forwarding and stationary weights, and reconciles
the costs. Browser tests cover phase changes, playback, high-DPI hit targets,
keyboard inspection, theme changes, mobile overflow, and reduced motion.

The page is static, works locally, and needs no compiler or API at runtime.
