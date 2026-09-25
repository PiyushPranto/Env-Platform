"""
Flood risk PROJECTION runner — separate model slot from flood.py.

This is deliberately its own model in the automation (own staging dir, own
OUTPUT_FILES, own success/skipped/failed status in refresh_status.json),
NOT a change to flood.py or flood_export.py. Reasons:

1. flood_export.py's 90-day nowcast (avg_predicted_risk) has 4 real
   verified successful production runs behind it. This new forecast-based
   feature calls a different Open-Meteo endpoint (the forecast API, not
   the archive API) that has never been exercised in production here — if
   it ever fails or gets rate-limited, that must never be able to take
   down the already-working nowcast pipeline. Per-model isolation in
   run_one_model() (scripts/update_model_outputs.py) already guarantees
   this automatically, as long as this stays a separate model entry.
2. It answers a genuinely different question (day-by-day risk for the
   next 7 real forecast days) than flood_national_priority.json does (one
   90-day historical average), so it is honestly a different model output,
   not a variant of the same one.

Until scripts/models/flood_projection_export.py exists (or if it starts
failing), this runner raises ModelUnavailable / lets ModelRunFailed
propagate rather than fabricating projection numbers — see
run_export_module() in scripts/runners/__init__.py.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "flood_projection"

OUTPUT_FILES = ["flood_risk_projection.json"]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
