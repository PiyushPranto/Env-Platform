"""
Output validation for the model-update automation.

Every file the automation produces must pass validate_file() before it is
allowed to replace the live copy in api/data/. This is the safety net that
satisfies the hard requirement: a failed or malformed model run must NEVER
overwrite a previously-good dashboard output.

Design:
- validate_file(path) returns (ok: bool, reason: str).
- Per-filename checks enforce the exact required fields each backend
  endpoint (api/index.py) actually reads, so a "valid JSON but wrong shape"
  file is still rejected.
- Any filename not in REQUIRED_FIELDS falls back to a generic structural
  check (valid JSON or GeoJSON, non-empty) rather than being silently
  accepted or silently rejected — new files added later are covered by
  default instead of crashing the pipeline.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class ValidationError(Exception):
    """Raised (and caught) internally; callers should use validate_file()."""


# ---------------------------------------------------------------------------
# Per-file required-field specs, taken directly from api/index.py's current
# docstrings and _load() usage — NOT invented. If api/index.py changes what
# it expects, update the matching entry here too.
# ---------------------------------------------------------------------------

def _require(obj: dict, *keys: str, where: str = "") -> None:
    missing = [k for k in keys if k not in obj]
    if missing:
        raise ValidationError(f"{where}missing field(s): {', '.join(missing)}")


def _check_heat_risk(data: Any) -> None:
    # Real schema (national, 64 districts) — updated when the real Heat
    # model output replaced the Chattogram-only placeholder. built_fraction
    # replaces ndbi (the notebook abandoned NDBI for JRC GHSL built-up
    # fraction); there is no population field — the model doesn't produce
    # one, so the dashboard's old "population in high-risk areas" KPI was
    # dropped rather than validated against a field that will never exist.
    if not isinstance(data, dict) or "wards" not in data:
        raise ValidationError("heat_risk.json must be an object with a 'wards' list")
    wards = data["wards"]
    if not isinstance(wards, list) or len(wards) == 0:
        raise ValidationError("heat_risk.json 'wards' must be a non-empty list")
    for i, row in enumerate(wards):
        if not isinstance(row, dict):
            raise ValidationError(f"heat_risk.json.wards[{i}] is not an object")
        _require(row, "name", "lst_c", "ndvi", "built_fraction", "heat_risk", "risk_category",
                  where=f"heat_risk.json.wards[{i}]: ")


def _check_heat_trend(data: Any) -> None:
    if not isinstance(data, dict) or "trend" not in data:
        raise ValidationError("heat_trend.json must be an object with a 'trend' list")
    if not isinstance(data["trend"], list) or len(data["trend"]) == 0:
        raise ValidationError("heat_trend.json 'trend' must be a non-empty list")


def _check_heat_grid(data: Any) -> None:
    if not isinstance(data, dict) or "grid" not in data:
        raise ValidationError("heat_grid.json must be an object with a 'grid' 2D array")
    grid = data["grid"]
    if not isinstance(grid, list) or len(grid) == 0 or not isinstance(grid[0], list):
        raise ValidationError("heat_grid.json 'grid' must be a non-empty 2D array")


def _check_flood_grid(data: Any) -> None:
    if not isinstance(data, dict) or "grid" not in data:
        raise ValidationError("flood_grid.json must be an object with a 'grid' 2D array")
    grid = data["grid"]
    if not isinstance(grid, list) or len(grid) == 0 or not isinstance(grid[0], list):
        raise ValidationError("flood_grid.json 'grid' must be a non-empty 2D array")


def _check_flood_trend(data: Any) -> None:
    if not isinstance(data, dict) or "trend" not in data:
        raise ValidationError("flood_trend.json must be an object with a 'trend' list")
    for i, row in enumerate(data["trend"]):
        _require(row, "date", "rainfall", "pctAlerted", where=f"flood_trend.json.trend[{i}]: ")


def _check_flood_top_risk_areas(data: Any) -> None:
    if not isinstance(data, dict) or "areas" not in data:
        raise ValidationError("flood_top_risk_areas.json must be an object with an 'areas' list")
    for i, row in enumerate(data["areas"]):
        _require(row, "area", "elevation", "riverDist", "risk", "category",
                  where=f"flood_top_risk_areas.json.areas[{i}]: ")


def _check_flood_summary(data: Any) -> None:
    if not isinstance(data, dict) or len(data) == 0:
        raise ValidationError("flood_summary.json must be a non-empty object")


def _check_geojson(data: Any, filename: str) -> None:
    if not isinstance(data, dict):
        raise ValidationError(f"{filename} must be a JSON object")
    if data.get("type") != "FeatureCollection":
        raise ValidationError(f"{filename} must have type == 'FeatureCollection'")
    feats = data.get("features")
    if not isinstance(feats, list):
        raise ValidationError(f"{filename} must have a 'features' list")
    # An empty features list is structurally valid GeoJSON but almost
    # certainly means the export step silently produced nothing — treat
    # that as invalid so a broken run can't quietly ship an empty layer.
    if len(feats) == 0:
        raise ValidationError(f"{filename} has zero features — refusing to treat an empty layer as valid")




# ---------------------------------------------------------------------------
# Nationwide flood (64-district Random Forest model, scripts/models/flood_export.py)
# and real Deforestation (7 files converted from the user's real, already-run
# notebook output) — added when both were wired into this automation.
# Field names taken directly from the actual api/data/*.json files shipped
# with that delivery, NOT invented.
# ---------------------------------------------------------------------------

def _check_flood_national_severity(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("flood_national_severity.json must be a non-empty list of district records")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"flood_national_severity.json[{i}] is not an object")
        _require(row, "district_id", "district_name", "avg_predicted_risk", "severity_tier", "historical_magnitude",
                  where=f"flood_national_severity.json[{i}]: ")


def _check_flood_national_priority(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("flood_national_priority.json must be a non-empty list of district records")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"flood_national_priority.json[{i}] is not an object")
        _require(row, "district_id", "district_name", "priority_rank", "priority_score", "avg_predicted_risk", "area_km2",
                  where=f"flood_national_priority.json[{i}]: ")


def _check_flood_national_summary(data: Any) -> None:
    if not isinstance(data, dict):
        raise ValidationError("flood_national_summary.json must be an object")
    _require(data, "districts", "rows_total", "date_range", "train_years", "test_years",
              "observed_years", "proxy_years", "top5_priority_districts", where="flood_national_summary.json: ")


def _check_deforestation_districts(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("deforestation_districts.json must be a non-empty list of district records")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"deforestation_districts.json[{i}] is not an object")
        _require(row, "district", "forest_pct_now", "forest_loss_pct", "trend", "alert", "priority", "protected_loss_km2",
                  where=f"deforestation_districts.json[{i}]: ")


def _check_deforestation_worklist(data: Any) -> None:
    if not isinstance(data, dict):
        raise ValidationError("deforestation_worklist.json must be an object")
    _require(data, "total_patches", "showing", "patches", where="deforestation_worklist.json: ")
    if not isinstance(data["patches"], list) or len(data["patches"]) == 0:
        raise ValidationError("deforestation_worklist.json 'patches' must be a non-empty list")


def _check_deforestation_citizen_cards(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("deforestation_citizen_cards.json must be a non-empty list of district cards")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"deforestation_citizen_cards.json[{i}] is not an object")
        _require(row, "district", "forest_pct", "years", "sparkline", "message", "call_to_action",
                  where=f"deforestation_citizen_cards.json[{i}]: ")


def _check_deforestation_timeseries(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("deforestation_timeseries.json must be a non-empty list of district-year rows")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"deforestation_timeseries.json[{i}] is not an object")
        _require(row, "district", "year", "forest_km2", where=f"deforestation_timeseries.json[{i}]: ")


def _check_deforestation_restoration_priority(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("deforestation_restoration_priority.json must be a non-empty list of district records")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"deforestation_restoration_priority.json[{i}] is not an object")
        _require(row, "district", "restoration_need", "restoration_tier", where=f"deforestation_restoration_priority.json[{i}]: ")


def _check_deforestation_loss_by_year(data: Any) -> None:
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("deforestation_loss_by_year.json must be a non-empty list of {year, km2_lost} rows")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"deforestation_loss_by_year.json[{i}] is not an object")
        _require(row, "year", "km2_lost", where=f"deforestation_loss_by_year.json[{i}]: ")


def _check_deforestation_model_metrics(data: Any) -> None:
    if not isinstance(data, dict):
        raise ValidationError("deforestation_model_metrics.json must be an object")
    _require(data, "accuracy", "precision", "recall", "f1", "roc_auc", where="deforestation_model_metrics.json: ")


def _check_heat_alerts(data: Any) -> None:
    # An empty 'alerts' list is a normal, honest result (no heatwave
    # forecast right now) — unlike the GeoJSON layers above, zero rows
    # here is NOT treated as suspicious, so this only checks shape.
    if not isinstance(data, dict):
        raise ValidationError("heat_alerts.json must be an object")
    _require(data, "generated_at", "sites_monitored", "alerts", where="heat_alerts.json: ")
    if not isinstance(data["alerts"], list):
        raise ValidationError("heat_alerts.json 'alerts' must be a list (can be empty)")
    for i, row in enumerate(data["alerts"]):
        if not isinstance(row, dict):
            raise ValidationError(f"heat_alerts.json.alerts[{i}] is not an object")
        _require(row, "name", "heatwave_days", "peak_tmax_c", "worst_category", "heat_risk",
                  where=f"heat_alerts.json.alerts[{i}]: ")


REQUIRED_FIELDS = {
    "heat_risk.json": _check_heat_risk,
    "heat_trend.json": _check_heat_trend,
    "heat_grid.json": _check_heat_grid,
    "heat_hotspots.geojson": lambda d: _check_geojson(d, "heat_hotspots.geojson"),
    "heat_alerts.json": _check_heat_alerts,
    "flood_grid.json": _check_flood_grid,
    "flood_trend.json": _check_flood_trend,
    "flood_top_risk_areas.json": _check_flood_top_risk_areas,
    "flood_summary.json": _check_flood_summary,
    "flood_national_severity.json": _check_flood_national_severity,
    "flood_national_priority.json": _check_flood_national_priority,
    "flood_national_summary.json": _check_flood_national_summary,
    "deforestation_timeseries.json": _check_deforestation_timeseries,
    "deforestation_restoration_priority.json": _check_deforestation_restoration_priority,
    "deforestation_loss_by_year.json": _check_deforestation_loss_by_year,
    "deforestation_model_metrics.json": _check_deforestation_model_metrics,
}


def validate_file(path: Path) -> tuple[bool, str]:
    """Validate one staged output file before it's allowed to go live.

    Returns (True, "ok") or (False, "<human-readable reason>"). Never
    raises — callers can rely on the tuple.
    """
    if not path.exists():
        return False, f"{path.name} does not exist"

    if path.stat().st_size == 0:
        return False, f"{path.name} is empty (0 bytes)"

    try:
        text = path.read_text(encoding="utf-8")
    except Exception as e:  # noqa: BLE001 - report, don't crash the run
        return False, f"{path.name} could not be read as UTF-8 text: {e}"

    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        return False, f"{path.name} is not valid JSON: {e}"

    checker = REQUIRED_FIELDS.get(path.name)
    if checker is None:
        # Unknown file: generic structural check only. Don't fabricate a
        # pass/fail rule we don't actually have — just make sure it's
        # non-trivial JSON (object or non-empty array).
        if data is None or data == {} or data == []:
            return False, f"{path.name} has no recognized schema and is empty/null"
        return True, "ok (generic check — no specific schema registered for this filename)"

    try:
        checker(data)
    except ValidationError as e:
        return False, str(e)

    return True, "ok"
