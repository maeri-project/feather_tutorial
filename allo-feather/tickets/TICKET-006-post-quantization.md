---
id: TICKET-006
title: Post-quantization module (int32 → int8)
status: resolved
priority: P0
---

# TICKET-006: Post-Quantization Module (int32 → int8)

## Problem

The RTL has `quant_post.v` that rescales 32-bit accumulation results to 8-bit for
the next layer. The Allo implementation only outputs raw int32 accumulation with
no quantization stage.

## Why It Matters

- Real DNN inference requires int8 output for layer chaining
- The RTL testbenches (`tb_feather_stress`, `tb_feather_scale`) verify quantization
  for every test case
- Blocks multi-layer execution (TICKET-009)

## RTL Reference

`quant_post.v` — purely combinational, per-channel:
```verilog
data_ext = sign_extend_64(data[ch]);      // 32-bit → 64-bit signed
scaled   = data_ext * i_scale;            // 64-bit signed multiply
result   = scaled + zero_extend_64(i_zp); // add zero point
output   = result[7:0];                   // truncate to 8 bits
```

Parameters: `i_scale` (32-bit signed), `i_zp` (8-bit unsigned).

The auto-quantization pipeline in `feather_plus_top.v`:
- Cycle N: OB write
- Cycle N+1: Auto OB read (triggered by `r_ob_wr_en_d1`)
- Cycle N+2: quant_post (combinational) + PONG write
- Throughput: 1 row/cycle, fully pipelined

## Proposed Implementation

### Option A: Separate quantization kernel (8th dataflow kernel)

Add a `quant_post` kernel after `output_accum`:

```python
@df.kernel(mapping=[1], args=[C_int8])
def quant_post(local_C_int8: int8[M, N]):
    for i in range(M):
        for j in range(N):
            val: int64 = accum[i, j]  # from output_accum
            scaled: int64 = val * scale
            result: int64 = scaled + zp
            local_C_int8[i, j] = result  # truncate to int8
```

Challenge: needs `accum` data from `output_accum`. Could use a stream or merge
into `output_accum`.

### Option B: Integrate into output_accum

After accumulation is complete, apply quantization in-place before writing to C:

```python
for i in range(M):
    for j in range(N):
        scaled: int32 = accum[i, j] * scale + zp
        local_C_int8[i, j] = scaled  # truncate
```

This is simpler but changes the output type from int32 to int8.

### Recommendation

Option B is simpler and sufficient. Add `quant_scale` and `quant_zp` parameters.
When `quant_scale=0` (or a flag), skip quantization and output raw int32 (backward
compatible). When enabled, output int8.

## Relevant Code

- `feather_minisa.py`: `output_accum` kernel, lines 339-373
- `quant_post.v`: Full module (30 lines)
- `feather_plus_top.v`: Auto-quant pipeline (lines ~87-100 in README)

## Acceptance Criteria

- [x] Quantization with configurable scale and zero point
- [x] Formula matches RTL: `(data * scale + zp)[7:0]` → `(val * quant_scale + quant_zp) & 255`
- [x] Backward compatible: raw int32 output when quant_scale=0 (default)
- [x] Test with RTL testbench parameters (scale=3, zp=10) — 7 test cases pass
- [x] AW=8 and AW=4 tests with combined zero points + quantization
- [ ] HLS csim passes with post-quantization (not yet tested)
