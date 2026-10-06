#!/usr/bin/env python3
"""Export a controlled, same-hardware Qwen3 mapping comparison for the website.

Run with the FEATHER_GEMM Python environment. This performs compiler legality
checks and analytical scheduling; it does not run RTL or modify compiler files.
"""
import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def build(repo):
    sys.path.insert(0, str(repo))
    from compiler.ACT.launch_cost_model import feather_spec_to_config
    from minisa.search import (
        _analytical_em_params_vn_safe, _find_all_layout_selections,
        _mapping_is_encodable, _hbm_images_fit, derive_execute_streaming,
    )
    from minisa.schedule_cost import COST_MODEL, score_schedule

    hardware = dict(AH=16, AW=16, D_StaB=128, D_StrB=64, D_OB=64)
    cfg = feather_spec_to_config(hardware)
    from minisa.search import brute_force_layer_search
    from minisa.layout import choose_layout_W, choose_layout_I, choose_layout_O, TABLE_II_OUTER_TO_INNER
    policies = {
        "replicate8": dict(name="C · Eight token replicas", Mt=32, Kt=32, Nt=16, replicas=8),
        "reuse": dict(name="A · Token parallel", Mt=32, Kt=32, Nt=32, replicas=4),
        "outputs": dict(name="B · Channel parallel", Mt=16, Kt=32, Nt=64, replicas=2),
    }
    stages = [
        dict(id="down", phase="prefill", title="Block 28 · down_proj", shape=dict(M=768, K=3072, N=1024),
             programN=512, programs=2, previous=None, input="G", weight="W_down", output="ΔH", rowOffset=0,
             inputName="Gated MLP activations", weightName="MLP down-projection weights", outputName="Residual update",
             axes=dict(M="prompt tokens", K="MLP features", N="hidden features")),
        dict(id="head", phase="prefill", title="Language-model head", shape=dict(M=1, K=1024, N=151936),
             programN=75968, programs=2, previous="down", input="Z_last", weight="W_vocab", output="logits", rowOffset=767,
             inputName="Last normalized hidden row", weightName="Vocabulary projection weights", outputName="Next-token logits",
             axes=dict(M="last prompt token", K="hidden features", N="vocabulary entries")),
        dict(id="decode", phase="decode", title="Next token · block 1 q_proj", shape=dict(M=1, K=1024, N=2048),
             programN=2048, programs=1, previous="head", input="X_next", weight="W_q", output="Q", rowOffset=0,
             inputName="Normalized new-token embedding", weightName="Query projection weights", outputName="Query vectors",
             axes=dict(M="new input token", K="hidden features", N="query features")),
    ]
    layouts = {}
    for stage in stages:
        m, k, n = stage["shape"]["M"], stage["shape"]["K"], stage["programN"]
        best = brute_force_layer_search(m, k, n, cfg, best_only=True)[0]
        stage["search"] = dict(stats=best.search_stats, tile=[best.Mt, best.Kt, best.Nt],
                               orders=[best.order_w, best.order_i, best.order_o], cyclesPerProgram=best.cycles_total)
        stage["records"] = {}
        for key, policy in policies.items():
            mt, kt, nt = min(m, policy["Mt"]), policy["Kt"], policy["Nt"]
            assert m % mt == k % kt == n % nt == 0
            eps = _analytical_em_params_vn_safe(
                mt, kt, nt, 16, 16, policy["replicas"], vn_sizes=[16, 16],
                wvn_col_stride="contiguous", ivn_distribution="interleaved")
            assert _mapping_is_encodable(eps, mt, cfg)
            orders = sorted(_find_all_layout_selections(eps, mt, kt, nt, 16, 16, policy["replicas"], cfg))[0]
            assert _hbm_images_fit(m, k, n, mt, kt, nt, cfg)
            assert len(eps) == 1
            em = eps[0]
            es = derive_execute_streaming(em, mt)
            seen, active = set(), []
            for dot in range(es.T):
                owners = 0
                for row in range(16):
                    for col in range(16):
                        mm = es.m_0 + es.s_m * dot + (col % em.G_r) // em.G_c
                        nn = em.c_0 + em.s_r * row + em.s_c * (col % em.G_c)
                        kg = em.r_0 + col // em.G_r
                        if mm >= mt or nn >= nt or kg * 16 >= kt:
                            continue
                        owner = (mm, nn, kg)
                        assert owner not in seen
                        seen.add(owner)
                        owners += 1
                active.append(owners)
            assert len(seen) * 16 == mt * kt * nt
            cost = asdict(score_schedule(m, k, n, cfg, mt, kt, nt, *orders, {(mt, kt, nt): eps}))
            cost = {field: value * stage["programs"] if isinstance(value, int) else value for field, value in cost.items()}
            layout_id = "_".join(map(str, (mt, kt, nt, *orders)))
            if layout_id not in layouts:
                maps = {}
                for operand, spec in zip(("W", "I", "O"), (choose_layout_W(cfg, kt, nt, orders[0]),
                        choose_layout_I(cfg, mt, kt, orders[1]), choose_layout_O(cfg, mt, nt, orders[2]))):
                    vectors = []
                    # Export independent Python address fixtures for every VN.
                    outer, inner = (kt//16, nt) if operand == "W" else (mt, kt//16) if operand == "I" else (mt, nt//16)
                    for u in range(outer):
                        for v in range(inner):
                            indices = ({"kL1": u, "nL0": v % spec.a0, "nL1": v // spec.a0} if operand == "W" else
                                       {"jL1": v, "mL0": u % spec.a0, "mL1": u // spec.a0} if operand == "I" else
                                       {"qL1": v, "pL0": u % spec.a0, "pL1": u // spec.a0})
                            linear = spec.linear_index(indices)
                            vectors.append(dict(logical=[u,v], linear=linear, bank=linear%16, rowBase=16*(linear//16)))
                    maps[operand] = dict(spec=asdict(spec), ranks=list(TABLE_II_OUTER_TO_INNER[spec.order_id][operand]),
                        dims=spec.dims(), vectors=vectors, bytes=spec.vn_count()*16*(4 if operand=="O" else 2))
                layouts[layout_id] = maps
            stage["records"][key] = dict(shape=dict(M=m,K=k,N=n), tile=dict(M=mt,K=kt,N=nt),
                orders=dict(zip(("W","I","O"),orders)), layouts=layout_id,
                EM={field:getattr(em,field) for field in ("G_r","G_c","r_0","c_0","s_r","s_c")},
                ES=asdict(es), cost=cost, mappedPEs=active[0], verifiedTileMacs=len(seen)*16)
        stage["preferred"] = min(stage["records"], key=lambda key: stage["records"][key]["cost"]["total_cycles"])
        chosen=stage["records"][stage["preferred"]]
        assert chosen["cost"]["total_cycles"] == best.cycles_total * stage["programs"]
        assert list(chosen["tile"].values()) == [best.Mt,best.Kt,best.Nt]
        assert {field:getattr(best.exec_params[0],field) for field in chosen["EM"]} == chosen["EM"]
    sources = (
        "minisa/search.py", "minisa/schedule_cost.py", "minisa/config.py",
        "minisa/layout.py", "minisa/isa.py", "compiler/ACT/launch_cost_model.py",
        "tb/scripts/extract_qwen3_fp16_workload.py",
        "tb/statistics/qwen3_0p6b_fp16_manifest.json",
    )
    manifest = json.loads((repo / sources[-1]).read_text())
    return dict(schema=2, hardware=hardware, weightsPerPE=16, policies=policies,
                stages=stages, layouts=layouts, provenance=dict(
                    costModel=COST_MODEL, model=manifest["model"], modelRevision=manifest["revision"],
                    sourceCommit=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
                    sourceSha256={p: hashlib.sha256((repo / p).read_bytes()).hexdigest() for p in sources},
                    scope="Final prefill down_proj, last-position lm_head, and next-token decode q_proj. FP16 operands, FP32 accumulation.",
                    selection="Bounded compiler tile/layout search; displayed 8/4/2-replica candidates are explanatory alternatives. A/B choices match the searched winner, not a claim of global optimality.",
                    boundary="down_proj output is added to its residual, normalized, and last-row selected. Logits are sampled, then the new token is embedded and normalized. These transformations are context, not a simulated inter-layer buffer handoff.",
                    timing="Serialized MINISA predictions; input packing, boundary operations, host launch and memory stalls excluded. down_proj uses two N=512 programs; LM head uses two N=75968 programs, each sequential and disjoint. No new RTL measurements.",
                    animation="First tile only. Symbolic tensor lineage is exact; teaching values are independent synthetic operands, not full-model numerical inference.",
                ))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "script/reconfigurable_compute_data.js")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data = build(args.source_root.resolve())
    content = ('// Generated by tools/build_reconfigurable_compute.py.\n'
               '(function(root){\n"use strict";\nconst data=' + json.dumps(data, sort_keys=True, indent=2) + ';\n'
               'if(typeof module==="object"&&module.exports)module.exports=data;\n'
               'root.ReconfigurableComputeData=data;\n})(typeof globalThis!=="undefined"?globalThis:this);\n')
    if args.check:
        if args.out.read_text() != content:
            raise SystemExit("Reconfigurable compute data is stale")
        print("Fresh:", args.out)
    else:
        args.out.write_text(content)
        print("Wrote:", args.out)


if __name__ == "__main__":
    main()
