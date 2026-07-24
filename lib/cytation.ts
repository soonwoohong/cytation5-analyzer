import * as XLSX from "xlsx";

type Cell = unknown;
type MatrixRow = Cell[];

export interface KineticObservation {
  sourceFile: string;
  sheet: string;
  block: number;
  timeSeconds: number;
  timeMinutes: number;
  elapsedMinutes: number;
  well: string;
  rfu: number;
}

export interface MappingEntry {
  well: string;
  target: string;
  crrna: string;
  mapOrder: number;
  replicate: number;
}

export interface ImportReport {
  source: string;
  sheetsRead: string[];
  duplicateSheetsSkipped: string[];
  blocksFound: number;
  wellsFound: number;
  timepointsFound: number;
  mappedWells: number;
  unmappedRawWells: string[];
}

export interface CytationAnalysis {
  sourceName: string;
  mappingName: string;
  observations: KineticObservation[];
  mapping: MappingEntry[];
  crrnaOrder: string[];
  targetOrder: string[];
  timepoints: number[];
  report: ImportReport;
}

export interface HeatmapCell {
  crrna: string;
  target: string;
  meanRfu: number | null;
  sdRfu: number | null;
  n: number;
}

export interface HeatmapData {
  requestedTime: number;
  selectedTime: number;
  crrnas: string[];
  targets: string[];
  cells: HeatmapCell[][];
  values: number[];
}

interface ParsedWorkbook {
  sheets: Array<{ name: string; rows: MatrixRow[] }>;
}

const WELL_RE = /^([A-P])(\d{1,2})$/i;
const TIME_RE = /^(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/;
const WELL_ALIASES = ["well", "well_id", "position"];
const TARGET_ALIASES = ["target", "sample", "condition"];
const CRRNA_ALIASES = ["crrna", "cr_rna", "assay", "guide"];

export async function analyzeFiles(
  dataFile: File,
  mappingFile: File,
): Promise<CytationAnalysis> {
  const [dataBytes, mappingBytes] = await Promise.all([
    dataFile.arrayBuffer(),
    mappingFile.arrayBuffer(),
  ]);
  return analyzeBytes(
    dataBytes,
    dataFile.name,
    mappingBytes,
    mappingFile.name,
  );
}

export function analyzeBytes(
  dataBytes: ArrayBuffer | Uint8Array,
  dataName: string,
  mappingBytes: ArrayBuffer | Uint8Array,
  mappingName: string,
): CytationAnalysis {
  const { observations, report } = parseCytationBytes(dataBytes, dataName);
  const mapping = parseMappingBytes(mappingBytes, mappingName);
  return createAnalysis(observations, mapping, dataName, mappingName, report);
}

export function parseCytationBytes(
  bytes: ArrayBuffer | Uint8Array,
  sourceName: string,
): { observations: KineticObservation[]; report: ImportReport } {
  const workbook = readWorkbook(bytes);
  const observations: KineticObservation[] = [];
  const sheetsRead: string[] = [];
  const duplicateSheetsSkipped: string[] = [];
  const fingerprints = new Set<string>();

  for (const sheet of workbook.sheets) {
    sheetsRead.push(sheet.name);
    const parsed = parseCytationSheet(sheet.rows, sourceName, sheet.name);
    if (!parsed.length) {
      continue;
    }
    const fingerprint = fingerprintObservations(parsed);
    if (fingerprints.has(fingerprint)) {
      duplicateSheetsSkipped.push(sheet.name);
      continue;
    }
    fingerprints.add(fingerprint);
    observations.push(...parsed);
  }

  if (!observations.length) {
    throw new Error(
      "No Cytation5 kinetic block was found. Check that the export contains a Time row and well columns such as A1 or B1.",
    );
  }

  observations.sort(
    (a, b) =>
      a.sheet.localeCompare(b.sheet) ||
      a.block - b.block ||
      wellSort(a.well, b.well) ||
      a.elapsedMinutes - b.elapsedMinutes,
  );
  const uniqueBlocks = new Set(
    observations.map((item) => `${item.sheet}\u0000${item.block}`),
  );
  const wells = unique(observations.map((item) => item.well));
  const timepoints = uniqueNumbers(
    observations.map((item) => item.elapsedMinutes),
  );
  const report: ImportReport = {
    source: sourceName,
    sheetsRead,
    duplicateSheetsSkipped,
    blocksFound: uniqueBlocks.size,
    wellsFound: wells.length,
    timepointsFound: timepoints.length,
    mappedWells: 0,
    unmappedRawWells: [],
  };
  return { observations, report };
}

export function parseMappingBytes(
  bytes: ArrayBuffer | Uint8Array,
  sourceName: string,
): MappingEntry[] {
  const workbook = readWorkbook(bytes);
  const firstSheet = workbook.sheets[0];
  if (!firstSheet) {
    throw new Error("The mapping file is empty.");
  }
  const grid = parseGridMapping(firstSheet.rows);
  const mapping = grid.length ? grid : parseFlatMapping(firstSheet.rows);
  validateMapping(mapping, sourceName);
  return mapping;
}

export function createAnalysis(
  observations: KineticObservation[],
  mapping: MappingEntry[],
  sourceName: string,
  mappingName: string,
  report?: ImportReport,
): CytationAnalysis {
  const rawWells = new Set(observations.map((item) => item.well));
  const mappedWells = new Set(mapping.map((item) => item.well));
  const missing = [...mappedWells]
    .filter((well) => !rawWells.has(well))
    .sort(wellSort);
  if (missing.length) {
    throw new Error(
      `Mapped wells are absent from the Cytation export: ${missing.slice(0, 12).join(", ")}`,
    );
  }

  const mappingByWell = new Map(mapping.map((item) => [item.well, item]));
  const mappedObservations = observations.filter((item) =>
    mappingByWell.has(item.well),
  );
  const crrnaOrder = unique(
    [...mapping]
      .sort((a, b) => a.mapOrder - b.mapOrder)
      .map((item) => item.crrna),
  );
  const targetOrder = unique(
    [...mapping]
      .sort((a, b) => a.mapOrder - b.mapOrder)
      .map((item) => item.target),
  );
  const timepoints = uniqueNumbers(
    mappedObservations.map((item) => item.elapsedMinutes),
  );
  const unmappedRawWells = [...rawWells]
    .filter((well) => !mappedWells.has(well))
    .sort(wellSort);

  return {
    sourceName,
    mappingName,
    observations: mappedObservations,
    mapping,
    crrnaOrder,
    targetOrder,
    timepoints,
    report: {
      source: report?.source ?? sourceName,
      sheetsRead: report?.sheetsRead ?? [],
      duplicateSheetsSkipped: report?.duplicateSheetsSkipped ?? [],
      blocksFound: report?.blocksFound ?? 1,
      wellsFound: report?.wellsFound ?? rawWells.size,
      timepointsFound: report?.timepointsFound ?? timepoints.length,
      mappedWells: mappedWells.size,
      unmappedRawWells,
    },
  };
}

export function buildHeatmap(
  analysis: CytationAnalysis,
  requestedTime: number,
): HeatmapData {
  const selectedTime = selectTimepoint(analysis.timepoints, requestedTime);
  const mappingByWell = new Map(
    analysis.mapping.map((item) => [item.well, item]),
  );
  const groups = new Map<string, number[]>();

  for (const observation of analysis.observations) {
    if (Math.abs(observation.elapsedMinutes - selectedTime) > 1e-7) {
      continue;
    }
    const map = mappingByWell.get(observation.well);
    if (!map) {
      continue;
    }
    const key = groupKey(map.crrna, map.target);
    const values = groups.get(key) ?? [];
    values.push(observation.rfu);
    groups.set(key, values);
  }

  const cells = analysis.crrnaOrder.map((crrna) =>
    analysis.targetOrder.map((target) => {
      const values = groups.get(groupKey(crrna, target)) ?? [];
      return summarizeCell(crrna, target, values);
    }),
  );
  return {
    requestedTime,
    selectedTime,
    crrnas: analysis.crrnaOrder,
    targets: analysis.targetOrder,
    cells,
    values: cells
      .flat()
      .map((cell) => cell.meanRfu)
      .filter((value): value is number => value !== null),
  };
}

export function replicateRange(analysis: CytationAnalysis): [number, number] {
  const counts = new Map<string, number>();
  for (const item of analysis.mapping) {
    const key = groupKey(item.crrna, item.target);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const values = [...counts.values()];
  return [Math.min(...values), Math.max(...values)];
}

export function heatmapToCsv(heatmap: HeatmapData): string {
  const header = ["crRNA", ...heatmap.targets].map(csvCell).join(",");
  const rows = heatmap.cells.map((row, index) =>
    [
      heatmap.crrnas[index],
      ...row.map((cell) => cell.meanRfu ?? ""),
    ]
      .map(csvCell)
      .join(","),
  );
  return [header, ...rows].join("\n");
}

export function createDemoAnalysis(): CytationAnalysis {
  const targets = [
    "IS6110",
    "IS1081",
    "Rv2341",
    "IS6110+IS1081",
    "IS1081+Rv2341",
    "Rv2341+IS6110",
    "IS6110+IS1081+Rv2341",
    "NTC",
  ];
  const guides = [
    { name: "crRNA2 for IS6110", marker: "IS6110" },
    { name: "crRNA2 for IS1081", marker: "IS1081" },
    { name: "crRNA4 for Rv2341", marker: "Rv2341" },
  ];
  const times = [0, 5, 10, 20, 30, 45, 60];
  const mapping: MappingEntry[] = [];
  const observations: KineticObservation[] = [];
  let mapOrder = 0;
  let wellIndex = 0;

  for (const target of targets) {
    for (const guide of guides) {
      for (let replicate = 1; replicate <= 2; replicate += 1) {
        const well = wellFromIndex(wellIndex);
        wellIndex += 1;
        mapOrder += 1;
        mapping.push({
          well,
          target,
          crrna: guide.name,
          mapOrder,
          replicate,
        });
        for (const time of times) {
          const active = target !== "NTC" && target.includes(guide.marker);
          const rise = 1 / (1 + Math.exp(-(time - 14) / 4));
          const plateau =
            48700 +
            targets.indexOf(target) * 520 +
            guides.indexOf(guide) * 390;
          const baseline =
            850 +
            targets.indexOf(target) * 42 +
            guides.indexOf(guide) * 55 +
            replicate * 65;
          const rfu = active
            ? baseline + plateau * rise
            : baseline + time * (target === "Rv2341" ? 28 : 7);
          observations.push({
            sourceFile: "synthetic_cytation5.xlsx",
            sheet: "Demo",
            block: 1,
            timeSeconds: time * 60,
            timeMinutes: time,
            elapsedMinutes: time,
            well,
            rfu: Math.round(rfu),
          });
        }
      }
    }
  }

  return createAnalysis(
    observations,
    mapping,
    "Synthetic Cytation5 demo",
    "Synthetic 96-well map",
  );
}

function readWorkbook(bytes: ArrayBuffer | Uint8Array): ParsedWorkbook {
  const workbook = XLSX.read(bytes, {
    type: "array",
    cellDates: true,
    raw: true,
  });
  return {
    sheets: workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<MatrixRow>(workbook.Sheets[name], {
        header: 1,
        raw: true,
        defval: null,
        blankrows: false,
      }),
    })),
  };
}

function parseCytationSheet(
  rows: MatrixRow[],
  sourceFile: string,
  sheet: string,
): KineticObservation[] {
  const observations: KineticObservation[] = [];
  let block = 0;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const header = rows[rowIndex].map((value) => cleanText(value));
    const timeColumn = header.findIndex(
      (value) => value.toLowerCase() === "time",
    );
    const wellColumns = header
      .map((value, index) => ({ value: value.toUpperCase(), index }))
      .filter((item) => WELL_RE.test(item.value));
    if (timeColumn < 0 || !wellColumns.length) {
      continue;
    }

    block += 1;
    const blockItems: KineticObservation[] = [];
    for (
      let dataIndex = rowIndex + 1;
      dataIndex < rows.length;
      dataIndex += 1
    ) {
      const seconds = timeToSeconds(rows[dataIndex][timeColumn]);
      if (seconds === null) {
        break;
      }
      for (const item of wellColumns) {
        const rfu = toNumber(rows[dataIndex][item.index]);
        if (rfu === null) {
          continue;
        }
        blockItems.push({
          sourceFile,
          sheet,
          block,
          timeSeconds: seconds,
          timeMinutes: seconds / 60,
          elapsedMinutes: 0,
          well: normalizeWell(item.value),
          rfu,
        });
      }
    }
    if (blockItems.length) {
      const firstTime = Math.min(...blockItems.map((item) => item.timeMinutes));
      for (const item of blockItems) {
        item.elapsedMinutes = round(item.timeMinutes - firstTime, 6);
      }
      observations.push(...blockItems);
    }
  }
  return observations;
}

function parseGridMapping(rows: MatrixRow[]): MappingEntry[] {
  let markerRow = -1;
  let markerColumn = -1;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    for (
      let columnIndex = 0;
      columnIndex < rows[rowIndex].length;
      columnIndex += 1
    ) {
      const value = cleanText(rows[rowIndex][columnIndex]).toLowerCase();
      if (["384 maps", "96 maps", "384 map", "96 map"].includes(value)) {
        markerRow = rowIndex;
        markerColumn = columnIndex;
        break;
      }
    }
    if (markerRow >= 0) {
      break;
    }
  }
  if (markerRow < 0 || markerColumn < 0) {
    return [];
  }

  const header = rows[markerRow];
  const targetColumn = header.findIndex((value) =>
    cleanText(value)
      .toLowerCase()
      .replace(/\s+/g, "")
      .includes("row(target"),
  );
  const crrnaHeader = findCrrnaHeader(rows, markerRow, markerColumn);
  const mapping: MappingEntry[] = [];
  const replicateCounts = new Map<string, number>();

  for (const row of rows.slice(markerRow + 1)) {
    const plateRow = cleanText(row[markerColumn] ?? row[0]).toUpperCase();
    if (!/^[A-P]$/.test(plateRow)) {
      continue;
    }
    const rowTarget =
      targetColumn >= 0 ? cleanText(row[targetColumn]) : "";
    for (
      let columnIndex = markerColumn + 1;
      columnIndex < header.length;
      columnIndex += 1
    ) {
      const plateColumn = parsePlateColumn(header[columnIndex]);
      if (plateColumn === null) {
        continue;
      }
      const cell = cleanText(row[columnIndex], true);
      if (!cell) {
        continue;
      }
      const metadata = parseMappingCell(cell);
      const target = cleanText(metadata.target || rowTarget);
      const crrna = cleanText(
        metadata.crrna ||
          metadata.crrna_name ||
          crrnaHeader[columnIndex],
      );
      if (!target || !crrna) {
        continue;
      }
      const key = groupKey(crrna, target);
      const replicate = (replicateCounts.get(key) ?? 0) + 1;
      replicateCounts.set(key, replicate);
      mapping.push({
        well: `${plateRow}${plateColumn}`,
        target,
        crrna,
        mapOrder: mapping.length + 1,
        replicate,
      });
    }
  }
  return mapping;
}

function parseFlatMapping(rows: MatrixRow[]): MappingEntry[] {
  let headerIndex = -1;
  let normalizedHeader: string[] = [];
  for (let index = 0; index < Math.min(rows.length, 50); index += 1) {
    const candidate = rows[index].map(normalizeHeader);
    if (
      candidate.some((item) => WELL_ALIASES.includes(item)) &&
      candidate.some((item) => TARGET_ALIASES.includes(item)) &&
      candidate.some((item) => CRRNA_ALIASES.includes(item))
    ) {
      headerIndex = index;
      normalizedHeader = candidate;
      break;
    }
  }
  if (headerIndex < 0) {
    throw new Error(
      "The mapping must be a recognized 96/384-well grid or a flat table with well, target/condition, and crRNA/assay columns.",
    );
  }

  const wellColumn = findAlias(normalizedHeader, WELL_ALIASES);
  const targetColumn = findAlias(normalizedHeader, TARGET_ALIASES);
  const crrnaColumn = findAlias(normalizedHeader, CRRNA_ALIASES);
  const replicateColumn = normalizedHeader.indexOf("replicate");
  const replicateCounts = new Map<string, number>();
  const mapping: MappingEntry[] = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const well = normalizeWell(cleanText(row[wellColumn]));
    const target = cleanText(row[targetColumn]);
    const crrna = cleanText(row[crrnaColumn]);
    if (!well && !target && !crrna) {
      continue;
    }
    const key = groupKey(crrna, target);
    const inferredReplicate = (replicateCounts.get(key) ?? 0) + 1;
    replicateCounts.set(key, inferredReplicate);
    const rawReplicate =
      replicateColumn >= 0 ? toNumber(row[replicateColumn]) : null;
    mapping.push({
      well,
      target,
      crrna,
      mapOrder: mapping.length + 1,
      replicate: rawReplicate ?? inferredReplicate,
    });
  }
  return mapping;
}

function validateMapping(mapping: MappingEntry[], sourceName: string): void {
  if (!mapping.length) {
    throw new Error(`No mapped wells were found in ${sourceName}.`);
  }
  const invalid = mapping
    .filter(
      (item) =>
        !WELL_RE.test(item.well) || !item.target.trim() || !item.crrna.trim(),
    )
    .map((item) => item.well || "(blank)");
  if (invalid.length) {
    throw new Error(
      `Invalid mapping rows or well IDs: ${invalid.slice(0, 12).join(", ")}`,
    );
  }
  const duplicates = mapping
    .map((item) => item.well)
    .filter((well, index, all) => all.indexOf(well) !== index);
  if (duplicates.length) {
    throw new Error(
      `Duplicate mapped wells: ${unique(duplicates).slice(0, 12).join(", ")}`,
    );
  }
}

function summarizeCell(
  crrna: string,
  target: string,
  values: number[],
): HeatmapCell {
  if (!values.length) {
    return { crrna, target, meanRfu: null, sdRfu: null, n: 0 };
  }
  const meanRfu = mean(values);
  const variance =
    values.length > 1
      ? values.reduce((sum, value) => sum + (value - meanRfu) ** 2, 0) /
        (values.length - 1)
      : 0;
  return {
    crrna,
    target,
    meanRfu,
    sdRfu: Math.sqrt(variance),
    n: values.length,
  };
}

function selectTimepoint(times: number[], requested: number): number {
  if (!times.length) {
    throw new Error("No elapsed time points are available.");
  }
  const closest = [...times].sort(
    (a, b) => Math.abs(a - requested) - Math.abs(b - requested),
  )[0];
  if (times.length === 1) {
    if (Math.abs(closest - requested) > 1e-7) {
      throw new Error(`Only ${closest} min is available.`);
    }
    return closest;
  }
  const steps = times
    .slice(1)
    .map((value, index) => value - times[index])
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const medianStep = steps[Math.floor(steps.length / 2)];
  if (Math.abs(closest - requested) > medianStep / 2 + 1e-7) {
    throw new Error(
      `No time point near ${requested} min. The closest available time is ${closest} min.`,
    );
  }
  return closest;
}

function parseMappingCell(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = normalizeHeader(line.slice(0, separator));
    result[key] = line.slice(separator + 1).trim();
  }
  return result;
}

function findCrrnaHeader(
  rows: MatrixRow[],
  markerRow: number,
  markerColumn: number,
): MatrixRow {
  for (let rowIndex = markerRow - 1; rowIndex >= 0; rowIndex -= 1) {
    const marker = cleanText(rows[rowIndex][markerColumn])
      .toLowerCase()
      .replace(/\s+/g, "");
    if (marker.includes("column") && marker.includes("crrna")) {
      return rows[rowIndex];
    }
  }
  return [];
}

function timeToSeconds(value: Cell): number | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return (
      value.getUTCHours() * 3600 +
      value.getUTCMinutes() * 60 +
      value.getUTCSeconds() +
      value.getUTCMilliseconds() / 1000
    );
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 0 && value < 1) {
      return value * 86400;
    }
    return value * 60;
  }
  const match = cleanText(value).match(TIME_RE);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] ?? 0);
}

function toNumber(value: Cell): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(cleanText(value).replace(/,/g, ""));
  return Number.isFinite(parsed) && cleanText(value) !== "" ? parsed : null;
}

function cleanText(value: Cell, preserveNewlines = false): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = String(value).trim();
  if (preserveNewlines) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
  }
  return text.replace(/\s+/g, " ");
}

function normalizeHeader(value: Cell): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeWell(value: string): string {
  return value.trim().toUpperCase();
}

function parsePlateColumn(value: Cell): number | null {
  const text = cleanText(value);
  if (!/^\d{1,2}$/.test(text)) {
    return null;
  }
  const column = Number(text);
  return column >= 1 && column <= 24 ? column : null;
}

function findAlias(header: string[], aliases: string[]): number {
  return header.findIndex((item) => aliases.includes(item));
}

function fingerprintObservations(items: KineticObservation[]): string {
  return items
    .map(
      (item) =>
        `${item.block}|${item.timeSeconds}|${item.well}|${round(item.rfu, 8)}`,
    )
    .sort()
    .join("\u0001");
}

function wellFromIndex(index: number): string {
  const row = String.fromCharCode("A".charCodeAt(0) + Math.floor(index / 12));
  return `${row}${(index % 12) + 1}`;
}

function wellSort(a: string, b: string): number {
  const matchA = a.match(WELL_RE);
  const matchB = b.match(WELL_RE);
  if (!matchA || !matchB) {
    return a.localeCompare(b);
  }
  return (
    matchA[1].toUpperCase().localeCompare(matchB[1].toUpperCase()) ||
    Number(matchA[2]) - Number(matchB[2])
  );
}

function groupKey(crrna: string, target: string): string {
  return `${crrna}\u0000${target}`;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: number[]): number[] {
  return unique(values).sort((a, b) => a - b);
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}
