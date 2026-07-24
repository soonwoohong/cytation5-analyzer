from __future__ import annotations

import io
import unittest
import zipfile

from cytation5_analyzer import (
    analyze_upload,
    build_heatmap,
    merge_mapping_text,
    parse_mapping,
    summarize_kinetics,
)


RAW_CSV = b"""Instrument,Cytation5
Time,A1,A2,B1,B2
11:00:00,100,120,200,220
11:05:00,1100,1300,400,440
11:10:00,2100,2300,600,660
"""

FLAT_MAP = b"""well,target,crRNA,replicate
A1,Target 1,Guide 1,1
A2,Target 1,Guide 1,2
B1,Target 2,Guide 1,1
B2,Target 2,Guide 1,2
"""

GRID_MAP = b""",,,1,2
,,column (crRNAs),Guide 1,
,row(targets),96 maps,1,2
A,Target 1,A,"target: Target 1
crRNA: Guide 1","target: Target 1
crRNA: Guide 1"
"""


class CytationCoreTests(unittest.TestCase):
    def test_optional_mapping_uses_well_addresses(self) -> None:
        analysis = analyze_upload(RAW_CSV, "raw.csv")

        self.assertEqual(analysis["mapping_mode"], "well addresses")
        self.assertEqual(analysis["report"]["mapped_wells"], 4)
        self.assertEqual(
            [item["target"] for item in analysis["mapping"]],
            ["A1", "A2", "B1", "B2"],
        )
        kinetics = summarize_kinetics(
            analysis["observations"], analysis["mapping"]
        )
        self.assertEqual(len(kinetics["panels"]), 1)
        self.assertEqual(len(kinetics["panels"][0]["series"]), 4)

    def test_flat_mapping_aggregates_replicates(self) -> None:
        analysis = analyze_upload(RAW_CSV, "raw.csv", FLAT_MAP, "map.csv")
        kinetics = summarize_kinetics(
            analysis["observations"], analysis["mapping"]
        )
        first_target = kinetics["panels"][0]["series"][0]

        self.assertEqual(first_target["target"], "Target 1")
        self.assertEqual(first_target["points"][1]["mean"], 1200)
        self.assertEqual(first_target["points"][1]["n"], 2)

        heatmap = build_heatmap(
            analysis["observations"], analysis["mapping"], 5
        )
        self.assertEqual(heatmap["selected_time"], 5)
        self.assertEqual(heatmap["matrix"], [[1200, 420]])

    def test_baseline_subtraction_is_per_well(self) -> None:
        analysis = analyze_upload(RAW_CSV, "raw.csv", FLAT_MAP, "map.csv")
        kinetics = summarize_kinetics(
            analysis["observations"], analysis["mapping"], baseline=True
        )

        first_target = kinetics["panels"][0]["series"][0]
        self.assertEqual(first_target["points"][0]["mean"], 0)
        self.assertEqual(first_target["points"][1]["mean"], 1090)

    def test_grid_mapping_is_recognized(self) -> None:
        mapping = parse_mapping(GRID_MAP, "grid.csv")

        self.assertEqual(len(mapping), 2)
        self.assertEqual(mapping[0]["well"], "A1")
        self.assertEqual(mapping[0]["target"], "Target 1")
        self.assertEqual(mapping[0]["crrna"], "Guide 1")

    def test_manual_mapping_merge(self) -> None:
        analysis = analyze_upload(RAW_CSV, "raw.csv")
        merged = merge_mapping_text(
            "well,target,crRNA,replicate,include\n"
            "A1,Positive,Guide X,2,true\n"
            "B2,Negative,Guide X,1,false\n",
            analysis["mapping"],
        )

        self.assertEqual(merged[0]["target"], "Positive")
        self.assertEqual(merged[0]["replicate"], 2)
        self.assertFalse(merged[-1]["include"])

    def test_minimal_xlsx_is_read_without_external_packages(self) -> None:
        workbook = _minimal_xlsx()
        analysis = analyze_upload(workbook, "raw.xlsx")

        self.assertEqual(analysis["report"]["wells_found"], 2)
        self.assertEqual(analysis["timepoints"], [0.0, 5.0])


def _minimal_xlsx() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<?xml version="1.0"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
              <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
              <Default Extension="xml" ContentType="application/xml"/>
              <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
              <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            </Types>""",
        )
        archive.writestr(
            "xl/workbook.xml",
            """<?xml version="1.0"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
              <sheets><sheet name="Plate" sheetId="1" r:id="rId1"/></sheets>
            </workbook>""",
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            """<?xml version="1.0"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="rId1"
                Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
                Target="worksheets/sheet1.xml"/>
            </Relationships>""",
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            """<?xml version="1.0"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
              <sheetData>
                <row r="1">
                  <c r="A1" t="inlineStr"><is><t>Time</t></is></c>
                  <c r="B1" t="inlineStr"><is><t>A1</t></is></c>
                  <c r="C1" t="inlineStr"><is><t>A2</t></is></c>
                </row>
                <row r="2"><c r="A2"><v>0.5</v></c><c r="B2"><v>100</v></c><c r="C2"><v>120</v></c></row>
                <row r="3"><c r="A3"><v>0.5034722222</v></c><c r="B3"><v>200</v></c><c r="C3"><v>240</v></c></row>
              </sheetData>
            </worksheet>""",
        )
    return output.getvalue()


if __name__ == "__main__":
    unittest.main()
