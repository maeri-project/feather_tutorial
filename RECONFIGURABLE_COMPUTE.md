# Reconfigurable compute in a Qwen3 inference graph

`RECONFIGURABLE_COMPUTE.html` explains mapping selection through three connected
checkpoints of the recorded Qwen3-0.6B workload. It starts with the preceding
GEMM instead of imposing an unexplained fixed mapping:

1. Final prefill block's `down_proj`: G[768,3072] × W_down[3072,1024] →
   ΔH[768,1024]. Its compiler prefers A, four token replicas.
2. Residual addition and final RMSNorm produce Z. `logits_to_keep=1` selects
   Z[767,:]. The language-model head multiplies Z_last[1,1024] by
   W_vocab[1024,151936]. The incoming A mapping has redundant token replicas;
   this workload prefers B, two replicas and twice as many output channels.
3. Sampling, embedding and block-1 RMSNorm produce X_next[1,1024]. Decode
   `q_proj` multiplies it by W_q[1024,2048]. B remains appropriate. The
   vocabulary weights are replaced by query weights; only the spatial policy
   carries over.

The graph is symbolic tensor lineage, not a numerical simulation of the whole
model. Residual/norm, row selection, sampling, embedding and layout repacking
are explicit boundaries, excluded from the GEMM costs. It does not imply an
automatic output-to-input SRAM swap. The local extractor records last-position
logits; links to the model configuration and Transformers implementation are
provided on the page.

## Mapping and layout evidence

All candidates use the same 16×16 array, 16 PE-local weights, and per-bank
StaB/StrB/OB depths 128/64/64. All use the deployed WO-S execution path. A/B
change spatial replication, input assignment and tiling within that path.

| Candidate | Maximum tile M×K×N | Gr/Gc | Token replicas |
|---|---|---|---:|
| C | 32×32×16 | 8/1 | 8 |
| A: token parallel | 32×32×32 | 8/2 | 4 |
| B: channel parallel | 16×32×64 | 8/4 | 2 |

M clips to the actual input rows. A fourth illustrated proposal, Kt=32/Nt=128,
needs 4096 stationary scalars where only 2048 fit. This rejection is conditional
on Kt=32, not a claim that every wider tile is impossible.

The generator runs `brute_force_layer_search(best_only=True)` for each
checkpoint. The preferred explanatory candidate must match the winning tile,
EM fields and full-program cost. Search statistics and the three legal
candidate costs are exported. This is bounded search, not global optimality or
a graph-wide layout-conversion optimizer.

To compare all policies legally under the compiler's default packed operand
image regions, down_proj uses two disjoint N=512 programs and lm_head uses two
disjoint N=75968 programs. All candidates use these same partitions, with cycle
costs summed serially; startup/dispatch costs are retained for each program.
These two-program shapes are teaching comparison partitions, not claims about
an existing ACT partition deployment. Decode q_proj uses one N=2048 program.

The output includes each layout's extents, outer-to-inner permutation and all
logical-vector/physical-address pairs. The browser independently calculates
bank = L mod 16 and scalar row = 16 floor(L/16) + lane. W and I vectors span
K; O vectors span N. Invalid token replicas have no valid I/O address.

For example, at the head's PE (0,2), A holds W_vocab[0:16,0] for absent token
row 1; B holds W_vocab[0:16,32] for Z_last row 0 = Z's original row 767.
The visible inspector follows those weight/input sources into a local dot,
the partner PE for the other K half, and the physical OB destination. The
layout window follows the same selected PE in both mappings. Eight bank cells
per display row wrap the 16 physical banks; they do not denote different SRAM
row ranges. Sample values are deterministic synthetic operands.

## Timing and animation

Cycle values use `serialized_minisa_v2` including operand loads, PE preload,
streaming, gaps/drain, dispatch and stores. Operands start in their required
layouts; boundary work, repacking, memory stalls and host launch are excluded.
No new RTL measurements or end-to-end inference speedups are claimed.

The PE animation shows the first tile with a row-skewed input stream. A scalar
arrives at row r on teaching step dot×16+lane+r. Weights persist across input
dots; BIRRD combines the two K groups and later tiles accumulate the remaining
K range. Playback omits setup and pipeline gaps and is not the program clock.
Nothing autoplays. Keyboard and mouse select the same PE in both diagrams.
Numerical samples stay expandable; workload, dataflow, selected-PE identities,
physical layout and candidate rationale remain visible.

## Reproduce and verify

Use the FEATHER_GEMM environment with its NumPy/pandas dependencies:

```sh
python tools/build_reconfigurable_compute.py --source-root ../FEATHER_GEMM
python tools/build_reconfigurable_compute.py --source-root ../FEATHER_GEMM --check
node tests/reconfigurable_compute_model_test.cjs
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers \
node tests/reconfigurable_compute_browser_test.cjs
```

The exporter checks ISA encoding, layouts, bank conflicts, SRAM capacity, packed
HBM regions, exact MAC ownership and winner agreement. The JS test verifies all
nine animated tiles against independent GEMM, forwarding and weight stationarity,
plus every exported scalar address against the Python layout implementation.
Browser checks cover graph traversal, predecessor rationale, shapes, candidate
selection, masked PE assignments, layout choices, keyboard hit testing, playback,
mobile layouts, themes and reduced motion. The site has no compiler/API runtime
dependency.
