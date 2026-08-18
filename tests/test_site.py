from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SiteBuildTests(unittest.TestCase):
    def test_static_site_contains_python_engine_and_kinetic_default(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            destination = Path(temporary) / "site"
            subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "scripts" / "build_site.py"),
                    "--output",
                    str(destination),
                ],
                check=True,
                capture_output=True,
                text=True,
            )

            html = (destination / "index.html").read_text(encoding="utf-8")
            javascript = (destination / "app.js").read_text(encoding="utf-8")
            stylesheet = (destination / "styles.css").read_text(encoding="utf-8")

            self.assertIn("Kinetic curves", html)
            self.assertIn("Plate map", html)
            self.assertIn("Optional", html)
            self.assertIn("Plate layout", html)
            self.assertIn('id="plate-grid"', html)
            self.assertIn('<option value="publication">Publication vivid</option>', html)
            self.assertIn('<option value="band">SD band</option>', html)
            self.assertIn('<option value="bars">SD error bars</option>', html)
            self.assertNotIn('value="sem"', html)
            self.assertIn('id="line-width-number"', html)
            self.assertIn('id="ntc-color" type="color" value="#000000"', html)
            self.assertIn('id="base-font"', html)
            self.assertNotIn('id="title-font"', html)
            self.assertIn('id="grid-toggle" type="checkbox" />', html)
            self.assertIn('id="interactive-toggle" type="checkbox" />', html)
            self.assertIn('id="save-settings"', html)
            self.assertIn('id="load-settings"', html)
            self.assertIn('id="panel-export-select"', html)
            self.assertIn('id="export-panel-png"', html)
            self.assertIn('id="export-panel-svg"', html)
            self.assertIn('view: "kinetics"', javascript)
            self.assertIn("load_upload_from_files", javascript)
            self.assertIn("seriesLineDash", javascript)
            self.assertIn("isNtcSeries", javascript)
            self.assertIn("kineticSeriesColor", javascript)
            self.assertIn("exportPanelFigure", javascript)
            self.assertIn("standalonePanelLayout", javascript)
            self.assertIn("staticPlot: !interactive", javascript)
            self.assertIn("renderPlateLayout", javascript)
            self.assertIn("cytation5-analyzer-settings", javascript)
            self.assertIn("width: 1600", javascript)
            self.assertIn("height: 900", javascript)
            self.assertIn("Fluorescence intensity (a.u.)", javascript)
            self.assertIn("aspect-ratio: 16 / 9", stylesheet)
            self.assertNotIn("chatgpt.site", html)
            self.assertIn("vendor/pyodide/pyodide.js", html)
            self.assertNotIn("cdn.jsdelivr.net/pyodide", html)
            self.assertTrue(
                (destination / "python" / "cytation5_analyzer" / "core.py").is_file()
            )
            self.assertTrue(
                (destination / "vendor" / "pyodide" / "pyodide.asm.wasm").is_file()
            )
            self.assertTrue(
                (destination / "vendor" / "pyodide" / "python_stdlib.zip").is_file()
            )
            self.assertTrue(
                (destination / "vendor" / "pyodide" / "LICENSE").is_file()
            )
            self.assertTrue((destination / ".nojekyll").is_file())


if __name__ == "__main__":
    unittest.main()
