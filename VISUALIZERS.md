# FEATHER visualizers

The left sidebar offers two complementary pages:

- `FEATHER.html` preserves the tutorial's original generic MINISA editor and
  documentation. Its single FEATHER tab connects NEST and BIRRD; the VN-buffer
  tab remains separate. The generic editor has no switch-command field, so its
  BIRRD animation is explicitly a PASS topology preview, not a configured
  reduction or cycle-accurate hardware trace.
- `QWEN3_MINISA_VISUALIZER.html` is the detailed FP16 Qwen3 explorer. It embeds
  the compiler-exported nine-operator mappings, real BIRRD commands, synthetic
  scalar dataflow, and packed MINISA generation/import/export. The website
  shell shares `styles.css` and `script.js`; application styles are scoped so
  they cannot change the sidebar. Both light and dark site themes are supported.

The Qwen page's browser ISA execution is a control preview, not a connection to
an FPGA. Its programming panel documents how to run the exported instruction
image using the maintained FEATHER_GEMM RTL runner. Workload values in the
animation are deterministic teaching samples, not Qwen model tensors; animation
steps are not measured RTL cycles.

## Rebuild the Qwen page

The maintained compiler and standalone visualizer sources live in the sibling
`FEATHER_GEMM` repository. Rebuild its standalone HTML there before importing:

```bash
cd ../FEATHER_GEMM
python tb/scripts/build_minisa_visualizer.py
cd ../feather_tutorial
python3 tools/build_qwen_page.py --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html
python3 tools/build_qwen_page.py --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html --check
```

The importer needs only Python's standard library. `--source` can point to any
checkout of the standalone artifact; this is a build-time dependency only.
No GEMM checkout or Python server is needed by the published page. Do not use
the already packaged page as input, and do not replace the original FEATHER
editor with the Qwen page. The generated page records its source SHA-256.

## Browser regressions

Install Playwright and Chromium outside the checkout, then point the tests to
that installation. Screenshots and reports are written outside the repository.

```bash
export PLAYWRIGHT_MODULE=/path/to/node_modules/playwright
export PLAYWRIGHT_BROWSERS_PATH=/path/to/playwright/browsers
node tests/qwen_visualizer_browser_test.cjs
node tests/feather_tutorial_browser_test.cjs
node tests/site_shell_browser_test.cjs
python3 tools/build_qwen_page_test.py
```

Tests cover the original editor and unified 4/8/16-wide tutorial, all nine Qwen
operators, programmed BIRRD connectivity, VN addresses, ISA import/export,
single-element arithmetic and moving pixels, playback isolation, reduced
motion, desktop and mobile layouts. Optional webfonts on original tutorial
pages are not required for the Qwen application to work offline.
