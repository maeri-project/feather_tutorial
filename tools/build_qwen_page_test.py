#!/usr/bin/env python3
"""Standard-library checks for the standalone-to-site Qwen page packager."""

import hashlib
import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build_qwen_page.py")
SPEC = importlib.util.spec_from_file_location("build_qwen_page", SCRIPT)
PACKAGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGER)

STYLE = """:root { --ink: #123; } body { color: var(--ink); }
header, button:not(.one, .two) { border: 0; }
@media (max-width: 600px) {
  @supports (display: grid) { body .grid, [data-label=\"a,b{c}\"] { display: grid; } }
}
"""
SCRIPTS = '''<script id="case-data" type="application/json">{"operators":[{"name":"q_proj","M":128}],"encoding":"FP16"}</script>
<script>const quote = "<header>payload</header>"; window.mapping = {tile: [32,32,32]};</script>
<script>window.motion = function () { return "A[m,k] → BIRRD → C[m,n]"; };</script>'''
SOURCE = f'''<!doctype html><html><head><style>{STYLE}</style></head><body>
<header><h1>FEATHER</h1></header><main id="main" class="wrap">
<button id="motion-play">Animate</button><canvas id="nest"></canvas>
<p>Self-contained: no server, network requests or external libraries required.</p>
</main>{SCRIPTS}</body></html>'''


class CssScopingTest(unittest.TestCase):
    def test_document_rules_and_selector_functions(self):
        result = PACKAGER.scope_css(STYLE)
        self.assertIn('.qwen-app { --ink: #123; }', result)
        self.assertIn('.qwen-app { color: var(--ink); }', result)
        self.assertIn('.qwen-app header, .qwen-app button:not(.one, .two)', result)
        self.assertIn('.qwen-app .grid, .qwen-app [data-label="a,b{c}"]', result)
        self.assertNotRegex(result, r'(?:^|[{}])\s*(?:body|header|:root)\s*[{,]')

    def test_comments_strings_and_nested_conditionals(self):
        css = '''/* braces { } */ @media (width < 800px) {
          @supports (display: grid) { a::before { content: "comma,brace}"; /* } */ } } }
        '''
        result = PACKAGER.scope_css(css)
        self.assertIn('@media (width < 800px)', result)
        self.assertIn('@supports (display: grid)', result)
        self.assertIn('.qwen-app a::before', result)
        self.assertIn('content: "comma,brace}"; /* } */', result)

    def test_keyframes_are_not_prefixed_as_selectors(self):
        css = '@keyframes pulse { from { opacity: 0; } to { opacity: 1; } } .dot { animation: pulse 1s; }'
        result = PACKAGER.scope_css(css)
        self.assertIn('from { opacity: 0; }', result)
        self.assertNotIn('.qwen-app from', result)
        self.assertIn('.qwen-app .dot', result)

    def test_fail_closed_on_unsupported_or_incomplete_css(self):
        for css in ('@import url("external.css");', '@unknown foo { body { color: red; } }',
                    'body { color: red;', '/* unterminated', 'body { color: red; } stray'):
            with self.subTest(css=css), self.assertRaises(ValueError):
                PACKAGER.scope_css(css)


class PagePackagingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = (PACKAGER.ROOT / "index.html").read_text(encoding="utf-8")

    def test_payload_and_control_ids_are_unchanged(self):
        result = PACKAGER.build(SOURCE, self.shell)
        source_scripts = re.findall(r'<script\b[^>]*>.*?</script>', SOURCE, re.S)
        result_scripts = re.findall(r'<script\b[^>]*>.*?</script>', result, re.S)
        self.assertEqual(result_scripts[:-1], source_scripts)
        self.assertEqual(result_scripts[-1], '<script src="script.js"></script>')
        for identifier in ('main', 'motion-play', 'nest', 'case-data'):
            self.assertEqual(result.count(f'id="{identifier}"'), 1)
        self.assertIn(hashlib.sha256(SOURCE.encode('utf-8')).hexdigest(), result)
        self.assertIn('<div id="main" class="wrap">', result)
        self.assertEqual(len(re.findall(r'<main\b', result)), 1)
        self.assertEqual(result.count('</main>'), 1)

    def test_native_shell_has_exactly_one_active_sidebar_link(self):
        result = PACKAGER.build(SOURCE, self.shell)
        sidebar = re.search(r'<aside class="sidebar">(.*?)</aside>', result, re.S).group(1)
        self.assertEqual(sidebar.count('class="active"'), 1)
        self.assertEqual(sidebar.count('aria-current="page"'), 1)
        self.assertIn('href="QWEN3_MINISA_VISUALIZER.html" class="active" aria-current="page"', sidebar)
        self.assertIn('href="FEATHER.html"', sidebar)
        for identifier in ('theme-toggle', 'mobile-menu-btn', 'mobile-close-btn'):
            self.assertEqual(result.count(f'id="{identifier}"'), 1)
        self.assertIn('href="styles.css"', result)
        self.assertIn('data-site-metadata="feather-tutorial-qwen-v1"', result)
        self.assertIn('--paper: var(--bg-body)', result)
        self.assertIn('[data-theme="dark"] .qwen-app', result)
        self.assertNotIn('<iframe', result)

    def test_double_packaging_and_invalid_input_are_rejected(self):
        result = PACKAGER.build(SOURCE, self.shell)
        with self.assertRaisesRegex(ValueError, 'already packaged'):
            PACKAGER.build(result, self.shell)
        with self.assertRaisesRegex(ValueError, 'missing id="nest"'):
            PACKAGER.build(SOURCE.replace('id="nest"', 'id="other"'), self.shell)
        with self.assertRaisesRegex(ValueError, 'expected tutorial shell'):
            PACKAGER.build(SOURCE, '<html><body>not the site shell</body></html>')

    def test_shell_without_qwen_link_gets_one(self):
        shell = re.sub(r'\s*<li><a href="QWEN3_MINISA_VISUALIZER\.html"[^>]*>.*?</a></li>', '', self.shell)
        result = PACKAGER.build(SOURCE, shell)
        self.assertEqual(result.count('href="QWEN3_MINISA_VISUALIZER.html"'), 1)
        self.assertEqual(result.count('aria-current="page"'), 1)


class CommandLineTest(unittest.TestCase):
    def run_tool(self, *arguments):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, arguments)],
                              capture_output=True, text=True, check=False)

    def test_source_output_alias_and_existing_page_are_preserved(self):
        with tempfile.TemporaryDirectory(prefix='feather-packager-test-') as temporary:
            source = Path(temporary) / 'source.html'
            output = Path(temporary) / 'other.html'
            source.write_text(SOURCE, encoding='utf-8')
            output.write_text('<html>unrelated authored page</html>', encoding='utf-8')
            same = self.run_tool('--source', source, '--out', source.parent / '.' / source.name)
            self.assertNotEqual(same.returncode, 0)
            self.assertIn('Source and output must be different files', same.stderr)
            self.assertEqual(source.read_text(encoding='utf-8'), SOURCE)
            other = self.run_tool('--source', source, '--out', output)
            self.assertNotEqual(other.returncode, 0)
            self.assertIn('Refusing to overwrite', other.stderr)
            self.assertEqual(output.read_text(encoding='utf-8'), '<html>unrelated authored page</html>')

    def test_freshness_check_and_stale_check_do_not_write(self):
        with tempfile.TemporaryDirectory(prefix='feather-packager-test-') as temporary:
            source = Path(temporary) / 'source.html'
            output = Path(temporary) / 'site.html'
            source.write_text(SOURCE, encoding='utf-8')
            result = self.run_tool('--source', source, '--out', output)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(PACKAGER.MARKER, output.read_text(encoding='utf-8'))
            fresh = self.run_tool('--source', source, '--out', output, '--check')
            self.assertEqual(fresh.returncode, 0, fresh.stderr)
            original_output = output.read_bytes()
            source.write_text(SOURCE.replace('FP16', 'FP32'), encoding='utf-8')
            stale = self.run_tool('--source', source, '--out', output, '--check')
            self.assertEqual(stale.returncode, 1)
            self.assertIn('Stale or missing', stale.stderr)
            self.assertEqual(output.read_bytes(), original_output)


if __name__ == '__main__':
    unittest.main(verbosity=2)
