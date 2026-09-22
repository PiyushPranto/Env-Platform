# Citizen deforestation reports — setup

The Citizen dashboard's tree-cover card now has a small "Report tree-cutting
in your area" form. This document is the one thing you need to do before
submitted reports actually get saved anywhere.

## Why this needs a step from you

Same reason as officer registration (see REGISTRATION.md): Vercel's
serverless functions can't write files that survive between requests, so
this needs real storage. **If you already did the REGISTRATION.md setup for
officer registration, you're most of the way there already** — this reuses
the exact same Supabase project and the exact same `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` environment variables. You only need to add one
more table (step 1 below) — no new Supabase project, no new environment
variables, no redeploy needed beyond that.

If you haven't set up Supabase at all yet, do the REGISTRATION.md steps
first (steps 1, 3, 4 there cover creating the project and setting the two
environment variables), then come back here just for the table.

**Until the table exists, the report form shows a clear "reports aren't set
up yet" message — it does not pretend the report was saved.**

## Setup (about 2 minutes, once Supabase itself is set up)

1. In your Supabase project's **SQL Editor**, run:

   ```sql
   create table citizen_reports (
     id uuid primary key default gen_random_uuid(),
     district text not null,
     description text not null,
     contact text,
     created_at timestamptz not null default now()
   );

   -- Same reasoning as the officers table: the backend's service-role key
   -- bypasses Row Level Security entirely, so RLS can stay off here too.
   ```

2. That's it — no new environment variables. Redeploy the backend once
   (push any commit, or use Vercel's "Redeploy" button) so the new
   `citizen_reports_db.py` module is picked up.

3. Test it: submit a report from the Citizen dashboard's tree-cover card.
   If it works, you'll see a short confirmation. If Supabase isn't
   reachable or the table doesn't exist yet, the error message says exactly
   that.

## What this is for

Real satellite-based deforestation detection (the model behind
`/deforestation/*`) only sees loss that's large and persistent enough to
show up in a 250m MODIS pixel across multiple years. Small-scale local
tree-cutting — a few trees, a single plot — can go undetected by that model
for a long time. A citizen report is a genuinely different signal, not a
duplicate of what the satellite model already shows: it's a
crowd-sourced, real-time complement to a coarse, slow-moving dataset.

Reports are visible to the government dashboard via
`GET /deforestation/citizen-reports` (most recent first). There's no
automatic verification of report content — they're shown as citizen input,
not confirmed findings, same as any tip line.

## What's actually stored

- District, a free-text description, and an optional contact field (all
  optional except district/description — no login or account is required
  to submit a report, by design, so this stays a low-friction "I saw
  something" channel).
- No personal data is required. If a citizen chooses to leave contact info,
  that's stored as plain text (not sensitive/authentication data, unlike
  the officer passwords in the other table) — fine for a class project;
  a real deployment might want to encrypt or omit it entirely.
