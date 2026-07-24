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

            self.assertIn("Kinetic curves", html)
            self.assertIn("Plate map", html)
            self.assertIn("Optional", html)
            self.assertIn('view: "kinetics"', javascript)
            self.assertIn("load_upload_from_files", javascript)
            self.assertNotIn("chatgpt.site", html)
            self.assertTrue(
                (destination / "python" / "cytation5_analyzer" / "core.py").is_file()
            )
            self.assertTrue((destination / ".nojekyll").is_file())


if __name__ == "__main__":
    unittest.main()
