"""
Real export script for the Heat model — national Heat Risk Score, DBSCAN
hotspot clusters, per-district SUHI intensity, and a live heatwave-alert
check. Delivered by the user from their own Colab run (heat_model_project.ipynb,
executed against real GEE exports: MODIS LST/NDVI, JRC GHSL built-up
fraction, SRTM elevation, JRC surface water — Mar-May 2026 season, all 64
districts) as heat_model_project.ipynb + a ready api_data/ folder.

WHAT ACTUALLY REFRESHES EVERY 3 DAYS, AND WHAT DOESN'T (read this before
assuming a 3-day cron retrains the model — it doesn't, and for the same
reason flood_export.py's classifier doesn't retrain: the underlying
satellite composite doesn't change that often):

- heat_risk.json, heat_grid.json, heat_trend.json, heat_hotspots.geojson
  are FROZEN. They come from one real Mar-May 2026 MODIS/GHSL composite —
  the same kind of one-time seasonal analysis as the Deforestation model's
  annual NDVI composites. Re-deriving them every 3 days would, in the
  overwhelming majority of runs, reprocess byte-identical satellite input
  and produce an unchanged result — see scripts/runners/deforestation.py's
  docstring, point 2, for the identical argument made there. This script
  copies them through unchanged every run, the same way flood_export.py
  copies its frozen classifier and static per-district CSVs through
  unchanged every run.

- heat_alerts.json is the genuinely live part, and it exists precisely
  because the notebook's own "Heatwave Risk" section (the cell this
  function ports) already separates a static piece (which locations are
  hotspots — that needs the satellite run) from a live piece (is a
  heatwave forecast for those locations in the next 7 days — that only
  needs today's weather forecast). This script re-runs just that live
  piece every time the automation fires:

    1. Take the largest hotspot clusters from the FROZEN heat_hotspots.geojson
       (by cell count, same "top 10" cutoff the notebook used) as the
       monitored sites — this is a real, if coarse, stand-in for named
       locations, since the model's output is grid cells, not place names.
    2. Fetch a real 7-day daily max-temperature forecast for each site's
       centroid from Open-Meteo's forecast API (free, keyless — the same
       provider flood_export.py uses for rainfall).
    3. Classify each forecast day against Bangladesh Meteorological
       Department's published heatwave bands (Mild 36-38C, Moderate
       38-40C, Severe 40-42C, Extreme >=42C) — taken directly from the
       notebook's own bmd_category() function, not re-derived here.
    4. Keep only forecast days that clear BOTH a real heat-category (>=Mild)
       AND the site's own model-derived heat_risk (>= the median heat_risk
       across monitored sites) — exactly the notebook's `RISK_CUT` logic —
       so this isn't "any warm day anywhere", it's "a BMD-defined hot spell
       forecast for a place the model already flagged as heat-prone."

  An empty alerts list is a normal, honest, and (as of the run this was
  built from, 22 Sept 2026) the ACTUAL current result — Dhaka-area highs
  were only ~28-32C that week, nowhere near BMD's 36C floor. Empty means
  "no heatwave forecast right now", not "this feature is broken."

WHY THIS IS "10 hotspot sites", NOT "64 districts": the notebook's alert
check runs on hotspot cluster centroids (lat/lon), because that's what a
heat-mitigation team would actually watch — the specific hot places the
model found, not an administrative boundary average. Mapping a cluster
centroid back to a district name would require a spatial join this script
doesn't have inputs for, so sites are reported as "Hotspot <cluster id>"
with their coordinates, same as the notebook printed them. The frontend is
expected to show this as a national-level "N locations under heatwave
watch" signal, not attribute it to a citizen's specific district.

DATA THIS SCRIPT NEEDS THAT IS BUNDLED HERE (not re-fetched every run):
    scripts/models/data/heat/heat_risk.json       - frozen national risk score, 64 districts
    scripts/models/data/heat/heat_grid.json       - frozen national LST grid
    scripts/models/data/heat/heat_trend.json      - frozen 2015-2026 national trend
    scripts/models/data/heat/heat_hotspots.geojson - frozen DBSCAN hotspot clusters (this run's monitored sites)

DATA THIS SCRIPT FETCHES LIVE, EVERY RUN:
    7-day daily temperature_2m_max per hotspot centroid, from
    https://api.open-meteo.com/v1/forecast (no API key required).

HONESTLY NOTED LIMITATION (same as flood_export.py's): this sandbox's
outbound network is restricted to an allowlist that may not include
api.open-meteo.com, so the live-fetch path here was validated against the
notebook's own real, already-executed forecast call (22 Sept 2026 — see
heat_model_project.ipynb, cell 20) rather than re-executed fresh in this
sandbox. GitHub Actions runners have normal internet access; after
pushing, trigger one manual "Run workflow" and check the Actions log /
api/data/heat_alerts.json before trusting the 3-day schedule unattended.
"""

from __future__ import annotations

import json
import shutil
import statistics
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

FROZEN_DIR = Path(__file__).resolve().parent / "data" / "heat"
FROZEN_FILES = ["heat_risk.json", "heat_grid.json", "heat_trend.json", "heat_hotspots.geojson"]

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
FORECAST_DAYS = 7
MAX_SITES = 10  # matches the notebook's `.head(10)` largest clusters

# BMD official heatwave bands, taken verbatim from the notebook's
# bmd_category() (heat_model_project.ipynb, cell 20) — not re-derived here.
SEVERITY_ORDER = ["Normal", "Mild", "Moderate", "Severe", "Extreme"]


def _bmd_category(tmax_c: float | None) -> str:
    if tmax_c is None:
        return "Normal"
    if tmax_c >= 42:
        return "Extreme"
    if tmax_c >= 40:
        return "Severe"
    if tmax_c >= 38:
        return "Moderate"
    if tmax_c >= 36:
        return "Mild"
    return "Normal"


def _load_frozen(name: str) -> Any:
    with open(FROZEN_DIR / name, "r", encoding="utf-8") as f:
        return json.load(f)


def _monitored_sites() -> list[dict]:
    """Largest hotspot clusters from the frozen model output, as (name, lat,
    lon, heat_risk) — the same "top 10 by cell count" cutoff the notebook
    used for its Heatwave Risk section."""
    hotspots = _load_frozen("heat_hotspots.geojson")
    feats = sorted(
        hotspots.get("features", []),
        key=lambda f: f.get("properties", {}).get("cells", 0),
        reverse=True,
    )[:MAX_SITES]

    sites = []
    for f in feats:
        props = f.get("properties", {})
        lon, lat = f["geometry"]["coordinates"]  # GeoJSON order is [lon, lat]
        sites.append({
            "name": f"Hotspot {props.get('cluster_id')}",
            "lat": lat,
            "lon": lon,
            "heat_risk": props.get("heat_risk"),
        })
    return sites


def _fetch_forecast(sites: list[dict]) -> list[dict]:
    """One batched request for all sites' 7-day daily max temperature."""
    params = {
        "latitude": ",".join(f"{s['lat']:.4f}" for s in sites),
        "longitude": ",".join(f"{s['lon']:.4f}" for s in sites),
        "daily": "temperature_2m_max",
        "timezone": "Asia/Dhaka",
        "forecast_days": str(FORECAST_DAYS),
    }
    query = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{OPEN_METEO_URL}?{query}"

    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        raise RuntimeError(f"Open-Meteo forecast request failed: {e}") from e

    # Open-Meteo returns a single object for one location, a list for
    # multiple — normalise to a list either way.
    blocks = payload if isinstance(payload, list) else [payload]
    if len(blocks) != len(sites):
        raise RuntimeError(
            f"Open-Meteo returned {len(blocks)} location block(s) for {len(sites)} requested sites"
        )

    rows = []
    for site, block in zip(sites, blocks):
        daily = block.get("daily", {})
        days = daily.get("time", [])
        tmaxes = daily.get("temperature_2m_max", [])
        for day, tmax in zip(days, tmaxes):
            rows.append({**site, "date": day, "tmax_c": tmax, "bmd_category": _bmd_category(tmax)})
    return rows


def _build_alerts(forecast_rows: list[dict], sites: list[dict]) -> dict:
    risks = [s["heat_risk"] for s in sites if s["heat_risk"] is not None]
    risk_cut = statistics.median(risks) if risks else 0.0

    by_site: dict[str, list[dict]] = {}
    for row in forecast_rows:
        severity = SEVERITY_ORDER.index(row["bmd_category"])
        if severity == 0:
            continue  # "Normal" days are never alerts
        if row["heat_risk"] is None or row["heat_risk"] < risk_cut:
            continue
        by_site.setdefault(row["name"], []).append(row)

    alerts = []
    for name, rows in by_site.items():
        worst = max(rows, key=lambda r: SEVERITY_ORDER.index(r["bmd_category"]))
        alerts.append({
            "name": name,
            "lat": rows[0]["lat"],
            "lon": rows[0]["lon"],
            "heat_risk": rows[0]["heat_risk"],
            "heatwave_days": len(rows),
            "peak_tmax_c": round(max(r["tmax_c"] for r in rows), 1),
            "worst_category": worst["bmd_category"],
        })
    alerts.sort(key=lambda a: (SEVERITY_ORDER.index(a["worst_category"]), a["heat_risk"]), reverse=True)

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecast_days": FORECAST_DAYS,
        "sites_monitored": len(sites),
        "risk_cut": round(risk_cut, 3),
        "alerts": alerts,
    }


def generate(staging_dir: Path) -> None:
    # 1. The frozen, one-time-real satellite outputs pass through unchanged —
    #    same pattern as flood_export.py's frozen classifier/CSVs.
    for name in FROZEN_FILES:
        shutil.copyfile(FROZEN_DIR / name, staging_dir / name)

    # 2. The genuinely live piece: today's 7-day forecast against BMD
    #    thresholds, for the model's own real hotspot sites.
    sites = _monitored_sites()
    if not sites:
        raise RuntimeError("heat_hotspots.geojson has no clusters — cannot build heatwave alerts")

    forecast_rows = _fetch_forecast(sites)
    alerts_payload = _build_alerts(forecast_rows, sites)

    with open(staging_dir / "heat_alerts.json", "w", encoding="utf-8") as f:
        json.dump(alerts_payload, f, indent=2)
