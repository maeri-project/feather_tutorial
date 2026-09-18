# FEATHER versus a systolic array

Open [FEATHER_VS_SYSTOLIC.html](FEATHER_VS_SYSTOLIC.html) directly, or select
**FEATHER vs. Systolic** in the tutorial sidebar. The page needs only local
HTML/CSS/JavaScript assets; it has no runtime compiler or network dependency.

Both arrays have 16×16 physical PEs and execute the same real, non-padding
`M×K×N` MACs with identical deterministic inputs and weights. These are small
synthetic teaching tensors, not Qwen activations. Every output becomes the
next layer's actual input; the chain is not a collection of unrelated GEMMs.

## Presets and what they teach

- Single-row chain: `1×12×32 → 1×32×19 → 1×19×47 → 1×47×9 → 1×9×33 → 1×33×12`.
  The first GEMM maps 32 useful FEATHER PE owners versus 16 per OS systolic
  fold. After wavefront skew, the simultaneous MAC peaks are 24 versus 12.
  The whole chain does **not** necessarily favor FEATHER: short/ragged K tiles
  can require additional compiler mappings and network drains.
- Seven-row chain: the same widths with `M=7`. Mapping replication and
  K-split choices change along the chain, and producer/consumer bank layouts
  can genuinely differ. The first boundary provides a compiler-checked
  output-layout alternative without changing its compute mapping.
- Aligned control: `16×16×32 → 16×32×16 → 16×16×32`. Aligned dimensions are
  not automatically evidence of equal performance or of either machine winning.

The baseline can use fixed output-stationary (OS), weight-stationary (WS), or
input-stationary (IS) mappings. **Best per layer** chooses the lowest modeled
compute-cycle count among all three with no dataflow-switch penalty. This is
an intentionally optimistic baseline, not a claim that all physical systolic
arrays support all three modes. No cross-layer GEMM fusion or independent-job
packing is credited to either array.

## Metrics and logical clocks

**Mapped PEs** is the maximum useful owner count in one mapping/fold. It is
not an instantaneous MAC count. **Active now** counts actual current events;
**peak active** is the maximum across all cycles. **Useful MAC utilization**
is `M*K*N / (256 * logical cycles)` and includes fill, inactive edges, and
drain. Equal PE counts do not imply equal area, local storage, bandwidth,
power, clock frequency, or arithmetic pipelines.

The systolic schedule maps `(M,N)` spatially for OS, `(K,N)` for WS, and
`(M,K)` for IS. The remaining axis advances in time. Each rectangular fold
uses `t + row + column` for a MAC and retains one final capture beat, giving
`temporalExtent + activeRows + activeColumns - 1` logical cycles. Ragged edges
are shortened; padded MACs are neither executed nor counted. Fold loads and
preloads cost zero in this idealized comparison.

FEATHER uses exported compiler tile and EM/ES records, including independently
mapped tails. Row `r`, VN lane `l` computes at `dotStart + r + l`. Dot starts
are separated by `max(16, VN length)` to avoid column-bus collisions. A row's
column-bus event follows its final lane by one cycle, then eight distinct
BIRRD stage events and an output-buffer write. Each mapping drains before
the next one; concurrent row/group identities remain distinct.

**Neither clock is RTL timing or a SCALE-Sim run.** Both omit external DMA,
weight preload, instruction dispatch, arithmetic-pipeline latency, and most
reconfiguration costs. FEATHER compiler choices were selected for the deployed
compiler's cost model, not globally optimized for this illustrative clock.
Systolic WS/IS K-partial spill and reload traffic is also omitted; the
mathematical accumulator preserves those values without charging memory beats.
Do not interpret a ratio here as measured hardware speedup. The currently
maintained FP16 MINISA wrapper supports **WO-S only**; its spatial replication,
tiling, and reduction choices vary, but this page does not invent IO-S support.

## Layout switching: a separate, conditional experiment

The bank diagram uses the compiler's Table-II rank permutations with 16-scalar
VNs. It normalizes a whole intermediate tensor to show addresses side by side;
it is **not** a claim that all its tiles simultaneously occupy the real SRAM.
Cell identity, value, bank, and scalar row are retained across the illustration.

The fixed-output baseline writes its native OVN order. If a next-layer IVN
order assigns different addresses, the example copies the entire real tensor
through a distinct scratch buffer. At an editable scalar-transfer budget `B`,
the extra cost is `ceil(elements/B)` reads plus `ceil(elements/B)` writes. Even
unchanged cells must populate the fresh destination. This is
an optimistic incremental copy model: common mandatory stores/loads, precision
conversion, SRAM conflicts, scratch capacity, and retiling are outside it.

FEATHER avoids that extra pass **only** when all of the following hold:

1. Addresses actually differ.
2. The producer's Mt/Nt matches the consumer's Mt/Kt.
3. A separately run constrained compiler search confirms that the target OVN
   order preserves the producer's chosen tile and every full/tail EM+ES pair.
4. The architectural layout-switch option is enabled.

Otherwise both arrays retain the same modeled conversion cost. Configuring
the alternate output layout adds the editable configuration cost, even though
the arithmetic is unchanged. The **layout-aware systolic writer / compatible**
option removes the extra conversion for both machines and exposes the limit
of this comparison. A single-row tensor often has identical addresses under
both rank orders, so the vector-chain preset claims **no extra copy saving**.

For the first seven-row boundary, OVN order 0 places VN `(m,q)` at linear
address `m*2+q`, while the consumer's IVN order 0 uses `q*7+m`. OVN order 5
can produce the latter directly, and its mapping has been compiler-checked.
Of 224 logical cells, 192 change address. All 224 must reach the new destination;
at `B=16`, the illustrative separate copy costs 28 beats. Direct placement charges its
configuration cost. This does not establish deployable buffer reuse: the
current FP16 wrapper still stores/reloads data rather than implementing this
whole-chain direct handoff. Its FP32-to-FP16 conversion is not free or modeled
by this layout-only experiment.

## Reproduction and validation

The mapping snapshot is generated from the maintained FEATHER_GEMM compiler:

```bash
cd ../FEATHER_GEMM
python tb/scripts/build_feather_comparison_data.py
python tb/scripts/build_feather_comparison_data.py --check
cd ../feather_tutorial
node tests/comparison_model_test.cjs
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers \
node tests/comparison_browser_test.cjs
```

Use the builder's `--out` argument for another tutorial worktree. The emitted
data records source hashes, hardware configuration, legal layout alternatives,
and exact ownership checks; 14 unique cases cover the three chain presets.
Tests independently check every `(m,k,n)` once per architecture, numerical
chain continuity, physical PE conflicts, per-row timing, output delivery,
Table-II addresses, copy-cost sensitivity, playback, and native page behavior.

## Sources and scope

The architectural reordering motivation is described in the original
[FEATHER paper](https://arxiv.org/abs/2405.13170). Systolic OS/WS/IS distinctions
follow the [SCALE-Sim paper](https://arxiv.org/abs/1811.02883) and
[official simulator](https://github.com/scalesim-project/SCALE-Sim).
Those sources motivate the models; **the numbers on this page are generated
by this page's disclosed teaching model, not quoted experimental results**.
Deployed MINISA limitations are documented in
[the FP16 interface specification](https://github.com/maeri-project/FEATHER_GEMM/blob/fp16/RTL/fp16/INTERFACE_SPEC.md#121-deployable-legality-envelope).
