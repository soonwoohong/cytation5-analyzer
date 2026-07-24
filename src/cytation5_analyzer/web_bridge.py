"""JSON bridge used by the Pyodide web application."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .core import (
    analyze_upload,
    build_heatmap,
    create_demo,
    mapping_to_csv,
    merge_mapping_text,
    summarize_kinetics,
)

_SESSION: dict[str, Any] | None = None


def load_upload_from_files(
    data_path: str,
    data_name: str,
    mapping_path: str = "",
    mapping_name: str = "",
) -> str:
    global _SESSION
    mapping_data = Path(mapping_path).read_bytes() if mapping_path else None
    _SESSION = analyze_upload(
        Path(data_path).read_bytes(),
        data_name,
        mapping_data,
        mapping_name,
    )
    return _session_payload(_SESSION)


def load_demo() -> str:
    global _SESSION
    _SESSION = create_demo()
    return _session_payload(_SESSION)


def kinetics(mapping_json: str, options_json: str = "{}") -> str:
    session = _require_session()
    mapping = json.loads(mapping_json)
    options = json.loads(options_json)
    result = summarize_kinetics(
        session["observations"],
        mapping,
        baseline=bool(options.get("baseline", False)),
    )
    return json.dumps(result, separators=(",", ":"))


def heatmap(mapping_json: str, options_json: str = "{}") -> str:
    session = _require_session()
    mapping = json.loads(mapping_json)
    options = json.loads(options_json)
    result = build_heatmap(
        session["observations"],
        mapping,
        float(options.get("time", 30)),
        baseline=bool(options.get("baseline", False)),
    )
    return json.dumps(result, separators=(",", ":"))


def merge_mapping(mapping_json: str, pasted_text: str) -> str:
    merged = merge_mapping_text(pasted_text, json.loads(mapping_json))
    return json.dumps(merged, separators=(",", ":"))


def export_mapping(mapping_json: str) -> str:
    return mapping_to_csv(json.loads(mapping_json))


def _session_payload(session: dict[str, Any]) -> str:
    payload = {
        key: session[key]
        for key in (
            "source_name",
            "mapping_name",
            "mapping_mode",
            "mapping",
            "timepoints",
            "report",
        )
    }
    return json.dumps(payload, separators=(",", ":"))


def _require_session() -> dict[str, Any]:
    if _SESSION is None:
        raise RuntimeError("Load a Cytation file or the demo first.")
    return _SESSION
