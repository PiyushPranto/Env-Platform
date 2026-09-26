"""
Real export script for the NATIONWIDE (64-district) flood model.

WHICH FLOOD EFFORT THIS TARGETS (see scripts/runners/flood.py's long
comment for the full background): this targets the newer 64-district
trained Random Forest classifier (bangladesh_flood_model_colab_final.ipynb
/ bd_flood_model.joblib), NOT the Dhaka-only one-time composite score
(flood_grid.json / flood_trend.json / flood_top_risk_areas.json /
flood_summary.json, still hand-served as a fixed historical analysis and
unaffected by this file). scripts/runners/flood.py's OUTPUT_FILES was
updated to point at the three flood_national_*.json files this script
produces.

WHAT ACTUALLY REFRESHES EVERY 3 DAYS, AND WHAT DOESN'T (read this before
assuming this is "the model retraining itself" — it isn't, and shouldn't
be):

- The Random Forest classifier itself (scripts/models/data/flood_model.joblib)
  is FROZEN. It was trained once, offline, on real 2015-2018 DFO+GFD flood
  event ground truth plus a disclosed rainfall-extremity proxy for
  2019-2024 (see flood_training_provenance.json — bundled here as a static
  snapshot of the original bd_flood_model_summary.json, describing how the
  model was actually built; that history doesn't change on a refresh and
  is deliberately never overwritten by this script). Retraining it every 3
  days would not be meaningful — the training ground truth doesn't change.

- Each district's HISTORICAL flood profile (dfo_avg_severity,
  gfd_avg_flooded_fraction, gfd_event_count, historical_magnitude —
  scripts/models/data/flood_severity_static.csv) is also FROZEN. These are
  facts about real past flood events; they don't change either.

- What DOES genuinely refresh every run: avg_predicted_risk per district.
  This script fetches real, live daily rainfall for the last
  WINDOW_DAYS (default 90) days for all 64 districts from the Open-Meteo
  Archive API (free, keyless, ERA5-reanalysis-based — the same kind of
  rainfall data the model was trained on), recomputes the same rolling
  rainfall features the model expects (rain_roll3/7/14, rain_lag1, month,
  day_of_year), and runs them through the already-trained, frozen
  classifier. avg_predicted_risk is the mean predicted flood probability
  over that real, current window — so it genuinely moves as real weather
  changes (elevated during an actual wet spell, lower in a dry spell).
  severity_tier and priority_rank are then recomputed from that fresh
  number using the exact same formulas/weights as the original notebook.

This is an honest "frozen model scored on a live rolling window", not a
live-retraining pipeline and not a claim that new satellite ground truth
arrives every 3 days — both would be false. Framed this way, a 3-day
schedule is a defensible, real refresh: rainfall genuinely changes that
often, and BGD flood risk exposure genuinely does move with it.

DATA THIS SCRIPT NEEDS THAT IS BUNDLED HERE (not re-fetched every run,
because it doesn't change):
    scripts/models/data/flood_model.joblib          - {"model", "feature_cols"}
    scripts/models/data/flood_districts_static.csv  - 64 rows: terrain + centroid
    scripts/models/data/flood_severity_static.csv   - 64 rows: historical DFO/GFD profile
    scripts/models/data/flood_population_static.csv - 64 rows: real 2022 census population
    scripts/models/data/flood_training_provenance.json - static training-corpus facts

EXPOSURE WEIGHT FIX (population data now used — previously a disclosed
known weakness): the original export used district area (area_km2) as a
stand-in for population in the 20%-weighted "exposure" term of
priority_score, because population data wasn't part of the original
export. That gap is now closed: flood_population_static.csv holds each
district's real population from Bangladesh's 2022 Population and Housing
Census (BBS), sourced from the Wikipedia division/district pages that
carry those census infoboxes (en.wikipedia.org/wiki/<Division>_Division
and en.wikipedia.org/wiki/<District>_District, fetched and cross-checked
per district on 2026-09-26; the 64-district sum is ~164.9M, matching BBS's
published national total of ~165.16M). priority_score's exposure term is
now genuinely "how many people are in this district", not a geographic
area stand-in — a materially more defensible number for a mitigation-
investment ranking. area_km2 is still reported in the output (informational),
it just no longer feeds the score.

DATA THIS SCRIPT FETCHES LIVE, EVERY RUN:
    Daily precipitation_sum per district centroid, last ~104 days, from
    https://archive-api.open-meteo.com/v1/archive (no API key required).

HONESTLY NOTED LIMITATION: this sandbox's outbound network is restricted
to an allowlist that does not include archive-api.open-meteo.com, so the
live-fetch path could not be executed end-to-end here — only the
request-building, parsing and feature/scoring logic were exercised against
a saved sample response shape. GitHub Actions runners have normal internet
access, so this should work there; after pushing, trigger one manual
"Run workflow" and check the Actions log / refresh_status.json before
trusting the 3-day schedule unattended.
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
MODEL_PATH = DATA_DIR / "flood_model.joblib"
DISTRICTS_STATIC_PATH = DATA_DIR / "flood_districts_static.csv"
SEVERITY_STATIC_PATH = DATA_DIR / "flood_severity_static.csv"
POPULATION_STATIC_PATH = DATA_DIR / "flood_population_static.csv"
TRAINING_PROVENANCE_PATH = DATA_DIR / "flood_training_provenance.json"

# The currently-LIVE output from the previous run (about to be replaced).
# Read once, before overwriting, purely to compute an honest "is this
# district's risk rising or falling since last refresh" signal — never
# invented, and never blocking if it's missing (very first run, or the
# file moved) since a trend simply isn't shown in that case.
LIVE_SEVERITY_PATH = Path(__file__).resolve().parent.parent.parent / "api" / "data" / "flood_national_severity.json"
TREND_STEADY_THRESHOLD = 0.03  # +/- 3 percentage points of predicted risk counts as "steady", not noise-driven up/down

OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
BATCH_SIZE = 16          # districts per HTTP request — keeps URLs short, limits blast radius of one bad batch
LAG_DAYS = 7             # end the window this many days before "today" — ERA5 archive data needs a few days to finalize
WINDOW_DAYS = 90         # real days actually averaged into avg_predicted_risk
BUFFER_DAYS = 14         # extra days fetched before the window, only to seed rain_roll14/rain_lag1 correctly
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5

RISK_WEIGHT, SEVERITY_WEIGHT, EXPOSURE_WEIGHT = 0.5, 0.3, 0.2  # weights unchanged from the original notebook
POPULATION_DATA_SOURCE = (
    "Bangladesh Population and Housing Census 2022 (BBS), via Wikipedia division/district "
    "page infoboxes, cross-checked per district 2026-09-26"
)


def _read_csv(path: Path) -> list[dict]:
    import csv

    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _fetch_batch(lats: list[float], lons: list[float], start_date: str, end_date: str) -> list[dict]:
    """One Open-Meteo Archive API call for up to BATCH_SIZE locations.

    Returns a list (same length/order as lats/lons) of {"time": [...dates...],
    "precipitation_sum": [...mm or None...]}. Raises on repeated failure —
    never returns a fabricated/empty result silently.
    """
    params = {
        "latitude": ",".join(f"{v:.6f}" for v in lats),
        "longitude": ",".join(f"{v:.6f}" for v in lons),
        "start_date": start_date,
        "end_date": end_date,
        "daily": "precipitation_sum",
        "timezone": "Asia/Dhaka",
    }
    query = "&".join(f"{k}={urllib.request.quote(str(v))}" for k, v in params.items())
    url = f"{OPEN_METEO_ARCHIVE_URL}?{query}"

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
            # A single-location request returns one object instead of a
            # list — normalize so callers always get a list.
            if isinstance(payload, dict):
                payload = [payload]
            if not isinstance(payload, list) or len(payload) != len(lats):
                raise ValueError(
                    f"Open-Meteo returned {len(payload) if isinstance(payload, list) else type(payload)} "
                    f"result(s) for {len(lats)} requested location(s)"
                )
            return [p["daily"] for p in payload]
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, KeyError, TimeoutError) as e:
            last_error = e
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_BACKOFF_SECONDS * attempt)
    raise RuntimeError(f"Open-Meteo Archive API request failed after {MAX_RETRIES} attempts: {last_error}")


def _fetch_all_rainfall(districts: list[dict], start_date: str, end_date: str) -> dict[int, list[tuple[str, float]]]:
    """Fetch daily rainfall for every district, batched. Returns
    {district_id: [(date_str, rainfall_mm), ...]} sorted by date."""
    out: dict[int, list[tuple[str, float]]] = {}
    for i in range(0, len(districts), BATCH_SIZE):
        chunk = districts[i : i + BATCH_SIZE]
        lats = [float(d["centroid_lat"]) for d in chunk]
        lons = [float(d["centroid_lon"]) for d in chunk]
        dailies = _fetch_batch(lats, lons, start_date, end_date)
        for d, daily in zip(chunk, dailies):
            times = daily.get("time", [])
            precip = daily.get("precipitation_sum", [])
            rows = [
                (t, 0.0 if v is None else max(0.0, float(v)))
                for t, v in zip(times, precip)
            ]
            out[int(d["district_id"])] = sorted(rows, key=lambda r: r[0])
        if i + BATCH_SIZE < len(districts):
            time.sleep(1)  # be polite to a free, keyless public API between batches
    return out


def _rolling_features(rows: list[tuple[str, float]]) -> list[dict]:
    """Reproduce the notebook's rolling-feature logic (rain_roll3/7/14,
    rain_lag1, month, day_of_year) for one district's daily series,
    in plain Python (no pandas dependency needed for this part)."""
    values = [r[1] for r in rows]
    out = []
    for idx, (date_str, rainfall_mm) in enumerate(rows):
        date = datetime.strptime(date_str, "%Y-%m-%d")
        window3 = values[max(0, idx - 2) : idx + 1]
        window7 = values[max(0, idx - 6) : idx + 1]
        window14 = values[max(0, idx - 13) : idx + 1]
        lag1 = values[idx - 1] if idx >= 1 else 0.0
        out.append(
            {
                "date": date_str,
                "rainfall_mm": rainfall_mm,
                "rain_roll3": sum(window3),
                "rain_roll7": sum(window7),
                "rain_roll14": sum(window14),
                "rain_lag1": lag1,
                "month": date.month,
                "day_of_year": date.timetuple().tm_yday,
            }
        )
    return out


def _normalize(values: list[float]) -> list[float]:
    lo, hi = min(values), max(values)
    if hi - lo <= 0:
        return [0.0 for _ in values]
    return [(v - lo) / (hi - lo) for v in values]


def _load_previous_avg_risk() -> dict[int, float]:
    """Best-effort read of the previous run's avg_predicted_risk per
    district, from the file this run is about to overwrite. Returns {} if
    it doesn't exist yet (first-ever run) or can't be parsed - a missing
    trend is honest; a fabricated one is not."""
    if not LIVE_SEVERITY_PATH.exists():
        return {}
    try:
        rows = json.loads(LIVE_SEVERITY_PATH.read_text())
        return {
            int(r["district_id"]): float(r["avg_predicted_risk"])
            for r in rows
            if "district_id" in r and r.get("avg_predicted_risk") is not None
        }
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return {}


def _risk_trend(current: float, previous: float | None) -> str | None:
    if previous is None:
        return None
    diff = current - previous
    if abs(diff) < TREND_STEADY_THRESHOLD:
        return "steady"
    return "up" if diff > 0 else "down"


def _assess_severity(probability: float, historical_magnitude: float) -> str:
    """Identical thresholds to the original notebook's assess_severity()."""
    if probability < 0.4:
        return "Low"
    combined = 0.5 * probability + 0.5 * historical_magnitude
    if combined > 0.75:
        return "Severe"
    if combined > 0.55:
        return "High"
    return "Moderate"


def generate(staging_dir: Path) -> None:
    import warnings

    import joblib

    warnings.filterwarnings("ignore", message="X does not have valid feature names")

    if not MODEL_PATH.exists():
        raise RuntimeError(f"Bundled model not found at {MODEL_PATH} — cannot score anything without it.")

    bundle = joblib.load(MODEL_PATH)
    model = bundle["model"]
    feature_cols = bundle["feature_cols"]

    districts = _read_csv(DISTRICTS_STATIC_PATH)
    severity_static = {int(r["district_id"]): r for r in _read_csv(SEVERITY_STATIC_PATH)}
    population_static = {int(r["district_id"]): int(r["population_2022"]) for r in _read_csv(POPULATION_STATIC_PATH)}
    training_provenance = json.loads(TRAINING_PROVENANCE_PATH.read_text())

    if len(districts) != 64:
        raise RuntimeError(f"Expected 64 districts in {DISTRICTS_STATIC_PATH}, found {len(districts)}")

    missing_population = [d["district_name"] for d in districts if int(d["district_id"]) not in population_static]
    if missing_population:
        raise RuntimeError(
            f"No population figure for: {', '.join(missing_population)} — refusing to score exposure "
            f"with an incomplete population table rather than silently defaulting to zero/area."
        )

    end_date = (datetime.now(timezone.utc) - timedelta(days=LAG_DAYS)).date()
    start_date = end_date - timedelta(days=WINDOW_DAYS + BUFFER_DAYS - 1)

    rainfall_by_district = _fetch_all_rainfall(districts, start_date.isoformat(), end_date.isoformat())
    previous_avg_risk = _load_previous_avg_risk()

    severity_rows = []
    priority_rows = []
    avg_risk_by_district: dict[int, float] = {}

    for d in districts:
        did = int(d["district_id"])
        rows = rainfall_by_district.get(did, [])
        if len(rows) < WINDOW_DAYS:
            raise RuntimeError(
                f"District {d['district_name']} ({did}): only got {len(rows)} days of rainfall, "
                f"need at least {WINDOW_DAYS} — refusing to score on an incomplete window."
            )

        feats = _rolling_features(rows)[-WINDOW_DAYS:]  # drop the buffer days, keep the real evaluation window

        static_feats = {
            "elevation_m_mean": float(d["elevation_m_mean"]),
            "elevation_m_min": float(d["elevation_m_min"]),
            "slope_deg_mean": float(d["slope_deg_mean"]),
            "river_distance_m_mean": float(d["river_distance_m_mean"]),
            "area_km2": float(d["area_km2"]),
        }

        X = [[{**f, **static_feats}[c] for c in feature_cols] for f in feats]
        probabilities = model.predict_proba(X)[:, 1]
        avg_predicted_risk = float(sum(probabilities) / len(probabilities))
        avg_risk_by_district[did] = avg_predicted_risk

        sev = severity_static.get(did, {})
        historical_magnitude = float(sev.get("historical_magnitude", 0.0) or 0.0)
        has_recorded_event = str(sev.get("has_recorded_event", "False")).strip().lower() == "true"
        population_2022 = population_static[did]

        severity_rows.append(
            {
                "district_id": did,
                "district_name": d["district_name"],
                "dfo_avg_severity": float(sev["dfo_avg_severity"]) if sev.get("dfo_avg_severity") else None,
                "gfd_avg_flooded_fraction": float(sev["gfd_avg_flooded_fraction"]) if sev.get("gfd_avg_flooded_fraction") else None,
                "gfd_max_flooded_fraction": float(sev["gfd_max_flooded_fraction"]) if sev.get("gfd_max_flooded_fraction") else None,
                "gfd_event_count": float(sev["gfd_event_count"]) if sev.get("gfd_event_count") else None,
                "has_recorded_event": has_recorded_event,
                "historical_magnitude": historical_magnitude,
                "avg_predicted_risk": avg_predicted_risk,
                "severity_tier": _assess_severity(avg_predicted_risk, historical_magnitude),
                "previous_avg_predicted_risk": previous_avg_risk.get(did),
                "risk_trend": _risk_trend(avg_predicted_risk, previous_avg_risk.get(did)),
                "population_2022": population_2022,
            }
        )

        priority_rows.append(
            {
                "district_id": did,
                "district_name": d["district_name"],
                "area_km2": float(d["area_km2"]),
                "population_2022": population_2022,
                "avg_predicted_risk": avg_predicted_risk,
                "historical_magnitude": historical_magnitude,
                "has_recorded_event": has_recorded_event,
            }
        )

    risk_values = [p["avg_predicted_risk"] for p in priority_rows]
    sev_values = [p["historical_magnitude"] for p in priority_rows]
    # Exposure term: real 2022 census population per district, replacing the
    # area_km2 stand-in the original export used (see POPULATION_DATA_SOURCE
    # and the module docstring). area_km2 stays in the output for reference,
    # it just no longer drives priority_score.
    population_values = [p["population_2022"] for p in priority_rows]
    risk_norms = _normalize(risk_values)
    sev_norms = _normalize(sev_values)
    exposure_norms = _normalize(population_values)

    for p, rn, sn, en in zip(priority_rows, risk_norms, sev_norms, exposure_norms):
        p["risk_norm"] = rn
        p["severity_norm"] = sn
        p["exposure_norm"] = en
        p["priority_score"] = RISK_WEIGHT * rn + SEVERITY_WEIGHT * sn + EXPOSURE_WEIGHT * en

    priority_rows.sort(key=lambda p: p["priority_score"], reverse=True)
    for i, p in enumerate(priority_rows):
        p["priority_rank"] = i + 1

    summary = dict(training_provenance)  # static training-corpus facts — never overwritten by a live refresh
    summary["top5_priority_districts"] = [p["district_name"] for p in priority_rows[:5]]
    summary["live_prediction_window"] = {
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "window_days": WINDOW_DAYS,
    }
    summary["last_refreshed_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    summary["refresh_mode"] = "frozen_model_scored_on_live_open_meteo_rolling_window"
    summary["exposure_metric"] = "population_2022"
    summary["population_data_source"] = POPULATION_DATA_SOURCE

    (staging_dir / "flood_national_severity.json").write_text(json.dumps(severity_rows))
    (staging_dir / "flood_national_priority.json").write_text(json.dumps(priority_rows))
    (staging_dir / "flood_national_summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        generate(Path(tmp))
        print("Wrote:", sorted(Path(tmp).iterdir()))
