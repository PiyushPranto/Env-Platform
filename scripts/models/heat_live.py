"""
scripts/models/heat_live.py
===========================
LIVE HEAT RE-SCORING — the flood module's pattern, applied to heat.

NOTHING EXISTING IS MODIFIED. This reads heat_risk.json and writes one NEW
file, heat_live.json. The seasonal score, grid, hotspots, trend and SUHI are
untouched and keep serving exactly what they serve now.

--------------------------------------------------------------------------
THE IDEA
--------------------------------------------------------------------------
The flood module freezes its classifier and re-scores districts against a
live rainfall window. The same split exists inside the heat risk score:

    heat_risk = 0.4*(1 - NDVI_norm) + 0.4*LST_norm + 0.2*built_norm
                \________________________________/   \____________/
                  thermal term, time-varying          stable terms

Vegetation cover and built-up surface do not change between runs. Surface
temperature does. So the score splits into a SURFACE SUSCEPTIBILITY that is
a property of the land, and a THERMAL FACTOR that is a property of the
weather:

    susceptibility = 0.4*(1 - NDVI_norm) + 0.2*built_norm      (stable)
    thermal        = 0.4*LST_norm                              (varies)

Susceptibility is recovered algebraically from the model output you already
have -- exactly as the flood module back-solved terrain susceptibility from
its stored per-cell risk:

    susceptibility_d = heat_risk_d - 0.4 * LST_norm_d

This is EXACT, not an approximation, because min-max normalisation is affine
and the score is linear, so both commute with the district mean:

    mean(a*X + b) = a*mean(X) + b

The live score then recombines the stable half with a live thermal term:

    live_risk_d = susceptibility_d + 0.4 * T_norm_d

--------------------------------------------------------------------------
THE ONE THING YOU MUST DISCLOSE
--------------------------------------------------------------------------
T_norm comes from forecast 2 m AIR temperature. LST_norm came from satellite
LAND SURFACE temperature. These are different physical quantities.

That means heat_live.json is a PARALLEL INDEX, not the seasonal index
updated. Its susceptibility half is identical to the published model; its
thermal half is a different measurement on the same 0-1 relative scale. The
two scores are not interchangeable and must never be plotted on one axis.

This is the same honesty boundary the flood live layer already states, and
it is why the output carries an explicit `comparable_to_seasonal: false`.

--------------------------------------------------------------------------
WHY THE THERMAL TERM USES A FIXED REFERENCE RANGE
--------------------------------------------------------------------------
A naive live term would normalise today's 64 temperatures against today's own
min and max. That breaks day-to-day comparison: on a uniformly hot day the
hottest district still scores 1.0 and the coolest still scores 0.0, so the
index would never show a nationwide heatwave at all, and yesterday's 0.8
would not mean the same as today's 0.8.

So the reference range is FIXED and absolute, anchored to the BMD bands:

    REF_LO = 20 C   (comfortable)
    REF_HI = 42 C   (BMD extreme heatwave threshold)
    T_norm = clip((T - 20) / 22, 0, 1)

Every run uses the same scale, so the live score is comparable across days,
and 1.0 has a meaning rather than being "whichever district is hottest".
This mirrors the flood module, which normalises live rainfall against a
fixed 10-year CHIRPS baseline rather than against the current week.

--------------------------------------------------------------------------
USAGE
--------------------------------------------------------------------------
    python heat_live.py --data-dir api/data --out api/data     standalone
    from heat_live import build_live                           importable
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# --------------------------------------------------------------------------
# Configuration — these three constants are the model, keep them in the report
# --------------------------------------------------------------------------

W_VEG, W_LST, W_BUILT = 0.4, 0.4, 0.2     # the published weights, unchanged

# Pixel-level min and max of the Mar-May 2026 LST composite. These are what
# the notebook normalised against; they must match or the back-solve is wrong.
LST_MIN, LST_MAX = 20.81, 31.36

# Fixed reference range for the live thermal term (see header).
REF_LO, REF_HI = 20.0, 42.0

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEZONE = "Asia/Dhaka"
BATCH = 16
TIMEOUT = 60
RETRIES = 3

# Change of this much or more in the live score counts as a real move, not
# noise. Mirrors the flood module's +/-3 percentage point "steady" band.
STEADY_BAND = 0.02


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def _clip01(x: float) -> float:
    return 0.0 if x < 0.0 else (1.0 if x > 1.0 else x)


def _get(url: str, params: dict):
    last = None
    for attempt in range(RETRIES):
        try:
            full = f"{url}?{urllib.parse.urlencode(params)}"
            req = urllib.request.Request(full, headers={"User-Agent": "heat-live/1.0"})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as exc:
            last = exc
            time.sleep(2 * (attempt + 1))
    raise ConnectionError(f"Open-Meteo unreachable after {RETRIES} attempts: {last}")


# --------------------------------------------------------------------------
# Step 1 — recover the stable half of the score
# --------------------------------------------------------------------------

def recover_susceptibility(districts: list[dict]) -> list[dict]:
    """heat_risk - 0.4*LST_norm, per district. Exact, not fitted.

    Each input row needs `name`, `heat_risk` and `lst_c` — all three are
    already in heat_risk.json.
    """
    span = LST_MAX - LST_MIN
    out = []
    for d in districts:
        lst_norm = (float(d["lst_c"]) - LST_MIN) / span
        susc = float(d["heat_risk"]) - W_LST * lst_norm
        out.append({
            "name": d["name"],
            "seasonal_heat_risk": round(float(d["heat_risk"]), 4),
            "seasonal_lst_c": round(float(d["lst_c"]), 2),
            "seasonal_lst_norm": round(lst_norm, 4),
            "susceptibility": round(susc, 4),
        })
    return out


def check_susceptibility(rows: list[dict]) -> list[str]:
    """Susceptibility is 0.4*(1-NDVI_norm) + 0.2*built_norm, so it must lie in
    [0, 0.6]. Anything outside means LST_MIN/LST_MAX do not match the run that
    produced heat_risk.json, and the whole live layer would be wrong."""
    bad = [f"{r['name']}: {r['susceptibility']:.4f}"
           for r in rows if not (-0.01 <= r["susceptibility"] <= 0.61)]
    return bad


# --------------------------------------------------------------------------
# Step 2 — the live thermal term
# --------------------------------------------------------------------------

def fetch_today_tmax(sites: list[dict]) -> dict[str, float]:
    """Today's forecast daily maximum 2 m air temperature, per district."""
    result: dict[str, float] = {}
    for i in range(0, len(sites), BATCH):
        chunk = sites[i:i + BATCH]
        payload = _get(FORECAST_URL, {
            "latitude": ",".join(str(s["lat"]) for s in chunk),
            "longitude": ",".join(str(s["lon"]) for s in chunk),
            "daily": "temperature_2m_max",
            "timezone": TIMEZONE,
            "forecast_days": 1,
        })
        locs = payload if isinstance(payload, list) else [payload]
        if len(locs) != len(chunk):
            raise ValueError(f"asked for {len(chunk)} locations, got {len(locs)}")
        for site, loc in zip(chunk, locs):
            temps = (loc.get("daily") or {}).get("temperature_2m_max") or []
            if temps and temps[0] is not None:
                result[site["name"]] = float(temps[0])
        time.sleep(0.5)
    return result


def thermal_factor(tmax_c: float) -> float:
    """Live thermal term on the same 0-1 scale as LST_norm, against a FIXED
    reference range so the index is comparable between days."""
    return _clip01((tmax_c - REF_LO) / (REF_HI - REF_LO))


# --------------------------------------------------------------------------
# Step 3 — recombine
# --------------------------------------------------------------------------

def categorise(value: float, cuts: list[float]) -> str:
    """Bands taken from the SEASONAL distribution, so 'High' keeps the same
    meaning on the live index as on the published one."""
    lo, mid, hi = cuts
    if value >= hi:
        return "Very High"
    if value >= mid:
        return "High"
    if value >= lo:
        return "Moderate"
    return "Low"


def seasonal_cuts(districts: list[dict]) -> list[float]:
    vals = sorted(float(d["heat_risk"]) for d in districts)
    n = len(vals)

    def q(p):
        k = p * (n - 1)
        f = int(k)
        return vals[f] if f + 1 >= n else vals[f] + (k - f) * (vals[f + 1] - vals[f])

    return [round(q(0.25), 4), round(q(0.50), 4), round(q(0.75), 4)]


def build_live(districts: list[dict], sites: list[dict]) -> dict:
    """districts: rows from heat_risk.json (name, heat_risk, lst_c, ...)
       sites:     [{name, lat, lon}] district points for the forecast lookup"""
    susc_rows = recover_susceptibility(districts)
    problems = check_susceptibility(susc_rows)
    if problems:
        raise ValueError(
            "Recovered susceptibility outside the valid range [0, 0.6] for: "
            + "; ".join(problems[:5])
            + ".\nLST_MIN/LST_MAX do not match the run that produced "
              "heat_risk.json. Fix them before trusting this output."
        )

    by_name = {r["name"]: r for r in susc_rows}
    cuts = seasonal_cuts(districts)
    tmax = fetch_today_tmax(sites)

    rows, missing = [], []
    for name, r in by_name.items():
        if name not in tmax:
            missing.append(name)
            continue
        t = tmax[name]
        tf = thermal_factor(t)
        live = r["susceptibility"] + W_LST * tf
        delta = live - r["seasonal_heat_risk"]
        rows.append({
            "name": name,
            "live_heat_risk": round(live, 4),
            "live_category": categorise(live, cuts),
            "tmax_air_c": round(t, 1),
            "thermal_factor": round(tf, 4),
            "susceptibility": r["susceptibility"],
            "seasonal_heat_risk": r["seasonal_heat_risk"],
            "seasonal_category": categorise(r["seasonal_heat_risk"], cuts),
            "delta_vs_seasonal": round(delta, 4),
            "direction": ("up" if delta > STEADY_BAND
                          else "down" if delta < -STEADY_BAND
                          else "steady"),
        })

    rows.sort(key=lambda r: -r["live_heat_risk"])

    return {
        "generated_at": _now_iso(),
        "status": "ok",
        "districts_scored": len(rows),
        "districts_missing_forecast": missing,
        "live": rows,
        "national_mean_live_risk": (
            round(sum(r["live_heat_risk"] for r in rows) / len(rows), 4) if rows else None),
        "national_mean_seasonal_risk": (
            round(sum(r["seasonal_heat_risk"] for r in rows) / len(rows), 4) if rows else None),
        "method": {
            "formula": "live_heat_risk = susceptibility + 0.4 * thermal_factor",
            "susceptibility": "0.4*(1 - NDVI_norm) + 0.2*built_norm, recovered "
                              "algebraically from the published seasonal score",
            "thermal_factor": f"clip((Tmax_air - {REF_LO}) / "
                              f"({REF_HI} - {REF_LO}), 0, 1)",
            "weights": {"vegetation_deficit": W_VEG, "thermal": W_LST,
                        "built_up": W_BUILT},
            "reference_range_c": [REF_LO, REF_HI],
            "category_cuts": cuts,
        },
        "comparable_to_seasonal": False,
        "disclosure": (
            "This is a parallel index, not the seasonal index updated. Its "
            "susceptibility term is identical to the published model; its "
            "thermal term uses forecast 2 m air temperature where the seasonal "
            "index uses satellite land surface temperature. These are different "
            "physical quantities on a common 0-1 relative scale, so the live and "
            "seasonal scores must not be plotted on one axis or differenced as "
            "temperatures. The weights and the stable half of the model are "
            "unchanged; only the thermal driver is live."
        ),
        "source": "Open-Meteo forecast API (daily maximum 2 m air temperature)",
    }


def unavailable(reason: str) -> dict:
    """Written when the fetch fails. Never fabricates a score."""
    return {
        "generated_at": _now_iso(),
        "status": "unavailable",
        "error": str(reason),
        "districts_scored": 0,
        "live": [],
        "comparable_to_seasonal": False,
        "disclosure": ("The live re-scoring could not run. The dashboard should "
                       "fall back to the seasonal score and say so, rather than "
                       "showing a stale live value."),
    }


# --------------------------------------------------------------------------
# District points
# --------------------------------------------------------------------------

def load_sites(data_dir: Path, names: list[str]) -> list[dict]:
    """Representative points per district, from the boundary file if present,
    otherwise from a cached sites file written on a previous run.

    representative_point() is used rather than centroid: a centroid for a long
    curved coastal district can fall in the Bay of Bengal and return sea
    conditions.
    """
    cache = data_dir / "heat_district_sites.json"
    gj = data_dir / "bd_districts.geojson"

    if gj.exists():
        try:
            import geopandas as gpd
            g = gpd.read_file(gj)[["ADM2_NAME", "geometry"]]
            g["geometry"] = g.geometry.representative_point()
            sites = [{"name": r.ADM2_NAME, "lat": round(r.geometry.y, 4),
                      "lon": round(r.geometry.x, 4)}
                     for r in g.itertuples() if r.ADM2_NAME in set(names)]
            cache.write_text(json.dumps(sites, indent=2))
            return sites
        except Exception as exc:  # noqa: BLE001
            print(f"  ! could not derive sites from the boundary file ({exc})")

    if cache.exists():
        print("  > using cached district points")
        return [s for s in json.loads(cache.read_text()) if s["name"] in set(names)]

    raise SystemExit(
        "No district points available. Put bd_districts.geojson in the data "
        "directory once (geopandas required), or supply "
        "heat_district_sites.json as [{name, lat, lon}, ...]."
    )


# --------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------

def generate(data_dir, out_dir) -> dict:
    """Write heat_live.json into out_dir. Returns the payload."""
    data_dir, out_dir = Path(data_dir), Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    risk = json.loads((data_dir / "heat_risk.json").read_text())
    districts = risk["wards"] if isinstance(risk, dict) and "wards" in risk else (
        risk["districts"] if isinstance(risk, dict) and "districts" in risk else risk)
    if not isinstance(districts, list):
        raise SystemExit("heat_risk.json is not a list of districts; check its shape.")

    print(f"  > {len(districts)} districts in the seasonal output")
    sites = load_sites(data_dir, [d["name"] for d in districts])
    print(f"  > {len(sites)} district points for the forecast lookup")

    try:
        payload = build_live(districts, sites)
        print(f"  > scored {payload['districts_scored']} districts; "
              f"national mean live {payload['national_mean_live_risk']} "
              f"vs seasonal {payload['national_mean_seasonal_risk']}")
    except (ConnectionError, ValueError, KeyError) as exc:
        print(f"  ! live re-scoring failed: {exc}")
        payload = unavailable(exc)

    (out_dir / "heat_live.json").write_text(json.dumps(payload, indent=2))
    print("  + heat_live.json")
    return payload


def _main(argv=None) -> int:
    p = argparse.ArgumentParser(
        description="Live heat re-scoring: stable susceptibility + live thermal term.")
    p.add_argument("--data-dir", default="api/data",
                   help="where heat_risk.json and bd_districts.geojson live")
    p.add_argument("--out", default=None, help="output directory (default: --data-dir)")
    a = p.parse_args(argv)

    payload = generate(a.data_dir, a.out or a.data_dir)
    if payload["status"] != "ok":
        return 1

    print(f"\n{'district':<18}{'live':>8}{'seasonal':>10}{'air C':>8}  {'dir':<7}category")
    print("-" * 66)
    for r in payload["live"][:15]:
        print(f"{r['name']:<18}{r['live_heat_risk']:>8.3f}"
              f"{r['seasonal_heat_risk']:>10.3f}{r['tmax_air_c']:>8.1f}  "
              f"{r['direction']:<7}{r['live_category']}")
    return 0


if __name__ == "__main__":
    sys.exit(_main())
