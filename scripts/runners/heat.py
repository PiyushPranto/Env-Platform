"""
Heat model runner.

STATUS (updated): the notebook (heat_model_project.ipynb) HAS now actually
been executed — real output was delivered by the user from their own
Google Drive run (a ready api_data/ folder with heat_risk.json,
heat_grid.json, heat_trend.json, heat_hotspots.geojson), covering all 64
districts with a real Random Forest heat-risk composite, DBSCAN hotspot
clusters, and per-district SUHI intensity. Those four files are bundled as
frozen source data at scripts/models/data/heat/ and are copied through
unchanged on every run — see scripts/models/heat_export.py's module
docstring for exactly why (same reasoning as the Deforestation runner's:
an annual/seasonal satellite composite has nothing new to reprocess every
3 days).

What genuinely refreshes every 3 days is heat_alerts.json: a live 7-day
heatwave forecast check (Open-Meteo + official BMD thresholds) against the
model's own real hotspot sites, ported directly from the notebook's own
"Heatwave Risk" section. That's the live half of this module, the same
way flood_export.py's live half is re-scoring against fresh rainfall while
its classifier stays frozen.

heat_live.json is a second, independent live piece: the flood module's
back-solved-susceptibility pattern applied to heat (see
scripts/models/heat_live.py). It recovers the stable land-cover half of
heat_risk.json's score and recombines it with a live forecast air
temperature, per district (all 64, not just the 10 hotspot sites
heat_alerts.json watches). It is an explicitly-labeled PARALLEL index
(`comparable_to_seasonal: false`), not the seasonal index updated — see
heat_live.py's own module docstring for the full disclosure.

OUTPUT_FILES below includes all six files (the four frozen ones plus
heat_alerts.json and heat_live.json) so the orchestrator validates and
promotes them together as one atomic unit — consistent with every other
model here.
"""

from __future__ import annotations

from pathlib import Path

from . import run_export_module

MODEL_NAME = "heat"

# Files this model is responsible for producing into the staging directory.
# Keep this in sync with api/index.py's heat endpoints.
OUTPUT_FILES = [
    "heat_risk.json", "heat_trend.json", "heat_grid.json", "heat_hotspots.geojson",
    "heat_alerts.json", "heat_live.json",
]


def run(staging_dir: Path) -> None:
    """Entry point called by the orchestrator. May raise ModelUnavailable
    or ModelRunFailed — both are handled by the orchestrator, not here."""
    run_export_module(MODEL_NAME, staging_dir)
