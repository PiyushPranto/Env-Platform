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
     created_at timestamptz not null default now(),
     status text not null default 'pending',
     officer_note text,
     assigned_to text,
     updated_at timestamptz,
     updated_by text
   );

   -- Same reasoning as the officers table: the backend's service-role key
   -- bypasses Row Level Security entirely, so RLS can stay off here too.
   ```

   **Already created this table before the closed-loop verification feature
   existed?** Run this instead (adds the new columns to your existing table
   without losing any reports already in it):

   ```sql
   alter table citizen_reports add column if not exists status text not null default 'pending';
   alter table citizen_reports add column if not exists officer_note text;
   alter table citizen_reports add column if not exists assigned_to text;
   alter table citizen_reports add column if not exists updated_at timestamptz;
   alter table citizen_reports add column if not exists updated_by text;
   ```

2. That's it — no new environment variables. Redeploy the backend once
   (push any commit, or use Vercel's "Redeploy" button) so the new
   `citizen_reports_db.py` module is picked up.

3. Test it: submit a report from the Citizen dashboard's tree-cover card.
   If it works, you'll see a short confirmation. If Supabase isn't
   reachable or the table doesn't exist yet, the error message says exactly
   that.

## Closed-loop verification and task assignment (government side)

Reports no longer just sit in a read-only list. Each one has a `status`
(`pending` → `verified`/`rejected` → `resolved`) that an officer changes
from the government dashboard's citizen-reports worklist, optionally
leaving an `officer_note` and/or assigning it (`assigned_to`) to a specific
officer for follow-up — real task hand-off between officers, not just a
shared inbox. Every change records `updated_by` (the officer who made it)
and `updated_at`.

This is deliberately NOT protected by real session auth (this project's
whole login system is a simple officer_id+password check, no tokens/
sessions — see `LoginRequest` in `api/index.py`): the update endpoint
checks that `updated_by` is a real, known officer_id (demo account or
registered), which stops obviously-wrong values but isn't a security
boundary. Documented honestly as a thesis-scope limitation, not silently
pretended away.

## Closed-loop status check (citizen side)

A citizen can check what happened to their own report using the same
reference number (`#<id>`) they were shown right after submitting —
`GET /deforestation/citizen-reports/{id}`, no login needed, same
low-friction design as submitting the report itself.

## Community transparency feed

`GET /deforestation/community-stats` returns aggregated, anonymized counts
(total / pending / verified / resolved / rejected) per district and
nationwide — computed from the same rows above, nothing new tracked. The
citizen dashboard shows this per-district so anyone can see how much
reporting and government follow-up activity has happened in their own
area, without exposing any individual report's description or contact.

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
automatic verification of report content — a report starts as `pending`,
citizen input rather than a confirmed finding, until an officer actually
verifies it (see "Closed-loop verification" above).

## What's actually stored

- District, a free-text description, and an optional contact field (all
  optional except district/description — no login or account is required
  to submit a report, by design, so this stays a low-friction "I saw
  something" channel).
- A workflow state added on top of that: `status`, an optional
  `officer_note`, an optional `assigned_to` officer_id, and `updated_at`/
  `updated_by` recording the last officer action.
- No personal data is required. If a citizen chooses to leave contact info,
  that's stored as plain text (not sensitive/authentication data, unlike
  the officer passwords in the other table) — fine for a class project;
  a real deployment might want to encrypt or omit it entirely.
