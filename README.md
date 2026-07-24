# Cytation5 Analyzer

A browser-based prototype for turning paired Cytation5 plate-reader exports
and 96- or 384-well maps into target-by-crRNA fluorescence heatmaps.

The app processes files locally in the browser. Experimental data is not sent
to a server or stored by the application.

## Prototype Features

- Raw Cytation5 `.xlsx`, `.xls`, `.csv`, and `.tsv` import
- Grid-style or flat plate-map import
- Duplicate workbook-sheet detection
- Mean RFU heatmaps at any sampled elapsed time
- Target and crRNA ordering inherited from the plate map
- Viridis, magma, and cividis color palettes
- Optional cell annotations and manual color-scale maximum
- PNG, SVG, and mean-RFU matrix CSV export
- Synthetic multiplexing demo available on first load

## Input Pair

The raw data file should be a direct Cytation5 export containing a `Time`
column and well columns such as `A1`, `A2`, or `P24`.

The mapping file may be either:

1. A 96/384-well grid export containing a `96 maps` or `384 maps` marker and
   cells such as:

   ```text
   target: IS6110
   crRNA: crRNA2 for IS6110
   ```

2. A flat table with `well`, `target` (or `condition`), and `crRNA` (or
   `assay`) columns.

## Development

Requires Node.js 22 or newer and pnpm.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Checks

```bash
pnpm exec tsc --noEmit
pnpm test
```

The parser tests include a synthetic Cytation export and plate map. The
prototype was also validated locally against a 48-well, 28-time-point
Cytation5 experiment without publishing that experimental dataset.

## Prototype Scope

This first version focuses on fluorescence heatmaps. Kinetic line plots,
baseline subtraction, normalization, statistical testing, and reusable plate
map editing are natural next iterations.

## License

MIT
