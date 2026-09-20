# Environmental Risk Platform — Backend API

FastAPI backend for the Chattogram/Bangladesh Environmental Risk Platform
(Heat, Flood, Deforestation). Built so the frontend (`environmental-risk-platform.jsx`)
and the team's teammates can start integrating against a real HTTP API today,
even though not every model has finished training.

The frontend now fetches from this API on load (`useLiveData()` in
`App.jsx`), with an automatic fallback to its own hardcoded demo values if
the API is unset, unreachable, or returns an error — the dashboard never
breaks, it just quietly shows demo data with a small "Demo data" badge
instead of "Live data" in the top bar.

## Run it locally

```bash
pip install -r requirements.txt
uvicorn api.index:app --reload
```

Then open `http://127.0.0.1:8000/docs` for the auto-generated test UI, or
`http://127.0.0.1:8000/heat/risk` etc. directly. All endpoints tested and
return valid JSON with a 200 status.

For the frontend to see it locally, create `.env.local` next to `App.jsx` in
the frontend repo with:

```
VITE_API_BASE_URL=http://localhost:8000
```

Then `npm run dev` as usual — the top bar should say "Live data" once both
are running.

## Deploy to Vercel

This repo is already structured for Vercel's Python runtime (it auto-detects
the FastAPI `app` object in `api/index.py` and the `vercel.json` rewrite
routes every path to it):

1. Push this folder to a GitHub repo (either its own repo, or as a `backend/`
   subfolder of an existing one — if it's a subfolder, set Vercel's
   **Root Directory** to that subfolder when importing the project).
2. In Vercel: **Add New Project** → import the repo → deploy. No environment
   variables or build command needed.
3. You'll get a URL like `https://your-backend.vercel.app`. Test it:
   `https://your-backend.vercel.app/heat/risk`.
4. In your **frontend's** Vercel project → Settings → Environment Variables,
   add `VITE_API_BASE_URL` = `https://your-backend.vercel.app` (no trailing
   slash), then redeploy the frontend (env var changes need a new deploy to
   take effect — push any commit, or use Vercel's "Redeploy" button).
5. In `api/index.py`, tighten `allow_origins=["*"]` to the frontend's exact
   URL once both are deployed — `*` is fine for getting things working, not
   for the final defense build.

The frontend and this API live on **two separate Vercel projects** — that's
normal and doesn't need any special configuration beyond CORS and the env
var above.

## Officer registration

The government sign-in screen has a "New officer? Register here" link
(`POST /auth/register`, alongside the existing `POST /auth/login`). It needs
a one-time, ~10-minute setup (a free Supabase database — this backend has no
database otherwise) before it actually works — see
**[REGISTRATION.md](./REGISTRATION.md)** for the exact steps. Until that
setup is done, registering returns a clear error instead of silently
failing; the three original demo accounts are unaffected either way.

## Automated model-output updates

`api/data/*` can now be refreshed automatically every 3 days by a GitHub
Actions workflow instead of by hand — see **[AUTOMATION.md](./AUTOMATION.md)**
for the full picture, including exactly which models are wired up for real
vs. still need real model code plugged in. Short version: nothing above
changes (same endpoints, same files, same deploy process); a new endpoint,
`GET /model/refresh-status`, reports when each model last updated
successfully and whether any run is currently failing.

## Endpoint -> file -> real source map

| Endpoint | File (`api/data/`) | Status | Real source to eventually swap in |
|---|---|---|---|
| `GET /heat/risk` | `heat_risk.json` | Placeholder | Heat model (not trained yet) — per-ward/district `heat_risk` composite score |
| `GET /heat/hotspots` | `heat_hotspots.geojson` | Placeholder | Heat model — DBSCAN/KMeans clusters (not yet used by the frontend) |
| `GET /heat/trend` | `heat_trend.json` | Placeholder | Heat model — monthly trend |
| `GET /heat/grid` | `heat_grid.json` | Placeholder | Heat model's LST raster, downsampled to the 7x9 grid the frontend renders |
| `GET /flood/risk` | `flood_grid.json` | **Real** | Copied from the frontend's hardcoded `FLOOD_RISK_GRID` (block-averaged from the real 1,650-cell Dhaka grid) |
| `GET /flood/trend` | `flood_trend.json` | **Real** | Copied from the frontend's hardcoded `FLOOD_TREND` (62-day series) |
| `GET /flood/top-risk-areas` | `flood_top_risk_areas.json` | **Real** | Copied from the frontend's hardcoded `FLOOD_TOP_AREAS` |
| `GET /flood/summary` | `flood_summary.json` | **Real** | Copied from the frontend's hardcoded `FLOOD_SUMMARY`, matches `dhaka-flood-model-summary.md` |
| `GET /deforestation/detect` | `deforestation_detect.geojson` | Placeholder | Not wired into the frontend yet (module still locked) |
| `GET /deforestation/districts` | `deforestation_districts.geojson` | Placeholder | Not wired into the frontend yet |
| `GET /deforestation/ndvi` | `deforestation_ndvi_summary.json` | Placeholder | Not wired into the frontend yet |
| `GET /model/refresh-status` | `refresh_status.json` | **Real** (self-reporting) | Written automatically by `scripts/update_model_outputs.py` every automation run — see AUTOMATION.md |

To update a "Real" file with a finer-grained export later (e.g. the actual
1,650-cell `dhaka_flood_grid.geojson` instead of the 7x9 block-average), or
to replace a "Placeholder" once a model finishes training: give the new file
the same name as the column above and drop it into `api/data/`. If the shape
changes (e.g. going from a flat grid to real GeoJSON with coordinates), the
matching bit of frontend code (`useLiveData()` in `App.jsx`) needs a small
update too — it currently expects `{ "grid": [[...]] }` for both heat and
flood grids, and `{ "wards": [...] }` / `{ "areas": [...] }` / `{ "trend":
[...] }` for the rest.

## Known open issue: geographic scope mismatch

The frontend (`environmental-risk-platform.jsx`) hardcodes 8 **Chattogram**
wards for the Heat module. The actual models target different areas:

- Heat model (per the sprint plan / submitted Pre-Thesis 2 PDF): **Gazipur**
- Flood model (already run): **Dhaka District**
- Deforestation model: **Bangladesh districts generally**

None of these match Chattogram. This backend's `/heat/risk` placeholder keeps
the existing Chattogram ward names so the current frontend doesn't need
changes today, but this is a real decision the team needs to make before
final integration: either retarget the Heat model to Chattogram, or update
the frontend's ward list to Gazipur once real per-district output exists.
This is tracked in `claude/dashboard-implementation-status.md` in the project
and is worth resolving explicitly rather than discovering it during
integration testing (Day 9 in the execution guide).

## Notes

- CORS is wide open (`allow_origins=["*"]`) for ease of development — narrow
  it before the live defense demo.
- No database — this is intentionally file-based, matching the team's
  earlier decision to use `public/data.json` + git push over standing up
  Supabase before the defense.
- No auth — matches the frontend's current fake/demo login; add real auth
  only if the project moves past the defense/demo stage.
- Deforestation isn't wired into the frontend yet (still a locked module),
  so those three endpoints exist but aren't called by anything. Wire them up
  the same way as Heat/Flood in `useLiveData()` once that module gets built.
