"use client";

import {
  Activity,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  GitFork,
  ImageDown,
  LoaderCircle,
  Play,
  RotateCcw,
  Table2,
  UploadCloud,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type RefObject,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  analyzeFiles,
  buildHeatmap,
  createDemoAnalysis,
  heatmapToCsv,
  replicateRange,
  type CytationAnalysis,
  type HeatmapData,
} from "@/lib/cytation";

type PaletteId = "viridis" | "magma" | "cividis";

interface Palette {
  id: PaletteId;
  label: string;
  stops: string[];
}

const PALETTES: Palette[] = [
  {
    id: "viridis",
    label: "Viridis",
    stops: ["#440154", "#3B528B", "#21918C", "#5EC962", "#FDE725"],
  },
  {
    id: "magma",
    label: "Magma",
    stops: ["#000004", "#3B0F70", "#8C2981", "#DE4968", "#FCFDBF"],
  },
  {
    id: "cividis",
    label: "Cividis",
    stops: ["#00224E", "#35456C", "#6C6E72", "#A59C74", "#FDE737"],
  },
];

const SVG_WIDTH = 1240;
const SVG_HEIGHT = 620;

export default function CytationAnalyzer() {
  const [analysis, setAnalysis] = useState<CytationAnalysis>(() =>
    createDemoAnalysis(),
  );
  const [dataFile, setDataFile] = useState<File | null>(null);
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [selectedTime, setSelectedTime] = useState(30);
  const [paletteId, setPaletteId] = useState<PaletteId>("viridis");
  const [scaleMaximum, setScaleMaximum] = useState("");
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [figureTitle, setFigureTitle] = useState(
    "Conserved target multiplexing",
  );
  const [status, setStatus] = useState("Synthetic demo loaded");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const heatmap = useMemo(
    () => buildHeatmap(analysis, selectedTime),
    [analysis, selectedTime],
  );
  const palette =
    PALETTES.find((candidate) => candidate.id === paletteId) ?? PALETTES[0];
  const observedMaximum = Math.max(...heatmap.values, 1);
  const automaticMaximum = niceUpper(observedMaximum * 1.02);
  const requestedMaximum = Number(scaleMaximum);
  const colorMaximum =
    scaleMaximum.trim() && requestedMaximum > observedMaximum
      ? requestedMaximum
      : automaticMaximum;
  const [replicateMin, replicateMax] = replicateRange(analysis);
  const conditionCount = analysis.crrnaOrder.length * analysis.targetOrder.length;

  async function runAnalysis() {
    if (!dataFile || !mappingFile) {
      setError("Choose both a Cytation5 export and a plate-map file.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("Reading files");
    try {
      const result = await analyzeFiles(dataFile, mappingFile);
      const initialTime = nearestTime(result.timepoints, 30);
      setAnalysis(result);
      setSelectedTime(initialTime);
      setFigureTitle(cleanFilename(dataFile.name));
      setStatus(
        `${result.report.mappedWells} mapped wells across ${result.timepoints.length} time points`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The files could not be read.",
      );
      setStatus("Import failed");
    } finally {
      setBusy(false);
    }
  }

  function loadDemo() {
    const demo = createDemoAnalysis();
    setAnalysis(demo);
    setSelectedTime(30);
    setFigureTitle("Conserved target multiplexing");
    setDataFile(null);
    setMappingFile(null);
    setScaleMaximum("");
    setError("");
    setStatus("Synthetic demo loaded");
  }

  function downloadSvg() {
    if (!svgRef.current) {
      return;
    }
    const source = serializeSvg(svgRef.current);
    downloadBlob(
      new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
      `${figureSlug(figureTitle, heatmap.selectedTime)}.svg`,
    );
  }

  function downloadPng() {
    if (!svgRef.current) {
      return;
    }
    const source = serializeSvg(svgRef.current);
    const sourceUrl = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml;charset=utf-8" }),
    );
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = SVG_WIDTH * 2;
      canvas.height = SVG_HEIGHT * 2;
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(sourceUrl);
        setError("PNG export is unavailable in this browser.");
        return;
      }
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          downloadBlob(
            blob,
            `${figureSlug(figureTitle, heatmap.selectedTime)}.png`,
          );
        }
        URL.revokeObjectURL(sourceUrl);
      }, "image/png");
    };
    image.onerror = () => {
      URL.revokeObjectURL(sourceUrl);
      setError("The PNG could not be rendered.");
    };
    image.src = sourceUrl;
  }

  function downloadCsv() {
    downloadBlob(
      new Blob([heatmapToCsv(heatmap)], {
        type: "text/csv;charset=utf-8",
      }),
      `${figureSlug(figureTitle, heatmap.selectedTime)}_matrix.csv`,
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">
            <Activity size={21} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Cytation5 Analyzer</h1>
            <p>Plate-reader heatmaps in your browser</p>
          </div>
        </div>
        <div className="header-actions">
          <span className="privacy-status">
            <CheckCircle2 size={15} />
            Local processing
          </span>
          <a
            className="icon-button"
            href="https://github.com/soonwoohong/cytation5-analyzer"
            target="_blank"
            rel="noreferrer"
            aria-label="Open the GitHub repository"
            title="GitHub repository"
          >
            <GitFork size={19} />
          </a>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className="controls-pane" aria-label="Analysis controls">
          <section className="control-group">
            <div className="section-heading">
              <span className="step-number">1</span>
              <div>
                <h2>Input pair</h2>
                <p>Cytation export + plate map</p>
              </div>
            </div>
            <FilePicker
              label="Raw data"
              file={dataFile}
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
              onFile={setDataFile}
            />
            <FilePicker
              label="Plate map"
              file={mappingFile}
              accept=".xlsx,.xls,.xlsm,.csv,.tsv,.txt"
              onFile={setMappingFile}
            />
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={runAnalysis}
                disabled={busy}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <Play size={17} fill="currentColor" />
                )}
                Analyze
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={loadDemo}
              >
                <RotateCcw size={17} />
                Demo
              </button>
            </div>
            <div className="import-status" aria-live="polite">
              <span className={error ? "status-dot error" : "status-dot"} />
              <span>{error || status}</span>
            </div>
          </section>

          <section className="control-group">
            <div className="section-heading">
              <span className="step-number">2</span>
              <div>
                <h2>Heatmap</h2>
                <p>Mean fluorescence by condition</p>
              </div>
            </div>

            <label className="field">
              <span>Elapsed time</span>
              <select
                value={selectedTime}
                onChange={(event) => setSelectedTime(Number(event.target.value))}
              >
                {analysis.timepoints.map((time) => (
                  <option key={time} value={time}>
                    {formatMinutes(time)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Figure title</span>
              <input
                type="text"
                value={figureTitle}
                onChange={(event) => setFigureTitle(event.target.value)}
              />
            </label>

            <label className="field">
              <span>Color maximum</span>
              <div className="input-with-unit">
                <input
                  type="number"
                  min={Math.ceil(observedMaximum)}
                  step="1000"
                  placeholder={`Auto: ${formatInteger(automaticMaximum)}`}
                  value={scaleMaximum}
                  onChange={(event) => setScaleMaximum(event.target.value)}
                />
                <span>RFU</span>
              </div>
            </label>

            <fieldset className="palette-field">
              <legend>Palette</legend>
              <div className="palette-options">
                {PALETTES.map((item) => (
                  <button
                    key={item.id}
                    className={item.id === paletteId ? "palette active" : "palette"}
                    type="button"
                    aria-pressed={item.id === paletteId}
                    onClick={() => setPaletteId(item.id)}
                  >
                    <span
                      className="palette-swatch"
                      style={{
                        background: `linear-gradient(90deg, ${item.stops.join(", ")})`,
                      }}
                    />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="toggle-row">
              <span>
                <strong>Cell values</strong>
                <small>Show mean RFU labels</small>
              </span>
              <input
                type="checkbox"
                checked={showAnnotations}
                onChange={(event) => setShowAnnotations(event.target.checked)}
              />
            </label>
          </section>

          <section className="control-group export-group">
            <div className="section-heading compact">
              <span className="step-number">3</span>
              <div>
                <h2>Export</h2>
              </div>
            </div>
            <div className="export-grid">
              <button className="button button-secondary" type="button" onClick={downloadPng}>
                <ImageDown size={17} />
                PNG
              </button>
              <button className="button button-secondary" type="button" onClick={downloadSvg}>
                <Download size={17} />
                SVG
              </button>
              <button className="button button-secondary" type="button" onClick={downloadCsv}>
                <Table2 size={17} />
                CSV
              </button>
            </div>
          </section>
        </aside>

        <section className="results-pane" aria-label="Analysis results">
          <div className="results-toolbar">
            <div>
              <span className="results-kicker">Current analysis</span>
              <h2>{analysis.sourceName}</h2>
            </div>
            <div className="metric-strip">
              <Metric label="Mapped wells" value={analysis.report.mappedWells} />
              <Metric label="Conditions" value={conditionCount} />
              <Metric
                label="Replicates"
                value={
                  replicateMin === replicateMax
                    ? replicateMin
                    : `${replicateMin}-${replicateMax}`
                }
              />
              <Metric label="Time points" value={analysis.timepoints.length} />
            </div>
          </div>

          <section className="figure-workbench">
            <div className="figure-stage">
              <HeatmapFigure
                ref={svgRef}
                heatmap={heatmap}
                title={figureTitle || "Cytation5 fluorescence"}
                colorMaximum={colorMaximum}
                palette={palette}
                showAnnotations={showAnnotations}
                replicateRange={[replicateMin, replicateMax]}
              />
            </div>
          </section>

          <section className="matrix-section">
            <div className="matrix-header">
              <div>
                <span className="results-kicker">Mean RFU matrix</span>
                <h3>{formatMinutes(heatmap.selectedTime)}</h3>
              </div>
              <span>
                {heatmap.crrnas.length} crRNAs x {heatmap.targets.length} targets
              </span>
            </div>
            <div className="matrix-scroll">
              <table>
                <thead>
                  <tr>
                    <th>crRNA</th>
                    {heatmap.targets.map((target) => (
                      <th key={target}>{target}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.cells.map((row, rowIndex) => (
                    <tr key={heatmap.crrnas[rowIndex]}>
                      <th>{heatmap.crrnas[rowIndex]}</th>
                      {row.map((cell) => (
                        <td key={cell.target}>
                          {cell.meanRfu === null
                            ? "NA"
                            : formatInteger(cell.meanRfu)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function FilePicker({
  label,
  file,
  accept,
  onFile,
}: {
  label: string;
  file: File | null;
  accept: string;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    if (selected) {
      onFile(selected);
    }
  }

  function drop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    const selected = event.dataTransfer.files?.[0];
    if (selected) {
      onFile(selected);
    }
  }

  return (
    <div className="file-picker">
      <span className="file-label">{label}</span>
      <button
        className={file ? "file-drop loaded" : "file-drop"}
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={drop}
      >
        <span className="file-icon" aria-hidden="true">
          {file ? <FileSpreadsheet size={19} /> : <UploadCloud size={19} />}
        </span>
        <span className="file-copy">
          <strong>{file ? file.name : "Choose or drop a file"}</strong>
          <small>{file ? formatFileSize(file.size) : "XLSX, CSV, or TSV"}</small>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={choose}
        hidden
      />
    </div>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

const HeatmapFigure = function HeatmapFigure({
  ref,
  heatmap,
  title,
  colorMaximum,
  palette,
  showAnnotations,
  replicateRange: [replicateMin, replicateMax],
}: {
  ref: RefObject<SVGSVGElement | null>;
  heatmap: HeatmapData;
  title: string;
  colorMaximum: number;
  palette: Palette;
  showAnnotations: boolean;
  replicateRange: [number, number];
}) {
  const left = 245;
  const top = 150;
  const plotWidth = 815;
  const plotHeight = 285;
  const cellWidth = plotWidth / heatmap.targets.length;
  const cellHeight = plotHeight / heatmap.crrnas.length;
  const colorbarX = left + plotWidth + 48;
  const gradientId = `heatmap-gradient-${palette.id}`;
  const replicateText =
    replicateMin === replicateMax
      ? `${replicateMin} mapped wells per condition`
      : `${replicateMin}-${replicateMax} mapped wells per condition`;

  return (
    <svg
      ref={ref}
      className="heatmap-svg"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      role="img"
      aria-label={`${title}, mean fluorescence heatmap at ${heatmap.selectedTime} minutes`}
      data-testid="heatmap"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="1" y2="0">
          {palette.stops.map((stop, index) => (
            <stop
              key={stop}
              offset={`${(index / (palette.stops.length - 1)) * 100}%`}
              stopColor={stop}
            />
          ))}
        </linearGradient>
      </defs>
      <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="#FFFFFF" />
      <text
        x={SVG_WIDTH / 2}
        y="52"
        textAnchor="middle"
        fill="#182125"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize={title.length > 62 ? 21 : 25}
        fontWeight="700"
        letterSpacing="0"
      >
        {title}
      </text>
      <text
        x={SVG_WIDTH / 2}
        y="87"
        textAnchor="middle"
        fill="#667278"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="14"
        letterSpacing="0"
      >
        Mean RFU at {formatMinutes(heatmap.selectedTime)} | {replicateText}
      </text>

      {heatmap.cells.map((row, rowIndex) =>
        row.map((cell, columnIndex) => {
          const x = left + columnIndex * cellWidth;
          const y = top + rowIndex * cellHeight;
          const fill =
            cell.meanRfu === null
              ? "#E6EAEB"
              : colorAt(
                  Math.max(0, Math.min(1, cell.meanRfu / colorMaximum)),
                  palette.stops,
                );
          return (
            <g key={`${cell.crrna}-${cell.target}`}>
              <rect
                x={x}
                y={y}
                width={cellWidth}
                height={cellHeight}
                fill={fill}
                stroke="#FFFFFF"
                strokeWidth="2"
              />
              {showAnnotations && (
                <text
                  x={x + cellWidth / 2}
                  y={y + cellHeight / 2 + 5}
                  textAnchor="middle"
                  fill={contrastColor(fill)}
                  fontFamily="Arial, Helvetica, sans-serif"
                  fontSize="14"
                  fontWeight="700"
                  letterSpacing="0"
                >
                  {cell.meanRfu === null
                    ? "NA"
                    : formatCompact(cell.meanRfu)}
                </text>
              )}
            </g>
          );
        }),
      )}

      {heatmap.crrnas.map((crrna, index) => (
        <text
          key={crrna}
          x={left - 18}
          y={top + index * cellHeight + cellHeight / 2 + 5}
          textAnchor="end"
          fill="#2A353A"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="15"
          letterSpacing="0"
        >
          {crrna}
        </text>
      ))}

      {heatmap.targets.map((target, index) => (
        <text
          key={target}
          x={left + index * cellWidth + cellWidth / 2}
          y={top + plotHeight + 28}
          textAnchor="middle"
          fill="#2A353A"
          fontFamily="Arial, Helvetica, sans-serif"
          fontSize="13.5"
          letterSpacing="0"
        >
          {targetLines(target).map((line, lineIndex) => (
            <tspan
              key={line}
              x={left + index * cellWidth + cellWidth / 2}
              dy={lineIndex === 0 ? 0 : 18}
            >
              {line}
            </tspan>
          ))}
        </text>
      ))}

      <text
        x={left + plotWidth / 2}
        y="575"
        textAnchor="middle"
        fill="#202B30"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="17"
        letterSpacing="0"
      >
        Target
      </text>
      <text
        x="43"
        y={top + plotHeight / 2}
        textAnchor="middle"
        fill="#202B30"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="17"
        letterSpacing="0"
        transform={`rotate(-90 43 ${top + plotHeight / 2})`}
      >
        crRNA
      </text>

      <rect
        x={colorbarX}
        y={top}
        width="22"
        height={plotHeight}
        fill={`url(#${gradientId})`}
        stroke="#536168"
        strokeWidth="0.8"
      />
      {Array.from({ length: 6 }, (_, index) => {
        const fraction = index / 5;
        const y = top + plotHeight - fraction * plotHeight;
        return (
          <g key={fraction}>
            <line
              x1={colorbarX + 22}
              x2={colorbarX + 30}
              y1={y}
              y2={y}
              stroke="#445159"
              strokeWidth="1"
            />
            <text
              x={colorbarX + 37}
              y={y + 5}
              fill="#334047"
              fontFamily="Arial, Helvetica, sans-serif"
              fontSize="13"
              letterSpacing="0"
            >
              {formatAxis(colorMaximum * fraction)}
            </text>
          </g>
        );
      })}
      <text
        x={colorbarX + 92}
        y={top + plotHeight / 2}
        textAnchor="middle"
        fill="#202B30"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="16"
        letterSpacing="0"
        transform={`rotate(-90 ${colorbarX + 92} ${top + plotHeight / 2})`}
      >
        Mean RFU
      </text>
    </svg>
  );
};

function targetLines(target: string): string[] {
  const parts = target.split("+").map((part) => part.trim());
  if (parts.length === 1) {
    return parts;
  }
  return parts.map((part, index) =>
    index < parts.length - 1 ? `${part} +` : part,
  );
}

function colorAt(position: number, stops: string[]): string {
  const scaled = position * (stops.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(stops.length - 1, lower + 1);
  const fraction = scaled - lower;
  const from = hexToRgb(stops[lower]);
  const to = hexToRgb(stops[upper]);
  return rgbToHex(
    Math.round(from[0] + (to[0] - from[0]) * fraction),
    Math.round(from[1] + (to[1] - from[1]) * fraction),
    Math.round(from[2] + (to[2] - from[2]) * fraction),
  );
}

function contrastColor(hex: string): string {
  const [red, green, blue] = hexToRgb(hex);
  const luminance =
    (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance > 0.57 ? "#152027" : "#FFFFFF";
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgbToHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function niceUpper(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const exponent = 10 ** Math.floor(Math.log10(value));
  const scaled = value / exponent;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return (steps.find((step) => scaled <= step) ?? 10) * exponent;
}

function nearestTime(times: number[], requested: number): number {
  return [...times].sort(
    (a, b) => Math.abs(a - requested) - Math.abs(b - requested),
  )[0];
}

function formatMinutes(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)} min`;
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return Math.round(value).toString();
}

function formatAxis(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return Math.round(value).toString();
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanFilename(filename: string): string {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function figureSlug(title: string, time: number): string {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "cytation5";
  return `${stem}_${String(time).replace(".", "p")}min_heatmap`;
}

function serializeSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(SVG_WIDTH));
  clone.setAttribute("height", String(SVG_HEIGHT));
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
