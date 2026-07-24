"""Small, dependency-free readers for XLSX and delimited text files."""

from __future__ import annotations

import csv
import io
import posixpath
import re
import zipfile
from typing import Any
from xml.etree import ElementTree as ET

CELL_REF_RE = re.compile(r"([A-Z]+)(\d+)$")
MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def read_tabular_file(data: bytes, filename: str) -> list[dict[str, Any]]:
    """Return workbook-like sheets with dense row matrices."""

    lower = filename.lower()
    if lower.endswith((".csv", ".tsv", ".txt")):
        return [{"name": filename, "rows": _read_delimited(data, lower)}]
    if lower.endswith((".xlsx", ".xlsm")):
        return _read_xlsx(data)
    if lower.endswith(".xls"):
        raise ValueError(
            "Legacy .xls files are not supported. Export the file as .xlsx or .csv."
        )
    raise ValueError("Use an .xlsx, .xlsm, .csv, .tsv, or .txt file.")


def _read_delimited(data: bytes, filename: str) -> list[list[Any]]:
    text = _decode_text(data)
    if filename.endswith(".tsv"):
        dialect: csv.Dialect | type[csv.excel_tab] = csv.excel_tab
    else:
        try:
            dialect = csv.Sniffer().sniff(text[:8192], delimiters=",\t;")
        except csv.Error:
            dialect = csv.excel
    return [list(row) for row in csv.reader(io.StringIO(text), dialect)]


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-16", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _read_xlsx(data: bytes) -> list[dict[str, Any]]:
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError("The XLSX file is damaged or is not a valid workbook.") from exc

    with archive:
        names = set(archive.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("The file does not contain a valid XLSX workbook.")
        shared_strings = _read_shared_strings(archive)
        relationships = _read_workbook_relationships(archive)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets: list[dict[str, Any]] = []

        for sheet in workbook.findall(f".//{{{MAIN_NS}}}sheet"):
            name = sheet.attrib.get("name", "Sheet")
            relationship_id = sheet.attrib.get(f"{{{REL_NS}}}id", "")
            target = relationships.get(relationship_id)
            if not target:
                continue
            sheet_path = _normalize_sheet_path(target)
            if sheet_path not in names:
                continue
            rows = _read_worksheet(archive.read(sheet_path), shared_strings)
            sheets.append({"name": name, "rows": rows})
        return sheets


def _read_shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values: list[str] = []
    for item in root.findall(f"{{{MAIN_NS}}}si"):
        values.append("".join(node.text or "" for node in item.iter(f"{{{MAIN_NS}}}t")))
    return values


def _read_workbook_relationships(archive: zipfile.ZipFile) -> dict[str, str]:
    path = "xl/_rels/workbook.xml.rels"
    if path not in archive.namelist():
        return {}
    root = ET.fromstring(archive.read(path))
    return {
        relationship.attrib.get("Id", ""): relationship.attrib.get("Target", "")
        for relationship in root.findall(f"{{{PKG_REL_NS}}}Relationship")
    }


def _normalize_sheet_path(target: str) -> str:
    if target.startswith("/"):
        return target.lstrip("/")
    return posixpath.normpath(posixpath.join("xl", target))


def _read_worksheet(xml_data: bytes, shared_strings: list[str]) -> list[list[Any]]:
    root = ET.fromstring(xml_data)
    dense_rows: list[list[Any]] = []
    for row in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row"):
        sparse: dict[int, Any] = {}
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            reference = cell.attrib.get("r", "")
            match = CELL_REF_RE.match(reference)
            if not match:
                continue
            column = _column_index(match.group(1))
            sparse[column] = _cell_value(cell, shared_strings)
        if not sparse:
            dense_rows.append([])
            continue
        width = max(sparse) + 1
        dense = [None] * width
        for column, value in sparse.items():
            dense[column] = value
        dense_rows.append(dense)
    return dense_rows


def _cell_value(cell: ET.Element, shared_strings: list[str]) -> Any:
    cell_type = cell.attrib.get("t", "")
    if cell_type == "inlineStr":
        return "".join(
            node.text or "" for node in cell.iter(f"{{{MAIN_NS}}}t")
        )
    value_node = cell.find(f"{{{MAIN_NS}}}v")
    if value_node is None or value_node.text is None:
        return None
    raw = value_node.text
    if cell_type == "s":
        try:
            return shared_strings[int(raw)]
        except (ValueError, IndexError):
            return raw
    if cell_type in {"str", "e"}:
        return raw
    if cell_type == "b":
        return raw == "1"
    try:
        number = float(raw)
    except ValueError:
        return raw
    return int(number) if number.is_integer() else number


def _column_index(letters: str) -> int:
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - ord("A") + 1
    return value - 1
