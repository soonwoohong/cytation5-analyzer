/* global Plotly, loadPyodide, lucide */

"use strict";

const PYTHON_FILES = [
  "__init__.py",
  "xlsx.py",
  "core.py",
  "web_bridge.py",
];

const LINE_PALETTES = {
  tableau: [
    "#4E79A7",
    "#F28E2B",
    "#59A14F",
    "#E15759",
    "#76B7B2",
    "#EDC948",
    "#B07AA1",
    "#FF9DA7",
    "#9C755F",
    "#BAB0AC",
  ],
  okabe: [
    "#0072B2",
    "#D55E00",
    "#009E73",
    "#CC79A7",
    "#56B4E9",
    "#E69F00",
    "#000000",
    "#F0E442",
  ],
  prism: [
    "#1F77B4",
    "#FF7F0E",
    "#00A676",
    "#D675A8",
    "#55ACEE",
    "#E5A000",
    "#202020",
    "#8C6BB1",
  ],
  tol: [
    "#4477AA",
    "#EE6677",
    "#228833",
    "#CCBB44",
    "#66CCEE",
    "#AA3377",
    "#BBBBBB",
    "#000000",
  ],
  dark2: [
    "#1B9E77",
    "#D95F02",
    "#7570B3",
    "#E7298A",
    "#66A61E",
    "#E6AB02",
    "#A6761D",
    "#666666",
  ],
  set2: [
    "#66C2A5",
    "#FC8D62",
    "#8DA0CB",
    "#E78AC3",
    "#A6D854",
    "#FFD92F",
    "#E5C494",
    "#B3B3B3",
  ],
  paired: [
    "#1F78B4",
    "#A6CEE3",
    "#33A02C",
    "#B2DF8A",
    "#E31A1C",
    "#FB9A99",
    "#FF7F00",
    "#FDBF6F",
    "#6A3D9A",
    "#CAB2D6",
    "#B15928",
    "#FFFF99",
  ],
  viridis: [
    "#440154",
    "#482878",
    "#3E4989",
    "#31688E",
    "#26828E",
    "#1F9E89",
    "#35B779",
    "#6DCD59",
    "#B4DE2C",
    "#FDE725",
  ],
  turbo: [
    "#30123B",
    "#4662D7",
    "#28A8E0",
    "#1BCFD4",
    "#60F57A",
    "#C7EF34",
    "#F9BA38",
    "#F66B19",
    "#C92A28",
    "#7A0403",
  ],
  pastel: [
    "#80B1D3",
    "#FB8072",
    "#8DD3C7",
    "#BEBADA",
    "#FDB462",
    "#B3DE69",
    "#FCCDE5",
    "#BC80BD",
    "#CCEBC5",
    "#D9D9D9",
  ],
};

const HEATMAP_PALETTES = {
  Viridis: ["#440154", "#31688E", "#35B779", "#FDE725"],
  Plasma: ["#0D0887", "#9C179E", "#ED7953", "#F0F921"],
  Magma: ["#000004", "#721F81", "#F1605D", "#FCFDBF"],
  Inferno: ["#000004", "#781C6D", "#ED6925", "#FCFFA4"],
  Cividis: ["#00224E", "#575D6D", "#A59C74", "#FDE737"],
  Turbo: ["#30123B", "#28A8E0", "#60F57A", "#F9BA38", "#7A0403"],
  Blues: ["#F7FBFF", "#C6DBEF", "#6BAED6", "#08306B"],
  YlGnBu: ["#FFFFD9", "#7FCDBB", "#2C7FB8", "#253494"],
  RdBu: ["#B2182B", "#F4A582", "#F7F7F7", "#92C5DE", "#2166AC"],
  Spectral: ["#9E0142", "#F46D43", "#FFFFBF", "#66C2A5", "#5E4FA2"],
};

const state = {
  pyodide: null,
  pythonReady: false,
  session: null,
  mapping: [],
  dataFile: null,
  mappingFile: null,
  view: "kinetics",
  kinetics: null,
  heatmap: null,
  renderTimer: null,
  renderSequence: 0,
  toastTimer: null,
};

const byId = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", initialize);

async function initialize() {
  lucide.createIcons();
  bindEvents();
  updatePalettePreviews();
  setControlsEnabled(false);

  try {
    setBootDetail("Loading Python runtime");
    state.pyodide = await loadPyodide({
      indexURL: new URL("vendor/pyodide/", document.baseURI).href,
    });
    setBootDetail("Loading Cytation analysis package");
    await loadPythonSources();
    state.pythonReady = true;
    byId("engine-badge").classList.add("ready");
    byId("engine-label").textContent = "Python ready";
    setControlsEnabled(true);
    const fixtureLoaded = await loadLocalFixtureFromQuery();
    if (!fixtureLoaded) {
      await loadDemo();
    }
    byId("boot-screen").classList.add("dismissed");
  } catch (error) {
    console.error(error);
    setBootDetail("Python could not start");
    setStatus(readError(error), "error");
    byId("engine-label").textContent = "Python unavailable";
  }
}

async function loadPythonSources() {
  const root = "/app-python";
  const packageRoot = `${root}/cytation5_analyzer`;
  state.pyodide.FS.mkdirTree(packageRoot);
  for (const filename of PYTHON_FILES) {
    const url = new URL(
      `python/cytation5_analyzer/${filename}`,
      document.baseURI,
    );
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Could not load Python module ${filename}.`);
    }
    state.pyodide.FS.writeFile(
      `${packageRoot}/${filename}`,
      await response.text(),
    );
  }
  state.pyodide.runPython(`
import sys
if "/app-python" not in sys.path:
    sys.path.insert(0, "/app-python")
from cytation5_analyzer.web_bridge import (
    export_mapping,
    heatmap,
    kinetics,
    load_demo,
    load_upload_from_files,
    merge_mapping,
)
`);
}

function bindEvents() {
  bindFileInput("data-file", "data-drop", "data");
  bindFileInput("mapping-file", "mapping-drop", "mapping");

  byId("analyze-button").addEventListener("click", analyzeFiles);
  byId("demo-button").addEventListener("click", loadDemo);
  byId("figure-title").addEventListener("input", scheduleRender);

  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });

  const renderControls = [
    "error-mode",
    "legend-position",
    "panel-columns",
    "y-min",
    "y-max",
    "line-palette",
    "line-width",
    "baseline-toggle",
    "grid-toggle",
    "heatmap-time",
    "color-min",
    "color-max",
    "heatmap-palette",
    "reverse-palette",
    "annotation-toggle",
    "font-family",
    "title-font",
    "axis-font",
    "tick-font",
    "legend-font",
  ];
  for (const id of renderControls) {
    byId(id).addEventListener("input", () => {
      if (id === "line-width") {
        byId("line-width-value").textContent = byId(id).value;
      }
      if (
        id === "line-palette" ||
        id === "heatmap-palette" ||
        id === "reverse-palette"
      ) {
        updatePalettePreviews();
      }
      scheduleRender();
    });
    byId(id).addEventListener("change", scheduleRender);
  }

  byId("mapping-filter").addEventListener("input", filterMappingRows);
  byId("mapping-table-body").addEventListener("input", updateMappingCell);
  byId("mapping-table-body").addEventListener("change", updateMappingCell);
  byId("select-visible").addEventListener("click", () =>
    setVisibleIncluded(true),
  );
  byId("exclude-visible").addEventListener("click", () =>
    setVisibleIncluded(false),
  );
  byId("reset-well-map").addEventListener("click", resetWellMapping);
  byId("paste-map-button").addEventListener("click", openPasteDialog);
  byId("apply-pasted-map").addEventListener("click", applyPastedMapping);
  byId("download-map").addEventListener("click", downloadMapping);

  byId("export-png").addEventListener("click", () => exportFigure("png"));
  byId("export-svg").addEventListener("click", () => exportFigure("svg"));
  byId("export-csv").addEventListener("click", exportCurrentCsv);
  byId("reset-zoom").addEventListener("click", resetPlotAxes);

  window.addEventListener("resize", () => {
    if (!byId("figure-workspace").classList.contains("hidden")) {
      Plotly.Plots.resize(byId("plot"));
    }
  });
}

function bindFileInput(inputId, dropId, kind) {
  const input = byId(inputId);
  const drop = byId(dropId);
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) {
      setInputFile(kind, file);
    }
  });
  for (const eventName of ["dragenter", "dragover"]) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.add("dragging");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    drop.addEventListener(eventName, (event) => {
      event.preventDefault();
      drop.classList.remove("dragging");
    });
  }
  drop.addEventListener("drop", (event) => {
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) {
      setInputFile(kind, file);
    }
  });
}

function setInputFile(kind, file) {
  state[`${kind}File`] = file;
  const prefix = kind === "data" ? "data" : "mapping";
  byId(`${prefix}-file-name`).textContent = file.name;
  byId(`${prefix}-file-detail`).textContent = formatFileSize(file.size);
  byId(`${prefix}-drop`).classList.add("loaded");
}

async function analyzeFiles() {
  if (!state.pythonReady) {
    setStatus("The Python engine is still loading.", "error");
    return;
  }
  if (!state.dataFile) {
    setStatus("Choose a raw Cytation export.", "error");
    return;
  }

  setBusy(true);
  setStatus("Reading Cytation export");
  const dataPath = "/tmp/cytation-data";
  const mappingPath = state.mappingFile ? "/tmp/cytation-map" : "";

  try {
    state.pyodide.FS.writeFile(
      dataPath,
      new Uint8Array(await state.dataFile.arrayBuffer()),
    );
    if (state.mappingFile) {
      state.pyodide.FS.writeFile(
        mappingPath,
        new Uint8Array(await state.mappingFile.arrayBuffer()),
      );
    }
    const payload = callPythonJson(
      "load_upload_from_files",
      dataPath,
      state.dataFile.name,
      mappingPath,
      state.mappingFile ? state.mappingFile.name : "",
    );
    byId("figure-title").value = cleanFilename(state.dataFile.name);
    await adoptSession(payload);
    const mappingCopy = state.mappingFile
      ? `${payload.report.mapped_wells} mapped wells`
      : `${payload.report.wells_found} wells plotted by address`;
    setStatus(`${mappingCopy} across ${payload.timepoints.length} time points`, "ready");
  } catch (error) {
    console.error(error);
    setStatus(readError(error), "error");
  } finally {
    safeUnlink(dataPath);
    if (mappingPath) {
      safeUnlink(mappingPath);
    }
    setBusy(false);
  }
}

async function loadLocalFixtureFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const fixture = params.get("fixture");
  const isLocal = ["127.0.0.1", "localhost"].includes(window.location.hostname);
  if (!isLocal || !["pair", "raw"].includes(fixture)) {
    return false;
  }
  try {
    const rawResponse = await fetch("__fixtures__/raw.xlsx");
    const mapResponse =
      fixture === "pair" ? await fetch("__fixtures__/map.csv") : null;
    if (!rawResponse.ok || (mapResponse && !mapResponse.ok)) {
      return false;
    }
    setInputFile(
      "data",
      new File(
        [await rawResponse.arrayBuffer()],
        "local_fixture.xlsx",
      ),
    );
    if (mapResponse) {
      setInputFile(
        "mapping",
        new File(
          [await mapResponse.arrayBuffer()],
          "local_map.csv",
        ),
      );
    } else {
      state.mappingFile = null;
    }
    await analyzeFiles();
    return true;
  } catch (error) {
    console.warn("Local fixture could not be loaded.", error);
    return false;
  }
}

async function loadDemo() {
  if (!state.pythonReady) {
    return;
  }
  setBusy(true);
  try {
    const payload = callPythonJson("load_demo");
    byId("figure-title").value = "Conserved target multiplexing";
    await adoptSession(payload);
    setStatus("Synthetic demo loaded", "ready");
  } catch (error) {
    console.error(error);
    setStatus(readError(error), "error");
  } finally {
    setBusy(false);
  }
}

async function adoptSession(payload) {
  state.session = payload;
  state.mapping = payload.mapping.map((item) => ({ ...item }));
  state.kinetics = null;
  state.heatmap = null;
  populateTimepoints(payload.timepoints);
  renderMappingTable();
  updateAnalysisHeader();
  switchView("kinetics", false);
  await renderCurrentView();
}

function populateTimepoints(timepoints) {
  const select = byId("heatmap-time");
  select.replaceChildren();
  let nearest = timepoints[0];
  for (const value of timepoints) {
    if (Math.abs(value - 30) < Math.abs(nearest - 30)) {
      nearest = value;
    }
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = formatMinutes(value);
    select.append(option);
  }
  select.value = String(nearest);
}

function switchView(view, shouldRender = true) {
  state.view = view;
  byId("figure-workspace").dataset.view = view;
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll("[data-control-view]").forEach((section) => {
    section.classList.toggle("hidden", section.dataset.controlView !== view);
  });
  byId("figure-workspace").classList.toggle("hidden", view === "mapping");
  byId("mapping-workspace").classList.toggle("hidden", view !== "mapping");
  byId("reset-zoom").classList.toggle("hidden", view === "mapping");

  if (view === "mapping") {
    filterMappingRows();
  } else if (shouldRender) {
    renderCurrentView();
  }
}

function scheduleRender() {
  if (!state.session || state.view === "mapping") {
    return;
  }
  window.clearTimeout(state.renderTimer);
  state.renderTimer = window.setTimeout(renderCurrentView, 140);
}

async function renderCurrentView() {
  if (!state.session || !state.pythonReady || state.view === "mapping") {
    return;
  }
  const sequence = ++state.renderSequence;
  byId("plot-loading").classList.remove("hidden");
  await nextFrame();

  try {
    if (state.view === "kinetics") {
      const options = { baseline: byId("baseline-toggle").checked };
      const result = callPythonJson(
        "kinetics",
        JSON.stringify(state.mapping),
        JSON.stringify(options),
      );
      if (sequence !== state.renderSequence) {
        return;
      }
      state.kinetics = result;
      renderKineticPlot(result);
    } else {
      const options = {
        baseline: byId("baseline-toggle").checked,
        time: numberValue("heatmap-time", 30),
      };
      const result = callPythonJson(
        "heatmap",
        JSON.stringify(state.mapping),
        JSON.stringify(options),
      );
      if (sequence !== state.renderSequence) {
        return;
      }
      state.heatmap = result;
      renderHeatmapPlot(result);
    }
    updateAnalysisHeader();
  } catch (error) {
    console.error(error);
    setStatus(readError(error), "error");
  } finally {
    if (sequence === state.renderSequence) {
      byId("plot-loading").classList.add("hidden");
    }
  }
}

function renderKineticPlot(result) {
  const palette = LINE_PALETTES[byId("line-palette").value];
  const errorMode = byId("error-mode").value;
  const compactViewport = window.innerWidth <= 560;
  const columns = compactViewport
    ? 1
    : clamp(
        Math.round(numberValue("panel-columns", 3)),
        1,
        Math.max(1, Math.min(4, result.panels.length)),
      );
  const rows = Math.max(1, Math.ceil(result.panels.length / columns));
  const targets = result.target_order;
  const colors = new Map(
    targets.map((target, index) => [target, palette[index % palette.length]]),
  );
  const traces = [];
  const annotations = [];
  const legendSeen = new Set();
  let anyUncertaintyBand = false;
  const fontFamily = byId("font-family").value;
  const axisFont = numberValue("axis-font", 16);
  const tickFont = numberValue("tick-font", 13);
  const legendFont = numberValue("legend-font", 12);
  const lineWidth = numberValue("line-width", 2.2);
  const showGrid = byId("grid-toggle").checked;
  const legendPosition = compactViewport
    ? "bottom"
    : byId("legend-position").value;
  const yMin = optionalNumber("y-min");
  const yMax = optionalNumber("y-max");
  const yRange = yMin !== null || yMax !== null
    ? [yMin === null ? 0 : yMin, yMax === null ? inferYMaximum(result) : yMax]
    : undefined;

  result.panels.forEach((panel, panelIndex) => {
    const axisNumber = panelIndex + 1;
    const xAxis = axisNumber === 1 ? "x" : `x${axisNumber}`;
    const yAxis = axisNumber === 1 ? "y" : `y${axisNumber}`;
    const xReference = `${xAxis} domain`;
    const yReference = `${yAxis} domain`;

    for (const series of panel.series) {
      const color = colors.get(series.target) || "#46555B";
      const x = series.points.map((point) => point.time);
      const y = series.points.map((point) => point.mean);
      const uncertainty = series.points.map((point) =>
        errorMode === "none" ? 0 : point[errorMode],
      );
      const hasBand = uncertainty.some((value) => value > 0);
      if (hasBand) {
        anyUncertaintyBand = true;
        traces.push({
          x,
          y: y.map((value, index) => value + uncertainty[index]),
          xaxis: xAxis,
          yaxis: yAxis,
          mode: "lines",
          line: { color, width: 0 },
          hoverinfo: "skip",
          showlegend: false,
          legendgroup: series.target,
        });
        traces.push({
          x,
          y: y.map((value, index) => value - uncertainty[index]),
          xaxis: xAxis,
          yaxis: yAxis,
          mode: "lines",
          line: { color, width: 0 },
          fill: "tonexty",
          fillcolor: hexToRgba(color, 0.15),
          hoverinfo: "skip",
          showlegend: false,
          legendgroup: series.target,
        });
      }
      const showLegend = !legendSeen.has(series.target);
      legendSeen.add(series.target);
      traces.push({
        x,
        y,
        customdata: series.points.map((point) => [
          point.n,
          point.sd,
          point.sem,
        ]),
        xaxis: xAxis,
        yaxis: yAxis,
        type: "scatter",
        mode: "lines",
        name: series.target,
        legendgroup: series.target,
        showlegend: showLegend,
        line: { color, width: lineWidth },
        hovertemplate:
          `<b>${escapeHtml(series.target)}</b><br>` +
          "Time: %{x:g} min<br>Mean: %{y:,.1f} RFU<br>" +
          "SD: %{customdata[1]:,.1f}<br>n: %{customdata[0]}<extra></extra>",
      });
    }

    annotations.push({
      x: 0.5,
      y: 1.035,
      xref: xReference,
      yref: yReference,
      text: escapeHtml(panel.crrna),
      showarrow: false,
      xanchor: "center",
      yanchor: "bottom",
      font: {
        family: fontFamily,
        size: compactViewport
          ? Math.min(15, Math.max(12, axisFont))
          : Math.max(12, axisFont),
        color: "#263237",
      },
    });
  });

  const layout = {
    title: {
      text: escapeHtml(figureTitle()),
      x: 0.5,
      y: 0.985,
      xanchor: "center",
      font: {
        family: fontFamily,
        size: compactViewport
          ? Math.min(22, numberValue("title-font", 24))
          : numberValue("title-font", 24),
        color: "#182124",
      },
    },
    grid: {
      rows,
      columns,
      pattern: "independent",
      roworder: "top to bottom",
      xgap: compactViewport ? 0 : 0.09,
      ygap: compactViewport ? 0.1 : 0.16,
    },
    annotations,
    margin: {
      l: compactViewport ? 61 : 76,
      r: legendPosition === "right" ? 185 : 44,
      t: 142,
      b: legendPosition === "bottom" ? 145 : 68,
    },
    height: Math.max(540, rows * (compactViewport ? 300 : 330) + 150),
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: "#FFFFFF",
    hovermode: "closest",
    legend: {
      x: legendPosition === "bottom" ? 0.5 : 1.02,
      y: legendPosition === "bottom" ? -0.13 : 1,
      xanchor: legendPosition === "bottom" ? "center" : "left",
      yanchor: legendPosition === "bottom" ? "top" : "top",
      orientation: legendPosition === "bottom" ? "h" : "v",
      bgcolor: "rgba(255,255,255,0)",
      borderwidth: 0,
      font: { family: fontFamily, size: legendFont, color: "#344147" },
      tracegroupgap: 2,
    },
    showlegend: legendPosition !== "hidden",
    font: { family: fontFamily, color: "#263237" },
    uirevision: `${state.session.source_name}-kinetics`,
  };

  result.panels.forEach((panel, panelIndex) => {
    const axisNumber = panelIndex + 1;
    const suffix = axisNumber === 1 ? "" : String(axisNumber);
    const row = Math.floor(panelIndex / columns);
    const column = panelIndex % columns;
    layout[`xaxis${suffix}`] = {
      title:
        row === rows - 1 || compactViewport
          ? { text: "Time (min)", font: { family: fontFamily, size: axisFont } }
          : undefined,
      tickfont: { family: fontFamily, size: tickFont, color: "#4C5B60" },
      showgrid: showGrid,
      gridcolor: "#E2E7E5",
      gridwidth: 1,
      zeroline: false,
      showline: true,
      linecolor: "#5F6B70",
      linewidth: 1,
      ticks: "outside",
      automargin: true,
    };
    layout[`yaxis${suffix}`] = {
      title:
        column === 0
          ? {
              text: byId("baseline-toggle").checked ? "ΔRFU" : "Mean RFU",
              font: { family: fontFamily, size: axisFont },
            }
          : undefined,
      tickfont: { family: fontFamily, size: tickFont, color: "#4C5B60" },
      showgrid: showGrid,
      gridcolor: "#E2E7E5",
      gridwidth: 1,
      zeroline: false,
      showline: true,
      linecolor: "#5F6B70",
      linewidth: 1,
      ticks: "outside",
      automargin: true,
      matches: axisNumber === 1 ? undefined : "y",
      range: yRange,
    };
  });

  Plotly.react(byId("plot"), traces, layout, plotConfig("kinetic_curves"));
  byId("plot-kicker").textContent = "Mean RFU over time";
  const includedWells = state.mapping.filter((item) => item.include).length;
  byId("plot-detail").textContent =
    !anyUncertaintyBand && result.target_order.length === includedWells
      ? "Individual well traces"
      : errorMode === "none"
      ? "Replicate mean"
      : `Replicate mean with ${errorMode.toUpperCase()} band`;
  byId("note-primary").textContent =
    `${result.panels.length} ${plural(result.panels.length, "crRNA panel")}`;
  byId("note-secondary").textContent =
    `${result.target_order.length} target series`;
}

function renderHeatmapPlot(result) {
  const fontFamily = byId("font-family").value;
  const tickFont = numberValue("tick-font", 13);
  const annotationText = result.matrix.map((row) =>
    row.map((value) => (value === null ? "" : formatCompact(value))),
  );
  const customdata = result.cells.map((row) =>
    row.map((cell) => [cell.n, cell.sd]),
  );
  const trace = {
    x: result.targets,
    y: result.crrnas,
    z: result.matrix,
    customdata,
    text: annotationText,
    type: "heatmap",
    colorscale: byId("heatmap-palette").value,
    reversescale: byId("reverse-palette").checked,
    zmin: optionalNumber("color-min"),
    zmax: optionalNumber("color-max"),
    hoverongaps: false,
    hovertemplate:
      "<b>%{y}</b><br>Target: %{x}<br>Mean: %{z:,.1f} RFU" +
      "<br>SD: %{customdata[1]:,.1f}<br>n: %{customdata[0]}<extra></extra>",
    colorbar: {
      title: {
        text: byId("baseline-toggle").checked ? "Mean ΔRFU" : "Mean RFU",
        side: "right",
        font: {
          family: fontFamily,
          size: numberValue("axis-font", 16),
        },
      },
      tickfont: { family: fontFamily, size: tickFont },
      thickness: 19,
      len: 0.78,
      outlinewidth: 0.7,
      outlinecolor: "#6E7A7F",
    },
  };
  if (byId("annotation-toggle").checked) {
    trace.texttemplate = "%{text}";
    trace.textfont = {
      family: fontFamily,
      size: Math.max(8, Math.min(tickFont, 14)),
    };
  }

  const layout = {
    title: {
      text: escapeHtml(figureTitle()),
      x: 0.5,
      xanchor: "center",
      font: {
        family: fontFamily,
        size: numberValue("title-font", 24),
        color: "#182124",
      },
    },
    margin: { l: 170, r: 125, t: 88, b: 150 },
    height: Math.max(555, result.crrnas.length * 58 + 270),
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: "#FFFFFF",
    xaxis: {
      title: {
        text: "Target",
        font: {
          family: fontFamily,
          size: numberValue("axis-font", 16),
        },
      },
      tickangle: result.targets.length > 5 ? -35 : 0,
      tickfont: { family: fontFamily, size: tickFont },
      automargin: true,
      side: "bottom",
    },
    yaxis: {
      title: {
        text: "crRNA",
        font: {
          family: fontFamily,
          size: numberValue("axis-font", 16),
        },
      },
      tickfont: { family: fontFamily, size: tickFont },
      automargin: true,
      autorange: "reversed",
    },
    font: { family: fontFamily, color: "#263237" },
    uirevision: `${state.session.source_name}-heatmap`,
  };

  Plotly.react(byId("plot"), [trace], layout, plotConfig("fluorescence_heatmap"));
  byId("plot-kicker").textContent = "Mean fluorescence matrix";
  byId("plot-detail").textContent = formatMinutes(result.selected_time);
  byId("note-primary").textContent =
    `${result.crrnas.length} crRNAs × ${result.targets.length} targets`;
  byId("note-secondary").textContent =
    `Nearest sampled time: ${formatMinutes(result.selected_time)}`;
}

function renderMappingTable() {
  const body = byId("mapping-table-body");
  body.innerHTML = state.mapping
    .map(
      (item, index) => `
      <tr data-index="${index}" class="${item.include ? "" : "excluded"}">
        <td>
          <input
            type="checkbox"
            data-field="include"
            ${item.include ? "checked" : ""}
            aria-label="Include ${escapeHtml(item.well)}"
          />
        </td>
        <td><span class="well-id">${escapeHtml(item.well)}</span></td>
        <td>
          <input
            type="text"
            data-field="target"
            value="${escapeAttribute(item.target)}"
            aria-label="Target for ${escapeHtml(item.well)}"
          />
        </td>
        <td>
          <input
            type="text"
            data-field="crrna"
            value="${escapeAttribute(item.crrna)}"
            aria-label="crRNA for ${escapeHtml(item.well)}"
          />
        </td>
        <td>
          <input
            type="number"
            data-field="replicate"
            min="1"
            value="${Number(item.replicate) || 1}"
            aria-label="Replicate for ${escapeHtml(item.well)}"
          />
        </td>
      </tr>`,
    )
    .join("");
  filterMappingRows();
  updateAnalysisHeader();
}

function updateMappingCell(event) {
  const input = event.target.closest("[data-field]");
  const row = event.target.closest("tr[data-index]");
  if (!input || !row) {
    return;
  }
  const index = Number(row.dataset.index);
  const field = input.dataset.field;
  if (!state.mapping[index]) {
    return;
  }
  if (field === "include") {
    state.mapping[index][field] = input.checked;
    row.classList.toggle("excluded", !input.checked);
  } else if (field === "replicate") {
    state.mapping[index][field] = Math.max(1, Number(input.value) || 1);
  } else {
    state.mapping[index][field] =
      input.value.trim() ||
      (field === "crrna" ? "Plate wells" : state.mapping[index].well);
  }
  updateAnalysisHeader();
  scheduleRender();
}

function filterMappingRows() {
  const query = byId("mapping-filter").value.trim().toLowerCase();
  let visible = 0;
  document
    .querySelectorAll("#mapping-table-body tr[data-index]")
    .forEach((row) => {
      const item = state.mapping[Number(row.dataset.index)];
      const searchable = `${item.well} ${item.target} ${item.crrna}`.toLowerCase();
      const matches = !query || searchable.includes(query);
      row.classList.toggle("hidden-row", !matches);
      if (matches) {
        visible += 1;
      }
    });
  byId("visible-wells").textContent = String(visible);
}

function setVisibleIncluded(include) {
  document
    .querySelectorAll("#mapping-table-body tr[data-index]:not(.hidden-row)")
    .forEach((row) => {
      const index = Number(row.dataset.index);
      state.mapping[index].include = include;
      row.classList.toggle("excluded", !include);
      row.querySelector('[data-field="include"]').checked = include;
    });
  updateAnalysisHeader();
  scheduleRender();
}

function resetWellMapping() {
  state.mapping = state.mapping.map((item, index) => ({
    ...item,
    target: item.well,
    crrna: "Plate wells",
    replicate: 1,
    include: true,
    map_order: index + 1,
  }));
  renderMappingTable();
  scheduleRender();
  showToast("Plate map reset to well addresses");
}

function openPasteDialog() {
  byId("paste-map-error").classList.add("hidden");
  byId("paste-map-text").value = "";
  byId("paste-map-dialog").showModal();
}

function applyPastedMapping() {
  const error = byId("paste-map-error");
  error.classList.add("hidden");
  try {
    state.mapping = callPythonJson(
      "merge_mapping",
      JSON.stringify(state.mapping),
      byId("paste-map-text").value,
    );
    renderMappingTable();
    byId("paste-map-dialog").close();
    scheduleRender();
    showToast("Plate map updated");
  } catch (caught) {
    error.textContent = readError(caught);
    error.classList.remove("hidden");
  }
}

function updateAnalysisHeader() {
  if (!state.session) {
    return;
  }
  const active = state.mapping.filter((item) => item.include);
  const series = new Set(active.map((item) => `${item.crrna}\u0000${item.target}`));
  const panels = new Set(active.map((item) => item.crrna));
  byId("source-name").textContent = state.session.source_name;
  byId("mapping-mode").textContent =
    state.session.mapping_mode === "well addresses"
      ? "Grouped by well address"
      : state.session.mapping_name;
  byId("metric-wells").textContent = String(active.length);
  byId("metric-series").textContent = String(series.size);
  byId("metric-panels").textContent = String(panels.size);
  byId("metric-times").textContent = String(state.session.timepoints.length);
  byId("mapping-count").textContent = String(active.length);
  byId("included-wells").textContent = String(active.length);
}

function callPythonJson(functionName, ...args) {
  const names = args.map((_, index) => `_web_arg_${index}`);
  names.forEach((name, index) => state.pyodide.globals.set(name, args[index]));
  try {
    const expression = `${functionName}(${names.join(",")})`;
    return JSON.parse(state.pyodide.runPython(expression));
  } finally {
    names.forEach((name) => state.pyodide.globals.delete(name));
  }
}

function updatePalettePreviews() {
  const linePalette = LINE_PALETTES[byId("line-palette").value];
  byId("line-palette-preview").style.background =
    `linear-gradient(90deg, ${linePalette.join(", ")})`;
  let heatmapPalette = HEATMAP_PALETTES[byId("heatmap-palette").value];
  if (byId("reverse-palette").checked) {
    heatmapPalette = [...heatmapPalette].reverse();
  }
  byId("heatmap-palette-preview").style.background =
    `linear-gradient(90deg, ${heatmapPalette.join(", ")})`;
}

function exportFigure(format) {
  if (state.view === "mapping" || !state.session) {
    return;
  }
  const filename = figureSlug(
    figureTitle(),
    state.view === "heatmap"
      ? `${formatTimeToken(numberValue("heatmap-time", 30))}min_heatmap`
      : "kinetic_curves",
  );
  const plot = byId("plot");
  const width = Math.max(1000, plot.clientWidth);
  const height = Math.max(600, plot.clientHeight);
  Plotly.downloadImage(plot, {
    format,
    filename,
    width,
    height,
    scale: format === "png" ? 2 : 1,
  });
}

function exportCurrentCsv() {
  if (!state.session) {
    return;
  }
  if (state.view === "mapping") {
    downloadMapping();
    return;
  }
  const result = state.view === "heatmap" ? state.heatmap : state.kinetics;
  if (!result) {
    return;
  }
  const suffix =
    state.view === "heatmap"
      ? `${formatTimeToken(result.selected_time)}min_heatmap`
      : "kinetic_summary";
  downloadText(
    result.csv,
    `${figureSlug(figureTitle(), suffix)}.csv`,
    "text/csv;charset=utf-8",
  );
}

function downloadMapping() {
  if (!state.mapping.length) {
    return;
  }
  const csv = state.pythonReady
    ? callPythonString("export_mapping", JSON.stringify(state.mapping))
    : "";
  downloadText(
    csv,
    `${figureSlug(figureTitle(), "plate_map")}.csv`,
    "text/csv;charset=utf-8",
  );
}

function callPythonString(functionName, ...args) {
  const names = args.map((_, index) => `_web_string_arg_${index}`);
  names.forEach((name, index) => state.pyodide.globals.set(name, args[index]));
  try {
    return state.pyodide.runPython(`${functionName}(${names.join(",")})`);
  } finally {
    names.forEach((name) => state.pyodide.globals.delete(name));
  }
}

function resetPlotAxes() {
  const plot = byId("plot");
  if (!plot.layout) {
    return;
  }
  const updates = {};
  Object.keys(plot.layout).forEach((key) => {
    if (/^[xy]axis\d*$/.test(key)) {
      updates[`${key}.autorange`] = true;
    }
  });
  Plotly.relayout(plot, updates);
}

function plotConfig(stem) {
  return {
    responsive: true,
    displaylogo: false,
    scrollZoom: true,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
    toImageButtonOptions: {
      format: "svg",
      filename: figureSlug(figureTitle(), stem),
    },
  };
}

function inferYMaximum(result) {
  let maximum = 1;
  for (const panel of result.panels) {
    for (const series of panel.series) {
      for (const point of series.points) {
        maximum = Math.max(maximum, point.mean + point.sd);
      }
    }
  }
  return maximum * 1.04;
}

function setBusy(busy) {
  byId("analyze-button").disabled = busy || !state.pythonReady;
  byId("demo-button").disabled = busy || !state.pythonReady;
}

function setControlsEnabled(enabled) {
  byId("analyze-button").disabled = !enabled;
  byId("demo-button").disabled = !enabled;
}

function setStatus(message, kind = "") {
  byId("status-copy").textContent = message;
  byId("status-line").classList.toggle("ready", kind === "ready");
  byId("status-line").classList.toggle("error", kind === "error");
}

function setBootDetail(message) {
  byId("boot-detail").textContent = message;
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  byId("toast-copy").textContent = message;
  byId("toast").classList.remove("hidden");
  state.toastTimer = window.setTimeout(
    () => byId("toast").classList.add("hidden"),
    2400,
  );
}

function readError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/^PythonError:\s*/i, "")
    .split("\n")
    .filter((line) => line.trim() && !line.trim().startsWith("File "))
    .at(-1)
    ?.replace(/^[A-Za-z]+Error:\s*/, "") || "The analysis could not be completed.";
}

function safeUnlink(path) {
  try {
    state.pyodide.FS.unlink(path);
  } catch {
    // Temporary file was not created.
  }
}

function figureTitle() {
  return byId("figure-title").value.trim() || "Cytation5 fluorescence";
}

function numberValue(id, fallback) {
  const value = Number(byId(id).value);
  return Number.isFinite(value) ? value : fallback;
}

function optionalNumber(id) {
  const text = byId(id).value.trim();
  if (!text) {
    return null;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function formatMinutes(value) {
  return `${Number.isInteger(value) ? value : Number(value).toFixed(1)} min`;
}

function formatCompact(value) {
  const absolute = Math.abs(value);
  if (absolute >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (absolute >= 1000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return Math.round(value).toString();
}

function formatTimeToken(value) {
  return String(value).replace(".", "p");
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function cleanFilename(filename) {
  return filename
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function figureSlug(title, suffix) {
  const stem =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "cytation5";
  return `${stem}_${suffix}`;
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function downloadText(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
