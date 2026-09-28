# Proactive alerts — setup

The Citizen dashboard's hub now has a "Get alerted automatically" card. This
is the one thing that turns the platform from a dashboard you have to check
into an actual early-warning system: a citizen subscribes an email to their
district, and gets emailed automatically the moment that district's live
flood risk crosses into dangerous territory — or when a new national
heatwave forecast is issued — without opening the app.

This document is everything you need to do to make it actually send email.
**Two separate things need setting up: where subscriptions are stored
(Supabase — same as officer registration and citizen reports), and how
emails actually get sent (any SMTP account).**

## Part 1 — storage (Supabase)

**If you already did the REGISTRATION.md setup, you're most of the way
there** — this reuses the exact same Supabase project and the exact same
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` environment variables already
set on the Vercel backend. You only need to add one more table.

1. In your Supabase project's **SQL Editor**, run:

   ```sql
   create table alert_subscriptions (
     id uuid primary key default gen_random_uuid(),
     email text not null,
     district text not null,
     hazards text not null default 'flood',
     lang text not null default 'en',
     unsubscribe_token text not null,
     created_at timestamptz not null default now()
   );

   -- Same reasoning as the other two tables: the backend's service-role
   -- key bypasses Row Level Security entirely, so RLS can stay off here
   -- too.
   ```

2. That's it for Vercel — no new environment variables needed there. Push
   any commit (or use Vercel's "Redeploy" button) so `alert_subscriptions_db.py`
   is picked up. Test it: subscribe from the Citizen dashboard hub. If it
   works you'll see a confirmation; if Supabase isn't reachable or the
   table doesn't exist yet, the message says exactly that.

## Part 2 — actually sending email (GitHub Actions secrets)

Subscriptions being stored isn't enough by itself — something has to
actually check them and send mail. That's `scripts/send_alerts.py`, run as
a new step in `.github/workflows/update-model-outputs.yml`, in the same
every-3-day run that already refreshes the model data. It needs its own
copies of the Supabase credentials (GitHub Actions is a separate
environment from Vercel — they don't share env vars) plus SMTP credentials
for sending.

In your GitHub repo, go to **Settings → Secrets and variables → Actions**
and add:

| Secret | Example | Notes |
|---|---|---|
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Same value as the Vercel env var |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Same value as the Vercel env var |
| `SMTP_HOST` | `smtp.gmail.com` | Any real SMTP provider works |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | `yourproject@gmail.com` | |
| `SMTP_PASSWORD` | (an App Password, not your real password) | Gmail: Google Account → Security → 2-Step Verification → App passwords |
| `ALERT_FROM_EMAIL` | `yourproject@gmail.com` | Optional — defaults to `SMTP_USER` |
| `ALERT_FROM_NAME` | `Environmental Risk Platform` | Optional |

**Until these secrets are set, the automation step runs and exits quietly
(logs "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set") — it never fails
the workflow.** Once Supabase secrets are set but SMTP isn't, every alert
that would have been sent is printed in the Actions run log instead (a
dry run) — you can verify the trigger logic is working before wiring up
real email.

A free Gmail account comfortably handles this project's scale (Gmail's own
daily send cap is far above what 64 districts' worth of subscribers would
ever trigger in a single 3-day run).

## What actually triggers an email

- **Flood**: a subscribed district's live `avg_predicted_risk` (rescored
  every run from real rainfall) rises to ≥50% when it was below 50% the
  previous run. Deliberately NOT based on the historical severity tier
  (Low/Moderate/High/Severe) — that's a fixed historical classification
  that never changes run to run, so using it would mean either alerting
  the same people every 3 days forever, or never re-alerting at all. A
  district that stays above 50% for many consecutive runs is intentionally
  only alerted once, at the crossing — not spammed every cycle.
- **Heatwave**: a national notice (not per-district) whenever a *new*
  7-day forecast run actually contains at least one hotspot alert. This is
  national rather than per-district because the heat model's monitored
  "sites" are named by DBSCAN hotspot cluster id, not mapped back to
  official district names (see `scripts/models/heat_export.py`'s own
  module docstring) — there's no honest way to say "your district
  specifically" from that data.

See `scripts/send_alerts.py`'s own docstring for the full reasoning and
exact thresholds.

## What's actually stored / privacy

- Email, district, which hazard(s) they picked, and a language preference
  — no login, no verification step (same low-friction, anonymous design as
  the citizen report feature). No personal data beyond the email address
  is required.
- A random, unguessable `unsubscribe_token` is generated per subscription
  and included in every email's one-click unsubscribe link
  (`GET /alerts/unsubscribe?token=...`) — no login needed to unsubscribe
  either.
- Resubscribing with the same email + district updates the existing row
  in place (hazards/language only) rather than creating a duplicate, and
  keeps the same unsubscribe token so a previously-emailed unsubscribe
  link never breaks.
