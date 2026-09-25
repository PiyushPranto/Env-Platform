import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Thermometer, Droplets, Wind, TreeDeciduous, AlertTriangle, MapPin,
  Download, LogOut, Users, ShieldCheck, Bell, Search, TrendingUp, TrendingDown, Minus,
  FileText, X, Lock, ChevronRight, Radar, Building2, Sprout, ArrowLeft,
  UserPlus, ShieldAlert, Info, Send, Volume2, Languages,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Backend base URL
// ---------------------------------------------------------------------------
// Set VITE_API_URL in Vercel (env-platform project) -> Settings -> Environment
// Variables, e.g. VITE_API_URL=https://env-platform-u7jb.vercel.app
// Falls back to the known backend domain if the env var isn't set, so it still
// works even if you forget to add it.
const API_BASE =
  import.meta.env.VITE_API_URL || "https://env-platform-u7jb.vercel.app";

// ---------------------------------------------------------------------------
// Fallback / placeholder data (used only while loading or if a call fails,
// so the UI never looks broken)
// ---------------------------------------------------------------------------

// Heat used to be an 8-ward Chattogram-only demo with hand-authored
// fallback numbers. It's now real, national (64-district) data from
// heat_model_project.ipynb — see useHeatData() below — so, like Flood
// and Deforestation, there is no fake fallback dataset: a failed fetch
// shows an explicit "couldn't load" state instead of quietly reusing old
// Chattogram demo numbers for the whole country.

const OTHER_MODULES = [
  { key: "flood", labelKey: "navFlood", icon: Droplets, locked: false },
  { key: "air", labelKey: "navAir", icon: Wind, locked: true },
  { key: "forest", labelKey: "navForest", icon: TreeDeciduous, locked: false },
];

function tempToColor(t) {
  if (t === null || t === undefined) return "rgb(68,64,60)"; // stone-700 — "no data" cell
  // Calibrated to the real Mar-May 2026 composite's actual range (~23.9-28.1C
  // across all 64 districts) — the old 29-39C stops were left over from an
  // earlier placeholder and clamped every real cell to the same flat color.
  const stops = [
    { t: 25, c: [45, 130, 130] },
    { t: 26.5, c: [90, 150, 90] },
    { t: 28, c: [210, 170, 40] },
    { t: 29, c: [225, 120, 30] },
    { t: 30, c: [190, 40, 30] },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].t && t <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const range = hi.t - lo.t || 1;
  const f = Math.max(0, Math.min(1, (t - lo.t) / range));
  const c = lo.c.map((v, i) => Math.round(v + (hi.c[i] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Flood-risk grid color scale: same emerald->amber->red family as the heat
// scale, keyed to a 0-1 risk score with 0.7 as the alert threshold (matches
// dhaka-flood-model-summary.md's own color system).
function riskScoreToColor(v) {
  const stops = [
    { t: 0, c: [45, 130, 130] },
    { t: 0.4, c: [90, 150, 90] },
    { t: 0.7, c: [210, 170, 40] },
    { t: 0.85, c: [225, 120, 30] },
    { t: 1, c: [190, 40, 30] },
  ];
  let lo = stops[0], hi = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (v >= stops[i].t && v <= stops[i + 1].t) { lo = stops[i]; hi = stops[i + 1]; break; }
  }
  const range = hi.t - lo.t || 1;
  const f = Math.max(0, Math.min(1, (v - lo.t) / range));
  const c = lo.c.map((val, i) => Math.round(val + (hi.c[i] - val) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// Deforestation priority-tier colors, shared across the district ranking
// list, worklist and restoration list so "High" always reads the same way.
function tierColor(tier) {
  if (tier === "Severe" || tier === "High") return { bg: "bg-red-950/40", text: "text-red-400", ring: "ring-red-500/30", dot: "bg-red-500" };
  if (tier === "Moderate" || tier === "Medium") return { bg: "bg-amber-950/40", text: "text-amber-400", ring: "ring-amber-500/30", dot: "bg-amber-500" };
  if (tier === "no forest") return { bg: "bg-stone-700/40", text: "text-stone-400", ring: "ring-stone-500/30", dot: "bg-stone-500" };
  return { bg: "bg-emerald-950/40", text: "text-emerald-400", ring: "ring-emerald-500/30", dot: "bg-emerald-500" };
}

// Small "is this district's flood risk rising or falling since the last
// 3-day refresh" indicator. Reads risk_trend, which the automation script
// only sets once a previous run's output exists to compare against — so
// this quietly renders nothing rather than guessing on the very first run.
function RiskTrendBadge({ trend, size = 12 }) {
  if (!trend) return null;
  if (trend === "up") return <TrendingUp size={size} className="text-red-400" />;
  if (trend === "down") return <TrendingDown size={size} className="text-emerald-400" />;
  return <Minus size={size} className="text-stone-400" />;
}

// ---------------------------------------------------------------------------
// Plain-language risk level: collapses every tier vocabulary this app uses
// (heat's High/Medium/Low, flood's Severe/Moderate/Mild, deforestation's
// High/Medium/Low priority) onto one 3-step scale — high/caution/safe — so
// color alone tells a citizen the story without needing to read the tier
// word itself. This is additive: the real tier word is still shown next to
// it for anyone who can read it.
// ---------------------------------------------------------------------------
function riskLevel(tier) {
  if (!tier) return null;
  if (tier === "Severe" || tier === "High") return "high";
  if (tier === "Moderate" || tier === "Medium") return "caution";
  if (tier === "no forest") return "none";
  return "safe"; // Low, Mild, or any other "good" tier
}

const RISK_LEVEL_BADGE_TONE = { high: "red", caution: "amber", safe: "teal", none: "slate" };

// Bangla labels for the raw tier words the backend returns (always in
// English) — used only for display when the citizen dashboard is set to
// Bangla; the underlying data/logic is untouched.
const TIER_BN = {
  High: "উচ্চ", Medium: "মাঝারি", Low: "কম",
  Severe: "মারাত্মক", Moderate: "মাঝারি", Mild: "মৃদু",
  "no forest": "বন নেই",
};
function tierLabel(tier, lang) {
  if (!tier) return tier;
  return lang === "bn" ? TIER_BN[tier] || tier : tier;
}

// Reads a short plain-language sentence aloud with the browser's own
// text-to-speech — no backend, no API key, and a real accessibility aid for
// a citizen who can't read, not a cosmetic icon. Bangla voice availability
// varies by device/browser, so this quietly no-ops rather than pretending
// to work everywhere.
function speakText(text, lang) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = lang === "bn" ? "bn-BD" : "en-US";
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch {
    // Some embedded/webview browsers throw on speech synthesis — fail
    // silently rather than breaking the page over a nice-to-have.
  }
}

function SpeakButton({ text, lang, label }) {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  if (!supported || !text) return null;
  return (
    <button
      type="button"
      onClick={() => speakText(text, lang)}
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-stone-600 text-stone-300 hover:text-stone-100 hover:bg-stone-800 active:scale-[0.97] transition-all shrink-0"
    >
      <Volume2 size={13} /> {label}
    </button>
  );
}

// A big icon + color "status at a glance" block for the top of each citizen
// detail page — the color is the primary signal (red/amber/green, same
// scale everywhere in the app), the icon says which module it is, and the
// tier word and a Listen button are secondary support for whoever wants
// them. Everything below this block (maps, charts, exact numbers) is
// unchanged — this is a plain-language summary placed in front of it.
function RiskHero({ icon: Icon, tier, title, sub, lang, speak, listenLabel }) {
  const toneKey = RISK_LEVEL_BADGE_TONE[riskLevel(tier)] || "slate";
  const bg = tier ? tierColor(tier).bg : "bg-stone-800/40";
  return (
    <div className={`rounded-2xl p-4 border border-stone-700 flex items-center gap-3.5 shadow-sm shadow-black/20 ${bg}`}>
      <span className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl shrink-0 ${ICON_BADGE_TONES[toneKey]}`}>
        <Icon size={26} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-base font-semibold text-stone-50 truncate">{title}</div>
        {sub && <div className="text-xs text-stone-300 mt-0.5 truncate">{sub}</div>}
      </div>
      {speak && <SpeakButton text={speak} lang={lang} label={listenLabel} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Heat — real, national (64-district) output from heat_model_project.ipynb:
// a Random Forest heat-risk composite, DBSCAN hotspot clusters, and
// per-district SUHI intensity (MODIS LST/NDVI + JRC GHSL built-up
// fraction, Mar-May 2026). Like Flood and Deforestation, there is no fake
// fallback dataset — a failed fetch surfaces as an explicit error state.
//
// /heat/alerts is the one genuinely live piece: a 7-day heatwave forecast
// (Open-Meteo + official BMD thresholds) for the model's own hotspot
// sites, re-checked every 3 days by the same automation that re-scores
// Flood. An empty alerts list is a normal, honest "no heatwave forecast
// right now" result, not a broken feature.
// ---------------------------------------------------------------------------

function useHeatData() {
  const [districts, setDistricts] = useState(null);
  const [grid, setGrid] = useState(null);
  const [trend, setTrend] = useState(null);
  const [hotspots, setHotspots] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [riskRes, gridRes, trendRes, hotspotsRes, alertsRes] = await Promise.all([
          fetch(`${API_BASE}/heat/risk`),
          fetch(`${API_BASE}/heat/grid`),
          fetch(`${API_BASE}/heat/trend`),
          fetch(`${API_BASE}/heat/hotspots`),
          fetch(`${API_BASE}/heat/alerts`),
        ]);
        if (!riskRes.ok || !gridRes.ok || !trendRes.ok || !hotspotsRes.ok) {
          throw new Error("One or more /heat endpoints failed");
        }
        const [riskData, gridData, trendData, hotspotsData] = await Promise.all([
          riskRes.json(), gridRes.json(), trendRes.json(), hotspotsRes.json(),
        ]);
        // /heat/alerts always resolves (the backend returns a labeled
        // not-yet-run payload rather than a 404), but treat a network
        // failure on it as "no alert data" rather than failing the whole
        // module over the one piece that's allowed to be briefly unready.
        const alertsData = alertsRes.ok ? await alertsRes.json() : null;

        if (cancelled) return;
        setDistricts(riskData.wards || []);
        setGrid(gridData.grid || null);
        // heat_trend.json's field is named `month` for shape-compatibility
        // with the old placeholder, but holds a year (2015-2026) — rename
        // it here so the rest of the app deals in `year`, not a misleading name.
        setTrend((trendData.trend || []).map((r) => ({ year: r.month, temp: r.temp, baseline: r.baseline, excluded: r.excluded })));
        setHotspots(hotspotsData.features || []);
        setAlerts(alertsData);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load heat data:", err);
          setError(err.message || "Failed to load heat data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { districts, grid, trend, hotspots, alerts, loading, error };
}

// ---------------------------------------------------------------------------
// Flood — Dhaka (city-block, real data) and nationwide (64-district, real
// trained model) are two separate, real datasets served by two separate
// parts of the backend. Both hooks below fail soft: on any error the state
// just stays null/empty and the UI shows an explicit "couldn't load" note
// rather than inventing numbers, since (unlike Heat) no demo fallback
// dataset exists for either of these.
// ---------------------------------------------------------------------------

function useFloodDhakaData() {
  const [grid, setGrid] = useState(null);
  const [trend, setTrend] = useState(null);
  const [areas, setAreas] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [gridRes, trendRes, areasRes, summaryRes] = await Promise.all([
          fetch(`${API_BASE}/flood/risk`),
          fetch(`${API_BASE}/flood/trend`),
          fetch(`${API_BASE}/flood/top-risk-areas`),
          fetch(`${API_BASE}/flood/summary`),
        ]);
        if (!gridRes.ok || !trendRes.ok || !areasRes.ok || !summaryRes.ok) {
          throw new Error("One or more /flood endpoints failed");
        }
        const [gridData, trendData, areasData, summaryData] = await Promise.all([
          gridRes.json(), trendRes.json(), areasRes.json(), summaryRes.json(),
        ]);
        if (cancelled) return;
        setGrid(gridData.grid || null);
        setTrend(trendData.trend || null);
        setAreas(areasData.areas || null);
        setSummary(summaryData);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load Dhaka flood data:", err);
          setError(err.message || "Failed to load flood data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { grid, trend, areas, summary, loading, error };
}

function useNationalFloodData() {
  const [severity, setSeverity] = useState(null);
  const [priority, setPriority] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sevRes, prRes, sumRes] = await Promise.all([
          fetch(`${API_BASE}/flood/national/severity`),
          fetch(`${API_BASE}/flood/national/priority`),
          fetch(`${API_BASE}/flood/national/summary`),
        ]);
        if (!sevRes.ok || !prRes.ok || !sumRes.ok) {
          throw new Error("One or more /flood/national endpoints failed");
        }
        const [sevData, prData, sumData] = await Promise.all([sevRes.json(), prRes.json(), sumRes.json()]);
        if (cancelled) return;
        setSeverity(sevData);
        setPriority(prData);
        setSummary(sumData);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load national flood data:", err);
          setError(err.message || "Failed to load national flood data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { severity, priority, summary, loading, error };
}

// ---------------------------------------------------------------------------
// Deforestation — real data (Random Forest on seasonal MODIS NDVI, 2015-2025,
// all 64 districts). No demo fallback exists for this module either; a
// failed fetch surfaces as an explicit error state rather than fake numbers.
// ---------------------------------------------------------------------------

function useDeforestationData() {
  const [districts, setDistricts] = useState(null);
  const [worklist, setWorklist] = useState(null);
  const [worklistTotal, setWorklistTotal] = useState(null);
  const [restoration, setRestoration] = useState(null);
  const [lossByYear, setLossByYear] = useState(null);
  const [citizenCards, setCitizenCards] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [distRes, workRes, restRes, lossRes, cardsRes] = await Promise.all([
          fetch(`${API_BASE}/deforestation/districts`),
          fetch(`${API_BASE}/deforestation/worklist`),
          fetch(`${API_BASE}/deforestation/restoration-priority`),
          fetch(`${API_BASE}/deforestation/loss-by-year`),
          fetch(`${API_BASE}/deforestation/citizen-cards`),
        ]);
        if (!distRes.ok || !workRes.ok || !restRes.ok || !lossRes.ok || !cardsRes.ok) {
          throw new Error("One or more /deforestation endpoints failed");
        }
        const [distData, workData, restData, lossData, cardsData] = await Promise.all([
          distRes.json(), workRes.json(), restRes.json(), lossRes.json(), cardsRes.json(),
        ]);
        if (cancelled) return;
        setDistricts(distData);
        setWorklist(workData.patches || []);
        setWorklistTotal(workData.total_patches ?? null);
        setRestoration(restData);
        setLossByYear(lossData);
        setCitizenCards(cardsData);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load deforestation data:", err);
          setError(err.message || "Failed to load deforestation data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { districts, worklist, worklistTotal, restoration, lossByYear, citizenCards, loading, error };
}

// Citizen-submitted "I saw tree-cutting here" reports (see
// CitizenReportForm / CITIZEN-REPORTS-SETUP.md). `configured: false` means
// the backend's Supabase table isn't set up yet — shown as a plain notice
// rather than an empty list, so it's clear this isn't "zero reports so far".
function useCitizenReports() {
  const [reports, setReports] = useState(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/deforestation/citizen-reports`);
        if (!res.ok) throw new Error(`/deforestation/citizen-reports ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setConfigured(data.configured !== false);
        setReports(data.reports || []);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load citizen reports:", err);
          setError(err.message || "Failed to load citizen reports");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { reports, configured, loading, error };
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function HeatGrid({ grid, compact, colorFn = tempToColor, labelFn = (t) => (t === null || t === undefined ? "No data" : `${t.toFixed(0)}C`) }) {
  const cell = compact ? 26 : 34;
  return (
    <div className="inline-block rounded-xl overflow-hidden border border-stone-700 shadow-lg shadow-black/30 ring-1 ring-black/20">
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((t, ci) => (
            <div
              key={ci}
              title={labelFn(t)}
              style={{ width: cell, height: cell, background: colorFn(t) }}
              className="border border-stone-900/40 transition-transform duration-150 hover:scale-[1.12] hover:z-10 hover:shadow-lg"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Small tinted icon chip used throughout the dashboards for a consistent,
// slightly more premium "icon in a badge" look instead of a bare icon.
const ICON_BADGE_TONES = {
  slate: "bg-stone-700/80 text-stone-300 ring-1 ring-stone-600/60",
  orange: "bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20",
  red: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
  teal: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
};

function IconBadge({ icon: Icon, tone = "slate", size = 15, className = "" }) {
  return (
    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${ICON_BADGE_TONES[tone]} ${className}`}>
      <Icon size={size} />
    </span>
  );
}

// Small uppercase label used above section headings for a bit more visual
// hierarchy without adding much size/noise.
function Eyebrow({ children, tone = "orange" }) {
  const toneMap = {
    orange: "text-orange-400",
    teal: "text-emerald-400",
    slate: "text-stone-400",
  };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${toneMap[tone]}`}>
      {children}
    </span>
  );
}

// Shown in place of module content while real data is loading, or if it
// failed to load — used by Flood and Deforestation, which (unlike Heat)
// have no hardcoded demo fallback to quietly fall back to.
function DataStateNotice({ loading, error, label }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-stone-400 py-16 justify-center">
        <span className="w-2 h-2 rounded-full bg-stone-400 animate-pulse" />
        Loading {label}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 text-sm text-amber-500 py-16 text-center px-6">
        <IconBadge icon={AlertTriangle} tone="amber" />
        <span>Couldn't load {label} from the backend.</span>
        <span className="text-xs text-stone-400">{error}</span>
      </div>
    );
  }
  return null;
}

function Kpi({ label, value, sub, icon: Icon, tone = "slate" }) {
  const toneMap = {
    slate: "text-stone-100",
    orange: "text-orange-400",
    red: "text-red-400",
    teal: "text-emerald-400",
  };
  return (
    <div className="group bg-gradient-to-b from-stone-800/80 to-stone-800/40 border border-stone-700 hover:border-stone-600 rounded-2xl p-4 flex flex-col gap-3 shadow-sm shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30">
      <div className="flex items-center justify-between">
        <span className="text-xs text-stone-400 font-medium">{label}</span>
        {Icon && <IconBadge icon={Icon} tone={tone === "slate" ? "slate" : tone} size={14} />}
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${toneMap[tone]}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-stone-400">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report modal (stands in for PDF/Excel export)
// ---------------------------------------------------------------------------

function ReportModal({ districts, alerts, onClose }) {
  const printRef = useRef(null);
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  const sorted = [...districts].sort((a, b) => b.heat_risk - a.heat_risk);
  const avgLst = districts.length ? districts.reduce((s, d) => s + d.lst_c, 0) / districts.length : null;
  const highRiskCount = districts.filter((d) => d.risk_category === "High").length;
  const activeAlertCount = alerts?.alerts?.length ?? 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-stone-900 border border-stone-700 rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl shadow-black/50 animate-fade-in-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-700">
          <div className="flex items-center gap-2.5 text-stone-200">
            <IconBadge icon={FileText} tone="orange" size={14} />
            <span className="text-sm font-medium">National heat risk report</span>
          </div>
          <button onClick={onClose} className="text-stone-400 hover:text-stone-200 hover:bg-stone-800 rounded-lg p-1.5 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div ref={printRef} className="p-6 text-stone-200">
          <h2 className="text-lg font-semibold text-stone-50" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Urban Heat Risk Summary
          </h2>
          <p className="text-xs text-stone-400 mt-1">Bangladesh, all 64 districts — generated {now}</p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
            <div className="text-center">
              <div className="text-xl font-semibold text-orange-400">{avgLst !== null ? `${avgLst.toFixed(1)}C` : "—"}</div>
              <div className="text-[11px] text-stone-400 mt-1">National avg. surface temp</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-red-400">{highRiskCount}</div>
              <div className="text-[11px] text-stone-400 mt-1">High-risk districts</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-emerald-400">{activeAlertCount}</div>
              <div className="text-[11px] text-stone-400 mt-1">Active heatwave watches</div>
            </div>
          </div>

          <h3 className="text-sm font-medium text-stone-100 mt-6 mb-2">District ranking by heat risk</h3>
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr className="text-stone-400 text-left">
                <th className="py-1.5 font-medium border-b border-stone-700">District</th>
                <th className="py-1.5 font-medium border-b border-stone-700">LST</th>
                <th className="py-1.5 font-medium border-b border-stone-700">Risk</th>
                <th className="py-1.5 font-medium border-b border-stone-700">NDVI</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((d, i) => (
                <tr key={d.name} className={i % 2 === 1 ? "bg-stone-800/30" : ""}>
                  <td className="py-1.5 px-1 text-stone-200 rounded-l-md">{d.name}</td>
                  <td className="py-1.5 px-1 text-stone-300">{d.lst_c.toFixed(1)}C</td>
                  <td className="py-1.5 px-1 text-stone-300">{d.risk_category}</td>
                  <td className="py-1.5 px-1 text-stone-300 rounded-r-md">{d.ndvi.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-[11px] text-stone-500 mt-6 leading-relaxed">
            Risk score is a composite of surface temperature, vegetation and built-up fraction
            (MODIS LST/NDVI, JRC GHSL, Mar–May 2026 season). Heatwave watches are re-checked every 3
            days against a live 7-day forecast for the model's own hotspot sites. The 2015–2024
            national warming trend shown elsewhere in this dashboard is not statistically significant
            (p=0.106) — reported as observed, not confirmed.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-stone-700">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-lg border border-stone-600 text-stone-300 hover:bg-stone-800 hover:text-stone-200 transition-colors"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="px-3.5 py-1.5 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-500 active:scale-[0.97] flex items-center gap-1.5 shadow-lg shadow-orange-950/40 transition-all duration-150"
          >
            <Download size={14} /> Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Government dashboard
// ---------------------------------------------------------------------------
// A Bangla/English toggle for every day-to-day label, header, subtitle,
// button and status message a new officer sees while using the dashboard —
// so it reads clearly at a glance in either language. The handful of dense,
// statistics-heavy passages written for the thesis defense panel (model
// methodology, validation numbers, disclosed limitations) stay English-only
// by design: they're reference material for evaluators, not something a
// field officer needs translated to use the dashboard day to day, and a
// machine-style translation of technical statistical caveats risks
// misstating them.

const GOVT_I18N = {
  en: {
    consoleName: "Environmental Console",
    govtDashboard: "Government dashboard",
    navHeat: "Heat monitoring",
    navFlood: "Flood monitoring",
    navAir: "Air pollution (coming soon)",
    navForest: "Deforestation",
    signOut: "Sign out",
    searchPlaceholder: "Search by district, upazila or ward",
    loadingLiveData: "Loading live data…",
    couldntLoad: "Couldn't load",
    notifications: "Notifications",
    noActiveAlerts: "No active alerts right now.",
    generateReport: "Generate report",
    moduleInDevelopment: "Module in development",
    moduleInDevelopmentBody: (label) =>
      `This demo prototype implements Heat, Flood and Deforestation monitoring end-to-end. The ${label.toLowerCase()} module follows the same architecture and is scoped for the next build phase.`,
    backToHeat: "Back to heat monitoring",
    legend: "Colors on this dashboard always mean the same thing:",
    legendSafe: "Low / good",
    legendCaution: "Moderate — watch",
    legendHigh: "High / severe — act",
    kpiAvgTemp: "National avg. surface temp",
    kpiAvgTempSub: "Mar–May 2026 season",
    kpiHighRisk: "High-risk districts",
    kpiHighRiskSub: (n) => `of ${n} nationally`,
    kpiUhi: "Districts with measurable UHI",
    kpiUhiSub: "urban-vs-rural contrast detected",
    kpiUhiGloss: "UHI = urban heat island: how much hotter a city is than the countryside around it.",
    kpiHeatwaveWatches: "Heatwave watches",
    kpiHeatwaveLive: "live, rechecked every 3 days",
    kpiHeatwaveNotRun: "automation hasn't run yet",
    liveHeatBanner: (dateStr) =>
      `Live — heatwave watch rechecked every 3 days against real weather forecasts (satellite heat-risk layer is a fixed Mar–May 2026 seasonal composite). Last refreshed ${dateStr}.`,
    compositeSeason: "Composite season",
    surfaceTempTitle: "Surface temperature — nationwide",
    surfaceTempSub: "Satellite-measured ground temperature (MODIS LST composite), Mar–May 2026",
    gridNote: "Each square is the average for that area; blank squares simply have no data (usually water).",
    priorityRanking: "Priority ranking",
    heatMitigationTitle: "Heat mitigation priority",
    heatMitigationSub: "Districts most in need of cooling measures, highest first.",
    noGridData: "No grid data available.",
    trendTitle: "Annual temperature trend, 2015–2026",
    trendSub: "Nationwide average ground temperature by year, compared against the long-term baseline. The 2025–2026 points (hollow) are excluded from the trend line because of a known satellite sensor drift, not because the data is wrong. The upward trend is not yet statistically certain (p=0.106).",
    heatwaveWatch: "Heatwave watch",
    heatwaveWatchSub: "7-day forecast against official weather-service heatwave thresholds, rechecked every 3 days.",
    noForecastYet: "Automation hasn't produced a forecast check yet.",
    noHeatwaveForecast: (days) => `No heatwave forecast for any monitored hotspot in the next ${days} days.`,
    heatwavePeak: (a, forecastDays) => `Peak ${a.peak_tmax_c.toFixed(1)}°C over ${a.heatwave_days} day(s) in the next ${forecastDays}`,
    searchMatch: (n, q) => `${n} district(s) match "${q}"`,
    ndviGloss: "NDVI = vegetation greenness (higher = more plant cover)",
    builtGloss: "built-up fraction = share of the area covered by buildings/roads",
    suhiGloss: "SUHI = how much hotter this district is than similar rural land nearby",
    floodTabDhaka: "Dhaka (detailed)",
    floodTabNational: "Nationwide overview (64 districts)",
    kpiFloodProne: "Flood-prone area",
    kpiPeakAlerted: "Peak area under alert",
    kpiAlertDays: "Alert days",
    kpiAlertDaysSub: (n) => `of ${n} days observed`,
    kpiRainfall: "Rainfall vs baseline",
    kpiRainfallSub: (n) => `baseline ${n}mm/day`,
    realData2025: "Real data — 2025 monsoon window",
    dhakaFloodTitle: "Flood risk — Dhaka (14 Jul 2025, historical peak)",
    dhakaFloodSub: "Combined score of land shape and rainfall — 50% each",
    dhakaGridNote: "Averaged from the real 1,650-point Dhaka survey grid",
    highestRisk: "Highest risk",
    topLocations: "Top locations",
    rainfallVsAlert: "62-day rainfall vs. % of Dhaka under alert",
    rainfallVsAlertSub: "8 Jun – 8 Aug 2025, real observed rainfall",
    kpiDistrictsCovered: "Districts covered",
    allBangladesh: "All of Bangladesh",
    kpiValidatedRecall: "Validated recall",
    kpiValidatedRecallSub: "on real 2018 held-out events",
    kpiValidatedAuc: "Validated ROC-AUC",
    kpiValidatedAucSub: "real ground-truth test year",
    kpiTopPriority: "Top priority district",
    kpiTopPrioritySub: "highest mitigation priority",
    liveFloodBanner: (window, dateStr) =>
      `Live — risk rescored every 3 days from real rainfall${window ? ` through ${window}` : ""}. Last refreshed ${dateStr}.`,
    mitigationPriority: "Mitigation priority",
    top20of64: "Top 20 of 64 districts",
    rankedByScore: "Ranked by a weighted score: 50% predicted risk, 30% historical severity, 20% area exposure",
    badgeVsPercent: "The badge is historical severity (past flood magnitude) — the % is this week's live predicted risk. A district can carry a severe flood history but a calm week, or the reverse, so the two can disagree.",
    moreDistricts: (n) => `+${n} more districts, ranked, in the full export.`,
    scoreDeltaTooltip: (prev, curr) =>
      `Raw model score: ${prev} → ${curr} since the last automated refresh — the exact number the % on the right is rounded from.`,
    scoreDeltaLegend: "Δ = exact change in the raw model score since the last real refresh, to 4 decimals — so it's visible even when the rounded % looks the same.",
    avgMovementTitle: "Proof this is live, not frozen",
    avgMovementBody: (avg, min, max, n) =>
      `Average change in raw predicted risk since the last automated refresh, across all ${n} districts: ${avg}. Smallest movement: ${min}. Largest: ${max}. These are real numbers from the last scheduled run — not visible in the rounded percentages above, but recomputed from live rainfall every time the pipeline runs.`,
    noDeltaYet: "First refresh recorded — nothing to compare against yet.",
    fieldNoticeFlood: "Trained on real flood-event records for the years shown. A district-day is genuinely a flood only about 3–5% of the time, so the model is deliberately tuned to catch more real floods even at the cost of some false alarms — the right tradeoff for early warning.",
    forDefensePanel: "For the defense panel",
    modelProvenance: "Model provenance",
    citizenReportsEyebrow: "Citizen reports",
    citizenReportsTitle: "Tree-cutting reported by citizens",
    reportCount: (n) => `${n} report${n === 1 ? "" : "s"}`,
    contactLabel: "contact",
    citizenReportsSub: "Unverified — a helpful extra signal alongside the satellite model, not a confirmed field finding.",
    loadingCitizenReports: "Loading citizen reports…",
    couldntLoadCitizenReports: "Couldn't load citizen reports.",
    reportsNotSetUp: "Citizen reporting isn't set up yet on the backend.",
    noCitizenReports: "No citizen reports submitted yet.",
    kpiNationalLoss: "National loss, 2017–2024",
    kpiNationalLossSub: "confirmed, lasting loss (not a one-season dip)",
    kpiAccelerating: "Districts accelerating",
    kpiAcceleratingSub: "recent loss ≥1.5× own baseline",
    kpiAvgTreeCover: "Avg. tree cover",
    kpiAvgTreeCoverSub: "national average, 2024",
    kpiLossPatches: "Loss patches mapped",
    kpiLossPatchesSub: "≥0.25 km², 2017–2023",
    forestNotice: "This counts all tree cover — including home gardens and plantations, not only official forest land — so don't compare it to the Forest Department's own 11–15% figure. The nationwide year-by-year trend and a loss forecast are deliberately left off this dashboard: the underlying data disagreed with itself too much to trust a forecast built on it. The district ranking and loss map below did pass every check.",
    rankedByLoss: "Ranked by loss",
    districtRanking64: "District ranking — 64 districts",
    restorationPriority: "Restoration priority",
    topReplanting: "Top replanting targets",
    protectedLoss: "Confirmed loss inside a protected area",
    protectedShort: "protected",
    coverSuffix: "cover",
    nationalLossByYear: "National loss by year",
    km2PerYear: "km² of confirmed, lasting loss per year",
    fieldWorklist: "Field worklist",
    recentLossPatches: "Recent loss patches",
    showingOf: (shown, total) => `showing ${shown} of ${total}, protected + recent first`,
    downloadCsv: "Download CSV",
    downloadCsvHint: "Download the rows shown below as a spreadsheet file",
    colDistrict: "District",
    colYear: "Year",
    colArea: "Area",
    colProtected: "Protected",
    colLocation: "Location",
    map: "Map",
    yes: "yes",
    close: "Close",
  },
  bn: {
    consoleName: "পরিবেশ কনসোল",
    govtDashboard: "সরকারি ড্যাশবোর্ড",
    navHeat: "তাপ পর্যবেক্ষণ",
    navFlood: "বন্যা পর্যবেক্ষণ",
    navAir: "বায়ু দূষণ (শীঘ্রই আসছে)",
    navForest: "বন উজাড়",
    signOut: "সাইন আউট",
    searchPlaceholder: "জেলা, উপজেলা বা ওয়ার্ড দিয়ে খুঁজুন",
    loadingLiveData: "লাইভ তথ্য লোড হচ্ছে…",
    couldntLoad: "লোড করা যায়নি",
    notifications: "বিজ্ঞপ্তি",
    noActiveAlerts: "এই মুহূর্তে কোনো সক্রিয় সতর্কতা নেই।",
    generateReport: "রিপোর্ট তৈরি করুন",
    moduleInDevelopment: "এই মডিউলটি এখনো তৈরি হচ্ছে",
    moduleInDevelopmentBody: (label) =>
      `এই ডেমো প্রোটোটাইপে তাপ, বন্যা ও বন উজাড় পর্যবেক্ষণ সম্পূর্ণভাবে তৈরি করা হয়েছে। ${label} মডিউলটি একই কাঠামোতে পরবর্তী ধাপে তৈরি হবে।`,
    backToHeat: "তাপ পর্যবেক্ষণে ফিরে যান",
    legend: "এই ড্যাশবোর্ডে রঙের অর্থ সবসময় একই থাকে:",
    legendSafe: "কম / ভালো",
    legendCaution: "মাঝারি — নজর রাখুন",
    legendHigh: "উচ্চ / মারাত্মক — ব্যবস্থা নিন",
    kpiAvgTemp: "জাতীয় গড় ভূপৃষ্ঠ তাপমাত্রা",
    kpiAvgTempSub: "মার্চ–মে ২০২৬ মৌসুম",
    kpiHighRisk: "উচ্চ-ঝুঁকির জেলা",
    kpiHighRiskSub: (n) => `মোট ${n} টির মধ্যে`,
    kpiUhi: "পরিমাপযোগ্য UHI-সহ জেলা",
    kpiUhiSub: "শহর-বনাম-গ্রাম তাপ পার্থক্য শনাক্ত হয়েছে",
    kpiUhiGloss: "UHI = আরবান হিট আইল্যান্ড: আশেপাশের গ্রামাঞ্চলের তুলনায় শহর কতটা বেশি গরম।",
    kpiHeatwaveWatches: "তাপপ্রবাহ সতর্কতা",
    kpiHeatwaveLive: "লাইভ, প্রতি ৩ দিন পরপর হালনাগাদ",
    kpiHeatwaveNotRun: "অটোমেশন এখনো চলেনি",
    liveHeatBanner: (dateStr) =>
      `লাইভ — প্রকৃত আবহাওয়া পূর্বাভাসের ভিত্তিতে প্রতি ৩ দিন পরপর তাপপ্রবাহ সতর্কতা হালনাগাদ করা হয় (স্যাটেলাইট তাপ-ঝুঁকি স্তরটি মার্চ–মে ২০২৬ মৌসুমের একটি নির্দিষ্ট সমন্বয়)। সর্বশেষ হালনাগাদ ${dateStr}।`,
    compositeSeason: "সমন্বিত মৌসুম",
    surfaceTempTitle: "ভূপৃষ্ঠের তাপমাত্রা — সারাদেশ",
    surfaceTempSub: "স্যাটেলাইট থেকে পরিমাপ করা ভূপৃষ্ঠের তাপমাত্রা (MODIS LST), মার্চ–মে ২০২৬",
    gridNote: "প্রতিটি বর্গ ওই এলাকার গড় মান দেখায়; ফাঁকা বর্গে কোনো তথ্য নেই (সাধারণত পানি)।",
    priorityRanking: "অগ্রাধিকার তালিকা",
    heatMitigationTitle: "তাপ প্রশমন অগ্রাধিকার",
    heatMitigationSub: "যেসব জেলায় শীতলীকরণ ব্যবস্থা সবচেয়ে বেশি প্রয়োজন, উপরে সবচেয়ে জরুরিটা।",
    noGridData: "কোনো গ্রিড তথ্য পাওয়া যায়নি।",
    trendTitle: "বার্ষিক তাপমাত্রার প্রবণতা, ২০১৫–২০২৬",
    trendSub: "প্রতি বছরের সারাদেশের গড় ভূপৃষ্ঠ তাপমাত্রা, দীর্ঘমেয়াদি ভিত্তির সাথে তুলনা করে দেখানো। ২০২৫–২০২৬-এর পয়েন্টগুলো (ফাঁকা বৃত্ত) প্রবণতা রেখা থেকে বাদ দেওয়া হয়েছে — কারণ এটি স্যাটেলাইট সেন্সরের একটি পরিচিত ত্রুটি, ভুল তথ্য নয়। বাড়ার প্রবণতাটি এখনো পরিসংখ্যানগতভাবে নিশ্চিত নয় (p=0.106)।",
    heatwaveWatch: "তাপপ্রবাহ পর্যবেক্ষণ",
    heatwaveWatchSub: "সরকারি আবহাওয়া দপ্তরের তাপপ্রবাহ মানদণ্ড অনুযায়ী ৭ দিনের পূর্বাভাস, প্রতি ৩ দিন পরপর হালনাগাদ।",
    noForecastYet: "অটোমেশন এখনো কোনো পূর্বাভাস তৈরি করেনি।",
    noHeatwaveForecast: (days) => `আগামী ${days} দিনে কোনো পর্যবেক্ষণ এলাকায় তাপপ্রবাহের পূর্বাভাস নেই।`,
    heatwavePeak: (a, forecastDays) => `সর্বোচ্চ ${a.peak_tmax_c.toFixed(1)}°সে, আগামী ${forecastDays} দিনের মধ্যে ${a.heatwave_days} দিন ধরে`,
    searchMatch: (n, q) => `"${q}" এর সাথে ${n} টি জেলা মিলেছে`,
    ndviGloss: "NDVI = গাছপালার সবুজতা (বেশি মানে বেশি গাছপালা)",
    builtGloss: "built-up fraction = এলাকার কতটুকু ভবন/রাস্তায় ঢাকা",
    suhiGloss: "SUHI = আশেপাশের গ্রামাঞ্চলের তুলনায় এই জেলা কতটা বেশি গরম",
    floodTabDhaka: "ঢাকা (বিস্তারিত)",
    floodTabNational: "সারাদেশের সারসংক্ষেপ (৬৪ জেলা)",
    kpiFloodProne: "বন্যাপ্রবণ এলাকা",
    kpiPeakAlerted: "সর্বোচ্চ সতর্কতার আওতাধীন এলাকা",
    kpiAlertDays: "সতর্কতার দিন",
    kpiAlertDaysSub: (n) => `মোট ${n} দিনের মধ্যে`,
    kpiRainfall: "বৃষ্টিপাত বনাম স্বাভাবিক মাত্রা",
    kpiRainfallSub: (n) => `স্বাভাবিক মাত্রা ${n}মিমি/দিন`,
    realData2025: "প্রকৃত তথ্য — ২০২৫ বর্ষা মৌসুম",
    dhakaFloodTitle: "বন্যার ঝুঁকি — ঢাকা (১৪ জুলাই ২০২৫, ঐতিহাসিক সর্বোচ্চ)",
    dhakaFloodSub: "ভূমির গঠন ও বৃষ্টিপাতের সম্মিলিত স্কোর — প্রতিটি ৫০%",
    dhakaGridNote: "ঢাকার প্রকৃত ১,৬৫০-পয়েন্ট জরিপ গ্রিড থেকে গড় করা",
    highestRisk: "সর্বোচ্চ ঝুঁকি",
    topLocations: "শীর্ষ এলাকাসমূহ",
    rainfallVsAlert: "৬২ দিনের বৃষ্টিপাত বনাম ঢাকার কত % সতর্কতার আওতায়",
    rainfallVsAlertSub: "৮ জুন – ৮ আগস্ট ২০২৫, প্রকৃত পর্যবেক্ষণকৃত বৃষ্টিপাত",
    kpiDistrictsCovered: "অন্তর্ভুক্ত জেলা",
    allBangladesh: "সমগ্র বাংলাদেশ",
    kpiValidatedRecall: "যাচাইকৃত রিকল",
    kpiValidatedRecallSub: "প্রকৃত ২০১৮ পরীক্ষার তথ্যের ভিত্তিতে",
    kpiValidatedAuc: "যাচাইকৃত ROC-AUC",
    kpiValidatedAucSub: "প্রকৃত গ্রাউন্ড-ট্রুথ পরীক্ষার বছর",
    kpiTopPriority: "শীর্ষ অগ্রাধিকার জেলা",
    kpiTopPrioritySub: "সর্বোচ্চ প্রশমন অগ্রাধিকার",
    liveFloodBanner: (window, dateStr) =>
      `লাইভ — প্রকৃত বৃষ্টিপাতের তথ্য দিয়ে প্রতি ৩ দিন পরপর ঝুঁকি পুনর্মূল্যায়ন করা হয়${window ? ` — ${window} পর্যন্ত` : ""}। সর্বশেষ হালনাগাদ ${dateStr}।`,
    mitigationPriority: "প্রশমন অগ্রাধিকার",
    top20of64: "৬৪ জেলার মধ্যে শীর্ষ ২০",
    rankedByScore: "একটি ওজনযুক্ত স্কোর দিয়ে সাজানো: ৫০% পূর্বাভাসিত ঝুঁকি, ৩০% ঐতিহাসিক তীব্রতা, ২০% এলাকার সংস্পর্শ",
    badgeVsPercent: "ব্যাজটি ঐতিহাসিক তীব্রতা (অতীতের বন্যার মাত্রা) দেখায় — % হলো এই সপ্তাহের লাইভ পূর্বাভাসিত ঝুঁকি। একটি জেলার ইতিহাসে মারাত্মক বন্যা থাকতে পারে কিন্তু এই সপ্তাহ শান্ত, অথবা উল্টোটাও হতে পারে — তাই দুটো ভিন্ন হতে পারে।",
    moreDistricts: (n) => `সম্পূর্ণ এক্সপোর্টে আরও ${n} টি জেলা, ক্রমানুসারে।`,
    scoreDeltaTooltip: (prev, curr) =>
      `আসল মডেল স্কোর: ${prev} → ${curr}, সর্বশেষ স্বয়ংক্রিয় refresh থেকে — ডানপাশের %-টি এই সংখ্যা থেকেই round করা।`,
    scoreDeltaLegend: "Δ = সর্বশেষ real refresh-এর পর আসল মডেল স্কোরের সঠিক পরিবর্তন, ৪ decimal পর্যন্ত — round করা % একই দেখালেও এটা দেখা যায়।",
    avgMovementTitle: "এটা সত্যিই live, frozen না — তার প্রমাণ",
    avgMovementBody: (avg, min, max, n) =>
      `সর্বশেষ স্বয়ংক্রিয় refresh-এর পর আসল predicted risk-এর গড় পরিবর্তন, সবগুলো ${n} জেলা মিলিয়ে: ${avg}। সবচেয়ে কম পরিবর্তন: ${min}। সবচেয়ে বেশি: ${max}। এগুলো সর্বশেষ scheduled run-এর প্রকৃত সংখ্যা — উপরের round করা percentage-এ বোঝা না গেলেও, pipeline প্রতিবার run হওয়ার সময় live বৃষ্টিপাতের তথ্য থেকে এই পরিবর্তন সত্যিই recompute হচ্ছে।`,
    noDeltaYet: "প্রথম refresh রেকর্ড হয়েছে — তুলনা করার মতো আগের কিছু এখনো নেই।",
    fieldNoticeFlood: "প্রদর্শিত বছরগুলোর প্রকৃত বন্যার ঘটনার তথ্য দিয়ে প্রশিক্ষিত। একটি জেলা-দিন প্রকৃতপক্ষে বন্যা হয় মাত্র ৩–৫% সময়ে, তাই মডেলটি ইচ্ছাকৃতভাবে বেশি প্রকৃত বন্যা ধরার জন্য তৈরি, এমনকি কিছু ভুল সতর্কতার বিনিময়েও — আগাম সতর্কতার জন্য এটাই সঠিক পন্থা।",
    forDefensePanel: "থিসিস ডিফেন্স প্যানেলের জন্য",
    modelProvenance: "মডেলের বিস্তারিত তথ্য",
    citizenReportsEyebrow: "নাগরিক রিপোর্ট",
    citizenReportsTitle: "নাগরিকদের রিপোর্ট করা গাছ কাটা",
    reportCount: (n) => `${n} টি রিপোর্ট`,
    contactLabel: "যোগাযোগ",
    citizenReportsSub: "যাচাই করা হয়নি — স্যাটেলাইট মডেলের পাশাপাশি একটি সহায়ক অতিরিক্ত তথ্য, নিশ্চিত মাঠ পর্যায়ের তথ্য নয়।",
    loadingCitizenReports: "নাগরিকদের রিপোর্ট লোড হচ্ছে…",
    couldntLoadCitizenReports: "নাগরিকদের রিপোর্ট লোড করা যায়নি।",
    reportsNotSetUp: "নাগরিক রিপোর্টিং এখনো ব্যাকএন্ডে সেট আপ করা হয়নি।",
    noCitizenReports: "এখনো কোনো নাগরিক রিপোর্ট জমা পড়েনি।",
    kpiNationalLoss: "জাতীয় ক্ষতি, ২০১৭–২০২৪",
    kpiNationalLossSub: "নিশ্চিত, স্থায়ী ক্ষতি (এক-মৌসুমের সাময়িক হ্রাস নয়)",
    kpiAccelerating: "ত্বরান্বিত ক্ষতির জেলা",
    kpiAcceleratingSub: "নিজের ভিত্তির চেয়ে ≥১.৫ গুণ সাম্প্রতিক ক্ষতি",
    kpiAvgTreeCover: "গড় গাছপালার আচ্ছাদন",
    kpiAvgTreeCoverSub: "জাতীয় গড়, ২০২৪",
    kpiLossPatches: "চিহ্নিত ক্ষতিগ্রস্ত এলাকা",
    kpiLossPatchesSub: "≥০.২৫ বর্গ কিমি, ২০১৭–২০২৩",
    forestNotice: "এখানে সব ধরনের গাছপালার আচ্ছাদন গণনা করা হয়েছে — বাড়ির বাগান ও বাগান-বনসহ, শুধু সরকারি বনভূমি নয় — তাই এটিকে বন অধিদপ্তরের ১১–১৫% হিসাবের সাথে তুলনা করবেন না। সারাদেশের বছরভিত্তিক প্রবণতা ও ক্ষতির পূর্বাভাস ইচ্ছাকৃতভাবে এই ড্যাশবোর্ডে দেখানো হয়নি — মূল তথ্যের মধ্যেই যথেষ্ট অসামঞ্জস্য ছিল বলে তার উপর ভিত্তি করে পূর্বাভাসকে নির্ভরযোগ্য মনে করা যায়নি। নিচের জেলা তালিকা ও ক্ষতির মানচিত্র সব যাচাই পার হয়েছে।",
    rankedByLoss: "ক্ষতির ভিত্তিতে সাজানো",
    districtRanking64: "জেলা তালিকা — ৬৪ জেলা",
    restorationPriority: "পুনরুদ্ধার অগ্রাধিকার",
    topReplanting: "শীর্ষ পুনঃবনায়ন লক্ষ্য",
    protectedLoss: "সংরক্ষিত এলাকার ভেতরে নিশ্চিত ক্ষতি",
    protectedShort: "সংরক্ষিত",
    coverSuffix: "আচ্ছাদন",
    nationalLossByYear: "বছরভিত্তিক জাতীয় ক্ষতি",
    km2PerYear: "প্রতি বছর নিশ্চিত, স্থায়ী ক্ষতির বর্গ কিমি",
    fieldWorklist: "মাঠ কর্ম তালিকা",
    recentLossPatches: "সাম্প্রতিক ক্ষতিগ্রস্ত এলাকা",
    showingOf: (shown, total) => `${total} টির মধ্যে ${shown} টি দেখানো হচ্ছে, সংরক্ষিত + সাম্প্রতিক আগে`,
    downloadCsv: "CSV ডাউনলোড করুন",
    downloadCsvHint: "নিচের সারিগুলো একটি স্প্রেডশিট ফাইল হিসেবে ডাউনলোড করুন",
    colDistrict: "জেলা",
    colYear: "বছর",
    colArea: "এলাকা",
    colProtected: "সংরক্ষিত",
    colLocation: "অবস্থান",
    map: "মানচিত্র",
    yes: "হ্যাঁ",
    close: "বন্ধ করুন",
  },
};

function GovtDashboard({ role, onLogout }) {
  const [lang, setLang] = useState("en");
  const gt = GOVT_I18N[lang];
  const [activeModule, setActiveModule] = useState("heat");
  const [search, setSearch] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [selectedHeatDistrict, setSelectedHeatDistrict] = useState(null);
  const [floodTab, setFloodTab] = useState("dhaka"); // "dhaka" | "national"
  const [selectedFloodArea, setSelectedFloodArea] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const { districts: heatDistricts, grid: heatGrid, trend: heatTrend, alerts: heatAlerts, loading, error } = useHeatData();
  const floodDhaka = useFloodDhakaData();
  const floodNational = useNationalFloodData();
  const deforestation = useDeforestationData();
  const citizenReports = useCitizenReports();

  const activeLoading =
    activeModule === "flood" ? (floodTab === "national" ? floodNational.loading : floodDhaka.loading)
    : activeModule === "forest" ? deforestation.loading
    : loading;
  const activeError =
    activeModule === "flood" ? (floodTab === "national" ? floodNational.error : floodDhaka.error)
    : activeModule === "forest" ? deforestation.error
    : error;

  const filteredDistricts = useMemo(
    () => (heatDistricts || []).filter((d) => d.name.toLowerCase().includes(search.toLowerCase())),
    [search, heatDistricts]
  );

  const sortedByRisk = useMemo(
    () => [...(heatDistricts || [])].sort((a, b) => b.heat_risk - a.heat_risk),
    [heatDistricts]
  );

  const avgLst = heatDistricts?.length
    ? heatDistricts.reduce((s, d) => s + d.lst_c, 0) / heatDistricts.length
    : null;
  const highRiskCount = (heatDistricts || []).filter((d) => d.risk_category === "High").length;
  const suhiDistrictCount = (heatDistricts || []).filter((d) => d.uhi_intensity_c !== null && d.uhi_intensity_c !== undefined).length;
  const activeAlerts = heatAlerts?.alerts || [];

  // Real cross-module alert count for the header notification bell — no
  // invented "unread" state, just three genuine signals already computed
  // from live data: active heatwave watches, districts at Severe flood
  // risk, and districts flagged for accelerating deforestation.
  const floodSevereDistricts = (floodNational.severity || []).filter((s) => s.severity_tier === "Severe");
  const deforestAlertDistricts = (deforestation.districts || []).filter((d) => d.alert);
  const notifications = [
    ...activeAlerts.map((a) => ({
      module: "heat",
      text: `Heatwave watch: ${a.name} — peak ${a.peak_tmax_c.toFixed(1)}°C (${a.worst_category})`,
    })),
    ...floodSevereDistricts.map((s) => ({
      module: "flood",
      text: `${s.district_name}: Severe flood risk`,
    })),
    ...deforestAlertDistricts.map((d) => ({
      module: "forest",
      text: `${d.district}: flagged for accelerating deforestation`,
    })),
  ];

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex">
      {showReport && <ReportModal districts={heatDistricts || []} alerts={heatAlerts} onClose={() => setShowReport(false)} />}

      {/* Mobile nav backdrop */}
      {mobileNavOpen && (
        <div className="fixed inset-0 bg-black/60 z-30 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 md:w-60 border-r border-stone-700/80 flex flex-col shrink-0 bg-stone-900 md:bg-stone-900/60 transform transition-transform duration-200 ${
          mobileNavOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
      >
        <div className="px-5 py-5 border-b border-stone-700/80 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/25 to-orange-600/5 ring-1 ring-orange-500/25">
                <ShieldCheck size={16} className="text-orange-400" />
              </span>
              <span className="text-sm font-semibold text-stone-50 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                {gt.consoleName}
              </span>
            </div>
            <div className="text-[11px] text-stone-400 mt-2 pl-0.5">{gt.govtDashboard} · <span className="text-stone-300">{role}</span></div>
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="md:hidden text-stone-400 hover:text-stone-200 p-1">
            <X size={18} />
          </button>
        </div>

        {/* Color legend — always visible, no click/hover needed, so a
            brand-new officer knows what red/amber/green mean before they've
            read a single tier label anywhere in the app. */}
        <div className="px-4 py-3 border-b border-stone-700/80">
          <p className="text-[10px] text-stone-500 mb-1.5 leading-snug">{gt.legend}</p>
          <div className="space-y-1">
            <span className="flex items-center gap-1.5 text-[11px] text-stone-300"><span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" /> {gt.legendSafe}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-stone-300"><span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" /> {gt.legendCaution}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-stone-300"><span className="w-2 h-2 rounded-full bg-red-500 shrink-0" /> {gt.legendHigh}</span>
          </div>
        </div>

        <nav className="flex-1 py-3 px-3 space-y-1 overflow-y-auto">
          <button
            onClick={() => { setActiveModule("heat"); setMobileNavOpen(false); }}
            className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
              activeModule === "heat"
                ? "bg-orange-500/10 text-orange-400"
                : "text-stone-300 hover:bg-stone-800 hover:text-stone-200"
            }`}
          >
            {activeModule === "heat" && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-orange-500" />
            )}
            <Thermometer size={16} />
            {gt.navHeat}
          </button>
          {OTHER_MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => { setActiveModule(m.key); setMobileNavOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                activeModule === m.key ? "bg-stone-700/80 text-stone-200" : "text-stone-400 hover:bg-stone-800 hover:text-stone-300"
              }`}
            >
              <m.icon size={16} />
              <span className="flex-1 text-left">{gt[m.labelKey]}</span>
              {m.locked && <Lock size={12} className="text-stone-500" />}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-stone-700/80 space-y-1">
          <button
            onClick={() => setLang(lang === "en" ? "bn" : "en")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
          >
            <Languages size={15} />
            {lang === "en" ? "বাংলা" : "English"}
          </button>
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
          >
            <LogOut size={15} /> {gt.signOut}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-10 border-b border-stone-700/80 bg-stone-900/80 backdrop-blur-md px-3 md:px-6 py-3 md:py-3.5 flex items-center gap-2 md:gap-4 flex-wrap">
          <button onClick={() => setMobileNavOpen(true)} className="md:hidden text-stone-300 hover:text-stone-100 p-1 shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <div className="relative flex-1 min-w-[120px] max-w-sm order-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={gt.searchPlaceholder}
              className="w-full bg-stone-800/80 border border-stone-700 rounded-lg pl-8 pr-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-400 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-shadow"
            />
          </div>
          <div className="flex-1 hidden md:block" />
          {activeLoading && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-stone-400 order-2">
              <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-pulse" /> {gt.loadingLiveData}
            </span>
          )}
          {activeError && !activeLoading && (
            <span className="hidden sm:flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full order-2" title={activeError}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {gt.couldntLoad}
            </span>
          )}
          <div className="relative">
            <button
              onClick={() => setNotifOpen((v) => !v)}
              className="relative text-stone-400 hover:text-stone-200 transition-colors"
            >
              <Bell size={17} />
              {notifications.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-stone-900" />
              )}
            </button>
            {notifOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                <div className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-1.5rem)] bg-stone-800 border border-stone-700 rounded-xl shadow-xl shadow-black/40 z-20 overflow-hidden animate-fade-in">
                  <div className="px-4 py-3 border-b border-stone-700 text-xs font-medium text-stone-200">
                    {gt.notifications} {notifications.length > 0 ? `(${notifications.length})` : ""}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-stone-400 text-center">{gt.noActiveAlerts}</p>
                    ) : (
                      notifications.map((n, i) => (
                        <button
                          key={i}
                          onClick={() => {
                            setActiveModule(n.module);
                            if (n.module === "flood") setFloodTab("national");
                            setNotifOpen(false);
                          }}
                          className="w-full text-left px-4 py-2.5 text-xs text-stone-200 hover:bg-stone-700/70 border-b border-stone-700/60 last:border-0 transition-colors"
                        >
                          {n.text}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 text-sm px-2.5 md:px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 active:scale-[0.97] text-white shadow-lg shadow-orange-950/30 transition-all duration-150 shrink-0"
          >
            <FileText size={14} /> <span className="hidden sm:inline">{gt.generateReport}</span>
          </button>
        </div>

        {activeModule === "flood" ? (
          <FloodModuleContent
            floodTab={floodTab}
            setFloodTab={setFloodTab}
            dhaka={floodDhaka}
            national={floodNational}
            selectedArea={selectedFloodArea}
            setSelectedArea={setSelectedFloodArea}
            lang={lang}
          />
        ) : activeModule === "forest" ? (
          <DeforestationModuleContent
            data={deforestation}
            selectedDistrict={selectedDistrict}
            setSelectedDistrict={setSelectedDistrict}
            citizenReports={citizenReports}
            lang={lang}
          />
        ) : activeModule !== "heat" ? (
          <div className="flex-1 flex items-center justify-center p-10 animate-fade-in">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 rounded-2xl bg-stone-800 border border-stone-700 flex items-center justify-center mx-auto mb-4">
                <Lock size={22} className="text-stone-500" />
              </div>
              <p className="text-stone-100 font-medium">{gt.moduleInDevelopment}</p>
              <p className="text-sm text-stone-400 mt-1.5 leading-relaxed">
                {gt.moduleInDevelopmentBody(gt[OTHER_MODULES.find((m) => m.key === activeModule)?.labelKey] || "")}
              </p>
              <button
                onClick={() => setActiveModule("heat")}
                className="mt-5 text-sm text-orange-400 hover:text-orange-300 inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft size={14} /> {gt.backToHeat}
              </button>
            </div>
          </div>
        ) : loading || error || !heatDistricts ? (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 animate-fade-in">
            <DataStateNotice loading={loading} error={error} label="heat data" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 animate-fade-in">
            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi label={gt.kpiAvgTemp} value={avgLst !== null ? `${avgLst.toFixed(1)}C` : "—"} sub={gt.kpiAvgTempSub} icon={Thermometer} tone="orange" />
              <Kpi label={gt.kpiHighRisk} value={highRiskCount} sub={gt.kpiHighRiskSub(heatDistricts.length)} icon={AlertTriangle} tone="red" />
              <Kpi label={gt.kpiUhi} value={suhiDistrictCount} sub={gt.kpiUhiSub} icon={Users} />
              <Kpi
                label={gt.kpiHeatwaveWatches}
                value={activeAlerts.length}
                sub={heatAlerts?.generated_at ? gt.kpiHeatwaveLive : gt.kpiHeatwaveNotRun}
                icon={Bell}
                tone={activeAlerts.length ? "red" : "slate"}
              />
            </div>
            <p className="text-[10px] text-stone-500 -mt-4">{gt.kpiUhiGloss}</p>

            {heatAlerts?.generated_at && (
              <div className="flex items-center gap-2 text-[11px] text-emerald-400/80">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>
                  {gt.liveHeatBanner(
                    new Date(heatAlerts.generated_at).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", {
                      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
                    })
                  )}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Heat map */}
              <div className="lg:col-span-2 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Eyebrow>{gt.compositeSeason}</Eyebrow>
                    <h3 className="text-sm font-medium text-stone-100 mt-0.5">{gt.surfaceTempTitle}</h3>
                    <p className="text-xs text-stone-400 mt-0.5">{gt.surfaceTempSub}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
                    <span>25°C</span>
                    <div className="w-16 h-2 rounded-full ring-1 ring-black/20" style={{ background: "linear-gradient(to right, rgb(45,130,130), rgb(210,170,40), rgb(190,40,30))" }} />
                    <span>30°C</span>
                  </div>
                </div>
                {heatGrid ? (
                  <>
                    <div className="flex items-center justify-center py-4">
                      <HeatGrid grid={heatGrid} />
                    </div>
                    <p className="text-[11px] text-stone-500 text-center">{gt.gridNote}</p>
                  </>
                ) : (
                  <p className="text-xs text-stone-400 py-8 text-center">{gt.noGridData}</p>
                )}
              </div>

              {/* District ranking */}
              <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
                <Eyebrow>{gt.priorityRanking}</Eyebrow>
                <h3 className="text-sm font-medium text-stone-100 mt-0.5">{gt.heatMitigationTitle}</h3>
                <p className="text-[11px] text-stone-500 mb-3">{gt.heatMitigationSub}</p>
                <div className="space-y-1 max-h-[360px] overflow-y-auto">
                  {sortedByRisk.map((d, i) => {
                    const c = tierColor(d.risk_category);
                    const isSelected = selectedHeatDistrict?.name === d.name;
                    return (
                      <button
                        key={d.name}
                        onClick={() => setSelectedHeatDistrict(d)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${
                          isSelected ? "bg-stone-700/70 ring-1 " + c.ring : "hover:bg-stone-800/80"
                        }`}
                      >
                        <span className="text-[11px] text-stone-500 w-4 tabular-nums">{i + 1}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className="flex-1 text-sm text-stone-200">{d.name}</span>
                        <span className="text-xs text-stone-400 tabular-nums">{d.lst_c.toFixed(1)}°C</span>
                        <ChevronRight size={13} className={`text-stone-500 transition-transform ${isSelected ? "translate-x-0.5" : ""}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {selectedHeatDistrict && (
              <div className={`rounded-2xl p-4 border ${tierColor(selectedHeatDistrict.risk_category).bg} border-stone-700 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20`}>
                <IconBadge icon={MapPin} tone={selectedHeatDistrict.risk_category === "High" ? "red" : selectedHeatDistrict.risk_category === "Medium" ? "amber" : "teal"} />
                <div className="flex-1">
                  <span className="text-sm text-stone-100 font-medium">{selectedHeatDistrict.name}</span>
                  <span className="text-xs text-stone-400 ml-2">
                    {selectedHeatDistrict.lst_c.toFixed(1)}°C · {tierLabel(selectedHeatDistrict.risk_category, lang)} · NDVI {selectedHeatDistrict.ndvi.toFixed(2)} · {gt.builtGloss.split(" = ")[0]} {selectedHeatDistrict.built_fraction.toFixed(3)}
                    {selectedHeatDistrict.uhi_intensity_c !== null && selectedHeatDistrict.uhi_intensity_c !== undefined
                      ? ` · SUHI ${selectedHeatDistrict.uhi_intensity_c.toFixed(2)}°C`
                      : ""}
                  </span>
                  <div className="text-[10px] text-stone-500 mt-1">{gt.ndviGloss} · {gt.suhiGloss}</div>
                </div>
                <button onClick={() => setSelectedHeatDistrict(null)} className="text-stone-400 hover:text-stone-200 hover:bg-black/20 rounded-lg p-1 transition-colors">
                  <X size={15} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Trend chart */}
              <div className="lg:col-span-2 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-orange-400/80" />
                  <h3 className="text-sm font-medium text-stone-100">{gt.trendTitle}</h3>
                </div>
                <p className="text-xs text-stone-400 mb-3">{gt.trendSub}</p>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={heatTrend || []} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={[24, 32]} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}
                        labelStyle={{ color: "#cbd5e1", marginBottom: 2 }}
                        cursor={{ stroke: "#334155", strokeWidth: 1 }}
                      />
                      <Line type="monotone" dataKey="baseline" stroke="#475569" strokeWidth={1.5} dot={false} name="Pre-drift baseline" />
                      <Line
                        type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={2.5} name="Observed"
                        dot={(props) => {
                          const { cx, cy, payload, index } = props;
                          return (
                            <circle key={`dot-${payload.year ?? index}`} cx={cx} cy={cy} r={2.5}
                              fill={payload.excluded ? "#0f172a" : "#fb923c"}
                              stroke="#fb923c" strokeWidth={payload.excluded ? 1.5 : 0} />
                          );
                        }}
                        activeDot={{ r: 4.5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Heatwave watch */}
              <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
                <div className="flex items-center gap-2 mb-1">
                  <Bell size={14} className="text-orange-400/80" />
                  <h3 className="text-sm font-medium text-stone-100">{gt.heatwaveWatch}</h3>
                </div>
                <p className="text-[11px] text-stone-400 mb-3.5 leading-relaxed">{gt.heatwaveWatchSub}</p>
                {!heatAlerts?.generated_at ? (
                  <p className="text-xs text-stone-400">{gt.noForecastYet}</p>
                ) : activeAlerts.length === 0 ? (
                  <p className="text-xs text-emerald-300/90">{gt.noHeatwaveForecast(heatAlerts.forecast_days)}</p>
                ) : (
                  <div className="space-y-3">
                    {activeAlerts.map((a) => (
                      <div key={a.name} className="flex gap-3">
                        <IconBadge icon={AlertTriangle} tone="red" size={14} />
                        <div>
                          <p className="text-xs font-medium text-stone-200">{a.name} · {a.worst_category}</p>
                          <p className="text-[11px] text-stone-400 mt-0.5 leading-relaxed">
                            {gt.heatwavePeak(a, heatAlerts.forecast_days)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {search && (
              <div className="text-xs text-stone-400">
                {gt.searchMatch(filteredDistricts.length, search)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flood module content — two real, separate datasets: Dhaka (city-block
// rule-based composite score, historical 2025 window) and Nationwide
// (64-district trained Random Forest, 2015-2024). Shown as two tabs rather
// than merged, since they're different scales and different methods —
// merging them would blur that distinction rather than clarify it.
// ---------------------------------------------------------------------------

function FloodModuleContent({ floodTab, setFloodTab, dhaka, national, selectedArea, setSelectedArea, lang }) {
  const gt = GOVT_I18N[lang];
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 animate-fade-in">
      <div className="inline-flex items-center gap-1 bg-stone-800/80 border border-stone-700 rounded-lg p-1">
        <button
          onClick={() => setFloodTab("dhaka")}
          className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${floodTab === "dhaka" ? "bg-stone-700 text-stone-50" : "text-stone-400 hover:text-stone-200"}`}
        >
          {gt.floodTabDhaka}
        </button>
        <button
          onClick={() => setFloodTab("national")}
          className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${floodTab === "national" ? "bg-stone-700 text-stone-50" : "text-stone-400 hover:text-stone-200"}`}
        >
          {gt.floodTabNational}
        </button>
      </div>

      {floodTab === "dhaka" ? (
        <FloodDhakaView dhaka={dhaka} selectedArea={selectedArea} setSelectedArea={setSelectedArea} lang={lang} />
      ) : (
        <FloodNationalView national={national} lang={lang} />
      )}
    </div>
  );
}

function FloodDhakaView({ dhaka, selectedArea, setSelectedArea, lang }) {
  const gt = GOVT_I18N[lang];
  const { grid, trend, areas, summary, loading, error } = dhaka;

  if (loading || error || !summary) {
    return <DataStateNotice loading={loading} error={error} label="Dhaka flood data" />;
  }

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={gt.kpiFloodProne} value={`${summary.floodPronePct}%`} sub={`${summary.floodProneCells} / ${summary.totalCells}`} icon={Droplets} tone="orange" />
        <Kpi label={gt.kpiPeakAlerted} value={`${summary.peakPctAlerted}%`} sub={summary.peakDate} icon={AlertTriangle} tone="red" />
        <Kpi label={gt.kpiAlertDays} value={summary.alertDays} sub={gt.kpiAlertDaysSub(summary.totalDays)} />
        <Kpi label={gt.kpiRainfall} value={`${summary.observedRainfall}mm`} sub={gt.kpiRainfallSub(summary.historicalRainfall)} tone="teal" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>{gt.realData2025}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5">{gt.dhakaFloodTitle}</h3>
          <p className="text-xs text-stone-400 mt-0.5 mb-4">{gt.dhakaFloodSub}</p>
          <div className="flex items-center justify-center py-4">
            {grid && <HeatGrid grid={grid} colorFn={riskScoreToColor} labelFn={(v) => `${(v * 100).toFixed(0)}%`} />}
          </div>
          <p className="text-[11px] text-stone-500 text-center">{gt.dhakaGridNote}</p>
        </div>

        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>{gt.highestRisk}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5 mb-4">{gt.topLocations}</h3>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(areas || []).map((a, i) => {
              const isSelected = selectedArea?.area === a.area;
              return (
                <button
                  key={a.area}
                  onClick={() => setSelectedArea(a)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${isSelected ? "bg-stone-700/70 ring-1 ring-orange-500/30" : "hover:bg-stone-800/80"}`}
                >
                  <span className="text-[11px] text-stone-500 w-4 tabular-nums">{i + 1}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${a.category === "High" ? "bg-red-500" : a.category === "Medium" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <span className="flex-1 min-w-0 text-xs text-stone-200 truncate" title={a.name ? a.area : undefined}>{a.name || a.area}</span>
                  <span className="text-xs text-stone-400 tabular-nums">{(a.risk * 100).toFixed(0)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedArea && (
        <div className="rounded-2xl p-4 border bg-stone-800/40 border-stone-700 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20">
          <IconBadge icon={MapPin} tone={selectedArea.category === "High" ? "red" : "amber"} />
          <div className="flex-1 min-w-0">
            <span className="text-sm text-stone-100 font-medium">{selectedArea.name || selectedArea.area}</span>
            <span className="text-xs text-stone-400 ml-2">
              {(selectedArea.risk * 100).toFixed(0)}% · {tierLabel(selectedArea.category, lang)} · {selectedArea.elevation}m · {selectedArea.riverDist}m
            </span>
            {selectedArea.name && (
              <div className="text-[11px] text-stone-500 mt-0.5">{selectedArea.area}</div>
            )}
          </div>
          <button onClick={() => setSelectedArea(null)} className="text-stone-400 hover:text-stone-200 hover:bg-black/20 rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {trend && (
        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-orange-400/80" />
            <h3 className="text-sm font-medium text-stone-100">{gt.rainfallVsAlert}</h3>
          </div>
          <p className="text-xs text-stone-400 mb-3">{gt.rainfallVsAlertSub}</p>
          <div style={{ width: "100%", height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="#64748b" fontSize={10} tickLine={false} axisLine={false} interval={6} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12 }} />
                <Line type="monotone" dataKey="rainfall" stroke="#38bdf8" strokeWidth={1.5} dot={false} name="Rainfall (mm)" />
                <Line type="monotone" dataKey="pctAlerted" stroke="#fb923c" strokeWidth={2} dot={false} name="% area alerted" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="text-[11px] text-stone-500">
        No supervised model was trained for Dhaka — no flood-event ground truth exists for this window. Risk
        scores are a relative, comparative signal, not a calibrated probability.
      </p>
    </>
  );
}

function FloodNationalView({ national, lang }) {
  const gt = GOVT_I18N[lang];
  const { severity, priority, summary, loading, error } = national;

  const severityByDistrict = useMemo(() => {
    const m = {};
    (severity || []).forEach((s) => { m[s.district_id] = s; });
    return m;
  }, [severity]);

  // Real, un-rounded evidence that the pipeline recomputes every run, even
  // on days the rounded percentages above don't visibly move: every
  // district's current avg_predicted_risk against the previous_avg_predicted_risk
  // the automation script itself recorded (scripts/models/flood_export.py),
  // before it overwrote that file on the last run. Never invented — a
  // district with no previous value yet (first-ever run) is simply excluded.
  const movementStats = useMemo(() => {
    const deltas = (severity || [])
      .filter((s) => typeof s.previous_avg_predicted_risk === "number" && typeof s.avg_predicted_risk === "number")
      .map((s) => Math.abs(s.avg_predicted_risk - s.previous_avg_predicted_risk));
    if (deltas.length === 0) return null;
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    return { avg, min: Math.min(...deltas), max: Math.max(...deltas), n: deltas.length };
  }, [severity]);

  if (loading || error || !summary) {
    return <DataStateNotice loading={loading} error={error} label="nationwide flood data" />;
  }

  const topPriority = (priority || []).slice(0, 20);
  const observedYears = summary.observed_years || [];
  const proxyYears = summary.proxy_years || [];

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={gt.kpiDistrictsCovered} value={summary.districts} sub={gt.allBangladesh} icon={MapPin} />
        <Kpi label={gt.kpiValidatedRecall} value="83%" sub={gt.kpiValidatedRecallSub} icon={ShieldCheck} tone="teal" />
        <Kpi label={gt.kpiValidatedAuc} value="0.91" sub={gt.kpiValidatedAucSub} tone="teal" />
        <Kpi label={gt.kpiTopPriority} value={topPriority[0]?.district_name || "—"} sub={gt.kpiTopPrioritySub} icon={AlertTriangle} tone="red" />
      </div>

      {summary.last_refreshed_at && (
        <div className="flex items-center gap-2 text-[11px] text-emerald-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            {gt.liveFloodBanner(
              summary.live_prediction_window?.end_date,
              new Date(summary.last_refreshed_at).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", {
                day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
              })
            )}
          </span>
        </div>
      )}

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex items-start gap-3">
        <IconBadge icon={Info} tone="amber" size={14} />
        <p className="text-xs text-amber-200/90 leading-relaxed">
          {gt.fieldNoticeFlood}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>{gt.mitigationPriority}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5 mb-1">{gt.top20of64}</h3>
          <p className="text-xs text-stone-400 mb-1">{gt.rankedByScore}</p>
          <p className="text-[11px] text-stone-500 mb-1">{gt.badgeVsPercent}</p>
          <p className="text-[11px] text-stone-500 mb-4">{gt.scoreDeltaLegend}</p>
          <div className="space-y-1">
            {topPriority.map((d) => {
              const sev = severityByDistrict[d.district_id];
              const tier = sev?.severity_tier || "Moderate";
              const c = tierColor(tier);
              const prevRisk = sev?.previous_avg_predicted_risk;
              const hasDelta = typeof prevRisk === "number";
              const delta = hasDelta ? d.avg_predicted_risk - prevRisk : null;
              return (
                <div key={d.district_id} className="w-full flex items-center gap-2 sm:gap-3 p-2 rounded-lg hover:bg-stone-800/80 transition-colors">
                  <span className="text-[11px] text-stone-500 w-5 tabular-nums shrink-0">{d.priority_rank}</span>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
                  <span className="flex-1 min-w-0 text-sm text-stone-200 truncate">{d.district_name}</span>
                  <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`} title="Historical severity tier — based on past flood magnitude (DFO severity + flooded extent), not this week's weather">{tierLabel(tier, lang)}</span>
                  <RiskTrendBadge trend={sev?.risk_trend} />
                  {hasDelta ? (
                    <span
                      className={`shrink-0 text-[10px] tabular-nums w-16 text-right ${delta > 0 ? "text-amber-400" : delta < 0 ? "text-emerald-400" : "text-stone-500"}`}
                      title={gt.scoreDeltaTooltip(prevRisk.toFixed(4), d.avg_predicted_risk.toFixed(4))}
                    >
                      Δ{delta >= 0 ? "+" : ""}{delta.toFixed(4)}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] text-stone-600 w-16 text-right" title={gt.noDeltaYet}>—</span>
                  )}
                  <span className="shrink-0 text-xs text-stone-400 tabular-nums w-20 text-right" title="This week's live predicted flood risk from real rainfall — separate from the historical severity badge">{(d.avg_predicted_risk * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-stone-500 mt-3">{gt.moreDistricts(Math.max(0, (priority || []).length - 20))}</p>
        </div>

        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow tone="teal">{gt.modelProvenance}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5 mb-3">{gt.forDefensePanel}</h3>
          <div className="space-y-3 text-xs text-stone-300">
            <div><span className="text-stone-200">Algorithm:</span> Random Forest, class-weighted</div>
            <div><span className="text-stone-200">Rows:</span> {summary.rows_total?.toLocaleString()} district-days</div>
            <div><span className="text-stone-200">Date range:</span> {summary.date_range?.[0]} – {summary.date_range?.[1]}</div>
            <div><span className="text-stone-200">Train years:</span> {summary.train_years?.join("–")} (real events only)</div>
            <div><span className="text-stone-200">Test years:</span> {summary.test_years?.join("–")}</div>
            {summary.live_prediction_window && (
              <div className="pt-2 border-t border-stone-700">
                <span className="text-stone-200">Live risk window:</span> {summary.live_prediction_window.start_date} – {summary.live_prediction_window.end_date}
                {" "}({summary.live_prediction_window.window_days} real days, refreshed every 3 days via Open-Meteo)
              </div>
            )}
            <div className="pt-2 border-t border-stone-700">
              <span className="text-stone-200">Exposure proxy:</span> district area (population data wasn't in the
              original export — a disclosed limitation, not a hidden one)
            </div>
            {movementStats && (
              <div className="pt-2 border-t border-stone-700">
                <div className="text-stone-200 mb-1">{gt.avgMovementTitle}</div>
                <div className="text-stone-400">
                  {gt.avgMovementBody(
                    movementStats.avg.toFixed(4),
                    movementStats.min.toFixed(4),
                    movementStats.max.toFixed(4),
                    movementStats.n
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Deforestation module content — real data: Random Forest on seasonal MODIS
// NDVI, 2015-2025, all 64 districts. National year-by-year trend direction
// and the loss forecast are deliberately NOT shown — the notebook's own
// integration-readiness check quarantined both (three normalisation methods
// disagree even on the sign of the decade change; the forecast's backtest
// error exceeds its usability threshold). What IS shown — the 2020
// cross-section, district rankings, and loss locations — passed all 35
// core checks.
// ---------------------------------------------------------------------------

// Client-side CSV export of the worklist rows already fetched — no backend
// change needed. This is the difference between "a list on screen" and
// something a field officer can actually take with them (open in a
// spreadsheet, print, share over WhatsApp) when they're headed out with
// patchy or no connectivity.
function downloadWorklistCsv(rows) {
  const header = ["district", "loss_year", "area_km2", "in_protected", "lat", "lon"];
  const lines = [header.join(",")];
  rows.forEach((p) => {
    const vals = [
      p.district ?? "",
      p.loss_year ?? "",
      p.area_km2 ?? "",
      p.in_protected ? "yes" : "no",
      p.lat ?? "",
      p.lon ?? "",
    ];
    lines.push(vals.map((v) => (typeof v === "string" && v.includes(",") ? `"${v}"` : v)).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `deforestation_worklist_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DeforestationModuleContent({ data, selectedDistrict, setSelectedDistrict, citizenReports, lang }) {
  const gt = GOVT_I18N[lang];
  const { districts, worklist, worklistTotal, restoration, lossByYear, loading, error } = data;

  if (loading || error || !districts) {
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6 animate-fade-in">
        <DataStateNotice loading={loading} error={error} label="deforestation data" />
      </div>
    );
  }

  const nationalLossKm2 = (lossByYear || []).reduce((sum, r) => sum + (r.km2_lost || 0), 0);
  const alertCount = districts.filter((d) => d.alert).length;
  const avgForestPct = districts.reduce((s, d) => s + (d.forest_pct_now || 0), 0) / districts.length;
  const sortedByLoss = [...districts].sort((a, b) => (b.forest_loss_pct || 0) - (a.forest_loss_pct || 0));
  const topRestoration = (restoration || []).filter((r) => r.restoration_tier === "High").slice(0, 10);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 animate-fade-in">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label={gt.kpiNationalLoss} value={`${Math.round(nationalLossKm2).toLocaleString()} km²`} sub={gt.kpiNationalLossSub} icon={TreeDeciduous} tone="red" />
        <Kpi label={gt.kpiAccelerating} value={alertCount} sub={gt.kpiAcceleratingSub} icon={AlertTriangle} tone="orange" />
        <Kpi label={gt.kpiAvgTreeCover} value={`${avgForestPct.toFixed(1)}%`} sub={gt.kpiAvgTreeCoverSub} tone="teal" />
        <Kpi label={gt.kpiLossPatches} value={(worklistTotal ?? worklist?.length ?? 0).toLocaleString()} sub={gt.kpiLossPatchesSub} />
      </div>

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex items-start gap-3">
        <IconBadge icon={Info} tone="amber" size={14} />
        <p className="text-xs text-amber-200/90 leading-relaxed">{gt.forestNotice}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>{gt.rankedByLoss}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5 mb-4">{gt.districtRanking64}</h3>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {sortedByLoss.map((d, i) => {
              const c = tierColor(d.priority);
              const isSelected = selectedDistrict?.district === d.district;
              return (
                <button
                  key={d.district}
                  onClick={() => setSelectedDistrict(d)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${isSelected ? "bg-stone-700/70 ring-1 " + c.ring : "hover:bg-stone-800/80"}`}
                >
                  <span className="text-[11px] text-stone-500 w-5 tabular-nums">{i + 1}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  <span className="flex-1 min-w-0 text-sm text-stone-200 truncate">{d.district}</span>
                  {d.protected_loss_km2 > 0 && (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-950/40 text-red-400 shrink-0"
                      title={gt.protectedLoss}
                    >
                      {d.protected_loss_km2.toFixed(1)} km² {gt.protectedShort}
                    </span>
                  )}
                  <span className="text-xs text-stone-400 tabular-nums shrink-0">{d.forest_pct_now?.toFixed(1)}% {gt.coverSuffix}</span>
                  <ChevronRight size={13} className={`text-stone-500 transition-transform shrink-0 ${isSelected ? "translate-x-0.5" : ""}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow tone="teal">{gt.restorationPriority}</Eyebrow>
          <h3 className="text-sm font-medium text-stone-100 mt-0.5 mb-4">{gt.topReplanting}</h3>
          <div className="space-y-2.5">
            {topRestoration.map((r, i) => (
              <div key={r.district} className="flex items-center gap-2.5">
                <IconBadge icon={Sprout} tone="teal" size={13} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-200 truncate">{r.district}</p>
                  <p className="text-[11px] text-stone-400">{r.forest_pct_now?.toFixed(1)}% {gt.coverSuffix} · {r.trend}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedDistrict && (
        <div className={`rounded-2xl p-4 border ${tierColor(selectedDistrict.priority).bg} border-stone-700 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20`}>
          <IconBadge icon={TreeDeciduous} tone={selectedDistrict.priority === "High" ? "red" : selectedDistrict.priority === "Medium" ? "amber" : "teal"} />
          <div className="flex-1">
            <span className="text-sm text-stone-100 font-medium">{selectedDistrict.district}</span>
            <span className="text-xs text-stone-400 ml-2">
              {selectedDistrict.forest_pct_now?.toFixed(1)}% {gt.coverSuffix} · -{selectedDistrict.forest_loss_pct?.toFixed(1)}% (2016–) ·
              {" "}{selectedDistrict.trend} · {tierLabel(selectedDistrict.restoration_tier, lang)}
              {selectedDistrict.protected_loss_km2 > 0 && ` · ${selectedDistrict.protected_loss_km2.toFixed(1)} km² ${gt.protectedShort}`}
            </span>
          </div>
          <button onClick={() => setSelectedDistrict(null)} className="text-stone-400 hover:text-stone-200 hover:bg-black/20 rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {lossByYear && lossByYear.length > 0 && (
        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <h3 className="text-sm font-medium text-stone-100 mb-1">{gt.nationalLossByYear}</h3>
          <p className="text-xs text-stone-400 mb-3">{gt.km2PerYear}</p>
          <div style={{ width: "100%", height: 180 }}>
            <ResponsiveContainer>
              <BarChart data={lossByYear} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="year" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12 }} />
                <Bar dataKey="km2_lost" fill="#dc2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {worklist && worklist.length > 0 && (
        <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <div>
              <Eyebrow tone="orange">{gt.fieldWorklist}</Eyebrow>
              <h3 className="text-sm font-medium text-stone-100 mt-0.5">{gt.recentLossPatches}</h3>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] text-stone-400">{gt.showingOf(Math.min(50, worklist.length), (worklistTotal ?? worklist.length).toLocaleString())}</span>
              <button
                onClick={() => downloadWorklistCsv(worklist)}
                className="text-[11px] px-2 py-1 rounded-lg border border-stone-700 text-stone-300 hover:text-stone-100 hover:bg-stone-800 transition-colors shrink-0"
                title={gt.downloadCsvHint}
              >
                {gt.downloadCsv}
              </button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 bg-stone-800">
                <tr className="text-stone-400 text-left">
                  <th className="py-1.5 font-medium border-b border-stone-700">{gt.colDistrict}</th>
                  <th className="py-1.5 font-medium border-b border-stone-700">{gt.colYear}</th>
                  <th className="py-1.5 font-medium border-b border-stone-700">{gt.colArea}</th>
                  <th className="py-1.5 font-medium border-b border-stone-700">{gt.colProtected}</th>
                  <th className="py-1.5 font-medium border-b border-stone-700">{gt.colLocation}</th>
                </tr>
              </thead>
              <tbody>
                {worklist.slice(0, 50).map((p, i) => (
                  <tr key={i} className={i % 2 === 1 ? "bg-stone-800/30" : ""}>
                    <td className="py-1.5 px-1 text-stone-200">{p.district}</td>
                    <td className="py-1.5 px-1 text-stone-300">{p.loss_year}</td>
                    <td className="py-1.5 px-1 text-stone-300">{p.area_km2?.toFixed(2)} km²</td>
                    <td className="py-1.5 px-1">
                      {p.in_protected ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-950/40 text-red-400">{gt.yes}</span> : <span className="text-stone-500">—</span>}
                    </td>
                    <td className="py-1.5 px-1">
                      {p.lat != null && p.lon != null ? (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 tabular-nums"
                          title={`${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`}
                        >
                          <MapPin size={11} /> {gt.map}
                        </a>
                      ) : (
                        <span className="text-stone-500">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-5 shadow-sm shadow-black/20">
        <div className="flex items-center justify-between mb-1">
          <div>
            <Eyebrow tone="teal">{gt.citizenReportsEyebrow}</Eyebrow>
            <h3 className="text-sm font-medium text-stone-100 mt-0.5">{gt.citizenReportsTitle}</h3>
          </div>
          {citizenReports?.reports && (
            <span className="text-[11px] text-stone-400">{gt.reportCount(citizenReports.reports.length)}</span>
          )}
        </div>
        <p className="text-xs text-stone-400 mb-3">{gt.citizenReportsSub}</p>
        {citizenReports?.loading ? (
          <p className="text-xs text-stone-400 py-4">{gt.loadingCitizenReports}</p>
        ) : citizenReports?.error ? (
          <p className="text-xs text-amber-500 py-4">{gt.couldntLoadCitizenReports}</p>
        ) : citizenReports?.configured === false ? (
          <p className="text-xs text-stone-400 py-4">{gt.reportsNotSetUp}</p>
        ) : !citizenReports?.reports || citizenReports.reports.length === 0 ? (
          <p className="text-xs text-stone-400 py-4">{gt.noCitizenReports}</p>
        ) : (
          <div className="space-y-2.5 max-h-64 overflow-y-auto">
            {citizenReports.reports.map((r) => (
              <div key={r.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-stone-800/60">
                <IconBadge icon={AlertTriangle} tone="amber" size={12} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-200">
                    <span className="font-medium">{r.district}</span> — {r.description}
                  </p>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    {new Date(r.created_at).toLocaleString(lang === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {r.contact ? ` · ${gt.contactLabel}: ${r.contact}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citizen dashboard
// ---------------------------------------------------------------------------
// Real, citizen-facing additions (this revision): a district picker so the
// page is about the citizen's own area instead of a fixed demo ward; a real
// flood-risk card sourced from the same live, 3-day-refreshed national flood
// model the government dashboard uses (flood_national_severity.json — no new
// model, no invented numbers); tier-based safety guidance instead of just a
// number; and an English/Bangla toggle for the static text on this page.
// Nothing here fabricates specific shelter locations for a real district —
// the flood card points to the real, publicly known national emergency
// number (999) and local Union Parishad / Upazila office instead, since no
// real shelter-location dataset exists for this project.

const CITIZEN_I18N = {
  en: {
    appName: "Bangladesh Environmental Watch",
    exit: "Exit",
    back: "Back",
    hubHint: "Tap a category to see details for your area.",
    heatModuleLabel: "Heat monitoring",
    floodModuleLabel: "Flood risk",
    forestModuleLabel: "Deforestation",
    yourArea: "Your area",
    yourAreaHint: "Flood risk, heat risk and tree cover below update for whichever district you pick.",
    heatwaveWatchOne: "1 location nationally is forecast to see heatwave-level heat in the next 7 days.",
    heatwaveWatchMany: "locations nationally are forecast to see heatwave-level heat in the next 7 days.",
    heatMapTitle: "Heat map — nationwide",
    currentTemp: "Surface temp, your district",
    healthAdvisoryTitle: "Health advisory",
    floodRiskTitle: "Flood risk —",
    floodRiskLive: "Live, rescored every 3 days from real rainfall",
    floodRiskFallback: "Flood data isn't available right now — showing the last known status.",
    floodRiskFallbackNote: "Couldn't load live flood data. Try again shortly.",
    trendUp: "rising since last update",
    trendDown: "falling since last update",
    trendSteady: "steady since last update",
    whatToDo: "What to do",
    emergencyLine: "National emergency helpline: 999 (fire, flood rescue, ambulance)",
    emergencyLine2: "For your nearest official shelter, contact your local Union Parishad / Ward office.",
    treeCoverTitle: "Tree cover —",
    footer: "Live data from the backend where available.",
    loading: "Loading…",
    reportTitle: "Seen tree-cutting nearby?",
    reportHint: "Satellite data can miss small, local cutting. Your report helps — it's shown to government reviewers, not verified automatically.",
    reportDescriptionPlaceholder: "What did you see, and roughly where? (e.g. \"several trees cut near the riverbank, Ward 4\")",
    reportContactPlaceholder: "Phone or email (optional)",
    reportSubmit: "Submit report",
    reportSending: "Sending…",
    reportSuccess: "Thank you — your report was submitted.",
    reportReference: "Reference number, if you need to follow up:",
    reportNotConfigured: "Reports aren't accepted yet — this feature needs one more setup step on the backend.",
    reportError: "Couldn't submit your report. Please try again shortly.",
    reportTooShort: "Please add a few more words describing what you saw.",
    legendSafe: "Safe",
    legendCaution: "Caution",
    legendHigh: "High risk",
    listen: "Listen",
  },
  bn: {
    appName: "বাংলাদেশ পরিবেশ পর্যবেক্ষণ",
    exit: "বের হন",
    back: "ফিরে যান",
    hubHint: "বিস্তারিত দেখতে যেকোনো একটি বিভাগে ট্যাপ করুন।",
    heatModuleLabel: "তাপ পর্যবেক্ষণ",
    floodModuleLabel: "বন্যার ঝুঁকি",
    forestModuleLabel: "বন উজাড়",
    yourArea: "আপনার এলাকা",
    yourAreaHint: "নিচের বন্যার ঝুঁকি, তাপের ঝুঁকি ও বনভূমি তথ্য আপনার বাছাই করা জেলা অনুযায়ী বদলাবে।",
    heatwaveWatchOne: "সারাদেশে ১টি এলাকায় আগামী ৭ দিনে তাপপ্রবাহ-মাত্রার তাপ পূর্বাভাস দেওয়া হয়েছে।",
    heatwaveWatchMany: "টি এলাকায় আগামী ৭ দিনে তাপপ্রবাহ-মাত্রার তাপ পূর্বাভাস দেওয়া হয়েছে।",
    heatMapTitle: "তাপ মানচিত্র — সারাদেশ",
    currentTemp: "ভূপৃষ্ঠের তাপমাত্রা, আপনার জেলা",
    healthAdvisoryTitle: "স্বাস্থ্য পরামর্শ",
    floodRiskTitle: "বন্যার ঝুঁকি —",
    floodRiskLive: "লাইভ — প্রতি ৩ দিন পরপর প্রকৃত বৃষ্টিপাতের তথ্য দিয়ে হালনাগাদ",
    floodRiskFallback: "এই মুহূর্তে বন্যার তথ্য পাওয়া যাচ্ছে না — সর্বশেষ জানা অবস্থা দেখানো হচ্ছে।",
    floodRiskFallbackNote: "লাইভ বন্যার তথ্য লোড করা যায়নি। একটু পর আবার চেষ্টা করুন।",
    trendUp: "গত হালনাগাদের তুলনায় বাড়ছে",
    trendDown: "গত হালনাগাদের তুলনায় কমছে",
    trendSteady: "গত হালনাগাদের তুলনায় একই আছে",
    whatToDo: "কী করবেন",
    emergencyLine: "জাতীয় জরুরি সেবা: ৯৯৯ (ফায়ার সার্ভিস, বন্যা উদ্ধার, অ্যাম্বুলেন্স)",
    emergencyLine2: "নিকটতম সরকারি আশ্রয়কেন্দ্রের জন্য আপনার স্থানীয় ইউনিয়ন পরিষদ / ওয়ার্ড অফিসে যোগাযোগ করুন।",
    treeCoverTitle: "বনভূমি —",
    footer: "যেখানে সম্ভব ব্যাকএন্ড থেকে লাইভ তথ্য দেখানো হয়।",
    loading: "লোড হচ্ছে…",
    reportTitle: "আশেপাশে গাছ কাটা দেখেছেন?",
    reportHint: "স্যাটেলাইট ডেটা ছোট আকারের স্থানীয় গাছ কাটা ধরতে পারে না। আপনার রিপোর্ট সাহায্য করে — এটা সরকারি পর্যালোচকদের দেখানো হয়, স্বয়ংক্রিয়ভাবে যাচাই করা হয় না।",
    reportDescriptionPlaceholder: "কী দেখেছেন, আনুমানিক কোথায়? (যেমন: \"নদীর ধারে কয়েকটি গাছ কাটা হয়েছে, ওয়ার্ড ৪\")",
    reportContactPlaceholder: "ফোন বা ইমেইল (ঐচ্ছিক)",
    reportSubmit: "রিপোর্ট জমা দিন",
    reportSending: "পাঠানো হচ্ছে…",
    reportSuccess: "ধন্যবাদ — আপনার রিপোর্ট জমা হয়েছে।",
    reportReference: "পরে খোঁজ নিতে হলে এই রেফারেন্স নাম্বারটা রাখুন:",
    reportNotConfigured: "রিপোর্ট এখনো গ্রহণ করা হচ্ছে না — এই ফিচারের জন্য backend-এ আরেকটা setup ধাপ বাকি আছে।",
    reportError: "আপনার রিপোর্ট জমা দেওয়া যায়নি। একটু পর আবার চেষ্টা করুন।",
    reportTooShort: "আপনি কী দেখেছেন সেটা আরেকটু বিস্তারিত লিখুন।",
    legendSafe: "নিরাপদ",
    legendCaution: "সতর্কতা",
    legendHigh: "উচ্চ ঝুঁকি",
    listen: "শুনুন",
  },
};

function floodSafetySteps(tier, lang) {
  const steps = {
    en: {
      Severe: [
        "Keep valuables and important documents on a higher floor or shelf.",
        "Charge your phone and keep a torch or flashlight ready.",
        "Avoid crossing flooded roads or rivers on foot or by vehicle.",
        "If local authorities announce evacuation, leave early rather than waiting.",
      ],
      High: [
        "Keep valuables and important documents on a higher floor or shelf.",
        "Charge your phone and keep a torch or flashlight ready.",
        "Avoid crossing flooded roads or rivers on foot or by vehicle.",
      ],
      Moderate: [
        "Keep an eye on local news for updates over the next few days.",
        "Avoid unnecessary travel to low-lying areas near rivers.",
      ],
      Low: ["No unusual flood risk right now — normal precautions are enough."],
    },
    bn: {
      Severe: [
        "মূল্যবান জিনিসপত্র ও গুরুত্বপূর্ণ কাগজপত্র উঁচু জায়গায় সরিয়ে রাখুন।",
        "মোবাইল চার্জ করে রাখুন এবং টর্চ লাইট প্রস্তুত রাখুন।",
        "পানিতে ডোবা রাস্তা বা নদী হেঁটে বা গাড়িতে পার হওয়া থেকে বিরত থাকুন।",
        "স্থানীয় প্রশাসন সরে যেতে বললে দেরি না করে আগেভাগেই সরে যান।",
      ],
      High: [
        "মূল্যবান জিনিসপত্র ও গুরুত্বপূর্ণ কাগজপত্র উঁচু জায়গায় সরিয়ে রাখুন।",
        "মোবাইল চার্জ করে রাখুন এবং টর্চ লাইট প্রস্তুত রাখুন।",
        "পানিতে ডোবা রাস্তা বা নদী হেঁটে বা গাড়িতে পার হওয়া থেকে বিরত থাকুন।",
      ],
      Moderate: [
        "আগামী কয়েক দিন স্থানীয় খবরে নজর রাখুন।",
        "নদীর কাছাকাছি নিচু এলাকায় অপ্রয়োজনীয় যাতায়াত এড়িয়ে চলুন।",
      ],
      Low: ["এই মুহূর্তে অস্বাভাবিক বন্যার ঝুঁকি নেই — স্বাভাবিক সতর্কতাই যথেষ্ট।"],
    },
  };
  const byLang = steps[lang] || steps.en;
  return byLang[tier] || byLang.Moderate;
}

// Heat health guidance, keyed off the real model's risk_category (High /
// Medium / Low — a tertile split, not the old 4-tier Extreme/High/Moderate/Low
// placeholder scale). No fabricated ward-specific timing (the old text named
// "Panchlaish and Kotwali" for every citizen nationwide) — this is generic,
// defensible public-health guidance scaled to how hot the model actually
// says a district's season has been.
function heatAdvisory(category, lang) {
  const copy = {
    en: {
      High: {
        body: "This district's surface temperatures have run high this season. Drink water regularly even without feeling thirsty, limit direct sun exposure between late morning and late afternoon, and check on elderly neighbours and young children.",
        safeHours: "Safer hours to be outside: before 8am or after 6pm.",
      },
      Medium: {
        body: "This district's heat risk is moderate. Stay hydrated and take breaks in shade during the hottest part of the day.",
        safeHours: "Midday sun (roughly 12pm–3pm) is when it's hottest — pace outdoor work accordingly.",
      },
      Low: {
        body: "No unusual heat risk in this district right now — normal precautions are enough.",
        safeHours: null,
      },
    },
    bn: {
      High: {
        body: "এই মৌসুমে এই জেলার ভূপৃষ্ঠের তাপমাত্রা বেশি থেকেছে। তৃষ্ণা না লাগলেও নিয়মিত পানি পান করুন, সকাল শেষ থেকে বিকাল পর্যন্ত সরাসরি রোদ এড়িয়ে চলুন, এবং বয়স্ক প্রতিবেশী ও শিশুদের খোঁজ নিন।",
        safeHours: "বাইরে থাকার নিরাপদ সময়: সকাল ৮টার আগে অথবা সন্ধ্যা ৬টার পরে।",
      },
      Medium: {
        body: "এই জেলার তাপের ঝুঁকি মাঝারি। পানি পান করতে থাকুন এবং দিনের সবচেয়ে গরম সময়ে ছায়ায় বিরতি নিন।",
        safeHours: "দুপুর (আনুমানিক ১২টা–৩টা) সবচেয়ে গরম থাকে — সেই অনুযায়ী বাইরের কাজের গতি ঠিক করুন।",
      },
      Low: {
        body: "এই মুহূর্তে এই জেলায় অস্বাভাবিক তাপের ঝুঁকি নেই — স্বাভাবিক সতর্কতাই যথেষ্ট।",
        safeHours: null,
      },
    },
  };
  const byLang = copy[lang] || copy.en;
  return byLang[category] || byLang.Medium;
}

// A citizen "I saw tree-cutting here" report — genuinely different from
// the satellite-based deforestation model (which only catches loss large
// and persistent enough to show up in a 250m MODIS pixel over several
// years). Posts to /deforestation/citizen-reports; if the backend isn't
// configured yet (see CITIZEN-REPORTS-SETUP.md) it says so plainly rather
// than pretending the report was saved.
function CitizenReportForm({ district, lang }) {
  const t = CITIZEN_I18N[lang];
  const [description, setDescription] = useState("");
  const [contact, setContact] = useState("");
  const [status, setStatus] = useState("idle"); // idle | sending | sent | error | not_configured | too_short
  const [errorDetail, setErrorDetail] = useState("");
  // Real reference number, only shown if the backend actually returns one —
  // never invented client-side. A citizen who wants to follow up (e.g. by
  // calling their Union Parishad office) has something concrete to cite.
  const [reportId, setReportId] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (description.trim().length < 5) {
      setStatus("too_short");
      return;
    }
    setStatus("sending");
    setErrorDetail("");
    try {
      const res = await fetch(`${API_BASE}/deforestation/citizen-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ district, description: description.trim(), contact: contact.trim() || null }),
      });
      if (res.status === 503) {
        setStatus("not_configured");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorDetail(body.detail || "");
        setStatus("error");
        return;
      }
      const body = await res.json().catch(() => ({}));
      setReportId(body?.id ?? body?.report?.id ?? null);
      setStatus("sent");
      setDescription("");
      setContact("");
    } catch (err) {
      setErrorDetail(err.message || "");
      setStatus("error");
    }
  }

  return (
    <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
      <div className="flex items-center gap-2.5 mb-1">
        <IconBadge icon={Send} tone="teal" size={13} />
        <h3 className="text-sm font-medium text-stone-100">{t.reportTitle}</h3>
      </div>
      <p className="text-[11px] text-stone-400 mb-3 leading-relaxed">{t.reportHint}</p>

      {status === "sent" ? (
        <div>
          <p className="text-xs text-emerald-300">{t.reportSuccess}</p>
          {reportId != null && (
            <p className="text-[11px] text-stone-400 mt-1">
              {t.reportReference} <span className="text-stone-200 tabular-nums">#{reportId}</span>
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.reportDescriptionPlaceholder}
            rows={2}
            className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-200 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/50 resize-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t.reportContactPlaceholder}
            className="w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 text-xs text-stone-200 placeholder:text-stone-500 focus:outline-none focus:border-emerald-500/50"
          />
          {status === "too_short" && <p className="text-[11px] text-amber-400">{t.reportTooShort}</p>}
          {status === "not_configured" && <p className="text-[11px] text-amber-400">{t.reportNotConfigured}</p>}
          {status === "error" && <p className="text-[11px] text-amber-400">{t.reportError}{errorDetail ? ` (${errorDetail})` : ""}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 disabled:opacity-60 text-emerald-300 text-xs font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            {status === "sending" ? t.reportSending : t.reportSubmit}
          </button>
        </form>
      )}
    </div>
  );
}

function CitizenDashboard({ onLogout }) {
  const { districts: heatDistricts, grid: heatGrid, alerts: heatAlerts } = useHeatData();
  const { citizenCards, districts: forestDistricts } = useDeforestationData();
  const { severity, summary, loading: floodLoading, error: floodError } = useNationalFloodData();
  const [lang, setLang] = useState("en");
  const t = CITIZEN_I18N[lang];

  // Hub-and-detail navigation: the citizen dashboard opens on a hub of three
  // module cards (Heat / Flood / Deforestation) rather than dumping every
  // module's cards on one long scroll — tapping a card opens that module's
  // detail, with a Back button to return to the hub.
  const [citizenView, setCitizenView] = useState("hub"); // "hub" | "heat" | "flood" | "forest"

  const districtOptions = useMemo(
    () => (severity || []).map((s) => s.district_name).sort((a, b) => a.localeCompare(b)),
    [severity]
  );

  const [selectedDistrict, setSelectedDistrict] = useState(null);
  useEffect(() => {
    if (selectedDistrict || !districtOptions.length) return;
    const chattogram = districtOptions.find((d) => /chattogram|chittagong/i.test(d));
    setSelectedDistrict(chattogram || districtOptions[0]);
  }, [districtOptions, selectedDistrict]);

  const selectedFlood = useMemo(
    () => (severity || []).find((s) => s.district_name === selectedDistrict) || null,
    [severity, selectedDistrict]
  );

  // Tree cover and heat now both genuinely exist for all 64 districts, so
  // both follow the area picker instead of one being gated to a single city.
  const treeCard = useMemo(
    () => (citizenCards || []).find((c) => c.district === selectedDistrict) || null,
    [citizenCards, selectedDistrict]
  );

  const selectedHeat = useMemo(
    () => (heatDistricts || []).find((d) => d.name === selectedDistrict) || null,
    [heatDistricts, selectedDistrict]
  );

  // Real forest-loss priority tier for the citizen's own district, from the
  // same government-side deforestation data — not a new/invented signal —
  // so the Deforestation hub card can carry a real color-coded risk level
  // too, instead of being the one card with no risk color at all.
  const selectedForestPriority = useMemo(
    () => (forestDistricts || []).find((d) => d.district === selectedDistrict)?.priority || null,
    [forestDistricts, selectedDistrict]
  );

  // Heatwave watch is reported at the national level (it's keyed to the
  // model's own hotspot cluster centroids, not administrative districts —
  // see heat_export.py) — a short banner naming how many locations
  // nationally are under watch, not a claim about the citizen's own area.
  const activeHeatwaveCount = heatAlerts?.alerts?.length || 0;

  return (
    <div className="min-h-screen bg-stone-900 text-stone-100">
      <div className="sticky top-0 z-10 border-b border-stone-700/80 bg-stone-900/80 backdrop-blur-md px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onLogout}
            title={t.back}
            className="shrink-0 text-stone-400 hover:text-stone-200 p-1 -ml-1 rounded-lg hover:bg-stone-800 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/25 to-orange-600/5 ring-1 ring-orange-500/25 shrink-0">
            <Radar size={16} className="text-orange-400" />
          </span>
          <span className="text-sm font-semibold text-stone-50 tracking-tight truncate" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {t.appName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setLang(lang === "en" ? "bn" : "en")}
            className="text-xs text-stone-400 hover:text-stone-200 px-2.5 py-1 rounded-lg hover:bg-stone-800 transition-colors border border-stone-700"
          >
            {lang === "en" ? "বাংলা" : "English"}
          </button>
          <button onClick={onLogout} className="text-xs text-stone-400 hover:text-stone-200 px-2.5 py-1 rounded-lg hover:bg-stone-800 transition-colors">{t.exit}</button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4 animate-fade-in">
        {citizenView === "hub" ? (
          <>
            {districtOptions.length > 0 && (
              <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="text-sm font-medium text-stone-100">{t.yourArea}</h3>
                  <select
                    value={selectedDistrict || ""}
                    onChange={(e) => setSelectedDistrict(e.target.value)}
                    className="text-xs bg-stone-700/80 border border-stone-600 text-stone-100 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                  >
                    {districtOptions.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-stone-400">{t.yourAreaHint}</p>
              </div>
            )}

            {activeHeatwaveCount > 0 && (
              <div className="bg-gradient-to-br from-red-950/50 to-red-950/20 border border-red-900/40 rounded-2xl p-4 flex items-start gap-3 shadow-sm shadow-black/20">
                <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/15 ring-1 ring-red-500/30 shrink-0">
                  <AlertTriangle size={16} className="text-red-400" />
                </span>
                <p className="text-xs text-red-300 leading-relaxed">
                  {activeHeatwaveCount === 1 ? t.heatwaveWatchOne : `${activeHeatwaveCount} ${t.heatwaveWatchMany}`}
                </p>
              </div>
            )}

            <p className="text-[11px] text-stone-500 -mb-1">{t.hubHint}</p>

            {/* Always-visible color legend — the same red/amber/green scale
                is used everywhere in this app, so once someone learns it
                here, every badge and card below becomes readable by color
                alone, without needing to read any tier word. */}
            <div className="flex items-center gap-3 flex-wrap -mb-1">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-stone-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" /> {t.legendSafe}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-stone-400">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" /> {t.legendCaution}
              </span>
              <span className="inline-flex items-center gap-1.5 text-[10px] text-stone-400">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 shrink-0" /> {t.legendHigh}
              </span>
            </div>

            {[
              {
                key: "heat",
                icon: Thermometer,
                label: t.heatModuleLabel,
                tier: selectedHeat?.risk_category || null,
                sub: selectedHeat ? `${selectedHeat.lst_c.toFixed(1)}°C` : t.loading,
              },
              {
                key: "flood",
                icon: Droplets,
                label: t.floodModuleLabel,
                tier: selectedFlood?.severity_tier || null,
                sub: selectedFlood
                  ? `${(selectedFlood.avg_predicted_risk * 100).toFixed(1)}%`
                  : floodLoading
                  ? t.loading
                  : t.floodRiskFallbackNote,
              },
              {
                key: "forest",
                icon: TreeDeciduous,
                label: t.forestModuleLabel,
                tier: selectedForestPriority,
                sub: treeCard ? `${treeCard.forest_pct}%` : t.loading,
              },
            ].map((m) => {
              // Icon color = risk level (red/amber/green), the same scale as
              // the legend above and everywhere else in the app — this is
              // the primary signal now, not each module's brand color.
              const toneKey = RISK_LEVEL_BADGE_TONE[riskLevel(m.tier)] || "slate";
              return (
                <button
                  key={m.key}
                  onClick={() => setCitizenView(m.key)}
                  className="w-full flex items-center gap-3.5 bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 hover:border-stone-600 rounded-2xl p-4 shadow-sm shadow-black/20 transition-colors text-left"
                >
                  <span className={`inline-flex items-center justify-center w-12 h-12 rounded-xl shrink-0 ${ICON_BADGE_TONES[toneKey]}`}>
                    <m.icon size={22} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-100">{m.label}</div>
                    <div className="text-[11px] text-stone-400 mt-0.5">{m.sub}</div>
                  </div>
                  {m.tier && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${tierColor(m.tier).bg} ${tierColor(m.tier).text}`}>
                      {tierLabel(m.tier, lang)}
                    </span>
                  )}
                  <ChevronRight size={16} className="text-stone-500 shrink-0" />
                </button>
              );
            })}
          </>
        ) : (
          <>
            <div className="flex items-center justify-between -mt-1 mb-1">
              <button
                onClick={() => setCitizenView("hub")}
                className="flex items-center gap-1.5 text-sm text-stone-300 hover:text-stone-100 transition-colors"
              >
                <ArrowLeft size={14} /> {t.back}
              </button>
              {selectedDistrict && <span className="text-[11px] text-stone-400">{selectedDistrict}</span>}
            </div>

            {citizenView === "heat" && selectedHeat && (() => {
              const advisory = heatAdvisory(selectedHeat.risk_category, lang);
              const heroSpeak = `${tierLabel(selectedHeat.risk_category, lang)} — ${selectedHeat.lst_c.toFixed(1)}°C. ${advisory.body}`;
              return (
                <>
                  <RiskHero
                    icon={Thermometer}
                    tier={selectedHeat.risk_category}
                    title={tierLabel(selectedHeat.risk_category, lang)}
                    sub={`${selectedHeat.lst_c.toFixed(1)}°C · ${selectedDistrict || ""}`}
                    lang={lang}
                    speak={heroSpeak}
                    listenLabel={t.listen}
                  />

                  <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-stone-100">{t.heatMapTitle}</h3>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${tierColor(selectedHeat.risk_category).bg} ${tierColor(selectedHeat.risk_category).text}`}>
                        {tierLabel(selectedHeat.risk_category, lang)}
                      </span>
                    </div>
                    {heatGrid ? (
                      <div className="flex justify-center">
                        <HeatGrid grid={heatGrid} compact />
                      </div>
                    ) : (
                      <p className="text-xs text-stone-400 text-center py-4">{t.loading}</p>
                    )}
                  </div>

                  <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                    <IconBadge icon={Thermometer} tone="orange" size={14} className="mb-2.5" />
                    <div className="text-xl font-semibold text-stone-50 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                      {selectedHeat.lst_c.toFixed(1)}°C
                    </div>
                    <div className="text-[11px] text-stone-400 mt-0.5">{t.currentTemp}</div>
                  </div>

                  <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                    <h3 className="text-sm font-medium text-stone-100 mb-2">{t.healthAdvisoryTitle}</h3>
                    <p className="text-xs text-stone-300 leading-relaxed">{advisory.body}</p>
                    {advisory.safeHours && (
                      <p className="text-xs text-orange-300/90 leading-relaxed mt-2 pt-2 border-t border-stone-700">{advisory.safeHours}</p>
                    )}
                  </div>
                </>
              );
            })()}

            {citizenView === "flood" &&
              (floodLoading || floodError || !selectedFlood ? (
                <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                  <h3 className="text-sm font-medium text-stone-100 mb-1">{t.floodRiskTitle} {selectedDistrict || ""}</h3>
                  <p className="text-xs text-stone-400">{floodLoading ? t.loading : t.floodRiskFallbackNote}</p>
                </div>
              ) : (
                (() => {
                  const tier = selectedFlood.severity_tier || "Moderate";
                  const c = tierColor(tier);
                  const steps = floodSafetySteps(tier, lang);
                  const heroSpeak = `${tierLabel(tier, lang)} — ${(selectedFlood.avg_predicted_risk * 100).toFixed(1)}%. ${steps.join(" ")}`;
                  return (
                    <>
                      <RiskHero
                        icon={Droplets}
                        tier={tier}
                        title={tierLabel(tier, lang)}
                        sub={`${(selectedFlood.avg_predicted_risk * 100).toFixed(1)}% · ${selectedFlood.district_name}`}
                        lang={lang}
                        speak={heroSpeak}
                        listenLabel={t.listen}
                      />
                      <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2.5">
                            <IconBadge icon={Droplets} tone="teal" size={14} />
                            <h3 className="text-sm font-medium text-stone-100">{t.floodRiskTitle} {selectedFlood.district_name}</h3>
                          </div>
                          <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>{tierLabel(tier, lang)}</span>
                        </div>
                        <p className="text-[11px] text-stone-400 mb-3 flex items-center gap-1.5 flex-wrap">
                          <span>
                            {(selectedFlood.avg_predicted_risk * 100).toFixed(1)}% predicted risk
                            {summary?.last_refreshed_at ? ` · ${t.floodRiskLive}` : ""}
                          </span>
                          {selectedFlood.risk_trend && (
                            <span className="inline-flex items-center gap-1">
                              <RiskTrendBadge trend={selectedFlood.risk_trend} size={11} />
                              {selectedFlood.risk_trend === "up" ? t.trendUp : selectedFlood.risk_trend === "down" ? t.trendDown : t.trendSteady}
                            </span>
                          )}
                        </p>
                        <div className="space-y-2 mb-1">
                          {steps.map((s, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="w-1 h-1 rounded-full bg-stone-500 mt-1.5 shrink-0" />
                              <p className="text-xs text-stone-300 leading-relaxed">{s}</p>
                            </div>
                          ))}
                        </div>
                        {(tier === "Severe" || tier === "High" || tier === "Moderate") && (
                          <div className="mt-3 pt-3 border-t border-stone-700 space-y-1">
                            <p className="text-[11px] text-stone-400">{t.emergencyLine}</p>
                            <p className="text-[11px] text-stone-400">{t.emergencyLine2}</p>
                          </div>
                        )}
                      </div>
                    </>
                  );
                })()
              ))}

            {citizenView === "forest" && (
              <>
                {treeCard && (
                  <RiskHero
                    icon={TreeDeciduous}
                    tier={selectedForestPriority}
                    title={selectedForestPriority ? tierLabel(selectedForestPriority, lang) : `${treeCard.forest_pct}%`}
                    sub={`${treeCard.district} · ${treeCard.forest_pct}% ${lang === "bn" ? "গাছপালা" : "tree cover"}`}
                    lang={lang}
                    speak={`${treeCard.district}: ${treeCard.forest_pct}%. ${treeCard.message || ""}`}
                    listenLabel={t.listen}
                  />
                )}
                {treeCard && (
                  <div className="bg-gradient-to-b from-stone-800/70 to-stone-800/30 border border-stone-700 rounded-2xl p-4 shadow-sm shadow-black/20">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <IconBadge icon={TreeDeciduous} tone="teal" size={14} />
                        <h3 className="text-sm font-medium text-stone-100">{t.treeCoverTitle} {treeCard.district}</h3>
                      </div>
                      <span className="text-lg font-semibold text-stone-50 tabular-nums" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
                        {treeCard.forest_pct}%
                      </span>
                    </div>
                    <div style={{ width: "100%", height: 56 }}>
                      <ResponsiveContainer>
                        <LineChart data={treeCard.years.map((y, i) => ({ year: y, v: treeCard.sparkline[i] }))}>
                          <Line type="monotone" dataKey="v" stroke="#2dd4bf" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="text-xs text-stone-300 leading-relaxed mt-2">{treeCard.message}</p>
                    <button className="w-full mt-3 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 text-xs font-medium py-2 rounded-lg transition-colors">
                      {treeCard.call_to_action}
                    </button>
                  </div>
                )}

                {selectedDistrict && <CitizenReportForm district={selectedDistrict} lang={lang} />}
              </>
            )}
          </>
        )}

        <p className="text-[11px] text-stone-500 text-center pt-1 pb-2">
          {t.footer}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth / role select
// ---------------------------------------------------------------------------

const ROLE_CREDENTIALS = {
  "Environmental Analyst": { officer_id: "env_project", password: "env_project_400" },
  "City Administrator": { officer_id: "city_admin", password: "city_admin_400" },
  "Field Officer": { officer_id: "field_officer", password: "field_officer_400" },
};

const REGISTERABLE_ROLES = Object.keys(ROLE_CREDENTIALS);

function GovtLogin({ onBack, onLogin }) {
  const [mode, setMode] = useState("login"); // "login" | "register"

  // --- login state ---
  const [role, setRole] = useState("Environmental Analyst");
  const [officerId, setOfficerId] = useState(ROLE_CREDENTIALS["Environmental Analyst"].officer_id);
  const [password, setPassword] = useState(ROLE_CREDENTIALS["Environmental Analyst"].password);

  // --- register state ---
  const [regName, setRegName] = useState("");
  const [regRole, setRegRole] = useState(REGISTERABLE_ROLES[0]);
  const [regOfficerId, setRegOfficerId] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function switchMode(newMode) {
    setMode(newMode);
    setError("");
  }

  function handleRoleChange(newRole) {
    setRole(newRole);
    const creds = ROLE_CREDENTIALS[newRole];
    if (creds) {
      setOfficerId(creds.officer_id);
      setPassword(creds.password);
    }
    setError("");
  }

  async function handleLoginSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ officer_id: officerId, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Login failed (${res.status})`);
      }

      const data = await res.json();
      onLogin(data.role || role);
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegisterSubmit(e) {
    e.preventDefault();
    setError("");

    if (!regName.trim() || !regOfficerId.trim() || !regPassword) {
      setError("Please fill in every field.");
      return;
    }
    if (regPassword.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          officer_id: regOfficerId.trim(),
          password: regPassword,
          name: regName.trim(),
          role: regRole,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.detail || `Registration failed (${res.status})`);
      }

      // Instant access: a successful registration logs the new officer
      // straight in, same as the login flow.
      onLogin(body.role || regRole);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full bg-stone-900 border border-stone-700 rounded-lg px-3 py-2 mt-1 mb-3 text-sm text-stone-200 focus:outline-none focus:border-orange-500/50";

  return (
    <div className="min-h-screen bg-stone-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200 mb-6">
          <ArrowLeft size={14} /> Back
        </button>

        {mode === "login" ? (
          <form onSubmit={handleLoginSubmit} className="bg-stone-800/60 border border-stone-700 rounded-2xl p-6">
            <ShieldCheck size={22} className="text-orange-400 mb-3" />
            <h2 className="text-lg font-semibold text-stone-50" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Government sign in
            </h2>
            <p className="text-xs text-stone-400 mt-1 mb-5">Role-based access to environmental monitoring and decision support</p>

            <label className="text-xs text-stone-300">Role</label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className={inputClass}
            >
              {REGISTERABLE_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="text-xs text-stone-300">Officer ID</label>
            <input value={officerId} onChange={(e) => setOfficerId(e.target.value)} className={inputClass} />

            <label className="text-xs text-stone-300">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputClass}
            />

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <p className="text-[11px] text-stone-500 mt-3 text-center">Role selects the matching demo credentials automatically</p>

            <div className="border-t border-stone-700 mt-4 pt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode("register")}
                className="text-xs text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
              >
                <UserPlus size={13} /> New officer? Register here
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegisterSubmit} className="bg-stone-800/60 border border-stone-700 rounded-2xl p-6">
            <UserPlus size={22} className="text-orange-400 mb-3" />
            <h2 className="text-lg font-semibold text-stone-50" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Officer registration
            </h2>
            <p className="text-xs text-stone-400 mt-1 mb-5">Create an account to get government dashboard access</p>

            <label className="text-xs text-stone-300">Full name</label>
            <input value={regName} onChange={(e) => setRegName(e.target.value)} className={inputClass} placeholder="e.g. Rahim Uddin" />

            <label className="text-xs text-stone-300">Role</label>
            <select value={regRole} onChange={(e) => setRegRole(e.target.value)} className={inputClass}>
              {REGISTERABLE_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="text-xs text-stone-300">Officer ID</label>
            <input
              value={regOfficerId}
              onChange={(e) => setRegOfficerId(e.target.value)}
              className={inputClass}
              placeholder="Choose a unique ID, e.g. rahim_2026"
            />

            <label className="text-xs text-stone-300">Password</label>
            <input
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 6 characters"
            />

            <label className="text-xs text-stone-300">Confirm password</label>
            <input
              type="password"
              value={regConfirmPassword}
              onChange={(e) => setRegConfirmPassword(e.target.value)}
              className={inputClass}
            />

            {error && <p className="text-xs text-red-400 mb-3">{error}</p>}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg"
            >
              {loading ? "Creating account…" : "Register & sign in"}
            </button>

            <div className="border-t border-stone-700 mt-4 pt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-xs text-stone-300 hover:text-stone-200"
              >
                Already have an account? Sign in
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function RoleSelect({ onSelect }) {
  return (
    <div className="relative min-h-screen bg-stone-900 flex items-center justify-center p-4 overflow-hidden">
      {/* Subtle ambient background glow + dot grid, purely decorative */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.15) 1px, transparent 0)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black 40%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[560px] h-[360px] rounded-full blur-3xl opacity-30"
        style={{ background: "radial-gradient(closest-side, rgba(251,146,60,0.35), transparent)" }}
      />

      <div className="relative max-w-2xl w-full animate-fade-in-up">
        <div className="text-center mb-10">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-orange-400 bg-orange-500/10 ring-1 ring-orange-500/20 px-3 py-1 rounded-full mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            Environmental Risk Monitoring Platform
          </span>
          <h1 className="text-3xl sm:text-4xl font-semibold text-stone-50 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Bangladesh Climate and Hazard Console
          </h1>
          <p className="text-sm text-stone-400 mt-3.5 max-w-md mx-auto leading-relaxed">
            Satellite-derived heat, flood and deforestation risk monitoring,
            built on our own trained prediction models for government planning
            and public awareness.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <button
            onClick={() => onSelect("govt")}
            className="text-left bg-gradient-to-b from-stone-800/80 to-stone-800/40 border border-stone-700 hover:border-orange-500/40 rounded-2xl p-6 transition-all duration-200 group shadow-sm shadow-black/20 hover:-translate-y-1 hover:shadow-xl hover:shadow-orange-950/20"
          >
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20 mb-4 group-hover:scale-105 transition-transform">
              <ShieldCheck size={22} className="text-orange-400" />
            </span>
            <p className="text-stone-50 font-medium">Government dashboard</p>
            <p className="text-xs text-stone-400 mt-1.5 leading-relaxed">
              Full access to risk analysis, AI predictions, resource planning and report generation.
            </p>
            <span className="text-xs text-orange-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all font-medium">
              Continue <ChevronRight size={13} />
            </span>
          </button>
          <button
            onClick={() => onSelect("citizen")}
            className="text-left bg-gradient-to-b from-stone-800/80 to-stone-800/40 border border-stone-700 hover:border-emerald-500/40 rounded-2xl p-6 transition-all duration-200 group shadow-sm shadow-black/20 hover:-translate-y-1 hover:shadow-xl hover:shadow-emerald-950/20"
          >
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mb-4 group-hover:scale-105 transition-transform">
              <Users size={22} className="text-emerald-400" />
            </span>
            <p className="text-stone-50 font-medium">Citizen dashboard</p>
            <p className="text-xs text-stone-400 mt-1.5 leading-relaxed">
              Flood risk, heat risk and tree cover for your district, plus a national heatwave watch and health advisories.
            </p>
            <span className="text-xs text-emerald-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all font-medium">
              Continue <ChevronRight size={13} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [view, setView] = useState("select"); // select | govt-login | govt | citizen
  const [role, setRole] = useState(null);

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Inter:wght@400;500;600&display=swap');
      `}</style>

      {view === "select" && (
        <RoleSelect onSelect={(v) => setView(v === "govt" ? "govt-login" : "citizen")} />
      )}
      {view === "govt-login" && (
        <GovtLogin onBack={() => setView("select")} onLogin={(r) => { setRole(r); setView("govt"); }} />
      )}
      {view === "govt" && (
        <GovtDashboard role={role} onLogout={() => setView("select")} />
      )}
      {view === "citizen" && (
        <CitizenDashboard onLogout={() => setView("select")} />
      )}
    </div>
  );
}
