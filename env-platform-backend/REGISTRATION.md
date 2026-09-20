# Officer registration — setup

The Government sign-in screen now has a "New officer? Register here" link.
This document is the one thing you need to do before it actually works.

## Why this needs a step from you

Your backend has no database (that was a deliberate choice — see README.md's
"No database" note). A real registration feature — "an officer registers
once, then can log in later, from any computer" — needs storage that
survives a server restart. Vercel's serverless functions can't do that on
their own (the deployed filesystem is read-only, and even temporary writes
don't survive between requests). The smallest real fix is a free hosted
database: [Supabase](https://supabase.com) (a hosted Postgres with a free
tier, no credit card required).

**Until you do the steps below, `/auth/register` returns a clear error
message explaining exactly what's missing — it does not pretend to work.**
The three original demo accounts (`env_project` / `city_admin` /
`field_officer`) keep working exactly as before regardless.

## Setup (about 10 minutes)

1. Go to [supabase.com](https://supabase.com), sign up (free), and create a
   new project. Pick any name/region; note the database password it asks
   you to set (you won't need it for this, but don't lose it).

2. Once the project is ready, open the **SQL Editor** (left sidebar) and run
   this to create the officers table:

   ```sql
   create table officers (
     id uuid primary key default gen_random_uuid(),
     officer_id text unique not null,
     name text not null,
     role text not null,
     password_hash text not null,
     password_salt text not null,
     created_at timestamptz not null default now()
   );

   -- The backend uses its own service-role key (see below), which bypasses
   -- Row Level Security entirely, so RLS can stay off for this table. If
   -- you'd rather turn it on for defense-in-depth, that's fine too — the
   -- service-role key is unaffected either way.
   ```

3. Go to **Project Settings → API**. You need two values from this page:
   - **Project URL** (looks like `https://xxxxxxxx.supabase.co`)
   - **service_role** secret key (under "Project API keys" — NOT the
     "anon"/"public" key; the service-role key must never be shown to the
     browser, which is exactly why it lives only in your backend's
     environment variables, never in the frontend code)

4. Go to your **backend's Vercel project** → Settings → Environment
   Variables, and add:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your Project URL from step 3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | your service_role key from step 3 |

   Then redeploy the backend (env var changes need a new deploy to take
   effect — push any commit, or use Vercel's "Redeploy" button).

5. Test it: open your deployed backend URL + `/auth/register` isn't a GET
   page (it's POST-only), so instead just try registering a new officer
   from the actual sign-in screen on your deployed frontend. If it works,
   you'll be logged straight into the government dashboard as that new
   officer. If something's wrong, the error message on screen will say
   exactly what — e.g. still "Registration isn't set up yet..." means the
   env vars didn't get picked up (check you redeployed after adding them).

## What's actually stored, and how safe it is

- Passwords are never stored in plain text. Each one is hashed with
  PBKDF2-HMAC-SHA256 (260,000 iterations, a random salt per user) — this is
  Python's standard-library `hashlib`, not a fake or reversible scheme, and
  meets a reasonable modern minimum. (A production system would typically
  use bcrypt or argon2 via a dedicated library; PBKDF2 via stdlib was
  chosen here specifically so no new dependency had to be added to
  `requirements.txt` — see `api/officers_db.py` for the full reasoning.)
- The `SUPABASE_SERVICE_ROLE_KEY` is a powerful secret — it can read/write
  the whole database, bypassing all access rules. It lives only in your
  backend's Vercel environment variables, never in frontend code, never
  committed to git. Don't paste it anywhere else.
- Registered officers get whatever role they picked in the dropdown
  (Environmental Analyst / City Administrator / Field Officer). That role
  is currently cosmetic only — the dashboard just displays it in the header
  text ("Government dashboard - {role}") — it doesn't gate which data or
  features they can see. If you want real role-based permissions later,
  that's a separate, bigger change to `GovtDashboard` — ask if you want it.
- There's no email verification, no "forgot password" flow, and no rate
  limiting on registration attempts. Fine for a thesis defense demo; a real
  deployment would want all three.

## What you don't need to change

- The frontend's demo-account login flow — unchanged, still works exactly
  as before.
- `requirements.txt` — unchanged. Talking to Supabase uses Python's
  built-in `urllib`, not a new package, so the backend's dependencies and
  cold-start time don't grow.
- Vercel configuration (`vercel.json`) — unchanged, no new routes or
  build steps needed.
