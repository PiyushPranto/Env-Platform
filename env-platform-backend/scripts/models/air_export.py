"""
scripts/models/air_export.py
============================
LIVE AIR QUALITY for all 64 districts -> air_live.json

Follows the same contract as the other export scripts: generate(staging_dir)
writes real output into staging_dir, raises on any real failure, and never
writes placeholder numbers. The orchestrator validates the file before it is
promoted into api/data/.

SOURCE AND HONEST LIMITATION
----------------------------
Values come from the Open-Meteo Air Quality API (free, no key). This is
MODELLED atmospheric data (CAMS), not readings from ground sensors, and its
resolution over Bangladesh is coarse (tens of km). Treat it as a regional
estimate, not a street-level measurement. The `disclosure` field says this so
the dashboard can show it.

AQI categories use the standard US AQI index bands (0-50 Good ... 301+
Hazardous), applied to the `us_aqi` value the API returns.

Test locally (needs internet):
    python air_export.py
"""

from __future__ import annotations

import datetime as dt
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
TIMEZONE = "Asia/Dhaka"
FORECAST_DAYS = 5
BATCH = 16
TIMEOUT = 60
RETRIES = 3

# Reuse the 64 district points the heat module already ships with.
SITES_FILE = Path(__file__).resolve().parent / "data" / "heat" / "heat_district_sites.json"

CURRENT_VARS = "pm2_5,pm10,nitrogen_dioxide,ozone,us_aqi"
HOURLY_VARS = "pm2_5,us_aqi"


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _get(url: str, params: dict):
    last = None
    for attempt in range(RETRIES):
        try:
            full = f"{url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(full, headers={"User-Agent": "air-live/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise ConnectionError(f"Open-Meteo air quality unreachable after {RETRIES} attempts: {last}")


def aqi_category(aqi: float) -> str:
    if aqi <= 50:
        return "Good"
    if aqi <= 100:
        return "Moderate"
    if aqi <= 150:
        return "Unhealthy for Sensitive Groups"
    if aqi <= 200:
        return "Unhealthy"
    if aqi <= 300:
        return "Very Unhealthy"
    return "Hazardous"


def _daily_forecast(hourly: dict) -> list[dict]:
    """Collapse hourly values into one row per day: mean PM2.5, max AQI."""
    times = hourly.get("time") or []
    pm = hourly.get("pm2_5") or []
    aqi = hourly.get("us_aqi") or []
    by_day: dict[str, dict[str, list]] = defaultdict(lambda: {"pm": [], "aqi": []})
    for i, t in enumerate(times):
        day = t[:10]
        if i < len(pm) and pm[i] is not None:
            by_day[day]["pm"].append(float(pm[i]))
        if i < len(aqi) and aqi[i] is not None:
            by_day[day]["aqi"].append(float(aqi[i]))
    rows = []
    for day in sorted(by_day):
        d = by_day[day]
        if not d["pm"] or not d["aqi"]:
            continue
        rows.append({
            "date": day,
            "pm2_5_mean": round(sum(d["pm"]) / len(d["pm"]), 1),
            "us_aqi_max": round(max(d["aqi"])),
        })
    return rows


def fetch_air(sites: list[dict]) -> tuple[list[dict], list[str]]:
    rows, missing = [], []
    for i in range(0, len(sites), BATCH):
        chunk = sites[i:i + BATCH]
        payload = _get(AIR_URL, {
            "latitude": ",".join(str(s["lat"]) for s in chunk),
            "longitude": ",".join(str(s["lon"]) for s in chunk),
            "current": CURRENT_VARS,
            "hourly": HOURLY_VARS,
            "timezone": TIMEZONE,
            "forecast_days": FORECAST_DAYS,
        })
        locs = payload if isinstance(payload, list) else [payload]
        if len(locs) != len(chunk):
            raise ValueError(f"asked for {len(chunk)} locations, got {len(locs)}")
        for site, loc in zip(chunk, locs):
            cur = loc.get("current") or {}
            if cur.get("pm2_5") is None or cur.get("us_aqi") is None:
                missing.append(site["name"])
                continue
            aqi = float(cur["us_aqi"])
            rows.append({
                "name": site["name"],
                "pm2_5": round(float(cur["pm2_5"]), 1),
                "pm10": None if cur.get("pm10") is None else round(float(cur["pm10"]), 1),
                "no2": None if cur.get("nitrogen_dioxide") is None else round(float(cur["nitrogen_dioxide"]), 1),
                "o3": None if cur.get("ozone") is None else round(float(cur["ozone"]), 1),
                "us_aqi": round(aqi),
                "aqi_category": aqi_category(aqi),
                "forecast": _daily_forecast(loc.get("hourly") or {}),
            })
        time.sleep(0.5)
    return rows, missing


def build_payload(sites: list[dict]) -> dict:
    rows, missing = fetch_air(sites)
    if not rows:
        raise ValueError("Open-Meteo returned no usable air quality values for any district")
    rows.sort(key=lambda r: -r["us_aqi"])
    return {
        "generated_at": _now_iso(),
        "status": "ok",
        "districts_scored": len(rows),
        "districts_missing": missing,
        "districts": rows,
        "national_mean_pm2_5": round(sum(r["pm2_5"] for r in rows) / len(rows), 1),
        "national_mean_us_aqi": round(sum(r["us_aqi"] for r in rows) / len(rows)),
        "source": "Open-Meteo Air Quality API (CAMS atmospheric model)",
        "disclosure": (
            "Modelled atmospheric data, not ground-sensor readings. Resolution over "
            "Bangladesh is coarse (tens of km), so values are regional estimates and "
            "can differ from street-level conditions. AQI bands follow the US AQI index."
        ),
    }


def generate(staging_dir: Path) -> None:
    sites = json.loads(SITES_FILE.read_text())
    payload = build_payload(sites)  # raises on failure: no fake output
    (Path(staging_dir) / "air_live.json").write_text(json.dumps(payload, indent=2))


if __name__ == "__main__":
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        generate(Path(tmp))
        out = json.loads((Path(tmp) / "air_live.json").read_text())
        print(f"Scored {out['districts_scored']} districts; "
              f"national mean PM2.5 {out['national_mean_pm2_5']}, AQI {out['national_mean_us_aqi']}")
        print(f"{'district':<18}{'PM2.5':>8}{'AQI':>6}  category")
        for r in out["districts"][:10]:
            print(f"{r['name']:<18}{r['pm2_5']:>8}{r['us_aqi']:>6}  {r['aqi_category']}")
