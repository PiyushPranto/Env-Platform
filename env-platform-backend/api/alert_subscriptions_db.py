"""
Proactive alert subscriptions — same Supabase REST client pattern as
officers_db.py / citizen_reports_db.py, reused for a third table.

WHY THIS EXISTS: every other feature on this platform is "pull" — a
citizen has to open the dashboard to see their risk. That's a real gap for
an "early-warning system" (the project's own stated purpose): the whole
point of an early warning is that it reaches you, not that you go looking
for it. This lets a citizen subscribe an email address to a district and
get notified automatically when that district's live risk actually crosses
into dangerous territory, via the same every-3-day automation that already
refreshes the model outputs (see scripts/send_alerts.py).

STORAGE: reuses the exact same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
environment variables officers_db.py and citizen_reports_db.py already use
(see REGISTRATION.md) — if either of those is already set up, only ONE more
SQL statement is needed here (see ALERTS-SETUP.md) to create the
`alert_subscriptions` table; no new environment variables, no new Supabase
project. Until that table exists, is_configured() still returns True (the
credentials are set) but the request will fail with a clear SupabaseError
naming the missing table — api/index.py turns that into an honest 503,
never a fake success.

`hazards` is stored as a plain comma-joined string (e.g. "flood,heat")
rather than a Postgres array — avoids fighting PostgREST's array-literal
encoding over a plain REST call for what's only ever 1-2 values.
"""

from __future__ import annotations

import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
import json
from typing import Optional, TypedDict

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

TABLE = "alert_subscriptions"


class SubscriptionRow(TypedDict):
    id: str
    email: str
    district: str
    hazards: str
    lang: str
    unsubscribe_token: str
    created_at: str
    phone: Optional[str]


class SupabaseError(Exception):
    """Same meaning as officers_db.SupabaseError: configured but the REST
    call itself failed (bad credentials, missing table, network error)."""


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _request(method: str, path: str, *, params: Optional[dict] = None, body=None, prefer: Optional[str] = None):
    if not is_configured():
        raise SupabaseError(
            "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set in this "
            "environment. Alert subscriptions cannot be stored until both are "
            "set (see ALERTS-SETUP.md)."
        )

    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        # Encode each value (not the "eq."/"like." operator prefix's letters,
        # which are unreserved and pass through quote() unchanged) — emails
        # routinely contain "+"/"@" that would otherwise corrupt the query
        # string (unlike district names, which are always plain ASCII words).
        query = "&".join(f"{k}={urllib.parse.quote(str(v), safe='.')}" for k, v in params.items())
        url = f"{url}?{query}"

    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer

    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise SupabaseError(f"Supabase REST API returned {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise SupabaseError(f"Could not reach Supabase ({SUPABASE_URL}): {e.reason}") from e


def get_by_email_district(email: str, district: str) -> Optional[SubscriptionRow]:
    rows = _request(
        "GET", TABLE,
        params={"select": "*", "email": f"eq.{email}", "district": f"eq.{district}", "limit": "1"},
    ) or []
    return rows[0] if rows else None


def create_or_update_subscription(
    email: str, district: str, hazards: list[str], lang: str, phone: Optional[str] = None,
) -> SubscriptionRow:
    """Idempotent resubscribe: if this email already subscribed to this
    district, update its hazards/lang/phone in place (keeping the SAME
    unsubscribe_token, so any link already emailed to them keeps working)
    rather than creating a duplicate row.

    `phone` is optional (E.164 format, e.g. "+8801XXXXXXXXX") — set only if
    the citizen also opted into the WhatsApp channel (see
    scripts/send_alerts.py's Twilio Sandbox section). None/omitted means
    email-only, same as before this field existed."""
    hazards_str = ",".join(sorted(set(hazards)))
    existing = get_by_email_district(email, district)
    if existing:
        rows = _request(
            "PATCH", TABLE,
            params={"id": f"eq.{existing['id']}"},
            body={"hazards": hazards_str, "lang": lang, "phone": phone},
            prefer="return=representation",
        )
        return rows[0]
    body = {
        "email": email,
        "district": district,
        "hazards": hazards_str,
        "lang": lang,
        "phone": phone,
        "unsubscribe_token": secrets.token_urlsafe(24),
    }
    rows = _request("POST", TABLE, body=body, prefer="return=representation")
    return rows[0]


def list_all(limit: int = 5000) -> list[SubscriptionRow]:
    """Every subscription — used by scripts/send_alerts.py to decide who to
    notify. Not exposed over the public API (no endpoint reads this)."""
    return _request("GET", TABLE, params={"select": "*", "limit": str(limit)}) or []


def delete_by_token(token: str) -> bool:
    """One-click unsubscribe target. Returns True if a row was actually
    deleted, False if the token didn't match anything (already unsubscribed,
    or a malformed link) — api/index.py shows the same friendly confirmation
    either way, since from the citizen's point of view both mean "you're not
    getting alerts", which is what they wanted."""
    existing = _request(
        "GET", TABLE, params={"select": "id", "unsubscribe_token": f"eq.{token}", "limit": "1"},
    ) or []
    if not existing:
        return False
    _request("DELETE", TABLE, params={"unsubscribe_token": f"eq.{token}"})
    return True
