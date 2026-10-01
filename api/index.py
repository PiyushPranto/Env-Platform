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
from typing import Literal, Optional
import csv
import io
import json
import re

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator
from fastapi.middleware.cors import CORSMiddleware

try:
    # Normal case when this module is imported as part of the `api` package
    # (e.g. local testing with `import api.index`).
    from . import officers_db
    from . import citizen_reports_db
    from . import alert_subscriptions_db
except ImportError:
    # Vercel's Python runtime loads api/index.py directly rather than as a
    # package submodule, which makes the relative import above fail with
    # "attempted relative import with no known parent package". Its own
    # directory is on sys.path in that case, so a plain import resolves
    # officers_db.py / citizen_reports_db.py / alert_subscriptions_db.py
    # sitting right next to this file either way.
    import officers_db
    import citizen_reports_db
    import alert_subscriptions_db

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

DEMO_USERS_DISPLAY_NAME = {
    "env_project": "Environmental Analyst (demo)",
    "city_admin": "City Administrator (demo)",
    "field_officer": "Field Officer (demo)",
}


def _is_valid_officer(officer_id: str) -> bool:
    """True for a demo account or a real registered officer. Used to gate
    the report-verification/assignment endpoints below — this project has
    no real session/token auth (see LoginRequest's simple officer_id+password
    check above), so this is a plausibility check, not a security boundary:
    it stops an obviously-wrong officer_id from being recorded as who made
    a change, consistent with the rest of this app's honestly-simple,
    thesis-scope auth rather than pretending to be production-grade."""
    if officer_id in DEMO_USERS:
        return True
    if not officers_db.is_configured():
        return False
    try:
        return officers_db.get_officer(officer_id) is not None
    except officers_db.SupabaseError:
        return False


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


@app.get("/auth/officers")
def list_officers():
    """officer_id/name/role for every officer who can be assigned a citizen
    report (task assignment — see PATCH /deforestation/citizen-reports/{id}
    below). Always includes the 3 demo accounts (so assignment is testable
    even before Supabase/registration is set up) plus any real registered
    officers. Never returns password_hash/salt."""
    officers = [
        {"officer_id": oid, "name": DEMO_USERS_DISPLAY_NAME.get(oid, oid), "role": u["role"], "demo": True}
        for oid, u in DEMO_USERS.items()
    ]
    if officers_db.is_configured():
        try:
            officers += [{**o, "demo": False} for o in officers_db.list_officers()]
        except officers_db.SupabaseError:
            pass  # demo accounts alone are still a usable (if incomplete) list
    return {"officers": officers}


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
            "/heat/risk", "/heat/hotspots", "/heat/trend", "/heat/grid", "/heat/alerts", "/heat/live",
            "/flood/risk", "/flood/trend", "/flood/top-risk-areas", "/flood/summary",
            "/flood/national/severity", "/flood/national/priority", "/flood/national/summary",
            "/flood/national/projection",
            "/deforestation/districts", "/deforestation/worklist", "/deforestation/citizen-cards",
            "/deforestation/timeseries", "/deforestation/restoration-priority",
            "/deforestation/loss-by-year", "/deforestation/model-metrics",
            "/deforestation/citizen-reports", "/deforestation/citizen-reports/{report_id}",
            "/deforestation/community-stats",
            "/auth/officers",
            "/alerts/subscribe", "/alerts/unsubscribe",
            "/model/refresh-status",
            "/data/export", "/data/export.csv",
        ],
    }


# ---------------------------------------------------------------------------
# Heat — real, national (64-district) output from heat_model_project.ipynb
# (Random Forest heat-risk composite + DBSCAN hotspot clusters + per-district
# SUHI intensity, MODIS LST/NDVI + JRC GHSL built-up fraction, Mar-May 2026).
# heat_risk.json/heat_grid.json/heat_trend.json/heat_hotspots.geojson are a
# frozen one-time seasonal composite (same reasoning as Deforestation);
# heat_alerts.json is one live piece, re-scored every 3 days against a real
# Open-Meteo forecast for the model's own hotspot sites — see
# scripts/models/heat_export.py's module docstring for the full picture.
# heat_live.json is a second, independent live piece: a per-district (all
# 64) re-score against live forecast air temperature, parallel to (not an
# update of) the seasonal heat_risk.json score — see heat_live.py.
#
# Two schema notes vs. the old Chattogram-only placeholder this replaced:
#   - `built_fraction` replaces `ndbi` (NDBI was abandoned — see
#     heat-model-summary.md — in favour of JRC GHSL built-up fraction).
#   - there is no `population` field. The model doesn't produce one, so
#     the old "population in high-risk areas" KPI has no real data source
#     and was removed from the frontend rather than served against a
#     field that will never exist.
# ---------------------------------------------------------------------------

@app.get("/heat/risk")
def heat_risk():
    """National heat risk score, one record per district (64), in
    {"wards": [...]}. Fields: name, lst_c, ndvi, built_fraction, heat_risk,
    risk_category (High/Medium/Low, tertile-based), uhi_intensity_c
    (null unless this district had enough urban/rural contrast to measure
    SUHI — see heat-model-summary.md), cells."""
    return _load("heat_risk.json")


@app.get("/heat/hotspots")
def heat_hotspots():
    """DBSCAN hotspot clusters (>=25 cells) as GeoJSON points, with
    cluster_id, cells, heat_risk, lst_c. These are the sites /heat/alerts
    monitors."""
    return _load("heat_hotspots.geojson")


@app.get("/heat/trend")
def heat_trend():
    """National annual mean LST, 2015-2026 (field name is `month` for
    frontend-shape compatibility but holds a year int — see
    heat_export.py). `excluded: true` marks 2025/2026, dropped from the
    trend fit due to Terra sensor orbital drift. The fitted trend
    (+1.25 C/decade, 2015-2024) is NOT statistically significant
    (p=0.106) — report it as observed, not confirmed."""
    return _load("heat_trend.json")


@app.get("/heat/grid")
def heat_grid():
    """National LST grid (7x9, block-averaged) for the heat-map
    visualization. Cells with no valid pixels (open water, no data) are
    null — render them as a distinct 'no data' cell, not 0C."""
    return _load("heat_grid.json")


@app.get("/heat/alerts")
def heat_alerts():
    """Live heatwave watch: a 7-day Open-Meteo forecast for the model's own
    hotspot sites, checked against official BMD heatwave thresholds,
    refreshed every 3 days by the automation. An empty `alerts` list is a
    normal, honest result (no heatwave forecast right now), not a broken
    feature. Falls back to a clearly-labeled not-yet-run payload if the
    automation hasn't produced this file yet."""
    try:
        return _load("heat_alerts.json")
    except HTTPException:
        return {
            "generated_at": None,
            "forecast_days": 7,
            "sites_monitored": 0,
            "risk_cut": None,
            "alerts": [],
            "note": "Heatwave automation has not run yet.",
        }


@app.get("/heat/live")
def heat_live():
    """Live per-district heat re-scoring, all 64 districts: the published
    model's stable land-cover susceptibility term (recovered algebraically
    from heat_risk.json, unchanged) recombined with a live forecast air
    temperature, refreshed every 3 days by the automation — the flood
    module's back-solved-susceptibility pattern applied to heat. This is an
    explicitly-labeled PARALLEL index, not /heat/risk updated: its thermal
    term is forecast 2m air temperature, where /heat/risk's is satellite
    land surface temperature — different physical quantities on a common
    0-1 scale. `comparable_to_seasonal` is always false; never plot the two
    scores on one axis. A `status: "unavailable"` payload (empty `live`)
    means the forecast fetch failed that run — fall back to showing
    /heat/risk and say so, not a stale live value. Falls back to a
    clearly-labeled not-yet-run payload if the automation hasn't produced
    this file yet."""
    try:
        return _load("heat_live.json")
    except HTTPException:
        return {
            "generated_at": None,
            "status": "not_yet_run",
            "districts_scored": 0,
            "live": [],
            "comparable_to_seasonal": False,
            "note": "Live heat re-scoring has not run yet.",
        }


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
# Deforestation — REAL data. Produced by deforestation_model.ipynb (Random
# Forest classifier on seasonal MODIS NDVI, 2015-2025, all 64 Bangladesh
# districts), run by the team and verified via the notebook's own Step 14
# integration-readiness check (READY, 35/35 core checks passed). See
# claude/deforestation-model-summary.md and deforestation-api-contract.md
# in the project for the full methodology and field-by-field schema.
#
# Two fields the notebook itself flags as NOT safe to ship are deliberately
# left out of every response below: national year-by-year trend direction
# (the eleven-year series isn't identifiable — three normalisation methods
# disagree even on the SIGN of the decade change) and the risk forecast
# (backtest error 16.8pp against a 10pp usability cap). What's served here
# is exactly what the readiness check marked safe: the 2020 cross-section,
# district rankings, and loss locations.
#
# Large geometry files (deforestation_districts.geojson at 29MB,
# deforestation_detect.geojson at 6.9MB) are intentionally NOT served here —
# Vercel serverless functions cap a response around 4.5MB, so both would
# fail once deployed even though they work in local testing. Every other
# module on this platform renders its map as a custom colored grid/list
# rather than a real map library, so this follows the same pattern: district
# data is served as flat JSON for a ranking list, and the worklist below
# ships its top 200 rows (already sorted worst-first) rather than all 10,427.
# ---------------------------------------------------------------------------

@app.get("/deforestation/districts")
def deforestation_districts():
    """All 64 districts, full metrics (forest cover, loss, trend, priority,
    restoration need). Drives the government ranking table and the citizen
    link-out. Real data — see deforestation_summary.json in the notebook's
    output contract."""
    return _load("deforestation_districts.json")


@app.get("/deforestation/worklist")
def deforestation_worklist():
    """Top 200 deforestation patches (of 10,427 total), already sorted:
    protected areas first, then most recent, then largest. Each row has
    district, loss_year, lat/lon, area_km2, in_protected — the field
    worklist for "where do I send someone, and when did it happen." """
    return _load("deforestation_worklist.json")


@app.get("/deforestation/citizen-cards")
def deforestation_citizen_cards():
    """One card per district for the Citizen dashboard: current tree cover,
    a 9-point sparkline (2016-2024), a conditional outlook, and a
    ready-to-display message + planting call-to-action. No alert/alarm
    styling — per the model's own citizen framing, a deforestation stat
    isn't something a citizen can act on the way a flood alert is."""
    return _load("deforestation_citizen_cards.json")


@app.get("/deforestation/timeseries")
def deforestation_timeseries():
    """Long-format forest-cover time series, district x year (2016-2024,
    9 years — the first/last of the 11 imagery years are dropped since a
    3-year temporal filter can't apply symmetrically to them). Drives the
    per-district trend chart."""
    return _load("deforestation_timeseries.json")


@app.get("/deforestation/restoration-priority")
def deforestation_restoration_priority():
    """All 64 districts ranked by replanting priority, with the inputs
    (loss, trend, current cover) that produced the ranking."""
    return _load("deforestation_restoration_priority.json")


@app.get("/deforestation/loss-by-year")
def deforestation_loss_by_year():
    """National km2 lost per year, 2017-2024 — the headline bar chart."""
    return _load("deforestation_loss_by_year.json")


@app.get("/deforestation/model-metrics")
def deforestation_model_metrics():
    """Classifier performance — accuracy/precision/recall/F1/ROC-AUC
    (agreement with ESA WorldCover 2020 labels, not field-survey ground
    truth — see the model summary doc for why that distinction matters),
    plus feature importances. For the thesis defense / methodology panel."""
    return _load("deforestation_model_metrics.json")


class CitizenReportRequest(BaseModel):
    district: str = Field(min_length=1, max_length=64)
    description: str = Field(min_length=5, max_length=1000)
    contact: Optional[str] = Field(default=None, max_length=128)


@app.post("/deforestation/citizen-reports")
def create_citizen_report(request: CitizenReportRequest):
    """A citizen-submitted "I saw tree-cutting here" report — a different,
    complementary signal to the satellite model above, which only sees loss
    large/persistent enough to show up in a 250m MODIS pixel over multiple
    years. Needs Supabase configured (same env vars as /auth/register, see
    CITIZEN-REPORTS-SETUP.md for the one extra table) — until then this
    returns a clear 503, not a fake success."""
    if not citizen_reports_db.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Citizen reports aren't set up yet: SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY are not configured on this "
                "backend. See CITIZEN-REPORTS-SETUP.md for setup steps."
            ),
        )
    try:
        report = citizen_reports_db.create_report(
            district=request.district, description=request.description, contact=request.contact,
        )
    except citizen_reports_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't save report: {e}")
    return {"saved": True, "report": report}


@app.get("/deforestation/citizen-reports")
def list_citizen_reports():
    """Recent citizen reports, most recent first — for the government
    dashboard's field worklist. Same honest-503-if-not-configured behavior
    as the POST endpoint above; returns an empty list with a note if
    Supabase isn't set up yet, rather than a 500."""
    if not citizen_reports_db.is_configured():
        return {"configured": False, "reports": []}
    try:
        reports = citizen_reports_db.list_reports()
    except citizen_reports_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't load reports: {e}")
    return {"configured": True, "reports": reports}


@app.get("/deforestation/citizen-reports/{report_id}")
def get_citizen_report(report_id: str):
    """Closed-loop status check: the citizen who submitted a report can look
    up what happened to it using the reference number they were shown after
    submitting (see CitizenReportForm) — no login needed, same low-friction
    design as the report form itself. Same fields as the government
    worklist above (this doesn't create a new privacy boundary — the report
    was already visible in full there)."""
    if not citizen_reports_db.is_configured():
        raise HTTPException(status_code=503, detail="Citizen reports aren't set up yet.")
    try:
        report = citizen_reports_db.get_report(report_id)
    except citizen_reports_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't look up report: {e}")
    if not report:
        raise HTTPException(status_code=404, detail="No report found with that reference number.")
    return {"report": report}


class ReportUpdateRequest(BaseModel):
    updated_by: str = Field(min_length=1, max_length=64, description="officer_id making this change")
    status: Optional[Literal["pending", "verified", "resolved", "rejected"]] = None
    officer_note: Optional[str] = Field(default=None, max_length=1000)
    assigned_to: Optional[str] = Field(default=None, max_length=64)


@app.patch("/deforestation/citizen-reports/{report_id}")
def update_citizen_report(report_id: str, request: ReportUpdateRequest):
    """Closed-loop verification + task assignment: an officer moves a report
    through pending -> verified/rejected -> resolved, optionally leaving a
    note and/or assigning it to a specific officer for follow-up. Only the
    fields actually sent are changed. See _is_valid_officer's docstring for
    why `updated_by` is checked but this isn't real session auth."""
    if not citizen_reports_db.is_configured():
        raise HTTPException(status_code=503, detail="Citizen reports aren't set up yet.")
    if not _is_valid_officer(request.updated_by):
        raise HTTPException(status_code=403, detail="updated_by must be a known officer_id.")
    if request.assigned_to and not _is_valid_officer(request.assigned_to):
        raise HTTPException(status_code=400, detail="assigned_to must be a known officer_id.")
    try:
        report = citizen_reports_db.update_report(
            report_id,
            status=request.status,
            officer_note=request.officer_note,
            assigned_to=request.assigned_to,
            updated_by=request.updated_by,
        )
    except citizen_reports_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't update report: {e}")
    if not report:
        raise HTTPException(status_code=404, detail="No report found with that reference number.")
    return {"updated": True, "report": report}


@app.get("/deforestation/community-stats")
def community_stats():
    """Aggregated, anonymized citizen-report counts per district — the
    "community transparency feed": a citizen can see how much reporting
    activity and government follow-up has happened in their own area,
    without exposing any individual report's description/contact. Computed
    from the exact same rows the government worklist reads — nothing new is
    tracked, just counted and grouped here."""
    if not citizen_reports_db.is_configured():
        return {"configured": False, "districts": {}, "totals": {}}
    try:
        reports = citizen_reports_db.list_reports(limit=5000)
    except citizen_reports_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't load reports: {e}")

    by_district: dict[str, dict[str, int]] = {}
    totals = {"total": 0, "pending": 0, "verified": 0, "resolved": 0, "rejected": 0}
    for r in reports:
        d = r.get("district") or "Unknown"
        status = r.get("status") or "pending"
        bucket = by_district.setdefault(d, {"total": 0, "pending": 0, "verified": 0, "resolved": 0, "rejected": 0})
        bucket["total"] += 1
        bucket[status] = bucket.get(status, 0) + 1
        totals["total"] += 1
        totals[status] = totals.get(status, 0) + 1
    return {"configured": True, "districts": by_district, "totals": totals}


# ---------------------------------------------------------------------------
# Flood — nationwide (64-district) model. A separate effort from the
# Dhaka-only rule-based score above: a real Random Forest trained on 10
# years of daily district-level rainfall + terrain, validated against real
# flood-event ground truth (DFO + Global Flood Database) for 2015-2018 and
# a disclosed rainfall-extremity proxy for 2019-2024 (no free machine-
# readable ground truth exists for those years). See
# claude/bangladesh-flood-data-plan.md for the full build/validation story.
#
# Headline validated result: on 2018 held-out OBSERVED rows (real ground
# truth, not proxy), precision 0.12 / recall 0.83 / F1 0.21 / ROC-AUC 0.91.
# Low precision is expected and disclosed: floods are ~2-5% of district-days,
# and class_weight="balanced" deliberately trades some false alarms for
# catching more real floods — the right tradeoff for an early-warning tool.
#
# This is a SEPARATE, national-scale view alongside the Dhaka-specific grid
# above, not a replacement — Dhaka's model is city-block resolution;
# this one is district-level and country-wide. The raw per-day feature
# table (233,792 rows) and the trained model (.joblib) are intentionally
# not served here — nothing in the dashboard needs day-by-day granularity
# yet, and the model file isn't safe to expose over an API unauthenticated.
# ---------------------------------------------------------------------------

@app.get("/flood/national/severity")
def flood_national_severity():
    """All 64 districts: historical flood severity profile, combining DFO's
    event-severity rating and the Global Flood Database's flooded-area
    fraction into one 0-1 historical_magnitude score, plus a Low/Moderate/
    High/Severe tier. 63 of 64 districts have at least one recorded event;
    the one without gets the dataset median, not a fabricated zero."""
    return _load("flood_national_severity.json")


@app.get("/flood/national/priority")
def flood_national_priority():
    """All 64 districts ranked for flood-mitigation investment: a weighted
    composite of average predicted risk (50%), historical severity
    magnitude (30%), and real 2022 census population as the exposure term
    (20%) — each district's actual population, not the area_km2 stand-in
    the export used before real population data was added. area_km2 is
    still included per district for reference; it no longer feeds the
    score. See flood_national_summary.json's "population_data_source" for
    where the population figures came from."""
    return _load("flood_national_priority.json")


@app.get("/flood/national/summary")
def flood_national_summary():
    """Model provenance: row/district counts, date range, which years used
    real ground truth vs. a disclosed rainfall-extremity proxy, train/test
    split years, and the feature list. For the thesis methodology panel."""
    return _load("flood_national_summary.json")


@app.get("/flood/national/projection")
def flood_national_projection():
    """All 64 districts: a forward-looking 7-day flood-risk PROJECTION —
    the same frozen classifier /flood/national/priority's avg_predicted_risk
    uses, but scored day-by-day against Open-Meteo's real published forecast
    instead of a 90-day historical average. Answers "is this district's risk
    rising over the next week", not "what has it averaged recently". See
    this payload's own "methodology" field for the full disclosure,
    including how forecast uncertainty grows with lead time."""
    return _load("flood_risk_projection.json")


# ---------------------------------------------------------------------------
# Proactive alert subscriptions — turns the dashboard from "pull" (a citizen
# has to open the app to see their risk) into an actual early-warning
# system: a citizen subscribes an email + district + which hazards they
# care about, and scripts/send_alerts.py (run as part of the every-3-day
# automation, see .github/workflows/update-model-outputs.yml) emails them
# automatically when that district's LIVE flood risk newly crosses into
# high territory, or when a new national heatwave forecast is issued.
#
# Needs Supabase configured (same env vars as /auth/register — see
# ALERTS-SETUP.md for the one extra table) — until then this returns a
# clear 503, not a fake success, same as citizen reports above.
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
PHONE_RE = re.compile(r"^\+[1-9]\d{7,14}$")  # E.164: + then 8-15 digits total
ALLOWED_HAZARDS = {"flood", "heat"}


class AlertSubscribeRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    district: str = Field(min_length=1, max_length=64)
    hazards: list[str] = Field(min_length=1, max_length=2)
    lang: str = Field(default="en")
    # Optional WhatsApp channel (Twilio Sandbox — see ALERTS-SETUP.md Part 3
    # for why this is demo-only, not a production-grade channel yet). None
    # means email-only, unchanged from before this field existed.
    phone: Optional[str] = Field(default=None, max_length=20)

    @field_validator("email")
    @classmethod
    def _valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        # Deliberately a plain regex, not pydantic's EmailStr — that needs
        # the `email-validator` package, which isn't installed (see
        # requirements.txt's comment on keeping Vercel cold-start tiny).
        # This is a "does this look like an email" check, not a
        # deliverability guarantee — same honesty bar as everywhere else on
        # this platform: no email is ever actually verified/confirmed, and
        # subscribing is anonymous (no login), by design, same as citizen
        # reports above.
        if not EMAIL_RE.match(v):
            raise ValueError("doesn't look like a valid email address")
        return v

    @field_validator("hazards")
    @classmethod
    def _valid_hazards(cls, v: list[str]) -> list[str]:
        cleaned = sorted({h.strip().lower() for h in v})
        if not cleaned or any(h not in ALLOWED_HAZARDS for h in cleaned):
            raise ValueError(f"hazards must be a non-empty subset of {sorted(ALLOWED_HAZARDS)}")
        return cleaned

    @field_validator("lang")
    @classmethod
    def _valid_lang(cls, v: str) -> str:
        return v if v in ("en", "bn") else "en"

    @field_validator("phone")
    @classmethod
    def _valid_phone(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        v = v.strip().replace(" ", "")
        if not PHONE_RE.match(v):
            raise ValueError("phone must be in international format, e.g. +8801XXXXXXXXX")
        return v


@app.post("/alerts/subscribe")
def subscribe_to_alerts(request: AlertSubscribeRequest):
    """Subscribe (or update an existing subscription for the same
    email+district — re-submitting just changes which hazards you get,
    it never creates a duplicate)."""
    if not alert_subscriptions_db.is_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "Alerts aren't set up yet: SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY are not configured on this "
                "backend. See ALERTS-SETUP.md for setup steps."
            ),
        )
    try:
        sub = alert_subscriptions_db.create_or_update_subscription(
            email=request.email, district=request.district, hazards=request.hazards, lang=request.lang,
            phone=request.phone,
        )
    except alert_subscriptions_db.SupabaseError as e:
        raise HTTPException(status_code=503, detail=f"Couldn't save subscription: {e}")
    return {
        "subscribed": True,
        "email": sub["email"],
        "district": sub["district"],
        "hazards": sub["hazards"].split(","),
        "phone": sub.get("phone"),
    }


@app.get("/alerts/unsubscribe", response_class=HTMLResponse)
def unsubscribe_from_alerts(token: str):
    """One-click unsubscribe link target — this is what the URL in every
    alert email points to. Returns a small standalone HTML page (not JSON)
    since a real person clicks this straight from their email client, not
    the dashboard; the same friendly confirmation shows whether the token
    matched a live subscription or not (an already-unsubscribed link isn't
    an error from the citizen's point of view)."""
    if not alert_subscriptions_db.is_configured():
        body = "Alerts aren't set up on this backend yet, so there's nothing to unsubscribe from."
    else:
        try:
            alert_subscriptions_db.delete_by_token(token)
        except alert_subscriptions_db.SupabaseError:
            pass  # still show the same friendly confirmation — see docstring
        body = "You won't receive any more alerts for this subscription."
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>Unsubscribed</title></head>"
        "<body style='font-family: system-ui, sans-serif; background:#0c0a09; color:#e7e5e4; "
        "display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; padding:24px;'>"
        "<div style='max-width:420px; text-align:center;'>"
        "<p style='font-size:15px; line-height:1.6;'>" + body + "</p>"
        "</div></body></html>"
    )


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


# ---------------------------------------------------------------------------
# Public data export — for researchers/third parties who want the platform's
# current numbers outside the dashboard UI (open-data angle: this is public
# good infrastructure, not just a citizen-facing app). Deliberately NOT a new
# computation: it reshapes the exact same per-district files the dashboard
# itself already reads (flood_national_severity.json, heat_risk.json,
# deforestation_districts.json) into one combined row per district, joined
# on district name (verified to match exactly across all three files — same
# 64 districts, same spelling, no fuzzy matching needed).
#
# Honesty note carried into the export itself (see _export_metadata below):
# flood and heat are live, rescored every ~3 days by the automation; the
# deforestation numbers are from a one-time satellite analysis and are NOT
# yet refreshed automatically (refresh_status.json's own "deforestation":
# "skipped" already says this — the export's metadata just repeats it in a
# place a researcher pulling only /data/export would actually see it).
# ---------------------------------------------------------------------------

EXPORT_FIELDS = [
    "district", "population_2022",
    "flood_avg_predicted_risk", "flood_severity_tier", "flood_risk_trend",
    "heat_risk_score", "heat_risk_category", "heat_lst_c",
    "deforestation_forest_pct_now", "deforestation_forest_loss_pct",
    "deforestation_trend", "deforestation_risk_tier",
]


def _build_export_rows() -> list[dict]:
    flood_rows = {r["district_name"]: r for r in _load("flood_national_severity.json")}
    heat_rows = {w["name"]: w for w in _load("heat_risk.json").get("wards", [])}
    defor_rows = {r["district"]: r for r in _load("deforestation_districts.json")}

    districts = sorted(set(flood_rows) | set(heat_rows) | set(defor_rows))
    rows = []
    for d in districts:
        f, h, g = flood_rows.get(d, {}), heat_rows.get(d, {}), defor_rows.get(d, {})
        rows.append({
            "district": d,
            "population_2022": f.get("population_2022"),
            "flood_avg_predicted_risk": f.get("avg_predicted_risk"),
            "flood_severity_tier": f.get("severity_tier"),
            "flood_risk_trend": f.get("risk_trend"),
            "heat_risk_score": h.get("heat_risk"),
            "heat_risk_category": h.get("risk_category"),
            "heat_lst_c": h.get("lst_c"),
            "deforestation_forest_pct_now": g.get("forest_pct_now"),
            "deforestation_forest_loss_pct": g.get("forest_loss_pct"),
            "deforestation_trend": g.get("trend"),
            "deforestation_risk_tier": g.get("risk_tier"),
        })
    return rows


def _export_metadata() -> dict:
    try:
        refresh = _load("refresh_status.json")
    except HTTPException:
        refresh = {}
    return {
        "generated_at": refresh.get("last_run_at"),
        "field_notes": {
            "flood_avg_predicted_risk": "Live — rescored roughly every 3 days from real rainfall via a trained Random Forest classifier. 0-1 scale.",
            "flood_severity_tier": "Historical classification (DFO event severity + Global Flood Database flooded-area fraction). Does not change between automation runs.",
            "heat_risk_score": "Composite urban-heat-island + land-cover risk score, 0-1 scale, refreshed on the same ~3-day cadence as flood.",
            "deforestation_forest_pct_now": "From a one-time MODIS NDVI satellite analysis. NOT YET live-refreshed by the automation (see /model/refresh-status — deforestation is currently 'skipped') — treat as a snapshot, not a live feed.",
        },
        "license_note": "Produced by a BRAC University CSE400 thesis project (Group P2530998) for research/educational reuse. Provided as-is with no warranty on accuracy — verify independently before any operational use.",
    }


@app.get("/data/export")
def data_export():
    """Combined per-district snapshot across all three hazards, as JSON.
    Same underlying files the dashboard itself reads — nothing computed
    specially for this endpoint. See _export_metadata()'s field_notes for
    what's live vs. a one-time snapshot."""
    return {"metadata": _export_metadata(), "districts": _build_export_rows()}


@app.get("/data/export.csv")
def data_export_csv():
    """Same data as /data/export, as a downloadable CSV — for researchers
    who want to open it directly in a spreadsheet rather than parse JSON."""
    rows = _build_export_rows()
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=EXPORT_FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=env-platform-export.csv"},
    )
