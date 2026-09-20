"""
Heat model runner.

STATUS (as of this writing — see AUTOMATION.md for the up-to-date picture):
no Heat model code exists anywhere in this project. api/data/heat_risk.json,
heat_trend.json and heat_grid.json are hand-authored placeholders, not the
output of a trained model. There is no notebook, no script, nothing to
adapt here yet.

This runner therefore does exactly one thing: look for
scripts/models/heat_export.py and raise ModelUnavailable with a specific
explanation if it's missing (which it currently always is). It does NOT
generate placeholder numbers — that would violate the explicit
requirement to never fake a working pipeline.

Once a real Heat model exists (e.g. the Random Forest UHI + composite risk
score described in api/index.py's docstrings), create
scripts/models/heat_export.py following scripts/models/_template_export.py,
and this runner will pick it up automatically with no changes needed here.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "heat"

# Files this model is responsible for producing into the staging directory.
# Keep this in sync with api/index.py's heat endpoints.
OUTPUT_FILES = ["heat_risk.json", "heat_trend.json", "heat_grid.json", "heat_hotspots.geojson"]


def run(staging_dir: Path) -> None:
    """Entry point called by the orchestrator. May raise ModelUnavailable
    or ModelRunFailed — both are handled by the orchestrator, not here."""
    run_export_module(MODEL_NAME, staging_dir)
