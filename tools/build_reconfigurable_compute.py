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
    policies = {
        "reuse": dict(name="A · Reuse across tokens", Mt=32, Kt=32, Nt=32, replicas=4),
        "outputs": dict(name="B · Cover more outputs", Mt=16, Kt=32, Nt=64, replicas=2),
    }
    records = {}
    for phase, m in (("prefill", 768), ("decode", 1)):
        records[phase] = {}
        for key, policy in policies.items():
            mt, kt, nt = min(m, policy["Mt"]), policy["Kt"], policy["Nt"]
            eps = _analytical_em_params_vn_safe(
                mt, kt, nt, 16, 16, policy["replicas"], vn_sizes=[16, 16],
                wvn_col_stride="contiguous", ivn_distribution="interleaved")
            assert _mapping_is_encodable(eps, mt, cfg)
            orders = sorted(_find_all_layout_selections(
                eps, mt, kt, nt, 16, 16, policy["replicas"], cfg))[0]
            assert _hbm_images_fit(m, 1024, 2048, mt, kt, nt, cfg)
            assert len(eps) == 1
            em = eps[0]
            es = derive_execute_streaming(em, mt)
            # Independently count each logical dot owner: no padded MAC credit,
            # duplicated contraction groups, or silently missing outputs.
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
            cost = asdict(score_schedule(m, 1024, 2048, cfg, mt, kt, nt,
                                        *orders, {(mt, kt, nt): eps}))
            records[phase][key] = dict(
                shape=dict(M=m, K=1024, N=2048), tile=dict(M=mt, K=kt, N=nt),
                orders=dict(zip(("W", "I", "O"), orders)),
                EM={k: getattr(em, k) for k in ("G_r", "G_c", "r_0", "c_0", "s_r", "s_c")},
                ES=asdict(es), cost=cost, mappedPEs=active[0],
                verifiedTileMacs=len(seen) * 16,
            )
    sources = (
        "minisa/search.py", "minisa/schedule_cost.py", "minisa/config.py",
        "minisa/layout.py", "minisa/isa.py", "compiler/ACT/launch_cost_model.py",
        "tb/statistics/qwen3_0p6b_fp16_manifest.json",
    )
    manifest = json.loads((repo / sources[-1]).read_text())
    return dict(schema=1, hardware=hardware, weightsPerPE=16, policies=policies,
                records=records, provenance=dict(
                    costModel=COST_MODEL, model=manifest["model"], modelRevision=manifest["revision"],
                    sourceCommit=subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip(),
                    sourceSha256={p: hashlib.sha256((repo / p).read_bytes()).hexdigest() for p in sources},
                    scope="One complete q_proj invocation per phase; batch 1; FP16 inputs/weights, FP32 accumulation.",
                    baseline="Two fixed spatial mapping policies. M tile clips to workload; legal input layout may adapt to M. Same hardware, K tile and W/O orders. Neither is every possible fixed mapping.",
                    timing="Serialized MINISA prediction including loads, PE preload, stream, gaps/drain, dispatch and stores. Operands already packed; excludes layout conversion, external stalls, non-GEMM work and host launch. No new RTL measurement.",
                    animation="First M/N/K tile only. Row-skewed teaching steps omit preload and instruction gaps; distinct from predicted program cycles.",
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
