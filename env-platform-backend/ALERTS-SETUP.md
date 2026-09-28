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

## Part 3 — WhatsApp, optional (Twilio Sandbox — demo, not production)

Citizens can also opt into getting the same alert on WhatsApp by adding a
phone number. **Read this whole section before setting it up** — it's built
on Twilio's free Sandbox, which has one real limitation worth knowing
upfront: it is genuinely useful for a live demo (e.g. your thesis defense),
but not reliable as an always-on channel the way email is. That's why it's
additive — a subscriber always keeps getting email regardless of whether
they also add WhatsApp.

**Why the limitation exists:** Twilio's Sandbox only lets you message a
phone number *after* that number has sent it a "join <code-words>" message
from WhatsApp — and that opt-in expires after a period of the recipient's
inactivity. Since this platform's alerts fire automatically every 3 days,
if a subscriber's sandbox session has lapsed by the time an alert fires,
their WhatsApp message will fail quietly (logged in the Actions run, never
breaks the automation) while their email still arrives. A paid Twilio
WhatsApp Business sender removes this limitation entirely, but costs money
and requires Meta's business approval — out of scope here; this is an
honest, disclosed limitation, not a bug.

**Setup:**

1. Create a free account at [twilio.com/try-twilio](https://www.twilio.com/try-twilio).
2. In the Twilio Console, go to **Messaging → Try it out → Send a WhatsApp message**.
   This shows you a Sandbox phone number (usually `+1 415 523 8886`) and a
   unique join code like `join happy-tiger`. Anyone who wants WhatsApp
   alerts must send that exact phrase to that number from their own
   WhatsApp first (once — it's how Twilio's Sandbox knows it's allowed to
   message them back).
3. From the Console's main dashboard, copy your **Account SID** and
   **Auth Token**.
4. Add 3 more GitHub Actions secrets (same page as Part 2's table):

   | Secret | Example | Notes |
   |---|---|---|
   | `TWILIO_ACCOUNT_SID` | `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` | |
   | `TWILIO_AUTH_TOKEN` | (from the Console dashboard) | |
   | `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` | Keep the `whatsapp:` prefix; only change the number if you upgrade past the Sandbox |

5. In `src/environmental-risk-platform.jsx`, find `WHATSAPP_SANDBOX_NUMBER`
   and `WHATSAPP_SANDBOX_JOIN_CODE` near the top of the file and replace
   them with your actual Sandbox number and join phrase from step 2 — this
   is only used to show the citizen the right instructions in the
   dashboard's "Also get this on WhatsApp (demo)" section, it isn't a
   credential.
6. In Supabase's SQL Editor, add the one new column this needs:

   ```sql
   alter table alert_subscriptions add column phone text;
   ```

**Demoing it live:** right before you trigger a run (or shortly before the
scheduled one fires), send the join message again from your phone to
refresh the session, then subscribe with that phone number on the
dashboard. That guarantees the Sandbox session is active when the alert
actually sends.

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

- Email, district, which hazard(s) they picked, a language preference, and
  (only if they opted into WhatsApp) a phone number — no login, no
  verification step (same low-friction, anonymous design as the citizen
  report feature). Phone is entirely optional; email-only subscriptions
  store `phone` as null.
- A random, unguessable `unsubscribe_token` is generated per subscription
  and included in every email's one-click unsubscribe link
  (`GET /alerts/unsubscribe?token=...`) — no login needed to unsubscribe
  either.
- Resubscribing with the same email + district updates the existing row
  in place (hazards/language only) rather than creating a duplicate, and
  keeps the same unsubscribe token so a previously-emailed unsubscribe
  link never breaks.
