# act-feather

FEATHER specific patches for ACT-generated compiler backend.

## Docker

`./docker/build.sh` builds the image.

`./docker/run.sh` runs a ephemeral container with the current repository mounted inside.

## Run Q-sliced Attention

The XLA-HLO IR for Q-sliced attention is at `./attention_q_slice.hlo`.

To run the compiler,
```bash
cd act-backend
cargo build --release
./target/release/act-feather --input ../attention_q_sliced.hlo --log ./log/
```

## Understanding the log

You should see a structure like:

```text
log/
	metadata.json
	pii_0/
		0.pii
		variant_stats.csv
		layout_variants/
			pii_0_v0.json
			...
		layout_mapper_variants/
			mapped_pii_0_v0.json
			...
		minisa_traces/
			final_assembly_v0.txt
			...
			final_assembly.txt
```

File meanings:

- `metadata.json`: HLO-level metadata dumped by the frontend/parser stage.
- `pii_0/0.pii`: extracted PII graph for this candidate.
- `pii_0/layout_variants/*.json`: layout variants generated before mapper execution.
- `pii_0/layout_mapper_variants/mapped_*.json`: mapper output JSON per variant (with tile mapping and latency).
- `pii_0/minisa_traces/final_assembly_v*.txt`: emitted instruction traces per variant.
- `pii_0/minisa_traces/final_assembly.txt`: best variant trace (minimum total latency, earliest-index tie-break).
- `pii_0/variant_stats.csv`: per-layer CSV rows written after each variant mapper run.

`variant_stats.csv` columns:

- `variant`: variant index.
- `layer`: layer name (for example `L1`, `L3`).
- `latency`: per-layer latency from mapper stdout.
- `execute_tiles`: number of `ExecuteTile` instructions for the layer.
- `M,K,N`: GEMM dimensions parsed from mapper stdout.
- `overall_utilization,compute_utilization`: utilization percentages parsed from mapper stdout.
