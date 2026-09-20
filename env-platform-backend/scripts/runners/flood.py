"""
Flood model runner.

IMPORTANT CONTEXT — there are actually TWO separate flood efforts in this
project, and the automation needs a decision about which one this runner
should target:

1. The Dhaka-only rule-based composite score (elevation + river proximity +
   rainfall anomaly) that api/index.py currently serves via /flood/risk,
   /flood/trend, /flood/top-risk-areas and /flood/summary. This is not
   really a "trained model" that gets re-run — it's a one-time analysis
   over a fixed historical window (Jun-Aug 2025). There's nothing for a
   3-day cron to regenerate here unless the underlying rainfall data
   itself is re-pulled and the composite score recomputed on a rolling
   window.

2. The newer nationwide (64-district) trained Random Forest classifier
   (build_bangladesh_flood_model.py / bangladesh_flood_model_colab.ipynb)
   with a real predict_today() stub, evaluated on real 2018 ground truth
   (precision 0.12, recall 0.83, F1 0.21, ROC-AUC 0.91). This is the far
   better candidate for genuine periodic re-prediction, but it has never
   been wired to the dashboard, uses a different district-level shape than
   the current flood_* files, and its GEE exports currently land in a
   personal Google Drive (not reachable headlessly).

DECISION MADE HERE (documented, not silently assumed): this runner targets
whatever scripts/models/flood_export.py is wired up to produce — it does
not hardcode which of the two efforts that is. The plug-in stays generic
on purpose so you can point it at either:
  - Recompute the Dhaka composite score on a rolling window and write the
    existing flood_grid.json / flood_trend.json / flood_top_risk_areas.json
    / flood_summary.json shapes, OR
  - Adapt predict_today() from the nationwide model, convert its GEE
    exports to a headless-reachable destination (see AUTOMATION.md), and
    reshape its output to match the same filenames/fields api/index.py
    already reads (so no backend or frontend change is needed either way).

Until scripts/models/flood_export.py exists, this runner raises
ModelUnavailable rather than fabricating flood numbers — see
run_export_module() in scripts/runners/__init__.py.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "flood"

OUTPUT_FILES = ["flood_grid.json", "flood_trend.json", "flood_top_risk_areas.json", "flood_summary.json"]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
