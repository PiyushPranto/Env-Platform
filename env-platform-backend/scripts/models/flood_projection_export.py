"""
Forward-looking flood risk PROJECTION — the same frozen, trained
64-district Random Forest classifier as flood_export.py, applied to
Open-Meteo's real 7-day precipitation FORECAST instead of its historical
archive, to answer a genuinely different question than the nowcast does.

WHY THIS IS A SEPARATE FILE FROM flood_export.py, NOT AN EXTENSION OF IT:
flood_export.py's avg_predicted_risk answers "given roughly the last 90
real days of rainfall, how flood-prone is this district right now" — a
slow-moving climate-style average, deliberately averaged over 90 days so
one noisy day can't swing it. This script answers a different, complementary
question: "given the actual published weather forecast, which specific day
in the NEXT WEEK looks worst for this district". Keeping it as its own
model in the automation (its own OUTPUT_FILES, its own success/skipped/
failed status in refresh_status.json) means a problem fetching the forecast
can never take down the working nowcast pipeline, or vice versa — the same
per-model isolation update_model_outputs.py already gives Heat, Flood and
Deforestation.

METHODOLOGY (exactly as defensible as flood_export.py's, same honesty bar):
  1. Load the same bundled, FROZEN classifier and the same per-district
     static terrain features (elevation, slope, river distance, area) that
     flood_export.py uses — nothing about the model itself changes.
  2. For each district, fetch one real series from Open-Meteo's FORECAST
     API (api.open-meteo.com, not the archive-api.open-meteo.com host
     flood_export.py uses): PROJECTION_SEED_DAYS of near-real-time recent
     rainfall (via the `past_days` parameter) immediately followed by
     PROJECTION_FORECAST_DAYS of the actual published forecast (via
     `forecast_days`). The seed days exist ONLY to compute a correct
     rain_roll14/rain_roll7/rain_roll3 for the first forecast day — they
     are never themselves scored or reported.
  3. Reproduce the identical rolling-feature computation flood_export.py
     uses (rain_roll3/7/14, rain_lag1, month, day_of_year), then run the
     SAME frozen classifier on each of the 7 forecast days individually —
     this gives one predicted flood probability PER DAY, not a single
     90-day average, which is what actually makes a 7-day trajectory
     meaningful (a rising or falling shape, and which day peaks).
  4. Report each day's real forecasted rainfall alongside its predicted
     probability, the projected value 7 days out, which day is the worst,
     and a plain rising/falling/steady trend comparing day 1 to day 7 —
     never a claim sharper than "this model, fed this real forecast, says
     X"; never a claim about ground truth 7 days from now, which no one
     has.

HONEST LIMITS OF THIS FEATURE, STATED PLAINLY (do not paper over these in
the frontend either):
  - This inherits the weather forecast's own uncertainty. A forecast 6-7
    days out is far less reliable than tomorrow's; Open-Meteo does not
    publish per-day confidence with the free daily-summary endpoint used
    here, so this script cannot and does not report one. Treat day 6-7 as
    directional, not precise.
  - The classifier was trained on rain_roll3/7/14 built from REAL, already-
    happened rainfall (see flood_export.py / flood_training_provenance.json).
    Feeding it forecast rainfall for the same features is a legitimate,
    standard way to extend a nowcast model to short-lead forecasting (the
    feature space is identical, only the data source for future days
    changes), but it is not a separately validated forecasting model in
    its own right — this is disclosed here and should be disclosed in the
    thesis defense the same way.
  - Same sandbox limitation as flood_export.py and heat_export.py: this
    sandbox cannot reach api.open-meteo.com, so the live-fetch path here
    was validated against request-building/parsing/scoring logic only,
    not executed end-to-end. Trigger one manual "Run workflow" on GitHub
    Actions and check api/data/flood_risk_projection.json / the Actions
    log before trusting this unattended.

DATA THIS SCRIPT NEEDS (bundled, same files flood_export.py already uses —
read-only, never modified by this script):
    scripts/models/data/flood_model.joblib
    scripts/models/data/flood_districts_static.csv

DATA THIS SCRIPT FETCHES LIVE, EVERY RUN:
    PROJECTION_SEED_DAYS of recent + PROJECTION_FORECAST_DAYS of forecast
    daily precipitation_sum per district centroid, from
    https://api.open-meteo.com/v1/forecast (no API key required).
"""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
MODEL_PATH = DATA_DIR / "flood_model.joblib"
DISTRICTS_STATIC_PATH = DATA_DIR / "flood_districts_static.csv"

OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
BATCH_SIZE = 16                  # same batching rationale as flood_export.py
PROJECTION_SEED_DAYS = 13        # real recent days fetched only to seed rain_roll14 for day 1 of the forecast
PROJECTION_FORECAST_DAYS = 7     # real forecast days actually scored and reported
PROJECTION_TREND_THRESHOLD = 0.05  # +/- 5 points of predicted probability, day 1 vs day 7, counts as "steady"
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = 5


def _read_csv(path: Path) -> list[dict]:
    import csv

    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _fetch_forecast_batch(lats: list[float], lons: list[float]) -> list[dict]:
    """One Open-Meteo FORECAST API call (not the archive API) for up to
    BATCH_SIZE locations, requesting PROJECTION_SEED_DAYS of recent data
    plus PROJECTION_FORECAST_DAYS of real forecast. Raises on repeated
    failure — never returns a fabricated/empty result silently."""
    params = {
        "latitude": ",".join(f"{v:.6f}" for v in lats),
        "longitude": ",".join(f"{v:.6f}" for v in lons),
        "daily": "precipitation_sum",
        "timezone": "Asia/Dhaka",
        "past_days": str(PROJECTION_SEED_DAYS),
        "forecast_days": str(PROJECTION_FORECAST_DAYS),
    }
    query = urllib.parse.urlencode(params)
    url = f"{OPEN_METEO_FORECAST_URL}?{query}"

    last_error: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
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
    raise RuntimeError(f"Open-Meteo forecast API request failed after {MAX_RETRIES} attempts: {last_error}")


def _fetch_all_forecast_rainfall(districts: list[dict]) -> dict[int, list[tuple[str, float]]]:
    """Fetch the seed+forecast rainfall series for every district, batched.
    Returns {district_id: [(date_str, rainfall_mm), ...]} sorted by date,
    length PROJECTION_SEED_DAYS + PROJECTION_FORECAST_DAYS per district."""
    out: dict[int, list[tuple[str, float]]] = {}
    for i in range(0, len(districts), BATCH_SIZE):
        chunk = districts[i : i + BATCH_SIZE]
        lats = [float(d["centroid_lat"]) for d in chunk]
        lons = [float(d["centroid_lon"]) for d in chunk]
        dailies = _fetch_forecast_batch(lats, lons)
        for d, daily in zip(chunk, dailies):
            times = daily.get("time", [])
            precip = daily.get("precipitation_sum", [])
            rows = [(t, 0.0 if v is None else max(0.0, float(v))) for t, v in zip(times, precip)]
            out[int(d["district_id"])] = sorted(rows, key=lambda r: r[0])
        if i + BATCH_SIZE < len(districts):
            time.sleep(1)  # be polite to a free, keyless public API between batches
    return out


def _rolling_features(rows: list[tuple[str, float]]) -> list[dict]:
    """Identical logic to flood_export.py's _rolling_features — duplicated
    here deliberately rather than imported, so this script stays a fully
    standalone, independently-failing model (see module docstring)."""
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


def _projection_trend(first: float, last: float) -> str:
    diff = last - first
    if abs(diff) < PROJECTION_TREND_THRESHOLD:
        return "steady"
    return "rising" if diff > 0 else "falling"


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
    if len(districts) != 64:
        raise RuntimeError(f"Expected 64 districts in {DISTRICTS_STATIC_PATH}, found {len(districts)}")

    rainfall_by_district = _fetch_all_forecast_rainfall(districts)
    expected_len = PROJECTION_SEED_DAYS + PROJECTION_FORECAST_DAYS

    projection_rows = []
    for d in districts:
        did = int(d["district_id"])
        rows = rainfall_by_district.get(did, [])
        if len(rows) < expected_len:
            raise RuntimeError(
                f"District {d['district_name']} ({did}): only got {len(rows)} days from the forecast API, "
                f"need at least {expected_len} — refusing to project on an incomplete window."
            )

        feats = _rolling_features(rows)[-PROJECTION_FORECAST_DAYS:]  # drop the seed days, keep the real forecast days

        static_feats = {
            "elevation_m_mean": float(d["elevation_m_mean"]),
            "elevation_m_min": float(d["elevation_m_min"]),
            "slope_deg_mean": float(d["slope_deg_mean"]),
            "river_distance_m_mean": float(d["river_distance_m_mean"]),
            "area_km2": float(d["area_km2"]),
        }

        X = [[{**f, **static_feats}[c] for c in feature_cols] for f in feats]
        probabilities = model.predict_proba(X)[:, 1]

        daily = [
            {
                "date": f["date"],
                "predicted_risk": float(p),
                "rainfall_mm": round(f["rainfall_mm"], 1),
            }
            for f, p in zip(feats, probabilities)
        ]
        peak_day = max(daily, key=lambda r: r["predicted_risk"])

        projection_rows.append(
            {
                "district_id": did,
                "district_name": d["district_name"],
                "daily": daily,
                "risk_in_7_days": daily[-1]["predicted_risk"],
                "peak_day": peak_day,
                "projection_trend": _projection_trend(daily[0]["predicted_risk"], daily[-1]["predicted_risk"]),
            }
        )

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecast_days": PROJECTION_FORECAST_DAYS,
        "seed_days_used": PROJECTION_SEED_DAYS,
        "methodology": (
            f"The same frozen, trained classifier flood_national_priority.json's avg_predicted_risk uses, "
            f"scored day-by-day for the next {PROJECTION_FORECAST_DAYS} real forecast days from Open-Meteo's "
            f"published forecast (not the 90-day historical average the nowcast uses). {PROJECTION_SEED_DAYS} "
            f"prior days of near-real-time rainfall are fetched only to correctly seed the rolling-rain "
            f"features for day 1 of the forecast, and are not themselves scored or reported. This inherits "
            f"the weather forecast's own uncertainty, which grows with each day further out — treat later "
            f"days as directional, not precise."
        ),
        "districts": projection_rows,
    }

    (staging_dir / "flood_risk_projection.json").write_text(json.dumps(payload, indent=2))


if __name__ == "__main__":
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        generate(Path(tmp))
        print("Wrote:", sorted(Path(tmp).iterdir()))
