"""
Deforestation model runner.

STATUS: real methodology and code exist (deforestation_model.ipynb,
deforestation-model-summary.md, deforestation-api-contract.md — all dated
20 Sept), but as stored in the project the notebook has never actually
been executed: every cell has execution_count: null and empty outputs.
There is no confirmed real output anywhere yet, so this runner currently
always raises ModelUnavailable until that changes.

TWO THINGS TO KNOW BEFORE WIRING THIS UP FOR REAL AUTOMATION:

1. GEE export path. The notebook's feature stacks (ndvi_features_{year}.tif
   etc.) are produced by manual, interactive GEE Code Editor exports to a
   personal Google Drive. That cannot run unattended. To automate this,
   the export step needs to be rewritten using the Python `earthengine-api`
   with a service account (credentials stored as a GitHub Actions secret),
   exporting to Google Cloud Storage (or another destination this runner's
   environment can read headlessly) instead of Drive.

2. Update cadence mismatch (flagged honestly, not silently overridden).
   The model is built on ANNUAL seasonal MODIS NDVI composites (2015-2025).
   Re-running it every 3 days will, in the overwhelming majority of runs,
   reprocess byte-identical satellite composites and produce an unchanged
   result — the underlying yearly composite for the current year simply
   won't have new source data most weeks. This runner still follows the
   3-day schedule you asked for (so nothing here silently changes your
   choice), but be aware most 3-day runs for this specific model will be
   inexpensive no-ops once real code is wired in. If you'd rather this
   model run on a slower cadence (e.g. monthly) while Heat/Flood keep the
   3-day cadence, that's a small, isolated change to the GitHub Actions
   workflow (a second, separate schedule) — not something this runner
   needs to know about.

Once real, headless-capable export code exists, wire it into
scripts/models/deforestation_export.py (see _template_export.py) and this
runner will pick it up with no changes.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "deforestation"

OUTPUT_FILES = ["deforestation_detect.geojson", "deforestation_districts.geojson", "deforestation_ndvi_summary.json"]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
