"""Assemble the dependency-free GitHub Pages artifact."""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def build_site(destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(ROOT / "web", destination)
    package_destination = destination / "python" / "cytation5_analyzer"
    shutil.copytree(ROOT / "src" / "cytation5_analyzer", package_destination)
    assets = destination / "assets"
    assets.mkdir(exist_ok=True)
    shutil.copy2(ROOT / "public" / "favicon.svg", assets / "favicon.svg")
    shutil.copy2(ROOT / "public" / "og.png", assets / "og.png")
    (destination / ".nojekyll").write_text("", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "_site",
        help="Destination directory",
    )
    args = parser.parse_args()
    build_site(args.output.resolve())
    print(args.output.resolve())


if __name__ == "__main__":
    main()
