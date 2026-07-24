"""Cytation5 parsing, plate mapping, and fluorescence summaries."""

from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import statistics
from collections import defaultdict
from datetime import datetime, time, timedelta
from typing import Any, Iterable

from .xlsx import read_tabular_file

WELL_RE = re.compile(r"^([A-P])(\d{1,2})$", re.IGNORECASE)
TIME_RE = re.compile(r"^(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$")
WELL_ALIASES = {"well", "well_id", "position"}
TARGET_ALIASES = {"target", "sample", "condition"}
CRRNA_ALIASES = {"crrna", "cr_rna", "assay", "guide"}
MAP_MARKERS = {"384 maps", "96 maps", "384 map", "96 map"}


def analyze_upload(
    data: bytes,
    data_name: str,
    mapping_data: bytes | None = None,
    mapping_name: str = "",
) -> dict[str, Any]:
    observations, report = parse_cytation(data, data_name)
    raw_wells = sorted({item["well"] for item in observations}, key=well_sort_key)

    if mapping_data:
        supplied = parse_mapping(mapping_data, mapping_name)
        supplied_by_well = {item["well"]: item for item in supplied}
        raw_set = set(raw_wells)
        missing_mapped = sorted(
            (well for well in supplied_by_well if well not in raw_set),
            key=well_sort_key,
        )
        mapping = []
        for order, well in enumerate(raw_wells, start=1):
            if well in supplied_by_well:
                item = dict(supplied_by_well[well])
                item["map_order"] = order
                item["include"] = True
            else:
                item = _default_mapping_entry(well, order, include=False)
                item["crrna"] = "Unmapped wells"
            mapping.append(item)
        matched = len(raw_set.intersection(supplied_by_well))
        if not matched:
            raise ValueError("The plate map has no wells found in the raw Cytation file.")
        mapping_mode = "file"
        report["missing_mapped_wells"] = missing_mapped
        report["unmapped_raw_wells"] = [
            well for well in raw_wells if well not in supplied_by_well
        ]
        report["mapped_wells"] = matched
    else:
        mapping = [
            _default_mapping_entry(well, order)
            for order, well in enumerate(raw_wells, start=1)
        ]
        mapping_mode = "well addresses"
        report["missing_mapped_wells"] = []
        report["unmapped_raw_wells"] = []
        report["mapped_wells"] = len(mapping)

    return {
        "source_name": data_name,
        "mapping_name": mapping_name or "Well addresses",
        "mapping_mode": mapping_mode,
        "observations": observations,
        "mapping": mapping,
        "timepoints": sorted({item["elapsed_minutes"] for item in observations}),
        "report": report,
    }


def parse_cytation(
    data: bytes, source_name: str
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    sheets = read_tabular_file(data, source_name)
    observations: list[dict[str, Any]] = []
    duplicate_sheets: list[str] = []
    fingerprints: set[str] = set()
    sheets_read: list[str] = []

    for sheet in sheets:
        name = str(sheet["name"])
        sheets_read.append(name)
        parsed = _parse_cytation_sheet(sheet["rows"], source_name, name)
        if not parsed:
            continue
        fingerprint = _fingerprint_observations(parsed)
        if fingerprint in fingerprints:
            duplicate_sheets.append(name)
            continue
        fingerprints.add(fingerprint)
        observations.extend(parsed)

    if not observations:
        raise ValueError(
            "No Cytation kinetic block was found. The export must contain a Time "
            "column and well columns such as A1 or B1."
        )

    observations.sort(
        key=lambda item: (
            item["sheet"],
            item["block"],
            well_sort_key(item["well"]),
            item["elapsed_minutes"],
        )
    )
    blocks = {
        (item["sheet"], item["block"])
        for item in observations
    }
    wells = {item["well"] for item in observations}
    timepoints = {item["elapsed_minutes"] for item in observations}
    report = {
        "source": source_name,
        "sheets_read": sheets_read,
        "duplicate_sheets_skipped": duplicate_sheets,
        "blocks_found": len(blocks),
        "wells_found": len(wells),
        "timepoints_found": len(timepoints),
    }
    return observations, report


def parse_mapping(data: bytes, source_name: str) -> list[dict[str, Any]]:
    sheets = read_tabular_file(data, source_name)
    if not sheets:
        raise ValueError("The plate-map file is empty.")
    rows = sheets[0]["rows"]
    mapping = _parse_grid_mapping(rows)
    if not mapping:
        mapping = _parse_flat_mapping(rows)
    _validate_mapping(mapping, source_name)
    return mapping


def normalize_mapping(
    mapping: Iterable[dict[str, Any]], raw_wells: Iterable[str]
) -> list[dict[str, Any]]:
    raw_order = list(raw_wells)
    raw_set = set(raw_order)
    normalized: list[dict[str, Any]] = []
    seen: set[str] = set()
    for order, raw in enumerate(mapping, start=1):
        well = normalize_well(raw.get("well", ""))
        if not well or well not in raw_set or well in seen:
            continue
        seen.add(well)
        replicate = _positive_integer(raw.get("replicate"), 1)
        target = clean_text(raw.get("target")) or well
        crrna = clean_text(raw.get("crrna")) or "Plate wells"
        normalized.append(
            {
                "well": well,
                "target": target,
                "crrna": crrna,
                "replicate": replicate,
                "include": _to_bool(raw.get("include"), True),
                "map_order": order,
            }
        )
    for well in raw_order:
        if well not in seen:
            normalized.append(
                _default_mapping_entry(well, len(normalized) + 1, include=False)
            )
    return normalized


def summarize_kinetics(
    observations: list[dict[str, Any]],
    mapping: list[dict[str, Any]],
    *,
    baseline: bool = False,
) -> dict[str, Any]:
    raw_wells = sorted({item["well"] for item in observations}, key=well_sort_key)
    mapping = normalize_mapping(mapping, raw_wells)
    active = [item for item in mapping if item["include"]]
    if not active:
        raise ValueError("Select at least one well in the plate map.")

    values_by_well = _values_by_well(observations, baseline)
    groups: dict[tuple[str, str, float], list[float]] = defaultdict(list)
    mapping_by_well = {item["well"]: item for item in active}
    for well, points in values_by_well.items():
        map_item = mapping_by_well.get(well)
        if not map_item:
            continue
        for elapsed, value in points:
            groups[(map_item["crrna"], map_item["target"], elapsed)].append(value)

    crrna_order = _ordered_unique(item["crrna"] for item in active)
    target_order = _ordered_unique(item["target"] for item in active)
    panels: list[dict[str, Any]] = []
    tidy_rows: list[dict[str, Any]] = []
    for crrna in crrna_order:
        series_list: list[dict[str, Any]] = []
        panel_targets = _ordered_unique(
            item["target"] for item in active if item["crrna"] == crrna
        )
        for target in panel_targets:
            points = []
            times = sorted(
                elapsed
                for group_crrna, group_target, elapsed in groups
                if group_crrna == crrna and group_target == target
            )
            wells = [
                item["well"]
                for item in active
                if item["crrna"] == crrna and item["target"] == target
            ]
            for elapsed in times:
                stats = _summarize(groups[(crrna, target, elapsed)])
                point = {"time": elapsed, **stats}
                points.append(point)
                tidy_rows.append(
                    {
                        "crRNA": crrna,
                        "target": target,
                        "time_min": elapsed,
                        **stats,
                    }
                )
            series_list.append({"target": target, "wells": wells, "points": points})
        panels.append({"crrna": crrna, "series": series_list})

    return {
        "panels": panels,
        "target_order": target_order,
        "crrna_order": crrna_order,
        "timepoints": sorted(
            {point["time"] for panel in panels for series in panel["series"] for point in series["points"]}
        ),
        "csv": _dict_rows_to_csv(
            tidy_rows,
            ["crRNA", "target", "time_min", "mean", "sd", "sem", "n"],
        ),
    }


def build_heatmap(
    observations: list[dict[str, Any]],
    mapping: list[dict[str, Any]],
    requested_time: float,
    *,
    baseline: bool = False,
) -> dict[str, Any]:
    raw_wells = sorted({item["well"] for item in observations}, key=well_sort_key)
    mapping = normalize_mapping(mapping, raw_wells)
    active = [item for item in mapping if item["include"]]
    if not active:
        raise ValueError("Select at least one well in the plate map.")

    available = sorted({item["elapsed_minutes"] for item in observations})
    selected_time = min(available, key=lambda value: abs(value - requested_time))
    values_by_well = _values_by_well(observations, baseline)
    mapping_by_well = {item["well"]: item for item in active}
    groups: dict[tuple[str, str], list[float]] = defaultdict(list)
    for well, points in values_by_well.items():
        map_item = mapping_by_well.get(well)
        if not map_item:
            continue
        for elapsed, value in points:
            if math.isclose(elapsed, selected_time, abs_tol=1e-7):
                groups[(map_item["crrna"], map_item["target"])].append(value)

    crrnas = _ordered_unique(item["crrna"] for item in active)
    targets = _ordered_unique(item["target"] for item in active)
    matrix: list[list[float | None]] = []
    cells: list[list[dict[str, Any]]] = []
    tidy_rows: list[dict[str, Any]] = []
    for crrna in crrnas:
        matrix_row: list[float | None] = []
        cell_row: list[dict[str, Any]] = []
        for target in targets:
            values = groups.get((crrna, target), [])
            stats = _summarize(values) if values else {
                "mean": None,
                "sd": None,
                "sem": None,
                "n": 0,
            }
            matrix_row.append(stats["mean"])
            cell = {"crrna": crrna, "target": target, **stats}
            cell_row.append(cell)
            tidy_rows.append(cell)
        matrix.append(matrix_row)
        cells.append(cell_row)

    matrix_output = io.StringIO()
    writer = csv.writer(matrix_output, lineterminator="\n")
    writer.writerow(["crRNA", *targets])
    for crrna, row in zip(crrnas, matrix):
        writer.writerow([crrna, *["" if value is None else value for value in row]])

    return {
        "requested_time": requested_time,
        "selected_time": selected_time,
        "crrnas": crrnas,
        "targets": targets,
        "matrix": matrix,
        "cells": cells,
        "csv": matrix_output.getvalue(),
    }


def create_demo() -> dict[str, Any]:
    targets = [
        "IS6110",
        "IS1081",
        "Rv2341",
        "IS6110+IS1081",
        "IS1081+Rv2341",
        "Rv2341+IS6110",
        "IS6110+IS1081+Rv2341",
        "NTC",
    ]
    guides = [
        ("crRNA2 for IS6110", "IS6110"),
        ("crRNA2 for IS1081", "IS1081"),
        ("crRNA4 for Rv2341", "Rv2341"),
    ]
    times = [0, 5, 10, 20, 30, 45, 60, 90, 120]
    observations: list[dict[str, Any]] = []
    mapping: list[dict[str, Any]] = []
    index = 0
    for target_index, target in enumerate(targets):
        for guide_index, (guide, marker) in enumerate(guides):
            for replicate in (1, 2):
                well = well_from_index(index)
                index += 1
                mapping.append(
                    {
                        "well": well,
                        "target": target,
                        "crrna": guide,
                        "replicate": replicate,
                        "include": True,
                        "map_order": len(mapping) + 1,
                    }
                )
                for elapsed in times:
                    active = target != "NTC" and marker in target
                    rise = 1 / (1 + math.exp(-(elapsed - 16) / 5))
                    decay = max(0.78, 1 - max(0, elapsed - 45) * 0.0017)
                    plateau = 43000 + target_index * 620 + guide_index * 850
                    baseline = 900 + target_index * 45 + guide_index * 60
                    replicate_shift = (replicate - 1.5) * 620
                    rfu = (
                        baseline + plateau * rise * decay + replicate_shift
                        if active
                        else baseline + elapsed * (9 + target_index) + replicate_shift / 4
                    )
                    observations.append(
                        {
                            "source_file": "synthetic_cytation5.xlsx",
                            "sheet": "Demo",
                            "block": 1,
                            "time_seconds": elapsed * 60,
                            "time_minutes": elapsed,
                            "elapsed_minutes": elapsed,
                            "well": well,
                            "rfu": round(rfu, 3),
                        }
                    )
    return {
        "source_name": "Synthetic Cytation5 demo",
        "mapping_name": "Synthetic 96-well map",
        "mapping_mode": "demo",
        "observations": observations,
        "mapping": mapping,
        "timepoints": times,
        "report": {
            "source": "Synthetic Cytation5 demo",
            "sheets_read": ["Demo"],
            "duplicate_sheets_skipped": [],
            "blocks_found": 1,
            "wells_found": len(mapping),
            "timepoints_found": len(times),
            "mapped_wells": len(mapping),
            "missing_mapped_wells": [],
            "unmapped_raw_wells": [],
        },
    }


def merge_mapping_text(
    text: str,
    current_mapping: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    text = text.strip()
    if not text:
        raise ValueError("Paste a CSV or tab-delimited mapping table.")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("The pasted table needs a header row.")
    aliases = {normalize_header(name): name for name in reader.fieldnames}
    well_key = next((aliases[key] for key in WELL_ALIASES if key in aliases), None)
    target_key = next((aliases[key] for key in TARGET_ALIASES if key in aliases), None)
    crrna_key = next((aliases[key] for key in CRRNA_ALIASES if key in aliases), None)
    if not well_key or not target_key or not crrna_key:
        raise ValueError("Include well, target, and crRNA columns.")
    replicate_key = aliases.get("replicate")
    include_key = aliases.get("include")
    updates: dict[str, dict[str, Any]] = {}
    for row in reader:
        well = normalize_well(row.get(well_key, ""))
        if not well:
            continue
        updates[well] = {
            "target": clean_text(row.get(target_key)) or well,
            "crrna": clean_text(row.get(crrna_key)) or "Plate wells",
            "replicate": _positive_integer(
                row.get(replicate_key, "") if replicate_key else "", 1
            ),
            "include": _to_bool(
                row.get(include_key, "") if include_key else "", True
            ),
        }
    if not updates:
        raise ValueError("No valid well rows were found in the pasted table.")
    merged = []
    for item in current_mapping:
        updated = dict(item)
        if item["well"] in updates:
            updated.update(updates[item["well"]])
        merged.append(updated)
    return merged


def mapping_to_csv(mapping: list[dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(["well", "target", "crRNA", "replicate", "include"])
    for item in mapping:
        writer.writerow(
            [
                item["well"],
                item["target"],
                item["crrna"],
                item["replicate"],
                str(bool(item["include"])).lower(),
            ]
        )
    return output.getvalue()


def _parse_cytation_sheet(
    rows: list[list[Any]], source_file: str, sheet: str
) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    block = 0
    for row_index, row in enumerate(rows):
        header = [clean_text(value) for value in row]
        time_column = next(
            (index for index, value in enumerate(header) if value.lower() == "time"),
            -1,
        )
        well_columns = [
            (index, normalize_well(value))
            for index, value in enumerate(header)
            if WELL_RE.fullmatch(normalize_well(value))
        ]
        if time_column < 0 or not well_columns:
            continue

        block += 1
        block_items: list[dict[str, Any]] = []
        for data_row in rows[row_index + 1 :]:
            raw_time = data_row[time_column] if time_column < len(data_row) else None
            seconds = time_to_seconds(raw_time)
            if seconds is None:
                break
            for column, well in well_columns:
                raw_value = data_row[column] if column < len(data_row) else None
                rfu = to_number(raw_value)
                if rfu is None:
                    continue
                block_items.append(
                    {
                        "source_file": source_file,
                        "sheet": sheet,
                        "block": block,
                        "time_seconds": seconds,
                        "time_minutes": seconds / 60,
                        "elapsed_minutes": 0.0,
                        "well": well,
                        "rfu": rfu,
                    }
                )
        if block_items:
            first_time = min(item["time_minutes"] for item in block_items)
            for item in block_items:
                item["elapsed_minutes"] = round(item["time_minutes"] - first_time, 6)
            observations.extend(block_items)
    return observations


def _parse_grid_mapping(rows: list[list[Any]]) -> list[dict[str, Any]]:
    marker_row = -1
    marker_column = -1
    for row_index, row in enumerate(rows):
        for column_index, value in enumerate(row):
            if clean_text(value).lower() in MAP_MARKERS:
                marker_row = row_index
                marker_column = column_index
                break
        if marker_row >= 0:
            break
    if marker_row < 0:
        return []

    header = rows[marker_row]
    target_column = next(
        (
            index
            for index, value in enumerate(header)
            if "row(target" in clean_text(value).lower().replace(" ", "")
        ),
        -1,
    )
    crrna_header = _find_crrna_header(rows, marker_row, marker_column)
    mapping: list[dict[str, Any]] = []
    replicate_counts: dict[tuple[str, str], int] = defaultdict(int)

    for row in rows[marker_row + 1 :]:
        plate_row = clean_text(
            row[marker_column] if marker_column < len(row) else ""
        ).upper()
        if not re.fullmatch(r"[A-P]", plate_row):
            continue
        row_target = (
            clean_text(row[target_column])
            if target_column >= 0 and target_column < len(row)
            else ""
        )
        for column_index in range(marker_column + 1, len(header)):
            plate_column = _parse_plate_column(header[column_index])
            if plate_column is None:
                continue
            cell = clean_text(
                row[column_index] if column_index < len(row) else "",
                preserve_newlines=True,
            )
            if not cell:
                continue
            metadata = _parse_mapping_cell(cell)
            target = clean_text(metadata.get("target") or row_target)
            header_crrna = (
                crrna_header[column_index]
                if column_index < len(crrna_header)
                else ""
            )
            crrna = clean_text(
                metadata.get("crrna")
                or metadata.get("crrna_name")
                or header_crrna
            )
            if not target or not crrna:
                continue
            key = (crrna, target)
            replicate_counts[key] += 1
            mapping.append(
                {
                    "well": f"{plate_row}{plate_column}",
                    "target": target,
                    "crrna": crrna,
                    "replicate": replicate_counts[key],
                    "include": True,
                    "map_order": len(mapping) + 1,
                }
            )
    return mapping


def _parse_flat_mapping(rows: list[list[Any]]) -> list[dict[str, Any]]:
    header_index = -1
    normalized_header: list[str] = []
    for index, row in enumerate(rows[:50]):
        candidate = [normalize_header(value) for value in row]
        if (
            any(item in WELL_ALIASES for item in candidate)
            and any(item in TARGET_ALIASES for item in candidate)
            and any(item in CRRNA_ALIASES for item in candidate)
        ):
            header_index = index
            normalized_header = candidate
            break
    if header_index < 0:
        raise ValueError(
            "The plate map must be a recognized 96/384-well grid or a flat "
            "table with well, target, and crRNA columns."
        )

    well_column = _find_alias(normalized_header, WELL_ALIASES)
    target_column = _find_alias(normalized_header, TARGET_ALIASES)
    crrna_column = _find_alias(normalized_header, CRRNA_ALIASES)
    replicate_column = (
        normalized_header.index("replicate")
        if "replicate" in normalized_header
        else -1
    )
    include_column = (
        normalized_header.index("include") if "include" in normalized_header else -1
    )
    replicate_counts: dict[tuple[str, str], int] = defaultdict(int)
    mapping: list[dict[str, Any]] = []
    for row in rows[header_index + 1 :]:
        well = normalize_well(_get(row, well_column))
        target = clean_text(_get(row, target_column))
        crrna = clean_text(_get(row, crrna_column))
        if not well and not target and not crrna:
            continue
        key = (crrna, target)
        replicate_counts[key] += 1
        mapping.append(
            {
                "well": well,
                "target": target,
                "crrna": crrna,
                "replicate": _positive_integer(
                    _get(row, replicate_column), replicate_counts[key]
                ),
                "include": _to_bool(_get(row, include_column), True),
                "map_order": len(mapping) + 1,
            }
        )
    return mapping


def _validate_mapping(mapping: list[dict[str, Any]], source_name: str) -> None:
    if not mapping:
        raise ValueError(f"No mapped wells were found in {source_name}.")
    invalid = [
        item.get("well") or "(blank)"
        for item in mapping
        if not WELL_RE.fullmatch(str(item.get("well", "")))
        or not clean_text(item.get("target"))
        or not clean_text(item.get("crrna"))
    ]
    if invalid:
        raise ValueError(f"Invalid mapping rows or wells: {', '.join(invalid[:12])}")
    wells = [item["well"] for item in mapping]
    duplicates = _ordered_unique(
        well for index, well in enumerate(wells) if well in wells[:index]
    )
    if duplicates:
        raise ValueError(f"Duplicate mapped wells: {', '.join(duplicates[:12])}")


def _values_by_well(
    observations: list[dict[str, Any]], baseline: bool
) -> dict[str, list[tuple[float, float]]]:
    result: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for item in observations:
        result[item["well"]].append((item["elapsed_minutes"], item["rfu"]))
    for well, points in result.items():
        points.sort(key=lambda item: item[0])
        if baseline and points:
            first = points[0][1]
            result[well] = [(elapsed, value - first) for elapsed, value in points]
    return result


def _summarize(values: list[float]) -> dict[str, Any]:
    mean = statistics.fmean(values)
    sd = statistics.stdev(values) if len(values) > 1 else 0.0
    return {
        "mean": mean,
        "sd": sd,
        "sem": sd / math.sqrt(len(values)) if values else 0.0,
        "n": len(values),
    }


def _default_mapping_entry(
    well: str, order: int, include: bool = True
) -> dict[str, Any]:
    return {
        "well": well,
        "target": well,
        "crrna": "Plate wells",
        "replicate": 1,
        "include": include,
        "map_order": order,
    }


def _find_crrna_header(
    rows: list[list[Any]], marker_row: int, marker_column: int
) -> list[Any]:
    for row_index in range(marker_row - 1, -1, -1):
        row = rows[row_index]
        marker = clean_text(
            row[marker_column] if marker_column < len(row) else ""
        ).lower().replace(" ", "")
        if "column" in marker and "crrna" in marker:
            return row
    return []


def _parse_mapping_cell(value: str) -> dict[str, str]:
    result = {}
    for line in value.splitlines():
        if ":" not in line:
            continue
        key, entry = line.split(":", 1)
        result[normalize_header(key)] = entry.strip()
    return result


def time_to_seconds(value: Any) -> float | None:
    if isinstance(value, datetime):
        value = value.time()
    if isinstance(value, time):
        return (
            value.hour * 3600
            + value.minute * 60
            + value.second
            + value.microsecond / 1_000_000
        )
    if isinstance(value, timedelta):
        return value.total_seconds()
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value) * 86400 if 0 <= float(value) < 1 else float(value) * 60
    match = TIME_RE.fullmatch(clean_text(value))
    if not match:
        return None
    return (
        float(match.group(1)) * 3600
        + float(match.group(2)) * 60
        + float(match.group(3) or 0)
    )


def to_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    text = clean_text(value).replace(",", "")
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def clean_text(value: Any, preserve_newlines: bool = False) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if preserve_newlines:
        return "\n".join(line.strip() for line in text.splitlines() if line.strip())
    return re.sub(r"\s+", " ", text)


def normalize_header(value: Any) -> str:
    return re.sub(r"(^_+|_+$)", "", re.sub(r"[^a-z0-9]+", "_", clean_text(value).lower()))


def normalize_well(value: Any) -> str:
    return clean_text(value).upper()


def well_sort_key(well: str) -> tuple[int, int, str]:
    match = WELL_RE.fullmatch(well)
    if not match:
        return (99, 99, well)
    return (ord(match.group(1).upper()) - ord("A"), int(match.group(2)), well)


def well_from_index(index: int) -> str:
    return f"{chr(ord('A') + index // 12)}{index % 12 + 1}"


def _fingerprint_observations(items: list[dict[str, Any]]) -> str:
    tokens = sorted(
        f"{item['block']}|{item['time_seconds']:.8f}|{item['well']}|{item['rfu']:.8f}"
        for item in items
    )
    return hashlib.sha256("\x01".join(tokens).encode()).hexdigest()


def _parse_plate_column(value: Any) -> int | None:
    text = clean_text(value)
    if not re.fullmatch(r"\d{1,2}", text):
        return None
    number = int(text)
    return number if 1 <= number <= 24 else None


def _find_alias(header: list[str], aliases: set[str]) -> int:
    return next(index for index, item in enumerate(header) if item in aliases)


def _get(row: list[Any], index: int) -> Any:
    return row[index] if 0 <= index < len(row) else ""


def _positive_integer(value: Any, fallback: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return fallback
    return number if number > 0 else fallback


def _to_bool(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    text = clean_text(value).lower()
    if not text:
        return fallback
    if text in {"true", "1", "yes", "y", "include"}:
        return True
    if text in {"false", "0", "no", "n", "exclude"}:
        return False
    return fallback


def _ordered_unique(values: Iterable[Any]) -> list[Any]:
    return list(dict.fromkeys(values))


def _dict_rows_to_csv(rows: list[dict[str, Any]], fields: list[str]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()
