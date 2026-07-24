"""Command-line inspection for Cytation5 exports."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .core import analyze_upload


def main() -> None:
    parser = argparse.ArgumentParser(prog="cytation5-analyzer")
    parser.add_argument("data", type=Path, help="Raw Cytation5 XLSX or CSV export")
    parser.add_argument("--mapping", type=Path, help="Optional plate-map file")
    args = parser.parse_args()

    result = analyze_upload(
        args.data.read_bytes(),
        args.data.name,
        args.mapping.read_bytes() if args.mapping else None,
        args.mapping.name if args.mapping else "",
    )
    summary = {
        "source_name": result["source_name"],
        "mapping_name": result["mapping_name"],
        "mapping_mode": result["mapping_mode"],
        "timepoints": result["timepoints"],
        "report": result["report"],
    }
    print(json.dumps(summary, indent=2))
