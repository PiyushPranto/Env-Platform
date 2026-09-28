#!/usr/bin/env python3
"""
Sends proactive email alerts to citizens who subscribed for their district,
turning the dashboard from "pull" (open the app to check) into an actual
early-warning system.

Run as a step in .github/workflows/update-model-outputs.yml, right AFTER
scripts/update_model_outputs.py has refreshed api/data/*.json (still in the
working tree, not yet committed) — this script reads those files directly,
so it always alerts on the exact same numbers the dashboard is about to
show, and any api/data/alert_state.json it writes rides along in the same
commit as the model-output update.

FLOOD — why avg_predicted_risk is the trigger, not severity_tier:
severity_tier (Low/Moderate/High/Severe) is a HISTORICAL classification
(DFO event severity + Global Flood Database flooded-area fraction) — it
does not change between automation runs, because the historical record it's
built from doesn't change. Using it as an alert trigger would mean either
re-sending the exact same alert to the same people every 3 days forever
(a district that's historically Severe stays Severe), or only ever alerting
once at subscribe time. avg_predicted_risk is the genuinely LIVE number,
rescored every run from real rainfall — and flood_national_severity.json
already carries this run's avg_predicted_risk next to the PREVIOUS run's
value (previous_avg_predicted_risk, written by flood_export.py), so a
rising-edge check (now >= threshold, previous < threshold) is a real
"your risk just crossed into dangerous territory" signal, not a fabricated
one. A district that stays above the threshold for many consecutive runs
is intentionally NOT re-alerted every time — only the crossing itself.

HEAT — why this is a national notice, not per-district:
heat_alerts.json's monitored "sites" are named by DBSCAN hotspot cluster id
(e.g. "Hotspot 3"), not mapped back to district names — see
scripts/models/heat_export.py's own module docstring for exactly why
(mapping a cluster centroid to a district would need a spatial join this
pipeline doesn't do). There is no honest way to tell a specific district's
subscriber "your district is under a heatwave watch" from this data. So a
citizen who opts into heat alerts instead gets a national notice whenever a
NEW heat_alerts.json run (a new generated_at) actually contains at least
one alert — naming which hotspot regions and peak temperatures the 7-day
forecast covers. This is a disclosed scope limitation, not a bug.

CONFIGURATION (all via environment variables / GitHub Actions secrets —
see ALERTS-SETUP.md):
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  - same table subscribers sign
                                                up through (api/alert_subscriptions_db.py)
    SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD - any real SMTP account
                                                       (a Gmail App Password
                                                       works for this scale)
    ALERT_FROM_EMAIL   - defaults to SMTP_USER
    ALERT_FROM_NAME    - defaults to "Environmental Risk Platform"
    PUBLIC_API_BASE_URL - defaults to the deployed backend URL, used only
                          to build each email's unsubscribe link

If Supabase isn't configured, or there are zero subscriptions, this exits
quietly (0) — a feature nobody has set up or used yet is not an error. If
SMTP isn't configured, every alert that WOULD have been sent is printed
instead (dry run) rather than failing the whole automation job — same
non-strict philosophy as update_model_outputs.py: one broken piece here
must never block the model-output commit this runs alongside.
"""

from __future__ import annotations

import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from email.message import EmailMessage
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "api" / "data"
STATE_PATH = DATA_DIR / "alert_state.json"
STATUS_PATH = DATA_DIR / "alerts_status.json"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT") or "587")
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
ALERT_FROM_EMAIL = os.environ.get("ALERT_FROM_EMAIL") or SMTP_USER
ALERT_FROM_NAME = os.environ.get("ALERT_FROM_NAME") or "Environmental Risk Platform"
PUBLIC_API_BASE_URL = (os.environ.get("PUBLIC_API_BASE_URL") or "https://env-platform-u7jb.vercel.app").rstrip("/")

FLOOD_ALERT_THRESHOLD = 0.5  # avg_predicted_risk (0-1) that counts as "high enough to warn about"


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ---------------------------------------------------------------------------
# Minimal, read-only Supabase REST client — deliberately NOT importing
# api/alert_subscriptions_db.py. This automation script (scripts/) and the
# Vercel API (api/) are kept without cross-imports throughout this repo
# (see scripts/requirements-automation.txt's own comment on why) so each
# stays independently deployable; duplicating ~15 lines of GET logic here
# is cheaper than coupling the two environments together.
# ---------------------------------------------------------------------------

def _supabase_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _supabase_get(table: str, params: dict) -> list[dict]:
    query = "&".join(f"{k}={urllib.parse.quote(str(v), safe='.')}" for k, v in params.items())
    url = f"{SUPABASE_URL}/rest/v1/{table}?{query}"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else []


def _load_json(name: str):
    path = DATA_DIR / name
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except json.JSONDecodeError:
            pass
    return {"heat_last_alerted_generated_at": None}


def _save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")


def _smtp_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and ALERT_FROM_EMAIL)


def _send_email(to_email: str, subject: str, body: str) -> bool:
    """Returns True if actually sent, False if only dry-run-logged. Never
    raises — a single bad recipient/SMTP hiccup must not stop the rest of
    the run or fail the automation job."""
    if not _smtp_configured():
        print(f"  [dry-run, SMTP not configured] would email {to_email}: {subject}")
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{ALERT_FROM_NAME} <{ALERT_FROM_EMAIL}>"
    msg["To"] = to_email
    msg.set_content(body)
    try:
        context = ssl.create_default_context()
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.starttls(context=context)
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(msg)
        print(f"  sent to {to_email}: {subject}")
        return True
    except Exception as e:  # noqa: BLE001 — one bad send must never crash the run
        print(f"  FAILED to email {to_email}: {e}")
        return False


def _unsubscribe_link(token: str) -> str:
    return f"{PUBLIC_API_BASE_URL}/alerts/unsubscribe?token={urllib.parse.quote(token)}"


def _flood_body(district: str, risk_pct: float, previous_pct: float | None, lang: str) -> str:
    if lang == "bn":
        lines = [
            f"{district} জেলায় বন্যার ঝুঁকি বেড়ে {risk_pct:.0f}% হয়েছে",
            "(সাম্প্রতিক প্রকৃত বৃষ্টিপাতের ভিত্তিতে, প্রতি ৩ দিনে পুনর্গণনা করা হয়)।",
        ]
        if previous_pct is not None:
            lines.append(f"আগের হিসাবে ছিল {previous_pct:.0f}%।")
        lines += [
            "",
            "জরুরি নম্বর: ৯৯৯ / ৩৩৩ / ১৬১২৩",
            "",
            "বিস্তারিত ও নিরাপত্তা পরামর্শের জন্য ড্যাশবোর্ড দেখুন।",
        ]
        return "\n".join(lines)
    lines = [
        f"Flood risk for {district} has risen to {risk_pct:.0f}%",
        "(rescored every 3 days from real rainfall).",
    ]
    if previous_pct is not None:
        lines.append(f"It was {previous_pct:.0f}% at the last check.")
    lines += [
        "",
        "Emergency numbers: 999 / 333 / 16123",
        "",
        "See the dashboard for safety steps and details.",
    ]
    return "\n".join(lines)


def _heat_body(alerts: list[dict], forecast_days: int, lang: str) -> str:
    names = ", ".join(f"{a.get('name', '?')} (peak {a.get('peak_tmax_c', '?')}°C)" for a in alerts[:8])
    if lang == "bn":
        return (
            f"আগামী {forecast_days} দিনে তাপপ্রবাহের পূর্বাভাস রয়েছে এই এলাকাগুলোতে: {names}।\n\n"
            "এটি একটি জাতীয় সতর্কতা, নির্দিষ্ট জেলার জন্য নয় — বিস্তারিত ড্যাশবোর্ডে দেখুন।"
        )
    return (
        f"A heatwave is forecast over the next {forecast_days} days at: {names}.\n\n"
        "This is a national watch, not specific to your district — see the dashboard for details."
    )


def build_flood_alerts(severity_rows: list[dict], subscriptions: list[dict]) -> list[tuple[dict, dict]]:
    """Returns [(subscription, district_row), ...] for every subscriber
    whose district's avg_predicted_risk just crossed FLOOD_ALERT_THRESHOLD
    (rising edge only — see module docstring)."""
    crossed_districts = {}
    for row in severity_rows:
        risk = row.get("avg_predicted_risk")
        prev = row.get("previous_avg_predicted_risk")
        if not isinstance(risk, (int, float)):
            continue
        just_crossed = risk >= FLOOD_ALERT_THRESHOLD and (prev is None or prev < FLOOD_ALERT_THRESHOLD)
        if just_crossed:
            crossed_districts[row["district_name"]] = row

    if not crossed_districts:
        return []

    pairs = []
    for sub in subscriptions:
        hazards = (sub.get("hazards") or "").split(",")
        if "flood" not in hazards:
            continue
        row = crossed_districts.get(sub.get("district"))
        if row:
            pairs.append((sub, row))
    return pairs


def build_heat_recipients(heat_alerts_payload: dict, subscriptions: list[dict], state: dict) -> list[dict]:
    generated_at = heat_alerts_payload.get("generated_at")
    alerts = heat_alerts_payload.get("alerts") or []
    if not generated_at or not alerts:
        return []
    if generated_at == state.get("heat_last_alerted_generated_at"):
        return []  # already notified for this exact forecast run
    return [sub for sub in subscriptions if "heat" in (sub.get("hazards") or "").split(",")]


def main() -> int:
    status = {
        "ran_at": _now_iso(),
        "supabase_configured": _supabase_configured(),
        "smtp_configured": _smtp_configured(),
        "subscriptions_checked": 0,
        "flood_emails_sent": 0,
        "heat_emails_sent": 0,
        "note": None,
    }

    if not _supabase_configured():
        status["note"] = "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set — alerts feature not in use yet."
        print(status["note"])
        STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")
        return 0

    try:
        subscriptions = _supabase_get("alert_subscriptions", {"select": "*", "limit": "5000"})
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        status["note"] = f"Could not reach Supabase: {e}"
        print(status["note"])
        STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")
        return 0

    status["subscriptions_checked"] = len(subscriptions)
    if not subscriptions:
        status["note"] = "No alert subscriptions yet."
        print(status["note"])
        STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")
        return 0

    state = _load_state()

    # --- Flood: rising-edge, per-district ---
    severity_rows = _load_json("flood_national_severity.json") or []
    flood_pairs = build_flood_alerts(severity_rows, subscriptions)
    print(f"Flood: {len(flood_pairs)} subscriber(s) to alert (districts newly >= {FLOOD_ALERT_THRESHOLD:.0%}).")
    for sub, row in flood_pairs:
        lang = sub.get("lang") or "en"
        risk_pct = row["avg_predicted_risk"] * 100
        prev = row.get("previous_avg_predicted_risk")
        prev_pct = prev * 100 if isinstance(prev, (int, float)) else None
        subject = (
            f"বন্যার সতর্কতা: {row['district_name']}" if lang == "bn" else f"Flood alert: {row['district_name']}"
        )
        body = _flood_body(row["district_name"], risk_pct, prev_pct, lang)
        body += "\n\n" + ("সাবস্ক্রিপশন বাতিল: " if lang == "bn" else "Unsubscribe: ") + _unsubscribe_link(sub["unsubscribe_token"])
        if _send_email(sub["email"], subject, body):
            status["flood_emails_sent"] += 1

    # --- Heat: national notice, once per new forecast run ---
    heat_payload = _load_json("heat_alerts.json") or {}
    heat_recipients = build_heat_recipients(heat_payload, subscriptions, state)
    print(f"Heat: {len(heat_recipients)} subscriber(s) to alert (new forecast run with active alerts).")
    for sub in heat_recipients:
        lang = sub.get("lang") or "en"
        subject = "তাপপ্রবাহ সতর্কতা" if lang == "bn" else "Heatwave watch"
        body = _heat_body(heat_payload["alerts"], heat_payload.get("forecast_days", 7), lang)
        body += "\n\n" + ("সাবস্ক্রিপশন বাতিল: " if lang == "bn" else "Unsubscribe: ") + _unsubscribe_link(sub["unsubscribe_token"])
        if _send_email(sub["email"], subject, body):
            status["heat_emails_sent"] += 1
    if heat_recipients and heat_payload.get("generated_at"):
        state["heat_last_alerted_generated_at"] = heat_payload["generated_at"]
        _save_state(state)

    if not _smtp_configured():
        status["note"] = "SMTP not configured — alerts above were dry-run only (logged, not sent)."

    STATUS_PATH.write_text(json.dumps(status, indent=2) + "\n")
    print(json.dumps(status, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
