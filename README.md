# Cytation5 Analyzer

A Python-powered browser application for Cytation5 kinetic fluorescence
curves, target-by-crRNA heatmaps, and editable 96- or 384-well mappings.

[Open the GitHub Pages application](https://soonwoohong.github.io/cytation5-analyzer/)

Raw files are processed locally in the browser. The application does not
upload or store experimental data.

## Analysis Workflow

- Import a raw Cytation5 `.xlsx`, `.xlsm`, `.csv`, `.tsv`, or `.txt` export.
- Optionally import a grid-style or flat plate map.
- Plot every detected well by its plate address when no map is supplied.
- Edit well, target, crRNA, replicate, and inclusion fields in the plate-map
  table or paste a CSV/TSV table directly into the application.
- Plot replicate-mean kinetic curves in crRNA facets with optional SD or SEM.
- Apply per-well baseline subtraction and customize line width, panel count,
  legend placement, axes, fonts, and categorical palettes.
- Generate mean-RFU heatmaps at any sampled elapsed time with ten palettes,
  reversible scales, optional annotations, and manual color limits.
- Export figures as PNG or SVG and analysis tables as CSV.

## Python Architecture

The analysis engine is a standard Python package under
`src/cytation5_analyzer/`. It owns Cytation parsing, duplicate-sheet
detection, optional mapping, replicate aggregation, baseline subtraction,
kinetic summaries, and heatmap matrices.

The GitHub Pages interface loads that same package with Pyodide and renders
the returned analysis with Plotly.js. JavaScript is limited to browser file
handling, controls, the editable mapping table, and interactive rendering.

The XLSX reader uses Python's standard ZIP and XML libraries, so the package
has no runtime dependencies.

## Plate Maps

A plate map may be:

- A 96/384-well grid containing a `96 maps` or `384 maps` marker and cells
  with `target:` and `crRNA:` entries.
- A flat table with `well`, `target` (or `condition`), and `crRNA` (or
  `assay`) columns. `replicate` and `include` columns are optional.

When no plate map is supplied, each raw well is included with:

```text
target = well address
crRNA = Plate wells
replicate = 1
```

## Python Package

Install the package in editable mode:

```bash
python -m pip install -e .
```

Inspect a Cytation export:

```bash
cytation5-analyzer raw_data.xlsx --mapping plate_map.csv
```

## Local Web Development

Build and serve the same static artifact used by GitHub Pages:

```bash
python scripts/build_site.py
python -m http.server 8000 --directory _site
```

Open `http://localhost:8000/`.

The first visit loads the bundled Pyodide runtime and pinned Plotly runtime;
later visits use the browser cache.

## Tests

```bash
PYTHONPATH=src python -m unittest discover -s tests -p "test_*.py" -v
```

Tests cover optional and imported maps, replicate aggregation, baseline
subtraction, pasted map tables, XLSX parsing, and the GitHub Pages artifact.
The parser is also validated locally against the supplied Cytation5 datasets
without adding those experimental files to the repository.

## License

The application is MIT licensed. The bundled Pyodide runtime is distributed
under the Mozilla Public License 2.0; its license is included at
`web/vendor/pyodide/LICENSE`.
