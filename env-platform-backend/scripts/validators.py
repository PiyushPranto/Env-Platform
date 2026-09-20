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
    if not isinstance(data, list) or len(data) == 0:
        raise ValidationError("heat_risk.json must be a non-empty list of ward records")
    for i, row in enumerate(data):
        if not isinstance(row, dict):
            raise ValidationError(f"heat_risk.json[{i}] is not an object")
        _require(row, "name", "lst_c", "ndvi", "ndbi", "heat_risk", "risk_category",
                  "population", where=f"heat_risk.json[{i}]: ")


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


def _check_deforestation_ndvi_summary(data: Any) -> None:
    if not isinstance(data, dict) or len(data) == 0:
        raise ValidationError("deforestation_ndvi_summary.json must be a non-empty object")


REQUIRED_FIELDS = {
    "heat_risk.json": _check_heat_risk,
    "heat_trend.json": _check_heat_trend,
    "heat_grid.json": _check_heat_grid,
    "heat_hotspots.geojson": lambda d: _check_geojson(d, "heat_hotspots.geojson"),
    "flood_grid.json": _check_flood_grid,
    "flood_trend.json": _check_flood_trend,
    "flood_top_risk_areas.json": _check_flood_top_risk_areas,
    "flood_summary.json": _check_flood_summary,
    "deforestation_detect.geojson": lambda d: _check_geojson(d, "deforestation_detect.geojson"),
    "deforestation_districts.geojson": lambda d: _check_geojson(d, "deforestation_districts.geojson"),
    "deforestation_ndvi_summary.json": _check_deforestation_ndvi_summary,
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
