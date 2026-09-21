"""
Deforestation model runner.

STATUS (updated): the notebook (deforestation_model_Final7_2.ipynb) HAS
now actually been executed — real output was delivered by the user from
their own Google Drive run (deforestation_outputs.zip) and converted into
the 7 real files api/index.py now serves: deforestation_districts.json,
deforestation_worklist.json, deforestation_citizen_cards.json,
deforestation_timeseries.json, deforestation_restoration_priority.json,
deforestation_loss_by_year.json, deforestation_model_metrics.json. That
was a ONE-TIME conversion of a real, already-run notebook's output — not
headless automation. This runner still always raises ModelUnavailable
(no scripts/models/deforestation_export.py exists yet) until the GEE
export path below is rebuilt to run unattended.

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

3. Two fields are permanently excluded from ANY future automated output,
   not just the one-time conversion already shipped: national year-by-year
   trend direction and the loss forecast. The notebook's own Step 14
   "Integration Readiness" check quarantined both (three normalisation
   methods disagree even on the sign of the decade change; the forecast's
   backtest MAE exceeds its own 10pp usability cap). A future
   deforestation_export.py must keep honoring that quarantine — do not
   compute and ship those two fields just because automation makes it
   easy to.

Once real, headless-capable export code exists, wire it into
scripts/models/deforestation_export.py (see _template_export.py) and this
runner will pick it up with no changes. OUTPUT_FILES below already
reflects the 7 real filenames api/index.py currently serves (kept in sync
with the one-time conversion delivered this round) — a future export
script must produce exactly these, with the same field names, so the
frontend needs zero changes.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "deforestation"

OUTPUT_FILES = [
    "deforestation_districts.json",
    "deforestation_worklist.json",
    "deforestation_citizen_cards.json",
    "deforestation_timeseries.json",
    "deforestation_restoration_priority.json",
    "deforestation_loss_by_year.json",
    "deforestation_model_metrics.json",
]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
