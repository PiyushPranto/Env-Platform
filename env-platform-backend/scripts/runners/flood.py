"""
Flood model runner.

DECISION MADE (was previously undecided — see git history for the earlier
version of this docstring): this runner targets the nationwide
(64-district) trained Random Forest classifier
(bangladesh_flood_model_colab_final.ipynb / scripts/models/flood_export.py),
not the Dhaka-only rule-based composite score.

Why: the Dhaka composite (served via /flood/risk, /flood/trend,
/flood/top-risk-areas, /flood/summary, filenames flood_grid.json /
flood_trend.json / flood_top_risk_areas.json / flood_summary.json) is a
one-time analysis over a fixed historical window (Jun-Aug 2025) — there is
nothing for a 3-day cron to meaningfully regenerate there without a
separate rework of that analysis, and nobody has asked for that yet. Those
four files are left completely alone by this automation; they keep serving
their existing static content.

The nationwide model, by contrast, has a real frozen classifier that can
be legitimately re-scored on fresh real rainfall every few days (see
scripts/models/flood_export.py's module docstring for exactly what
refreshes and what stays frozen). That's what this runner's OUTPUT_FILES
now points at.

Until scripts/models/flood_export.py exists (or if it starts failing),
this runner raises ModelUnavailable / lets ModelRunFailed propagate rather
than fabricating flood numbers — see run_export_module() in
scripts/runners/__init__.py.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "flood"

OUTPUT_FILES = ["flood_national_severity.json", "flood_national_priority.json", "flood_national_summary.json"]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
