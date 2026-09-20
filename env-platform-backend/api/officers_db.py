"""
Officer registration storage — a thin, dependency-free client for Supabase's
auto-generated REST API (PostgREST), used by /auth/register and /auth/login
in api/index.py.

WHY THIS EXISTS: the backend has no database and (per README.md) that was a
deliberate choice to avoid standing up Supabase before the defense — but a
real "an officer registers, then can log in later, from any computer" flow
needs storage that actually survives a Vercel serverless cold start, which
an in-process dict or a file write inside the function does not (Vercel's
deployed filesystem is read-only in production, and even /tmp is only alive
for a single, short-lived instance). Supabase's free tier is the smallest
real fix: a hosted Postgres table reachable over plain HTTPS.

DEPENDENCY-FREE ON PURPOSE: this uses Python's stdlib `urllib.request`
instead of the `supabase` PyPI package or `requests`/`httpx`, so nothing new
needs to be added to requirements.txt — the Vercel function stays exactly as
small/fast-to-cold-start as it was.

SETUP REQUIRED (see REGISTRATION.md for the full walkthrough): this module
does nothing until two environment variables are set on the Vercel project:
    SUPABASE_URL               e.g. https://xxxxx.supabase.co
    SUPABASE_SERVICE_ROLE_KEY  the "service_role" secret key (server-side
                                only — never expose this to the frontend)
and the `officers` table has been created (exact SQL is in REGISTRATION.md).
Until both are set, is_configured() returns False and api/index.py returns a
clear 503 explaining exactly what's missing — it does NOT silently pretend
registration works.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import urllib.error
import urllib.request
from typing import Optional, TypedDict

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

TABLE = "officers"
PBKDF2_ITERATIONS = 260_000  # OWASP's 2023 minimum recommendation for PBKDF2-HMAC-SHA256


class OfficerRow(TypedDict):
    officer_id: str
    name: str
    role: str
    password_hash: str
    password_salt: str


class SupabaseError(Exception):
    """Raised when Supabase is configured but the REST call itself fails
    (bad credentials, table missing, network error, etc.) — distinct from
    "not configured at all", so api/index.py can tell the two apart and
    report the real reason instead of a generic failure."""


def is_configured() -> bool:
    return bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)


def _request(method: str, path: str, *, params: Optional[dict] = None, body: Optional[dict] = None,
             prefer: Optional[str] = None):
    if not is_configured():
        raise SupabaseError(
            "SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are not set in this "
            "environment. Registration cannot work until both are set as "
            "environment variables on the Vercel project (see REGISTRATION.md)."
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


def hash_password(password: str) -> tuple[str, str]:
    """Returns (salt_hex, hash_hex). PBKDF2-HMAC-SHA256 — stdlib-only, no new
    dependency (a real production system would use bcrypt/argon2 via a
    dedicated library; this is a reasonable, honestly-documented middle
    ground for a class project that still never stores plaintext passwords)."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex(), digest.hex()


def verify_password(password: str, salt_hex: str, expected_hash_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return hmac.compare_digest(digest.hex(), expected_hash_hex)


def get_officer(officer_id: str) -> Optional[OfficerRow]:
    """Returns the officer row, or None if no such officer_id is registered."""
    rows = _request("GET", TABLE, params={"officer_id": f"eq.{officer_id}", "select": "*"})
    return rows[0] if rows else None


def create_officer(officer_id: str, name: str, role: str, password: str) -> OfficerRow:
    """Raises SupabaseError (including on a duplicate officer_id, which
    Postgres rejects via the table's UNIQUE constraint — see REGISTRATION.md)
    if the insert fails."""
    salt_hex, hash_hex = hash_password(password)
    body = {
        "officer_id": officer_id,
        "name": name,
        "role": role,
        "password_hash": hash_hex,
        "password_salt": salt_hex,
    }
    rows = _request("POST", TABLE, body=body, prefer="return=representation")
    return rows[0]
