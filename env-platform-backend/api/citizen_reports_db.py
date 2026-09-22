"""
Citizen deforestation report storage — same Supabase REST client pattern as
officers_db.py, reused for a second table.

WHY THIS EXISTS: satellite-based deforestation detection (the real model
behind /deforestation/*) only sees loss large and persistent enough to show
up in a 250m MODIS pixel over multiple years. Small, local illegal
tree-cutting can go unnoticed for a long time. A citizen "I saw this happen
here" report is a genuinely different, complementary signal — not something
the model can already tell you — which is why this exists as its own
feature rather than duplicating what /deforestation/districts already
shows.

STORAGE: this reuses the exact same SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
environment variables officers_db.py already uses (see REGISTRATION.md) —
if that's already set up, only ONE more SQL statement is needed here (see
CITIZEN-REPORTS-SETUP.md) to create the `citizen_reports` table; no new
environment variables, no new Supabase project. Until that table exists,
is_configured() still returns True (the credentials are set) but the
INSERT will fail with a clear SupabaseError naming the missing table —
api/index.py turns that into an honest 503, never a fake success.
"""

from __future__ import annotations

import os
import urllib.error
import urllib.request
import json
from typing import Optional, TypedDict

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

TABLE = "citizen_reports"


class ReportRow(TypedDict):
    id: str
    district: str
    description: str
    contact: Optional[str]
    created_at: str


class SupabaseError(Exception):
    """Same meaning as officers_db.SupabaseError: configured but the REST
    call itself failed (bad credentials, missing table, network error)."""


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _request(method: str, path: str, *, params: Optional[dict] = None, body=None, prefer: Optional[str] = None):
    if not is_configured():
        raise SupabaseError(
            "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set in this "
            "environment. Citizen reports cannot be stored until both are set "
            "(see CITIZEN-REPORTS-SETUP.md)."
        )

    url = f"{SUPABASE_URL}/rest/v1/{path}"
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items())
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


def create_report(district: str, description: str, contact: Optional[str] = None) -> ReportRow:
    body = {"district": district, "description": description, "contact": contact}
    rows = _request("POST", TABLE, body=body, prefer="return=representation")
    return rows[0]


def list_reports(limit: int = 200) -> list[ReportRow]:
    """Most recent first — used by the government dashboard's worklist."""
    return _request(
        "GET", TABLE,
        params={"select": "*", "order": "created_at.desc", "limit": str(limit)},
    ) or []
