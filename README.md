# FEATHER Tutorial

Tutorial materials for the FEATHER accelerator, presented at RAIC.

**Tutorial website:** https://maeri-project.github.io/feather_tutorial/FEATHER.html

## Overview

This repository contains the compiler backend and hardware design materials for the FEATHER tutorial. Participants work through compiling attention kernels (XLA-HLO IR) to FEATHER's MINISA instruction set using both the ACT compiler backend and the Allo hardware design framework.

## File Structure

```
feather_tutorial/
├── act-feather/       # FEATHER-specific patches for ACT-generated compiler backend
│   ├── act-backend/   # Rust compiler backend source
│   ├── hlo_variants/  # XLA-HLO IR inputs for various attention configurations
│   └── docker/        # Docker environment for running the compiler
├── allo-feather/      # Allo-implemented FEATHER accelerator
│   └── minisa/        # MINISA ISA definition, lowering, and trace parser
└── shared/            # Shared directory, automatically synced to JupyterHub
    ├── act/           # HLO scripts for the ACT tutorial
    └── allo/          # Allo tutorial Jupyter notebooks
```

## Getting Started

See the [tutorial website](https://maeri-project.github.io/feather_tutorial/FEATHER.html) for step-by-step instructions.

For the ACT compiler backend, refer to [`act-feather/README.md`](act-feather/README.md).

## Microarchitecture and MINISA visualizer

Open [`FEATHER.html`](FEATHER.html) for the original **FEATHER Microarchitecture
and MINISA ISA Visualizer**. NEST and BIRRD now share one connected FEATHER tab;
VN Buffers remains a separate tab. The original instruction editor, JSON
load/save, validation, hardware controls, and tutorial prose are retained.
Playback is an illustrative teaching schedule, not a cycle-accurate RTL trace.
The default **Fit diagram** mode shows the full connected path; **Expand** keeps
the editor visible while enlarging the workbench. Use **Actual size** for
scrollable detail, and **Restore** or Escape to leave the expanded view.
BIRRD shows the real topology with an explicitly labeled PASS-mode preview;
the generic tutorial editor does not encode per-switch BIRRD commands.
Animation previews are bounded to 4,096 teaching steps without changing the
saved instruction trace.

This page and its `styles.css`, `script.js`, and three sponsor images are based
on the tutorial website sources in local `origin/main` at commit
`47c0985a24ec47317ea47512b7c76ecc27c0c5b0`. The existing Allo notebooks,
compiler exercises, and submodules are unchanged. Local changes do not publish
the website. Keep the stylesheet, script, and `fig/` assets beside the HTML
when serving this page; the optional web fonts can fall back to system fonts.

The separate, detailed FP16/Qwen3 workload explorer is at
`../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html`. **Do not generate that
page over this tutorial file.** Its Python builder maintains only the Qwen
explorer, not this original tutorial editor.

The sidebar's [Qwen3 MINISA Explorer](QWEN3_MINISA_VISUALIZER.html) packages that
standalone page inside this site's navigation and light/dark theme. It includes
all 22 recorded ACT prefill/decode cases, their exact layouts and instruction
downloads, and animated teaching examples for every case, including decode
and attention tails. The full-workload selector offers all 22 ACT cases
alongside the nine original full-layer prefill operators, with synchronized
matrix/tile navigation, animation, physical buffers, and original ISA traces.
Streaming, row-skewed NEST MACs, column-bus transfers, BIRRD traversal, and
output writes now animate concurrently. Use **Jump to overlap** to inspect
the pipeline. Its logical cycles compress RTL arithmetic latency and controller
gaps; they are not measured hardware clocks.

To refresh the site page after rebuilding the standalone explorer, run from
this tutorial checkout:

```sh
python3 tools/build_qwen_page.py \
  --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html \
  --shell QWEN3_MINISA_VISUALIZER.html
python3 tools/build_qwen_page.py \
  --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html \
  --shell QWEN3_MINISA_VISUALIZER.html --check
python3 tools/build_qwen_page_test.py
```

The packager preserves the source data and JavaScript, scopes its styles to
the embedded application, and records the source SHA-256. It does not modify
`FEATHER.html`, compiler inputs, or RTL, and does not publish to GitHub Pages.

Browser regression checks for this page live in the sibling GEMM checkout:

```sh
# From FEATHER_GEMM, with Playwright and Chromium installed externally:
node tb/scripts/feather_tutorial_browser_test.cjs
```
