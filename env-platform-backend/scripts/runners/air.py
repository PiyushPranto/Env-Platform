"""
Air quality runner.

Live data only: scripts/models/air_export.py fetches current and 5-day
forecast air quality for all 64 districts from the Open-Meteo Air Quality
API (modelled CAMS data, not ground sensors) and writes air_live.json.
Nothing here is frozen; the whole file refreshes on every automation run.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "air"

# Keep in sync with api/index.py's /air/live endpoint.
OUTPUT_FILES = ["air_live.json"]


def run(staging_dir: Path) -> None:
    run_export_module(MODEL_NAME, staging_dir)
