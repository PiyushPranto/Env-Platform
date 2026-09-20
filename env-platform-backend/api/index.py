"""
Chattogram / Bangladesh Environmental Risk Platform — API layer.

Serves model output (Heat, Flood, Deforestation) as JSON/GeoJSON for the
Government and Citizen dashboards (environmental-risk-platform.jsx).

STATUS: every endpoint currently reads a placeholder file from api/data/,
built to the exact field names each model's notebook is expected to
produce. As each model finishes training, replace the matching file in
api/data/ with the real export — same filename, same field names — and
no code or frontend change is needed. See README.md for the full mapping
of endpoint -> file -> real source notebook.

Endpoint list mirrors claude/10-day-execution-guide.md's Day 6 plan:
/heat/risk, /flood/predict (here: /flood/risk), /flood/alerts (folded
into /flood/risk + /flood/trend), /deforestation/ndvi, /deforestation/detect
— plus a few extras the frontend and notebooks already need.
"""

from pathlib import Path
import json

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from fastapi.middleware.cors import CORSMiddleware

try:
    # Normal case when this module is imported as part of the `api` package
    # (e.g. local testing with `import api.index`).
    from . import officers_db
except ImportError:
    # Vercel's Python runtime loads api/index.py directly rather than as a
    # package submodule, which makes the relative import above fail with
    # "attempted relative import with no known parent package". Its own
    # directory is on sys.path in that case, so a plain import resolves
    # officers_db.py sitting right next to this file either way.
    import officers_db

DATA_DIR = Path(__file__).parent / "data"

app = FastAPI(
    title="Environmental Risk Platform API",
    description="Heat / Flood / Deforestation model output for the Government and Citizen dashboards.",
    version="0.1.0",
)
class LoginRequest(BaseModel):
    officer_id: str
    password: str


class RegisterRequest(BaseModel):
    officer_id: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    role: str = Field(min_length=1, max_length=64)


DEMO_USERS = {
    "env_project": {"password": "env_project_400", "role": "Environmental Analyst"},
    "city_admin": {"password": "city_admin_400", "role": "City Administrator"},
    "field_officer": {"password": "field_officer_400", "role": "Field Officer"},
}


@app.post("/auth/login")
def login(credentials: LoginRequest):
    # 1. The three original demo accounts keep working exactly as before —
    #    unchanged behavior, checked first so nothing here can break them.
    demo_user = DEMO_USERS.get(credentials.officer_id)
    if demo_user:
        if demo_user["password"] != credentials.password:
            raise HTTPException(status_code=401, detail="Invalid Officer ID or password")
        return {
            "authenticated": True,
            "officer_id": credentials.officer_id,
            "role": demo_user["role"],
        }

    # 2. Not a demo account — check officers who registered for real.
    if not officers_db.is_configured():
        # Same officer_id might be a real registration, but there's no DB
        # to check — say so plainly rather than a misleading 401.
        raise HTTPException(
            status_code=401,
            detail="Invalid Officer ID or password",
        )

    try:
        officer = officers_db.get_officer(credentials.officer_id)
    except officers_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Login storage unavailable: {e}")

    if not officer or not officers_db.verify_password(
        credentials.password, officer["password_salt"], officer["password_hash"]
    ):
        raise HTTPException(status_code=401, detail="Invalid Officer ID or password")

    return {
        "authenticated": True,
        "officer_id": officer["officer_id"],
        "role": officer["role"],
    }


@app.post("/auth/register")
def register(request: RegisterRequest):
    """Registers a new officer account. Returns the same shape as /auth/login
    so the frontend can log the new officer straight in — see REGISTRATION.md
    for the full setup (this needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
    to be set; without them this returns a clear 503, not a fake success)."""
    if request.officer_id in DEMO_USERS:
        raise HTTPException(
            status_code=409,
            detail="That Officer ID is reserved for a demo account. Choose a different Officer ID.",
        )

    if not officers_db.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Registration isn't set up yet: SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY are not configured on this "
                "backend. See REGISTRATION.md for setup steps."
            ),
        )

    try:
        existing = officers_db.get_officer(request.officer_id)
        if existing:
            raise HTTPException(status_code=409, detail="That Officer ID is already registered.")

        officer = officers_db.create_officer(
            officer_id=request.officer_id,
            name=request.name,
            role=request.role,
            password=request.password,
        )
    except officers_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Registration storage unavailable: {e}")

    return {
        "authenticated": True,
        "officer_id": officer["officer_id"],
        "role": officer["role"],
    }


# Allow the deployed frontend (and local dev) to call this API from the browser.
# Tighten allow_origins to the exact Vercel frontend URL before the real defense demo.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _load(filename: str):
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"{filename} not found in api/data/")
    return json.loads(path.read_text())


@app.get("/")
def root():
    return {
        "service": "env-platform-api",
        "status": "ok",
        "endpoints": [
            "/heat/risk", "/heat/hotspots", "/heat/trend",
            "/flood/risk", "/flood/trend", "/flood/top-risk-areas", "/flood/summary",
            "/deforestation/detect", "/deforestation/districts", "/deforestation/ndvi",
            "/model/refresh-status",
        ],
    }


# ---------------------------------------------------------------------------
# Heat — model not trained yet; every response here is a labeled placeholder.
# ---------------------------------------------------------------------------

@app.get("/heat/risk")
def heat_risk():
    """Per-ward heat risk score. Replace api/data/heat_risk.json with the real
    per-district/ward output once the Heat model (Random Forest UHI + composite
    risk score) is trained. Keep the field names: name, lst_c, ndvi, ndbi,
    heat_risk, risk_category, population."""
    return _load("heat_risk.json")


@app.get("/heat/hotspots")
def heat_hotspots():
    """DBSCAN/KMeans hotspot clusters as GeoJSON points."""
    return _load("heat_hotspots.geojson")


@app.get("/heat/trend")
def heat_trend():
    """12-month temperature trend vs seasonal baseline."""
    return _load("heat_trend.json")


@app.get("/heat/grid")
def heat_grid():
    """Raw temperature grid for the heat-map visualization (7x9, matches the
    frontend's HEAT_GRID shape). Replace with the real LST raster once the
    Heat model produces one."""
    return _load("heat_grid.json")


# ---------------------------------------------------------------------------
# Flood — rule-based model already run once, real results (Dhaka, Jun-Aug
# 2025). Every flood endpoint below is REAL data, copied out of the
# frontend's hardcoded FLOOD_* constants so it's now served over HTTP
# instead of baked into the React file. If a finer-grained export
# (dhaka_flood_grid.geojson, 1,650 cells) becomes available later, this
# 7x9 grid can be swapped for the real one.
# ---------------------------------------------------------------------------

@app.get("/flood/risk")
def flood_risk():
    """7x9 flood-risk-score grid (0-1), block-averaged from the real
    1,650-cell Dhaka analysis. Matches the frontend's FLOOD_RISK_GRID shape
    exactly — { "grid": [[...]] }."""
    return _load("flood_grid.json")


@app.get("/flood/trend")
def flood_trend():
    """62-day rainfall / % of Dhaka alerted series, real data. Matches the
    frontend's FLOOD_TREND shape exactly — { "trend": [{date, rainfall,
    pctAlerted}, ...] }."""
    return _load("flood_trend.json")


@app.get("/flood/top-risk-areas")
def flood_top_risk_areas():
    """Highest-risk locations, real data. Matches the frontend's
    FLOOD_TOP_AREAS shape exactly — { "areas": [{area, elevation, riverDist,
    risk, category}, ...] }."""
    return _load("flood_top_risk_areas.json")


@app.get("/flood/summary")
def flood_summary():
    """Model summary numbers, real data — matches claude/dhaka-flood-model-summary.md
    and the frontend's FLOOD_SUMMARY object exactly."""
    return _load("flood_summary.json")


# ---------------------------------------------------------------------------
# Deforestation — NDVI change-detection notebook already exists; outputs
# below are placeholders shaped to match its documented file structure.
# ---------------------------------------------------------------------------

@app.get("/deforestation/detect")
def deforestation_detect():
    """Vectorized, minimum-mapping-unit-filtered deforestation patches, GeoJSON.
    Replace with the real deforestation_detect.geojson (541 patches after
    filtering, per the notebook run)."""
    return _load("deforestation_detect.geojson")


@app.get("/deforestation/districts")
def deforestation_districts():
    """Per-district NDVI / vegetation-cover change — choropleth layer +
    ranking-table source. Replace with the real deforestation_districts.geojson."""
    return _load("deforestation_districts.geojson")


@app.get("/deforestation/ndvi")
def deforestation_ndvi():
    """NDVI summary for the trend chart / headline numbers. Replace with the
    real deforestation_summary.json."""
    return _load("deforestation_ndvi_summary.json")


# ---------------------------------------------------------------------------
# Model refresh status — written by scripts/update_model_outputs.py
# (see .github/workflows/update-model-outputs.yml) every time the
# automation runs. Lets the dashboard show "Last model update" / whether
# each model is live, skipped (no real model code wired in yet) or failed
# (previous valid output is still being served). This is the only change
# made to this file for the automation — every existing endpoint above,
# including /auth/login, is unchanged.
# ---------------------------------------------------------------------------

@app.get("/model/refresh-status")
def model_refresh_status():
    """Status of the automated model-output update pipeline. Returns a
    safe default (nothing has run yet) if refresh_status.json doesn't
    exist yet, rather than a 404 — the dashboard should be able to render
    a "not yet automated" state instead of erroring."""
    path = DATA_DIR / "refresh_status.json"
    if not path.exists():
        return {
            "status": "not_yet_run",
            "last_run_at": None,
            "last_run_had_updates": False,
            "last_run_had_failures": False,
            "models": {},
        }
    return json.loads(path.read_text())
