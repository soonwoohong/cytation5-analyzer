import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeBytes,
  buildHeatmap,
  createDemoAnalysis,
  heatmapToCsv,
} from "../lib/cytation.ts";

test("builds the expected demo heatmap shape", () => {
  const analysis = createDemoAnalysis();
  const heatmap = buildHeatmap(analysis, 30);

  assert.equal(heatmap.selectedTime, 30);
  assert.equal(heatmap.crrnas.length, 3);
  assert.equal(heatmap.targets.length, 8);
  assert.equal(heatmap.cells.flat().length, 24);
  assert.ok(heatmap.cells[0][0].meanRfu! > 45000);
  assert.ok(heatmap.cells[0][1].meanRfu! < 3000);
  assert.match(heatmapToCsv(heatmap), /"crRNA","IS6110","IS1081"/);
});

test("parses a Cytation CSV and flat plate map", () => {
  const raw = [
    "Software Version,3.10.06,,,,",
    ',"Time","T FAM:485,528","A1","B1","A2","B2"',
    ',"00:00:06",37,100,120,90,110',
    ',"00:05:06",37,200,240,150,170',
  ].join("\n");
  const mapping = [
    "well,target,crRNA",
    "A1,target1,guide1",
    "B1,target1,guide1",
    "A2,target2,guide1",
    "B2,target2,guide1",
  ].join("\n");

  const analysis = analyzeBytes(
    new TextEncoder().encode(raw),
    "raw.csv",
    new TextEncoder().encode(mapping),
    "mapping.csv",
  );
  const heatmap = buildHeatmap(analysis, 5);

  assert.deepEqual(analysis.timepoints, [0, 5]);
  assert.equal(analysis.report.mappedWells, 4);
  assert.equal(heatmap.cells[0][0].meanRfu, 220);
  assert.equal(heatmap.cells[0][1].meanRfu, 160);
  assert.equal(heatmap.cells[0][0].n, 2);
});
