#!/usr/bin/env python3
"""Package the generated FP16 explorer in the tutorial website's native shell.

This is a build-time importer, not a runtime dependency on FEATHER_GEMM. The
generated page embeds its compiler metadata and JavaScript, and shares only the
tutorial's styles.css and script.js. Never use the output as the input.
"""

import argparse
import hashlib
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MARKER = '<meta name="generator" content="feather-tutorial-qwen-packager-v1">'
SCOPE = ".qwen-app"


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
    styles = re.findall(r"<style(?:\s[^>]*)?>(.*?)</style>", source, re.S | re.I)
    body_match = re.search(r"<body(?:\s[^>]*)?>(.*?)</body>", source, re.S | re.I)
    if not styles or body_match is None:
        raise ValueError("Standalone source must contain embedded CSS and a body")
    prefix_match = re.search(r"(<div class=\"app-layout\">.*?</header>)", shell, re.S)
    if prefix_match is None:
        raise ValueError("index.html no longer contains the expected tutorial shell")
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
    digest = hashlib.sha256(source.encode("utf-8")).hexdigest()
    scoped = scope_css("\n".join(styles))
    return f'''<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Qwen3 MINISA Explorer · FEATHER Tutorial</title>
  <meta name="description" content="Program FEATHER and explore Qwen3 operator mappings, NEST computation, BIRRD routing, and animated array dataflow.">
  {MARKER}
  <meta name="qwen-source-sha256" content="{digest}">
  <link rel="stylesheet" href="styles.css">
  <style>{scoped}\n{SITE_ADAPTATION}</style>
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
    parser.add_argument("--check", action="store_true", help="Check freshness without writing")
    args = parser.parse_args()
    if args.source.resolve() == args.out.resolve():
        parser.error("Source and output must be different files")
    try:
        result = build(args.source.read_text(encoding="utf-8"), (ROOT / "index.html").read_text(encoding="utf-8"))
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
