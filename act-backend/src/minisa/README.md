# MINISA Layout Exploration

This folder contains the MINISA post-processing flow used after PII extraction.

## Files

- `explore.rs`: Builds per-layer layout plans from `PiiGraph`, solves layout constraints, emits JSON variants, runs mapper, and writes assembly-like text.
- `dsu.rs`: Disjoint Set Union (Union-Find) used to group flex layout variables that must share the same layout.
- `emit.rs`: Emits final text instruction files from mapped JSON + PII graph (one text file per variant).
- `mapper.rs`: Mapper invocation layer; runs FEATHER python mapper (`launch_cost_model.py`) with `-i/-o` JSON paths.
- `spec.rs`: FEATHER spec constants emitted into generated JSON.
- `util.rs`: Non-core helpers for metadata parsing, layout conversion, variant enumeration, and JSON field builders.
- `mod.rs`: Module exports.

## Error Behavior

`explore_from_graph(...)` returns `io::Result<ExploreOutput>`.

Returned errors (non-panic path) are used for:
- Missing plan-node input0 (applies to Execute and SoftMax).
- Missing Execute input1.
- Execute child1 not being `LoadWVN` (required source for `SetWVN` emission).
- Invalid IVN/WVN/OVN metadata shapes.
- WVN being unspecified/flexible.
- Producer/consumer layout conflicts.
- Inconsistent dimensions inside a DSU component.
- SoftMax input/output shape mismatch for layout propagation.
- IO/JSON/mapper failures.

Mapper notes:
- Mapper command mirrors docker usage: `python3 compiler/ACT/launch_cost_model.py -i <input_json> -o <output_json>`.
- Script path is auto-discovered from repository layout.
- Optional override: set `FEATHER_MAPPER_SCRIPT` to the full script path.

Current panic-risk callsites inside this folder:
- `explore.rs`: `obj.iter().next().unwrap()` while reading mapped layer object.

## Layout Constraint Search (Execute + SoftMax only)

```text
for each Execute node E:
    set IVN layout:
        if LoadIVN metadata exists -> fixed
        else -> create flex variable

    set WVN layout:
        if LoadWVN metadata exists -> fixed
        else -> error (WVN cannot be flex)

    set OVN layout:
        if downstream StoreOVN metadata exists -> fixed
        else -> create flex variable

for each SoftMax node S:
    set IVN layout from S.input0 (fixed from metadata if present, otherwise flex)
    set OVN layout equal to IVN layout (SoftMax propagates layout)

for each planned node P (Execute or SoftMax):
    src = P.input0

    if src is also a planned node (Execute or SoftMax):
        constrain src.OVN == P.IVN
        apply constraints with DSU:
            flex/flex  -> union components
            fixed/flex -> bind component to fixed layout
            fixed/fixed -> must match, else conflict error

collapse DSU components
for each free component:
    build candidate domain from divisors and allowed orders

enumerate cartesian product of component domains
for each assignment:
    resolve each planned node IVN/OVN from fixed or chosen component value
    emit JSON layer entries only for Execute plans (SoftMax is propagation-only)
    call mapper to get latencies and mappings
    emit final text file (`final_assembly_vN.txt`) using layout+mapped data
    compute total latency as sum of per-layer mapped latencies

select best candidate by minimum total latency
```

## Output Shape

The pipeline writes outputs under a per-PII directory:

- `<log>/pii_<id>/<id>.pii`
- `<log>/pii_<id>/pii_<id>_vN.json`
- `<log>/pii_<id>/mapped_pii_<id>_vN.json`
- `<log>/pii_<id>/final_assembly_vN.txt`
- `<log>/pii_<id>/final_assembly.txt`

`final_assembly.txt` is a copy of the best variant text file.
