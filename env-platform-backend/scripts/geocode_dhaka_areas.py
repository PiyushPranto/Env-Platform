"""One-time enrichment: label the Dhaka "top risk areas" with real place
names instead of raw coordinates.

Why this exists
----------------
api/data/flood_top_risk_areas.json currently labels each of the 8 highest-
risk Dhaka grid points only by their coordinates (e.g. "23.577N, 90.063E"),
because the Dhaka flood analysis grid has no ward/locality boundaries baked
in. That was a deliberate, disclosed choice (see the file's own "note"
field) rather than an oversight - it's what "don't fabricate data" looks
like when you don't have the real names on hand.

This script gets the real names the honest way: a live reverse-geocoding
lookup against OpenStreetMap's free Nominatim service, which maps each
coordinate to the actual place name OSM has for that location. It does NOT
guess or invent area names.

Why this is a script you run once, not part of the 3-day automation
---------------------------------------------------------------------
- The 8 coordinates are fixed (frozen output of the one-time historical
  Dhaka analysis) - they will never change, so there's nothing to
  re-geocode on a schedule.
- Nominatim's usage policy requires a real contact User-Agent and a strict
  max of 1 request/second for casual/non-bulk use - fine for 8 one-off
  lookups, not something to bake into a recurring job.
- The sandbox that originally built this project's automation cannot reach
  nominatim.openstreetmap.org (network-restricted), so this has to be run
  from a machine with normal internet access - e.g. your own computer.

Usage
-----
    python scripts/geocode_dhaka_areas.py

(No extra packages needed - this only uses Python's built-in urllib.)

It reads api/data/flood_top_risk_areas.json, looks up each point, prints
what it found for you to sanity-check, and writes the result back with a
new "name" field added to each entry (the original "area" coordinate string
is kept, not removed, so nothing that already depends on it breaks).
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

DATA_FILE = Path(__file__).resolve().parent.parent / "api" / "data" / "flood_top_risk_areas.json"

# Nominatim's usage policy: identify yourself with a real, descriptive
# User-Agent (no generic "python-requests" default) and no more than one
# request per second. https://operations.osmfoundation.org/policies/nominatim/
USER_AGENT = "cse400-env-platform-thesis/1.0 (one-time reverse geocode, student project)"


def reverse_geocode(lat, lon):
    params = {
        "format": "jsonv2",
        "lat": lat,
        "lon": lon,
        "zoom": 16,  # neighbourhood-level detail
        "addressdetails": 1,
    }
    url = "https://nominatim.openstreetmap.org/reverse?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    addr = data.get("address", {})
    # Prefer the most locally-specific field Nominatim actually returned;
    # fall back progressively broader rather than guessing.
    name = (
        addr.get("suburb")
        or addr.get("neighbourhood")
        or addr.get("residential")
        or addr.get("village")
        or addr.get("town")
        or addr.get("city_district")
        or addr.get("city")
        or data.get("display_name")
    )
    return name


def parse_coord(area_str):
    # "23.577N, 90.063E" -> (23.577, 90.063)
    lat_part, lon_part = [p.strip() for p in area_str.split(",")]
    lat = float(lat_part.rstrip("Nn"))
    lon = float(lon_part.rstrip("Ee"))
    return lat, lon


def main():
    payload = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    areas = payload["areas"]

    for i, entry in enumerate(areas):
        lat, lon = parse_coord(entry["area"])
        try:
            name = reverse_geocode(lat, lon)
        except Exception as exc:  # noqa: BLE001 - print and keep going
            print(f"  [{i+1}/{len(areas)}] {entry['area']}: FAILED ({exc}) - keeping coordinates")
            continue
        if name:
            entry["name"] = name
            print(f"  [{i+1}/{len(areas)}] {entry['area']} -> {name}")
        else:
            print(f"  [{i+1}/{len(areas)}] {entry['area']}: no name returned - keeping coordinates")
        time.sleep(1.1)  # stay under Nominatim's 1 req/sec limit

    payload["note"] = (
        "Real data, copied from the frontend's hardcoded FLOOD_TOP_AREAS "
        "(top-risk locations from the real Dhaka flood grid). 'name' is a "
        "real OpenStreetMap reverse-geocode of the grid point's "
        "coordinates (approximate locality, not an official ward "
        "boundary - none exist for this dataset); 'area' keeps the exact "
        "coordinates the risk score is actually computed for."
    )
    DATA_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nDone. Wrote {DATA_FILE}")
    print("Check the names above look right, then commit/push as usual.")


if __name__ == "__main__":
    main()
