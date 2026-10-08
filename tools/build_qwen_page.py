#!/usr/bin/env python3
"""Package the generated FP16 explorer in the tutorial website's native shell.

This is a build-time importer, not a runtime dependency on FEATHER_GEMM. The
generated page combines upgraded ACT mappings with recorded prefill cases,
embeds its compiler metadata and JavaScript, and shares only the tutorial's
styles.css and script.js. Never use the output as the input.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MARKER = '<meta name="generator" content="feather-tutorial-qwen-packager-v1">'
SCOPE = ".qwen-app"


def compact_phone_drawing(script):
    """Narrow drawing boxes on phones without changing numerical state or hit coordinates."""
    def edit(old, new):
        nonlocal script
        if script.count(old) != 1:
            raise ValueError(f"Phone drawing adapter expected one occurrence: {old[:80]}")
        script = script.replace(old, new)

    edit('''            // Preserve logical coordinates and bound zoomed phone canvas memory.
            const requested = Math.max(2, Math.ceil((global.devicePixelRatio || 1) *
                (canvas.clientWidth || geom.width) / geom.width));
            const scale = global.FeatherMobile?.canvasScale(geom.width, geom.height, requested) ?? requested;
            const width = geom.width * scale, height = geom.height * scale;''', '''            // Compress horizontal geometry, but keep values uncompressed and
            // retain the original logical coordinates for packets and clicks.
            const phone = global.matchMedia("(max-width:900px)").matches;
            const displayWidth = phone ? 720 : geom.width, horizontalScale = displayWidth / geom.width;
            geom.pw = phone ? 30 : geom.dx - 22;
            canvas.style.aspectRatio = `${displayWidth} / ${geom.height}`;
            const requested = Math.max(2, Math.ceil((global.devicePixelRatio || 1) *
                (canvas.clientWidth || displayWidth) / displayWidth));
            const scale = global.FeatherMobile?.canvasScale(displayWidth, geom.height, requested) ?? requested;
            const width = displayWidth * scale, height = geom.height * scale;''')
    edit('ctx.setTransform(scale, 0, 0, scale, 0, 0);',
         'ctx.setTransform(scale * horizontalScale, 0, 0, scale, 0, 0);')
    edit('''            function line(points, color = C.line, width = 1, dash = []) {''', '''            function shortValue(value) {
                if (!Number.isFinite(value)) return String(value);
                const rounded = Number(value.toPrecision(2));
                const label = String(rounded).replace(/^(-?)0\\./, "$1.");
                return label.length <= 4 ? label : value.toExponential(0).replace("e+", "e");
            }
            function cellText(x, y, label, width, color, align = "center") {
                ctx.save(); ctx.translate(x, y); ctx.scale(1 / horizontalScale, 1);
                ctx.fillStyle = color; ctx.font = "11px ui-monospace, monospace"; ctx.textAlign = align;
                ctx.fillText(label, 0, 0, width * horizontalScale); ctx.restore();
            }
            function line(points, color = C.line, width = 1, dash = []) {''')
    edit('''                    const caption = `${record.identity}=${compact(value)}`;
                    const tx = Math.max(8, Math.min(880, x + 7)), ty = Math.max(14, y - 6);
                    ctx.font = "11px ui-monospace, monospace";
                    ctx.fillStyle = "#fffffff2"; ctx.fillRect(tx - 3, ty - 12, Math.min(230, ctx.measureText(caption).width + 6), 17);
                    text(tx, ty, caption, 11, color);''', '''                    const caption = phone ? shortValue(value) : `${record.identity}=${compact(value)}`;
                    const tx = Math.max(8, Math.min(phone ? geom.width - 85 : 880, x + 7)), ty = Math.max(14, y - 6);
                    ctx.font = "11px ui-monospace, monospace";
                    const labelWidth = phone ? Math.min(70, ctx.measureText(caption).width / horizontalScale + 6) : Math.min(230, ctx.measureText(caption).width + 6);
                    ctx.fillStyle = "#fffffff2"; ctx.fillRect(tx - 3, ty - 12, labelWidth, 17);
                    if (phone) cellText(tx, ty, caption, labelWidth - 6, color, "left");
                    else text(tx, ty, caption, 11, color);''')
    edit('''                    ctx.fillRect(cx + .5, cy + .2, cw - 1, Math.max(.8, ch - .4));''',
         '''                    const inset = phone ? 2.5 : .5;
                    ctx.fillRect(cx + inset, cy + .2, cw - 2 * inset, Math.max(.8, ch - .4));''')
    edit('''                    text(x + geom.pw / 2, y + geom.ph - 4, compact(value), 8, active ? "#3b3150" : "#7c858b", "center");''',
         '''                    if (phone) cellText(x + geom.pw / 2, y + geom.ph - 3, shortValue(value), geom.pw - 2, active ? "#3b3150" : "#7c858b");
                    else text(x + geom.pw / 2, y + geom.ph - 4, compact(value), 8, active ? "#3b3150" : "#7c858b", "center");''')
    edit('''                    box(Math.min(...outX) - 6, sy, Math.abs(outX[1] - outX[0]) + 12, 17, "#ad99c4", "#f5f0fa");
                    text(center, sy + 12, mode?.label || mode?.name || String(node.command), 8, C.P, "center");''',
         '''                    const switchWidth = phone ? 40 : Math.abs(outX[1] - outX[0]) + 12;
                    box(center - switchWidth / 2, sy, switchWidth, 17, "#ad99c4", "#f5f0fa");
                    const modeLabel = mode?.label || mode?.name || String(node.command);
                    if (phone) cellText(center, sy + 12, modeLabel, switchWidth - 4, C.P);
                    else text(center, sy + 12, modeLabel, 8, C.P, "center");''')
    return script


def prepare_tutorial_catalog(source):
    """Package upgraded ACT programs and recorded prefill cases for the tutorial.

    The standalone source still carries its historical workbench. Remove that
    workbench and its data here while preserving each retained packed program.
    """
    payload = re.search(r'(<script id="case-data"[^>]*>)(.*?)(</script>)', source, re.S)
    data = json.loads(payload[2])
    if "act_cases" not in data:
        return source
    bundle = data["act_cases"]
    upgraded_groups = ("optimized_full", "optimized_six")
    upgraded = [case for case in bundle["cases"] if case.get("catalog_group") in upgraded_groups]
    prefill = [case for case in bundle["cases"]
               if case["phase"] == "prefill" and case.get("catalog_group") not in upgraded_groups]
    if not upgraded:
        raise ValueError("The tutorial requires upgraded ACT mappings")
    # Preserve the upgraded default while restoring prefill's own programs,
    # hardware profiles and ISA widths without relabeling them as StaB128.
    bundle["cases"] = upgraded + prefill
    design_ids = {variant["design_id"] for case in bundle["cases"]
                  for variant in case["effective_designs"]}
    bundle["designs"] = [design for design in bundle["designs"] if design["id"] in design_ids]
    bundle.pop("comparisons", None)
    bundle["totals"] = {
        "cases": len(bundle["cases"]), "original_cases": len(prefill),
        "optimized_cases": len(upgraded),
        **{f"{phase}_cases": sum(case["phase"] == phase for case in bundle["cases"])
           for phase in ("prefill", "decode")},
        "instructions": sum(case["program"]["num_instructions"] for case in bundle["cases"]),
        "current_predicted_cycles": sum(case["schedule_cost"]["total_cycles"] for case in bundle["cases"]),
        "recorded_predicted_cycles": sum(case["recorded_schedule_cost"]["total_cycles"] for case in bundle["cases"]),
    }
    bundle["assumptions"] = [note.replace("Original ACT cases", "Recorded prefill cases")
                             for note in bundle["assumptions"]]
    first = bundle["cases"][0]
    bundle["hardware"] = first["hardware"]
    data = {"schema_version": data["schema_version"], "hardware": first["hardware"],
            "isa": first["isa"], "birrd": data["birrd"], "act_cases": bundle}
    encoded = json.dumps(data, separators=(",", ":")).replace("<", "\\u003c")
    source = source[:payload.start(2)] + encoded + source[payload.end(2):]

    def replace_one(text, pattern, replacement):
        result, count = re.subn(pattern, lambda _: replacement, text, flags=re.S)
        if count != 1:
            raise ValueError(f"Standalone explorer structure changed: {pattern}")
        return result

    source = replace_one(source, r'<div id="full-operator-legacy">.*?(?=<div id="full-operator-act")', "")
    # The full-workload view already contains the same animation and exact
    # inspector, plus matrix previews and tile traversal. Mount only that view.
    source = replace_one(source,
        r'    <section id="act-workspace".*?(?=    <div class="section-heading" id="full-operator-examples">)', '')
    source = replace_one(source,
        r'<div class="section-heading" id="full-operator-examples"><div>.*?</div><span id="full-workload-count" class="pill"></span></div>',
        '<div class="section-heading" id="full-operator-examples"><span id="full-workload-count" class="pill"></span></div>')
    source = replace_one(source, r'    <p id="full-workload-context"[^>]*></p>\n', '')
    source = replace_one(source, r'    <footer>.*?</footer>\n', '')
    source = source.replace('<div id="full-operator-act" hidden>', '<div id="full-operator-act">')
    source = source.replace(', #full-operator-legacy[hidden]', '').replace(', #full-operator-legacy', '')
    removed_scripts = (
        "Canvas helpers and BIRRD topology adapted", "Whole-tile numerical teaching model",
        "Unified FEATHER view:", "Concurrent row-skewed teaching pipeline.",
        "Mapper-driven adapter for the tutorial canvas helpers.",
    )

    def adapt_script(match):
        script = match[0]
        if any(marker in script[:180] for marker in removed_scripts):
            return ""
        if "Executable MINISA programs" in script[:100]:
            script = replace_one(script, r'    function generate\(.*?(?=    function hex\()', "")
            return script.replace("{assemble, decode, generate, validate, hex}", "{assemble, decode, hex}")
        if "Numerical teaching frames for the unified" in script[:100]:
            script = replace_one(script, r'    function build\(.*?(?=    const api =)', "")
            return script.replace("{build, sample, runNetwork, toFP16, fromFP16}", "{sample, runNetwork, toFP16, fromFP16}")
        if "Exact ACT bundle explorer" in script[:100]:
            script = replace_one(script, r'          <section id="act-optimization-summary".*?</section>\n', '')
            script = replace_one(script, r'        if \(bundle\.comparisons\?\.length\) \{.*?(?=        \$\("act-case"\)\.addEventListener)', '')
            script = replace_one(script, r'<label>ACT test case <select id="act-case"></select></label>', '')
            script = replace_one(script, r'            <button id="act-animate-example".*?</button>\n', '')
            script = script.replace('scopedId("act-case")', 'scopedId("act-case-summary")')
            script = script.replace('$("act-case").value = item.id; ', '')
            script = replace_one(script,
                r'        const groupLabels =.*?(?=            const row = document.createElement\("tr"\), name =)',
                '        for (const item of bundle.cases) {\n')
            script = script.replace('$("act-case").append(...groups.values()); ', '')
            script = replace_one(script,
                r'        \$\("act-case"\)\.addEventListener.*?(?=        \$\("act-design"\)\.addEventListener)', '')
            extra_sections = {}
            for section, title in (
                ("catalog", "All ACT cases: exact shapes and mapping choices"),
                ("provenance", "Provenance and model boundaries"),
            ):
                pattern = rf'<details><summary>{re.escape(title)}</summary>(.*?)</details>'
                match = re.search(pattern, script, re.S)
                if match is None:
                    raise ValueError(f"Standalone explorer is missing the ACT {section} details")
                extra_sections[section] = (pattern,
                    f'<section class="act-mapping-section" aria-labelledby="act-{section}-title">'
                    f'<h3 id="act-{section}-title">{title}</h3>{match[1]}</section>')
            # Keep all optional reference panels together after the mapping,
            # with the case catalog immediately following the complete trace.
            script = replace_one(script, extra_sections["catalog"][0], '')
            script = replace_one(script, extra_sections["provenance"][0],
                                 '\n          '.join(markup for _, markup in extra_sections.values()))
            for section in ("layout", "trace", "catalog", "provenance"):
                pattern = (rf'<section class="act-mapping-section" aria-labelledby="act-{section}-title">'
                           rf'<h3 id="act-{section}-title">(.*?)</h3>(.*?)</section>')
                match = re.search(pattern, script, re.S)
                if match is None:
                    raise ValueError(f"Standalone explorer is missing the ACT {section} section")
                title, contents = match.groups()
                script = replace_one(script, pattern,
                    f'<section class="act-mapping-section act-collapsible" aria-labelledby="act-{section}-title">'
                    f'<h3 id="act-{section}-title"><button id="act-{section}-toggle" type="button" '
                    f'class="act-section-toggle" aria-expanded="false" aria-controls="act-{section}-content">'
                    f'<span class="act-section-indicator" aria-hidden="true">▸</span>{title}</button></h3>'
                    f'<div id="act-{section}-content" class="act-section-content" hidden>{contents}</div></section>')
            script = replace_one(script, r'        const currentCase =', '''        function setSectionExpanded(section, expanded) {
            $(`act-${section}-content`).hidden = !expanded;
            $(`act-${section}-toggle`).setAttribute("aria-expanded", String(expanded));
        }
        for (const section of ["layout", "trace", "catalog", "provenance"]) {
            $(`act-${section}-toggle`).addEventListener("click", () => {
                setSectionExpanded(section, $(`act-${section}-content`).hidden);
            });
        }

        const currentCase =''')
            script = script.replace('() => { jumpToTile(); $("act-trace-title").scrollIntoView',
                                    '() => { setSectionExpanded("trace", true); jumpToTile(); $("act-trace-title").scrollIntoView')
            script = script.replace('return {selectCase, selectTile, state, hostId, prefix};',
                                    'return {selectCase, selectTile, setSectionExpanded, state, hostId, prefix};')
            script = replace_one(script, r'    const initial = document.getElementById\("act-workspace"\).*?global.FeatherACTView = Object.assign\(initial \|\| \{\}, \{create\}\);',
                                 '    global.FeatherACTView = {create};')
        if "ACT teaching presentation:" in script[:100]:
            script = replace_one(script, r'          <p class="act-teach-note">Continuous teaching stream:.*?</p>', '')
            script = script.replace('Click a moving packet or buffer cell for its exact source identity.', '')
            for detail, title in (
                ("source", "Calculation preview: selected source → PE → BIRRD"),
                ("output", "Calculation preview: physical destination and accumulation"),
            ):
                original = f'<h4>{title}</h4><pre id="${{prefix}}-{detail}"></pre>'
                script = replace_one(script, re.escape(original),
                    f'<h4><button id="${{prefix}}-{detail}-toggle" type="button" '
                    f'class="act-section-toggle" aria-expanded="false" aria-controls="${{prefix}}-{detail}">'
                    f'<span class="act-section-indicator" aria-hidden="true">▸</span>{title}</button></h4>'
                    f'<pre id="${{prefix}}-{detail}" hidden></pre>')
            script = script.replace('<p class="act-teach-note">These calculation previews',
                                    '<p id="${prefix}-readout-note" class="act-teach-note" hidden>These calculation previews')
            script = replace_one(script, r'        function option\(value, label\) \{', '''        for (const detail of ["source", "output"]) {
            $(`${detail}-toggle`).addEventListener("click", () => {
                const expanded = $(detail).hidden;
                $(detail).hidden = !expanded;
                $(`${detail}-toggle`).setAttribute("aria-expanded", String(expanded));
                $("readout-note").hidden = $("source").hidden && $("output").hidden;
            });
        }

        function option(value, label) {''')
            script = replace_one(script,
                r'          <div class="act-teach-controls">\s*<label>N tile.*?(?=          <div class="act-teach-playback">)', '')
            script = replace_one(script, r'        function bounded\(input, max\) \{.*?\n        \}', '''        function bounded(value, max) {
            const raw = Number(value);
            return Number.isFinite(raw) ? Math.min(max, Math.max(0, Math.floor(raw))) : 0;
        }''')
            script = script.replace('                    $(axis).value = options[axis] ?? 0;\n', '')
            script = script.replace('bounded($(axis), item.loop_counts[axis] - 1)',
                                    'bounded(options[axis] ?? 0, item.loop_counts[axis] - 1)')
            script = replace_one(script, r'                \$\("dot"\)\.replaceChildren.*?(?=                \$\("packet"\)\.textContent)', '')
            script = script.replace('const trace = state.trace, tile = trace.design.tile;', 'const trace = state.trace;')
            script = script.replace('            $("scrub").value = state.index; $("dot").value = group.index;',
                                    '            $("scrub").value = state.index;')
            script = script.replace(' $("row").value = row; $("col").value = col;', '')
            script = replace_one(script, r'        const rebuildTile =.*?(?=        \$\("mode"\)\.addEventListener)', '')
            script = replace_one(script, r'        for \(const key of \["row", "col"\]\).*?(?=        \$\("play"\)\.addEventListener)', '')
            script = replace_one(script, r'        \$\("zoom"\)\.addEventListener.*?(?=        \$\("buffer"\)\.addEventListener)', '')
            script = replace_one(script,
                r'            ctx.clearRect\(0, 0, canvas.width, canvas.height\); ctx.fillStyle = "#fafcfc"; ctx.fillRect\(0, 0, canvas.width, canvas.height\);',
                '''            // Preserve logical coordinates and bound zoomed phone canvas memory.
            const requested = Math.max(2, Math.ceil((global.devicePixelRatio || 1) *
                (canvas.clientWidth || geom.width) / geom.width));
            const scale = global.FeatherMobile?.canvasScale(geom.width, geom.height, requested) ?? requested;
            const width = geom.width * scale, height = geom.height * scale;
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width; canvas.height = height;
            }
            ctx.setTransform(scale, 0, 0, scale, 0, 0);
            ctx.clearRect(0, 0, geom.width, geom.height);
            ctx.fillStyle = "#fafcfc"; ctx.fillRect(0, 0, geom.width, geom.height);''')
            script = compact_phone_drawing(script)
            script = script.replace('* canvas.width / rect.width', '* geom.width / rect.width')
            script = script.replace('* canvas.height / rect.height', '* geom.height / rect.height')
            script = replace_one(script, r'        reduced.addEventListener\("change", updateReducedMotion\);',
                '''        reduced.addEventListener("change", updateReducedMotion);
        global.addEventListener("resize", render);
        if (global.ResizeObserver) new global.ResizeObserver(() => render()).observe($("canvas"));''')
            script = script.replace('            else target.view?.selectCase(state.trace.case.id);',
                                    '            else target.view?.selectCase(state.trace.case.id);\n'
                                    '            target.view?.setSectionExpanded("trace", true);')
            script = replace_one(script, r'    const initial = document.getElementById\("act-teaching"\).*?global.FeatherACTTeaching = Object.assign\(initial \|\| \{\}, \{create\}\);',
                                 '    global.FeatherACTTeaching = {create};')
        if "One full-workload catalog" in script[:100]:
            script = replace_one(script, r'/\* One full-workload catalog.*?\*/',
                                 '/* Full-workload catalog for upgraded ACT mappings, recorded prefill cases, and their exact packed programs. */')
            script = script.replace('{kind: "legacy", operatorIndex: 0,', '{kind: "act",')
            script = script.replace('        global.FeatherLegacyWorkbench.pause();\n', '')
            script = script.replace('            teaching: () => ({instance: teaching, hostId: "full-act-teaching"}),\n', '')
            script = script.replace('operatorIndex: null, ', '')
            script = script.replace('$("full-operator-legacy").hidden = true; ', '')
            script = replace_one(script,
                r'        \$\("full-workload-context"\)\.textContent = `ACT .*?(?=        \$\("full-loop-summary"\)\.textContent)', '')
            script = replace_one(script, r'    function legacyContext\(.*?(?=    function changeTile)',
                '    function select(value, indices = {}) {\n'
                '        value = String(value);\n'
                '        if (!value.startsWith("act:")) throw new Error(`Unknown ACT workload: ${value}`);\n'
                '        selectACT(value.slice(4), indices);\n'
                '    }\n\n')
            script = replace_one(script, r'    const legacy =.*?    const groups = \[legacy\];',
                                 '    const groups = [];')
            script = script.replace('["original", "optimized_full", "optimized_six"]', '["optimized_full", "optimized_six", "original"]')
            script = script.replace('${data.operators.length + cases.length} workloads · prefill + decode',
                                    '${cases.length} workloads · prefill + decode')
            script = replace_one(script, r'    global.addEventListener\("feather-legacy-operator-change".*?\n    \}\);\n', '')
            script = script.replace('    select("0");',
                                    '    select(`act:${cases[0].id}`);')
        return script

    source = re.sub(r'<script>.*?</script>', adapt_script, source, flags=re.S)
    replacements = {
        'One FEATHER accelerator.<br>Compute, route, accumulate.': 'Map Qwen 3 0.6B to FEATHER 16x16',
        'Explore original ACT workloads and optimized StaB128 schedules:':
            'Explore recorded prefill workloads and upgraded StaB128 decode schedules:',
        'Self-contained ACT case browser + animated teaching examples + ISA generator':
            'ACT prefill and decode case browser + workload animation + exact ISA downloads',
        'Choose N / M / K indices below ↓': 'View selected tile animation ↓',
        'Use Previous/Next to cross K and output-tile boundaries, or choose indices in the animation below.':
            'Use Previous/Next to cross K and output-tile boundaries.',
        'Inspect every prefill and decode MINISA program': 'Inspect prefill and decode MINISA programs',
        'Original ACT programs alongside StaB128 mapping upgrades and aligned Q-projection partitions.':
            'Recorded prefill programs, upgraded StaB128 decode mappings, and aligned Q-projection partitions.',
        'Original and optimized ACT test cases': 'Prefill and upgraded decode ACT test cases',
        'Choose any prefill or decode case, including its K and N tails.':
            'Choose any prefill or upgraded decode case, including its K and N tails.',
        'This player never modifies the original ACT packed program or old examples.':
            'This player preserves each recorded ACT packed program.',
        'Original ACT trace does not contain': 'Recorded ACT trace does not contain',
        'Original ACT prediction (frozen model)': 'Recorded compiler prediction (frozen model)',
        'Inspect original ACT trace ↑': 'Inspect exact ACT trace ↓',
        'original: "Original ACT"': 'original: "Recorded ACT · StaB64"',
        'item.catalog_group || "original"': 'item.catalog_group',
        'c.catalog_group || "original"': 'c.catalog_group',
    }
    for old, new in replacements.items():
        source = source.replace(old, new)
    return re.sub(r'(?m)^[ \t]+$', '', source)


def _delimiter(text, start, wanted):
    """Find a CSS delimiter outside strings, comments, and selector functions."""
    quote = None
    nesting = 0
    index = start
    while index < len(text):
        char = text[index]
        if quote:
            if char == "\\":
                index += 2
                continue
            if char == quote:
                quote = None
        elif text.startswith("/*", index):
            end = text.find("*/", index + 2)
            if end < 0:
                raise ValueError("Unterminated CSS comment")
            index = end + 2
            continue
        elif char in "\"'":
            quote = char
        elif char in "([":
            nesting += 1
        elif char in ")]":
            nesting -= 1
        elif not nesting and char in wanted:
            return index
        index += 1
    return len(text)


def _matching_brace(text, opening):
    depth = 1
    cursor = opening + 1
    while cursor < len(text):
        cursor = _delimiter(text, cursor, "{}")
        if cursor == len(text):
            break
        depth += 1 if text[cursor] == "{" else -1
        if depth == 0:
            return cursor
        cursor += 1
    raise ValueError("Unbalanced CSS rule")


def _scope_selector(selector):
    selector = selector.strip()
    # The source's document-level declarations belong to the app root only.
    if selector in (":root", "html", "body"):
        return SCOPE
    selector = re.sub(r"^(?:html\s+)?body(?=[\s.#:\[]|$)", SCOPE, selector)
    selector = re.sub(r"^(?::root|html)(?=[\s.#:\[]|$)", SCOPE, selector)
    return selector if selector.startswith(SCOPE) else f"{SCOPE} {selector}"


def scope_css(css):
    """Scope style rules, recursively handling media/supports/layer containers.

    Fail on unknown block at-rules instead of silently leaking styles into the
    site shell. Keyframe steps and font declarations are not selectors.
    """
    output = []
    cursor = 0
    while cursor < len(css):
        delimiter = _delimiter(css, cursor, "{;")
        if delimiter == len(css):
            tail = css[cursor:]
            if re.sub(r"/\*.*?\*/", "", tail, flags=re.S).strip():
                raise ValueError("Unexpected CSS text after final rule")
            output.append(tail)
            break
        prelude = css[cursor:delimiter]
        clean = re.sub(r"/\*.*?\*/", "", prelude, flags=re.S).strip()
        if css[delimiter] == ";":
            # External imports would defeat the offline payload guarantee.
            if not clean.startswith("@layer "):
                raise ValueError(f"Unsupported CSS statement: {clean}")
            output.append(prelude + ";")
            cursor = delimiter + 1
            continue
        closing = _matching_brace(css, delimiter)
        content = css[delimiter + 1:closing]
        if clean.startswith("@"):
            kind = clean.split(None, 1)[0].lower()
            if kind in ("@media", "@supports", "@layer", "@container"):
                content = scope_css(content)
            elif kind not in ("@keyframes", "@-webkit-keyframes", "@font-face", "@property"):
                raise ValueError(f"Unsupported CSS block: {clean}")
            scoped = prelude
        else:
            selectors = []
            start = 0
            while start < len(clean):
                end = _delimiter(clean, start, ",")
                selectors.append(_scope_selector(clean[start:end]))
                start = end + 1
            scoped = "\n" + ", ".join(selectors)
        output.append(scoped + " {" + content + "}")
        cursor = closing + 1
    return "".join(output)


SITE_ADAPTATION = """
/* Native tutorial theme. Diagram canvases intentionally retain a light paper
   background so their hardware color legend is identical in both themes. */
.qwen-app {
  --ink: var(--text-main); --muted: var(--text-muted);
  --line: var(--border-color); --paper: var(--bg-body);
  --teal: var(--primary-color); --teal-light: #e7dcfb;
  color-scheme: light dark; background: var(--bg-body); color: var(--text-main);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  min-width: 0; padding-bottom: 24px;
}
[data-theme="light"] .qwen-app { color-scheme: light; }
[data-theme="dark"] .qwen-app { color-scheme: dark; --teal-light: #36294e; --amber-light: #443522; }
.qwen-app > header { background: transparent; color: var(--text-main); }
.qwen-app .wrap { max-width: 1500px; padding-left: 32px; padding-right: 32px; }
.qwen-app .masthead { border-color: var(--border-color); }
.qwen-app .brand { color: var(--primary-color); }
.qwen-app .brand span, .qwen-app .hero-note, .qwen-app .intro { color: var(--text-muted); }
.qwen-app .hero .eyebrow { color: var(--primary-color); }
.qwen-app .hero { padding-top: 32px; padding-bottom: 32px; }
.qwen-app h1, .qwen-app h2, .qwen-app h3, .qwen-app h4 { font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif; }
.qwen-app .selection { margin-top: 0; }
.qwen-app .card { background: var(--bg-card); border-color: var(--border-color); box-shadow: var(--shadow-sm); }
.qwen-app button, .qwen-app select, .qwen-app input[type=number] { background: var(--bg-body); border-color: var(--border-color); color: var(--text-main); }
.qwen-app button:hover { border-color: var(--primary-color); background: var(--bg-sidebar); }
.qwen-app .primary { background: var(--primary-color); color: #180f2a; border-color: var(--primary-color); }
.qwen-app .primary:hover { background: var(--secondary-color); color: #180f2a; }
.qwen-app .badge, .qwen-app .pill { border-color: var(--border-color); color: var(--text-muted); }
.qwen-app .callout, .qwen-app .code-note, .qwen-app .detail-value,
.qwen-app .accelerator-control, .qwen-app .motion-workbench,
.qwen-app .motion-element-group, .qwen-app .motion-readouts pre,
.qwen-app .array-workbench, .qwen-app .array-readouts pre {
  background: var(--bg-sidebar); color: var(--text-main); border-color: var(--border-color);
}
.qwen-app .callout { border-left-color: var(--primary-color); }
.qwen-app .accelerator-control span, .qwen-app .motion-status,
.qwen-app .motion-element-group h4, .qwen-app .motion-element-detail,
.qwen-app .motion-vn-label, .qwen-app .array-status { color: var(--text-muted); }
.qwen-app .motion-vn-strip button { background: var(--bg-card); color: var(--text-main); border-color: var(--border-color); }
.qwen-app .motion-vn-strip button.current-element { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
.qwen-app .motion-vn-strip button.completed-element { border-bottom-color: var(--primary-color); }
[data-theme="dark"] .qwen-app .motion-vn-label.weight { color: #f4d397; }
[data-theme="dark"] .qwen-app .motion-vn-strip.weight button { background: #443522; color: #f4d397; border-color: #786043; }
[data-theme="dark"] .qwen-app .motion-vn-strip.weight button.current-element { background: #36294e; color: #e5d3ff; border-color: var(--primary-color); }
.qwen-app .tabs button[aria-selected=true] { background: rgba(120, 100, 255, .16); color: var(--primary-color); }
.qwen-app th, .qwen-app tr.active td { background: var(--bg-sidebar); }
.qwen-app .cost-breakdown div { border-color: var(--border-color); }
.qwen-app #buffer-table td button { border-color: var(--border-color); }
.qwen-app #buffer-table td button.highlight { background: var(--bg-sidebar); border-color: var(--primary-color); }
.qwen-app .reduction.selected { border-color: var(--primary-color); box-shadow: 0 0 0 1px var(--primary-color); }
[data-theme="dark"] .qwen-app .partial.first { color: #d3c2f3; }
[data-theme="dark"] .qwen-app .partial.second { color: #f4d397; }
.qwen-app .program-preview { background: var(--code-bg); color: var(--code-text); }
.qwen-app .act-details { background: var(--bg-sidebar); color: var(--text-main); }
.qwen-app .act-collapsible { border: 0; margin: 12px 0; padding: 0; }
.qwen-app .act-collapsible > h3 { margin: 0; }
.qwen-app .act-section-content { margin-top: 12px; }
.qwen-app .act-section-toggle { display: flex; align-items: center; gap: 10px; text-align: left; }
.qwen-app .act-section-indicator { display: inline-block; }
.qwen-app .act-section-toggle[aria-expanded="true"] .act-section-indicator { transform: rotate(90deg); }
.qwen-app .act-teach-packet:empty { display: none; }
.qwen-app #act-layout-table button[aria-pressed=true],
.qwen-app #act-trace tr[data-current=true] td,
.qwen-app #full-act-layout-table button[aria-pressed=true],
.qwen-app #full-act-trace tr[data-current=true] td {
  background: var(--bg-sidebar); color: var(--text-main);
  border-color: var(--primary-color);
}
.qwen-app #act-layout-table button[aria-pressed=true], .qwen-app #full-act-layout-table button[aria-pressed=true] { box-shadow: inset 0 0 0 1px var(--primary-color); }
.qwen-app #act-trace tr[data-current=true] td:first-child, .qwen-app #full-act-trace tr[data-current=true] td:first-child { box-shadow: inset 3px 0 var(--primary-color); }
/* Keep the specified operand colors readable beside the light hardware SVG. */
.qwen-app .act-legend { background: #fafcfc; color: #596d7b; padding: 8px; border-radius: 6px; color-scheme: light; }
.qwen-app .act-grid, .qwen-app .act-grid > * { min-width: 0; }
.qwen-app #act-workspace, .qwen-app #act-teaching, .qwen-app #teaching-examples,
.qwen-app #full-operator-examples, .qwen-app #full-act-workspace, .qwen-app #full-act-teaching {
  scroll-margin-top: calc(var(--header-height) + 16px);
}
.qwen-app .nest-viewport, .qwen-app .canvas-scroll { background: #fafcfc; border: 1px solid var(--border-color); border-radius: var(--radius-sm); }
.qwen-app section { margin-bottom: 24px; }
.qwen-app .datapath-grid, .qwen-app .program-grid { min-width: 0; }
.qwen-app .datapath-grid > *, .qwen-app .program-grid > * { min-width: 0; }
@media (max-width: 1280px) {
  .qwen-app .datapath-grid { grid-template-columns: minmax(0, 1fr); }
  .qwen-app .program-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 1000px) {
  .qwen-app .selection { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 650px) {
  .qwen-app .wrap { padding-left: 14px; padding-right: 14px; }
  .qwen-app .hero { padding-top: 24px; padding-bottom: 24px; }
  .qwen-app h1 { font-size: 32px; }
  .qwen-app .section-heading { flex-wrap: wrap; }
  .qwen-app .selection > * { min-width: 0; }
  .qwen-site .header-title { font-size: .9rem; }
}
"""


def build(source, shell):
    if MARKER in source:
        raise ValueError("Input is already packaged; use the standalone GEMM explorer")
    for required in ('id="case-data"', 'id="nest"', 'id="motion-play"'):
        if required not in source:
            raise ValueError(f"Not a supported standalone Qwen explorer: missing {required}")
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    source = prepare_tutorial_catalog(source)
    styles = re.findall(r"<style(?:\s[^>]*)?>(.*?)</style>", source, re.S | re.I)
    body_match = re.search(r"<body(?:\s[^>]*)?>(.*?)</body>", source, re.S | re.I)
    if not styles or body_match is None:
        raise ValueError("Standalone source must contain embedded CSS and a body")
    prefix_match = re.search(r"(<div class=\"app-layout\">.*?</header>)", shell, re.S)
    if prefix_match is None:
        raise ValueError("The selected shell page no longer contains the expected tutorial shell")
    prefix = prefix_match.group(1)
    prefix = prefix.replace(' class="active"', '')
    link = '<li><a href="QWEN3_MINISA_VISUALIZER.html" class="active" aria-current="page">Qwen3 MINISA Explorer</a></li>'
    if 'href="QWEN3_MINISA_VISUALIZER.html"' in prefix:
        prefix = re.sub(r'<li><a href="QWEN3_MINISA_VISUALIZER\.html"[^>]*>.*?</a></li>', link, prefix)
    else:
        prefix = prefix.replace('<li><a href="FEATHER.html">FEATHER</a></li>', '<li><a href="FEATHER.html">FEATHER</a></li>\n            ' + link)
    prefix = re.sub(r'(<div class="header-title">).*?(</div>)', r'\1Qwen3 MINISA Explorer\2', prefix)
    if prefix.count('aria-current="page"') != 1:
        raise ValueError("Unable to install Qwen page's active sidebar link")
    body = body_match.group(1).strip()
    # Avoid a nested main landmark; preserve #main and all application controls.
    body = re.sub(r'<main\b', '<div', body, count=1)
    body = re.sub(r'</main>', '</div>', body, count=1)
    body = body.replace(
        "Self-contained: no server, network requests or external libraries required.",
        "Compiler data and animation code are embedded. This page shares the tutorial's local style and navigation assets."
    )
    scoped = scope_css("\n".join(styles))
    return f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Qwen3 MINISA Explorer · FEATHER Tutorial</title>
  <meta name="description" content="Program FEATHER and explore Qwen3 operator mappings, NEST computation, BIRRD routing, and animated array dataflow.">
  {MARKER}
  <meta name="qwen-source-sha256" content="{digest}">
  <link rel="stylesheet" href="styles.css">
  <style>{scoped}\n{SITE_ADAPTATION}</style>
  <link rel="stylesheet" href="script/mobile.css">
  <script src="script/mobile.js" defer></script>
</head>
<body class="qwen-site">
  <!-- Generated by tools/build_qwen_page.py from the maintained FEATHER_GEMM
       standalone explorer. Local site assets are the only runtime dependencies. -->
  {prefix}
      <div class="qwen-app" data-site-metadata="feather-tutorial-qwen-v1">
{body}
      </div>
    </main>
  </div>
  <script src="script.js"></script>
</body>
</html>
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path,
                        help="Standalone FEATHER_GEMM/RTL/fp16/QWEN3_MINISA_VISUALIZER.html")
    parser.add_argument("--out", type=Path, default=ROOT / "QWEN3_MINISA_VISUALIZER.html")
    parser.add_argument("--shell", type=Path, default=ROOT / "FEATHER.html",
                        help="Existing tutorial page whose sidebar and top bar are preserved")
    parser.add_argument("--check", action="store_true", help="Check freshness without writing")
    args = parser.parse_args()
    if args.source.resolve() == args.out.resolve():
        parser.error("Source and output must be different files")
    try:
        result = build(args.source.read_text(encoding="utf-8"), args.shell.read_text(encoding="utf-8"))
        current = args.out.read_text(encoding="utf-8") if args.out.exists() else None
        if args.check:
            if current != result:
                parser.exit(1, f"Stale or missing: {args.out}\n")
            print(f"Fresh: {args.out}")
        else:
            if current is not None and MARKER not in current:
                parser.error(f"Refusing to overwrite a non-packaged page: {args.out}")
            args.out.write_text(result, encoding="utf-8")
            print(f"Wrote {args.out} ({len(result.encode('utf-8')):,} bytes)")
    except (OSError, ValueError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
