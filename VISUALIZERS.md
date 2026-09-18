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
  the nine original full-layer prefill operators plus all 22 recorded ACT
  prefill/decode workloads. All 31 choices are available in **Full-workload
  demonstrations**, with synchronized N/M/K tile navigation, animation,
  physical-buffer layouts, and instruction views. ACT cases preserve their
  recorded partition shapes and original instruction downloads; they are not
  relabeled as complete Qwen layers. Each case also has a separate animated
  teaching example. Real BIRRD commands, deterministic synthetic dataflow, and
  packed MINISA generation/import/export remain available. The website
  shell shares `styles.css` and `script.js`; application styles are scoped so
  they cannot change the sidebar. Both light and dark site themes are supported.

The Qwen page's browser ISA execution is a control preview, not a connection to
an FPGA. Its programming panel documents how to run the exported instruction
image using the maintained FEATHER_GEMM RTL runner. Workload values in the
animation are deterministic teaching samples, not Qwen model tensors; animation
steps are not measured RTL cycles.

## Entire-array animation

The Qwen page defaults to **Entire array · overlapping pipeline** for the
original operators. Press **Animate array** or **Jump to overlap**. ACT teaching
widgets also offer **Jump to overlap**, including the widgets embedded in the
full-workload section. The original scalar path remains available as
**Isolated result explanation · one path**; it explains one result, not the
timing of the whole array. Use pause, arrows, the scrubber, reset, or speed
controls to inspect:

- FP16 input and weight transfers into the banked buffers and PE weight preload.
- Row-staggered inputs and MACs: each PE row receives a sample one logical
  cycle after its upstream row, with source identity and physical addresses.
- Completed rows taking the column buses while later rows continue computing;
  the eight programmed BIRRD stages and output writes overlap both operations.
- Partial results retaining their source row and dot group throughout the
  network, even when different groups are active simultaneously.
- Exact physical output destinations. The original 32×32 examples fill all
  1,024 cells over eight dot groups; ACT cases use their actual tile layouts,
  active lanes, padding, and tail shapes.
- FP32 contributions retained across K tiles, with FP16 rounding and Store only
  on the final K tile. Select the last K tile to see the Store animation.

With 16 resident weights and 48 inputs streamed from cycle 0, the first dot's
PE rows complete at logical cycles 15–30. The registered column bus carries
those rows at cycles 16–31; the next dot's row 0 takes the bus at cycle 32.
Inputs, computation, bus transfers, all occupied BIRRD stages, and output
writes are shown together. Short-VN dot groups are spaced at least 16 cycles
apart to avoid column-bus contention, and changed mappings or weights retain
their preload barriers.

These are idealized teaching cycles: bulk transfers, RTL arithmetic flush
latency, and controller gaps are compressed, not measured hardware clocks.
The deployed RTL's extra arithmetic latency and dot-group gaps mean its exact
timestamps differ. The whole-tile schedule overview is a separate control-phase
summary, not a MAC-cycle waveform. Single-element, entire-array, overview, ISA,
and ACT teaching playback clocks are mutually exclusive. Reduced-motion
preferences use discrete snapshots; nothing autoplays.

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
python3 tools/build_qwen_page.py --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html --shell QWEN3_MINISA_VISUALIZER.html
python3 tools/build_qwen_page.py --source ../FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html --shell QWEN3_MINISA_VISUALIZER.html --check
```

The importer needs only Python's standard library. `--source` can point to any
checkout of the standalone artifact; this is a build-time dependency only.
`--shell` preserves the selected existing page's navigation and top bar; it
defaults to `FEATHER.html` when creating a page for the first time.
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
node tests/pipeline_browser_test.cjs
python3 tools/build_qwen_page_test.py
```

Tests cover the original editor and unified 4/8/16-wide tutorial, the nine
original Qwen operators and all 22 ACT workload selections, programmed BIRRD
connectivity, VN addresses, ISA import/export, scalar and row-staggered array
arithmetic, simultaneous input/bus/network/output packets, moving pixels,
playback isolation, reduced motion, and desktop/mobile layouts. The numeric
array test loads the embedded models from this page, without requiring a GEMM
checkout. Optional webfonts on original tutorial pages are not required for
the Qwen application to work offline.
