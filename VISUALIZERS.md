# FEATHER visualizers

The left sidebar offers two complementary pages:

- `FEATHER.html` preserves the tutorial's original generic MINISA editor and
  documentation. Its single FEATHER tab connects NEST and BIRRD; the VN-buffer
  tab remains separate. The generic editor has no switch-command field, so its
  BIRRD animation is explicitly a PASS topology preview, not a configured
  reduction or cycle-accurate hardware trace. Click the streaming, stationary,
  or output buffer in the architecture (or its **Inspect** button) to open a
  live scalar-layout inspector without leaving the diagram.
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

## Entire-array animation

On the Qwen page, choose **Entire array** in the **Dataflow animation** selector,
then **Animate entire array**. The original **Single element** view is retained.
Use pause, arrows, the scrubber, reset, or speed controls to inspect:

- FP16 input and weight transfers into the banked buffers and PE weight preload.
- All 256 PE accumulators updating over 16 MAC steps per dot group.
- Sixteen row waves per group moving through the eight programmed BIRRD stages;
  only the eight committed output ports write the output buffer.
- All 1,024 cells filling in the 32×32 output heatmap over eight dot groups.
- FP32 contributions retained across K tiles, with FP16 rounding and Store only
  on the final K tile. Select the last K tile to see the Store animation.

The 332 logical frames compress bulk transfers and illustrate concurrent waves,
not physical RTL cycle timing. Every MAC and committed row wave is represented.
Single-element, entire-array, overview, and ISA playback clocks are mutually
exclusive. Reduced-motion preferences use discrete snapshots; nothing autoplays.

## Generic tutorial buffer inspection

The buffer pop-up shows physical banks and scalar rows, logical tensor
coordinates, VN indices, and VN lanes for all six layout orders and 4/8/16-wide
arrays. It uses the layouts in effect for the current EM/ES pair. The architecture
and VN-buffer tab share the same renderer: every bank/VN-row box contains all AH
scalar lanes, with identical addresses, current-window rows, and read/write
highlights in both tabs. Large inspector layouts are paged in bounded
eight-row windows; use the row field to jump directly to an address.

Read highlights and labeled A/B packets identify which scalars move into which
PEs. Forwarded inputs between PE rows are distinguished from new SRAM reads.
Partial results retain their identity through column buses and BIRRD, then
travel to the configured output bank and scalar row. The destination is marked
preview-written only at arrival; backward stepping reverses that view. Both
diagram views show a bounded four-VN-row neighborhood plus every VN row needed
by simultaneous reads or the arriving result wave. Non-contiguous rows retain
their actual row numbers. Every active transfer terminates at its real displayed
scalar lane; undisplayed addresses never fall back to a buffer edge. Buffer cards
grow to contain the displayed lanes, and arriving result tags and markers stay
within the output-buffer boundary. Small BIRRD port markers are not SRAM banks.

The pop-up shares Play/Pause and Step with the diagram, supports keyboard cell
navigation, and has a Follow active transfers switch. It does not autoplay or
block the diagram. Use **Move left / Move right** on desktop to uncover the
array while keeping its buffer layout visible. Arriving output writes take priority in Follow and the
transfer list. Escape closes the inspector before closing an expanded diagram.

These are exact configured addresses and symbolic data identities, not numeric
tensor values. The generic editor contains neither tensor payloads nor BIRRD
reduction commands. Its animation is a bounded teaching excerpt, not a complete
execution of all T dot groups. PASS outputs therefore show intended partial-sum
destinations, not completed GEMM values or verified hardware writes; conflicts
and invalid/unmapped addresses are reported instead of silently wrapped.

### Follow moving elements

The **Detailed data movement** panel enlarges one current transfer into a moving
element card. **Follow element** selects it; **Replay transfer** moves it from
source to destination and pauses at arrival without advancing to the next
frame. Drag **Transfer** to inspect any intermediate position. **Play** shares
the main animation clock, and the existing Speed control applies to replay.
Selecting an active scalar in a buffer pop-up also selects its moving packet.

Every overview packet now carries a shape and an address/provenance tag, leaves
a visible trail, and retains a source marker. Input/weight tags encode physical
bank and scalar row; multicast copies keep the same tag. Partial-result tags
encode mapping, source PE, and dot group and persist through all PASS stages
and output writeback. A highlighted packet's physical endpoints are outlined
in the overview; the detail card spells out its current hop and original source.
The magnified lane is a teaching close-up of that hop, not additional hardware.
Semantic colors remain input `#004C99`, weight `#006633`, partial `#4C0099`, and
output `#990000`. No independent playback timer or fabricated tensor values are
introduced. Reduced-motion mode retains discrete snapshots.

Keep `script/feather_buffer_model.js`, `script/feather_buffer_view.js`, `script/feather_buffer_integration.js`,
`script/feather_buffer_popup.js`, `script/feather_buffer_popup.css`,
`script/feather_packet_motion.js`, and `script/feather_packet_motion.css` alongside
the HTML when publishing or opening it locally. These assets require no server
API, compiler process, or third-party JavaScript dependency.

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
node tests/feather_buffer_model_test.cjs
node tests/feather_buffer_view_test.cjs
node tests/feather_buffer_integration_test.cjs
node tests/feather_buffer_browser_test.cjs
node tests/feather_buffer_alignment_browser_test.cjs
node tests/feather_packet_motion_browser_test.cjs
node tests/site_shell_browser_test.cjs
node tests/array_animation_test.cjs
node tests/array_browser_test.cjs
python3 tools/build_qwen_page_test.py
```

Tests cover the original editor and unified 4/8/16-wide tutorial, all nine Qwen
operators, programmed BIRRD connectivity, VN addresses, ISA import/export,
single-element arithmetic and moving pixels, playback isolation, reduced
motion, desktop and mobile layouts. Optional webfonts on original tutorial
pages are not required for the Qwen application to work offline.
