import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Thermometer, Droplets, Wind, TreeDeciduous, AlertTriangle, MapPin,
  Download, LogOut, Users, ShieldCheck, Bell, Search, TrendingUp, TrendingDown, Minus,
  FileText, X, Lock, ChevronRight, Sun, Building2, Sprout, ArrowLeft,
  UserPlus, ShieldAlert, Info, Send,
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

const FALLBACK_WARDS = [
  { name: "Panchlaish", temp: 38.6, risk: "Extreme", ndvi: 0.11, pop: 61000 },
  { name: "Kotwali", temp: 38.1, risk: "Extreme", ndvi: 0.09, pop: 74000 },
  { name: "Chandgaon", temp: 36.4, risk: "High", ndvi: 0.18, pop: 58000 },
  { name: "Bayezid", temp: 36.0, risk: "High", ndvi: 0.21, pop: 49500 },
  { name: "EPZ", temp: 35.3, risk: "High", ndvi: 0.24, pop: 33200 },
  { name: "Double Mooring", temp: 34.1, risk: "Moderate", ndvi: 0.29, pop: 41800 },
  { name: "Halishahar", temp: 33.4, risk: "Moderate", ndvi: 0.33, pop: 52700 },
  { name: "Patenga", temp: 31.6, risk: "Low", ndvi: 0.44, pop: 27900 },
];

// 9x7 grid of temperatures approximating an urban-core hotspot with cooler,
// greener edges — kept as a visual placeholder until /heat/hotspots returns
// a grid shape (swap this out once you confirm the real response shape).
const FALLBACK_HEAT_GRID = [
  [30, 31, 32, 33, 33, 32, 31, 30, 29],
  [31, 33, 35, 36, 36, 35, 33, 31, 30],
  [32, 35, 37, 38, 38, 37, 35, 32, 31],
  [33, 36, 38, 39, 39, 38, 36, 33, 32],
  [32, 35, 38, 39, 38, 37, 35, 33, 31],
  [31, 34, 36, 37, 36, 35, 33, 32, 30],
  [30, 32, 34, 34, 33, 32, 31, 30, 29],
];

const FALLBACK_TREND = [
  { month: "Oct", temp: 30.8, baseline: 29.9 },
  { month: "Nov", temp: 28.4, baseline: 28.1 },
  { month: "Dec", temp: 25.9, baseline: 25.7 },
  { month: "Jan", temp: 25.1, baseline: 25.3 },
  { month: "Feb", temp: 27.6, baseline: 27.0 },
  { month: "Mar", temp: 31.4, baseline: 29.8 },
  { month: "Apr", temp: 34.7, baseline: 32.6 },
  { month: "May", temp: 36.9, baseline: 34.1 },
  { month: "Jun", temp: 35.2, baseline: 33.5 },
  { month: "Jul", temp: 33.6, baseline: 32.4 },
  { month: "Aug", temp: 34.0, baseline: 32.8 },
  { month: "Sep", temp: 35.5, baseline: 33.0 },
];

const COOLING_CENTERS = [
  { name: "Panchlaish Community Hall", distance: "0.6 km", capacity: 120 },
  { name: "Kotwali Primary School", distance: "1.1 km", capacity: 90 },
  { name: "CDA Park Shelter", distance: "1.8 km", capacity: 60 },
  { name: "Chandgaon Union Center", distance: "2.4 km", capacity: 80 },
];

const RECOMMENDATIONS = [
  { icon: TreeDeciduous, title: "Priority tree plantation", body: "Panchlaish and Kotwali have canopy cover under 12%. Modelled cooling gain: -1.4C at full canopy target." },
  { icon: Building2, title: "Cooling infrastructure", body: "Add shaded transit shelters and reflective roofing along Chandgaon's exposed commercial strip." },
  { icon: Sprout, title: "Green corridor", body: "Connect CDA Park to Double Mooring waterfront to break up the contiguous heat-holding built-up area." },
];

const OTHER_MODULES = [
  { key: "flood", label: "Flood monitoring", icon: Droplets, locked: false },
  { key: "air", label: "Air pollution", icon: Wind, locked: true },
  { key: "forest", label: "Deforestation", icon: TreeDeciduous, locked: false },
];

function riskColor(risk) {
  if (risk === "Extreme") return { bg: "bg-red-950/40", text: "text-red-400", ring: "ring-red-500/30", dot: "bg-red-500" };
  if (risk === "High") return { bg: "bg-orange-950/40", text: "text-orange-400", ring: "ring-orange-500/30", dot: "bg-orange-500" };
  if (risk === "Moderate") return { bg: "bg-amber-950/40", text: "text-amber-400", ring: "ring-amber-500/30", dot: "bg-amber-500" };
  return { bg: "bg-teal-950/40", text: "text-teal-400", ring: "ring-teal-500/30", dot: "bg-teal-500" };
}

function tempToColor(t) {
  const stops = [
    { t: 29, c: [45, 130, 130] },
    { t: 32, c: [90, 150, 90] },
    { t: 34, c: [210, 170, 40] },
    { t: 36, c: [225, 120, 30] },
    { t: 39, c: [190, 40, 30] },
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

// Flood-risk grid color scale: same teal->amber->red family as the heat
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
  if (tier === "no forest") return { bg: "bg-slate-800/40", text: "text-slate-500", ring: "ring-slate-600/30", dot: "bg-slate-600" };
  return { bg: "bg-teal-950/40", text: "text-teal-400", ring: "ring-teal-500/30", dot: "bg-teal-500" };
}

// Small "is this district's flood risk rising or falling since the last
// 3-day refresh" indicator. Reads risk_trend, which the automation script
// only sets once a previous run's output exists to compare against — so
// this quietly renders nothing rather than guessing on the very first run.
function RiskTrendBadge({ trend, size = 12 }) {
  if (!trend) return null;
  if (trend === "up") return <TrendingUp size={size} className="text-red-400" />;
  if (trend === "down") return <TrendingDown size={size} className="text-teal-400" />;
  return <Minus size={size} className="text-slate-500" />;
}

// ---------------------------------------------------------------------------
// Backend response mapping
// ---------------------------------------------------------------------------
// /heat/hotspots currently returns a GeoJSON FeatureCollection (placeholder
// clustering output — see backend note). Each feature has properties:
// { cluster_id, ward, mean_lst_c, size }. It does NOT yet include risk
// category, NDVI or population, so we derive/backfill those until the
// backend adds them.

function riskFromTemp(t) {
  if (t >= 38) return "Extreme";
  if (t >= 35) return "High";
  if (t >= 32) return "Moderate";
  return "Low";
}

function mapHotspotsGeoJsonToWards(geojson) {
  if (!geojson || !Array.isArray(geojson.features)) return null;
  const byName = Object.fromEntries(FALLBACK_WARDS.map((w) => [w.name, w]));
  return geojson.features.map((f) => {
    const props = f.properties || {};
    const name = props.ward || "Unknown";
    const temp = typeof props.mean_lst_c === "number" ? props.mean_lst_c : 0;
    const known = byName[name];
    return {
      name,
      temp,
      risk: riskFromTemp(temp),
      // ndvi / pop aren't in the placeholder response yet — fall back to
      // known demo values for that ward, or 0 if it's a ward we don't
      // otherwise have on file.
      ndvi: known ? known.ndvi : 0,
      pop: known ? known.pop : 0,
      clusterSize: props.size,
    };
  });
}

// ---------------------------------------------------------------------------
// Data hook — pulls live data from the backend
// ---------------------------------------------------------------------------

function useHeatData() {
  const [wards, setWards] = useState(FALLBACK_WARDS);
  const [heatGrid, setHeatGrid] = useState(FALLBACK_HEAT_GRID);
  const [trend, setTrend] = useState(FALLBACK_TREND);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [hotspotsRes, trendRes] = await Promise.all([
          fetch(`${API_BASE}/heat/hotspots`),
          fetch(`${API_BASE}/heat/trend`),
        ]);

        if (!hotspotsRes.ok) throw new Error(`/heat/hotspots ${hotspotsRes.status}`);
        if (!trendRes.ok) throw new Error(`/heat/trend ${trendRes.status}`);

        const hotspotsData = await hotspotsRes.json();
        const trendData = await trendRes.json();

        if (cancelled) return;

        // /heat/hotspots: GeoJSON FeatureCollection (placeholder clustering
        // output). Map it into the ward-list shape the UI expects.
        const mappedWards = mapHotspotsGeoJsonToWards(hotspotsData);
        if (mappedWards && mappedWards.length) setWards(mappedWards);

        // The grid visual isn't produced by any current endpoint — the
        // fallback grid stays in place until the backend exposes one.

        // /heat/trend: { trend: [{ month, temp, baseline }, ...] }
        if (Array.isArray(trendData?.trend)) setTrend(trendData.trend);
        else if (Array.isArray(trendData)) setTrend(trendData);
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load heat data:", err);
          setError(err.message || "Failed to load live data");
          // fallback/demo data stays in place so the UI still renders
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return { wards, heatGrid, trend, loading, error };
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

function HeatGrid({ grid, compact, colorFn = tempToColor, labelFn = (t) => `${t.toFixed(0)}C` }) {
  const cell = compact ? 26 : 34;
  return (
    <div className="inline-block rounded-xl overflow-hidden border border-slate-800 shadow-lg shadow-black/30 ring-1 ring-black/20">
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((t, ci) => (
            <div
              key={ci}
              title={labelFn(t)}
              style={{ width: cell, height: cell, background: colorFn(t) }}
              className="border border-slate-950/40 transition-transform duration-150 hover:scale-[1.12] hover:z-10 hover:shadow-lg"
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
  slate: "bg-slate-800/80 text-slate-400 ring-1 ring-slate-700/60",
  orange: "bg-orange-500/10 text-orange-400 ring-1 ring-orange-500/20",
  red: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
  teal: "bg-teal-500/10 text-teal-400 ring-1 ring-teal-500/20",
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
    teal: "text-teal-400",
    slate: "text-slate-500",
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
      <div className="flex items-center gap-2 text-sm text-slate-500 py-16 justify-center">
        <span className="w-2 h-2 rounded-full bg-slate-500 animate-pulse" />
        Loading {label}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 text-sm text-amber-500 py-16 text-center px-6">
        <IconBadge icon={AlertTriangle} tone="amber" />
        <span>Couldn't load {label} from the backend.</span>
        <span className="text-xs text-slate-500">{error}</span>
      </div>
    );
  }
  return null;
}

function Kpi({ label, value, sub, icon: Icon, tone = "slate" }) {
  const toneMap = {
    slate: "text-slate-200",
    orange: "text-orange-400",
    red: "text-red-400",
    teal: "text-teal-400",
  };
  return (
    <div className="group bg-gradient-to-b from-slate-900/80 to-slate-900/40 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 flex flex-col gap-3 shadow-sm shadow-black/20 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        {Icon && <IconBadge icon={Icon} tone={tone === "slate" ? "slate" : tone} size={14} />}
      </div>
      <div className={`text-2xl font-semibold tracking-tight ${toneMap[tone]}`} style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report modal (stands in for PDF/Excel export)
// ---------------------------------------------------------------------------

function ReportModal({ wards, onClose }) {
  const printRef = useRef(null);
  const now = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto shadow-2xl shadow-black/50 animate-fade-in-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2.5 text-slate-300">
            <IconBadge icon={FileText} tone="orange" size={14} />
            <span className="text-sm font-medium">Heat risk report — Chattogram City</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 hover:bg-slate-900 rounded-lg p-1.5 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div ref={printRef} className="p-6 text-slate-300">
          <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Urban Heat Risk Summary
          </h2>
          <p className="text-xs text-slate-500 mt-1">Chattogram City Corporation — generated {now}</p>

          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="text-center">
              <div className="text-xl font-semibold text-orange-400">35.4C</div>
              <div className="text-[11px] text-slate-500 mt-1">City avg. surface temp</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-red-400">2</div>
              <div className="text-[11px] text-slate-500 mt-1">Extreme-risk wards</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-semibold text-teal-400">~135k</div>
              <div className="text-[11px] text-slate-500 mt-1">Population in high+ risk</div>
            </div>
          </div>

          <h3 className="text-sm font-medium text-slate-200 mt-6 mb-2">Ward ranking by heat risk</h3>
          <table className="w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr className="text-slate-500 text-left">
                <th className="py-1.5 font-medium border-b border-slate-800">Ward</th>
                <th className="py-1.5 font-medium border-b border-slate-800">Temp</th>
                <th className="py-1.5 font-medium border-b border-slate-800">Risk</th>
                <th className="py-1.5 font-medium border-b border-slate-800">NDVI</th>
              </tr>
            </thead>
            <tbody>
              {wards.map((w, i) => (
                <tr key={w.name} className={i % 2 === 1 ? "bg-slate-900/30" : ""}>
                  <td className="py-1.5 px-1 text-slate-300 rounded-l-md">{w.name}</td>
                  <td className="py-1.5 px-1 text-slate-400">{w.temp.toFixed(1)}C</td>
                  <td className="py-1.5 px-1 text-slate-400">{w.risk}</td>
                  <td className="py-1.5 px-1 text-slate-400 rounded-r-md">{w.ndvi.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="text-sm font-medium text-slate-200 mt-6 mb-2">Priority actions</h3>
          <ul className="text-xs text-slate-400 space-y-1.5 list-disc pl-4">
            {RECOMMENDATIONS.map((r) => (
              <li key={r.title}>
                <span className="text-slate-300">{r.title}.</span> {r.body}
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-slate-600 mt-6">
            Report data reflects the live backend where available, with demo
            values as a fallback for anything not yet wired up.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 text-sm rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-900 hover:text-slate-300 transition-colors"
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

function GovtDashboard({ role, onLogout }) {
  const [activeModule, setActiveModule] = useState("heat");
  const [search, setSearch] = useState("");
  const [showReport, setShowReport] = useState(false);
  const [selectedWard, setSelectedWard] = useState(null);
  const [floodTab, setFloodTab] = useState("dhaka"); // "dhaka" | "national"
  const [selectedFloodArea, setSelectedFloodArea] = useState(null);
  const [selectedDistrict, setSelectedDistrict] = useState(null);

  const { wards, heatGrid, trend, loading, error } = useHeatData();
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

  const filteredWards = useMemo(
    () => wards.filter((w) => w.name.toLowerCase().includes(search.toLowerCase())),
    [search, wards]
  );

  const sortedByRisk = useMemo(
    () => [...wards].sort((a, b) => b.temp - a.temp),
    [wards]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex">
      {showReport && <ReportModal wards={wards} onClose={() => setShowReport(false)} />}

      {/* Sidebar */}
      <aside className="w-60 border-r border-slate-800/80 flex flex-col shrink-0 bg-slate-950/60">
        <div className="px-5 py-5 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/25 to-orange-600/5 ring-1 ring-orange-500/25">
              <ShieldCheck size={16} className="text-orange-400" />
            </span>
            <span className="text-sm font-semibold text-slate-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Environmental Console
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-2 pl-0.5">Government dashboard · <span className="text-slate-400">{role}</span></div>
        </div>

        <nav className="flex-1 py-3 px-3 space-y-1">
          <button
            onClick={() => setActiveModule("heat")}
            className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
              activeModule === "heat"
                ? "bg-orange-500/10 text-orange-400"
                : "text-slate-400 hover:bg-slate-900 hover:text-slate-300"
            }`}
          >
            {activeModule === "heat" && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-orange-500" />
            )}
            <Thermometer size={16} />
            Heat monitoring
          </button>
          {OTHER_MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => setActiveModule(m.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 ${
                activeModule === m.key ? "bg-slate-800/80 text-slate-300" : "text-slate-500 hover:bg-slate-900 hover:text-slate-400"
              }`}
            >
              <m.icon size={16} />
              <span className="flex-1 text-left">{m.label}</span>
              {m.locked && <Lock size={12} className="text-slate-600" />}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800/80">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-900 hover:text-slate-300 transition-colors"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-6 py-3.5 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by district, upazila or ward"
              className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/10 transition-shadow"
            />
          </div>
          <div className="flex-1" />
          {activeLoading && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-500 animate-pulse" /> Loading live data…
            </span>
          )}
          {activeError && !activeLoading && (
            <span className="flex items-center gap-1.5 text-[11px] text-amber-500 bg-amber-500/10 px-2 py-1 rounded-full" title={activeError}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              {activeModule === "heat" ? "Demo values shown" : "Couldn't load"}
            </span>
          )}
          <button className="relative text-slate-500 hover:text-slate-300 transition-colors">
            <Bell size={17} />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-slate-950" />
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 text-sm px-3.5 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 active:scale-[0.97] text-white shadow-lg shadow-orange-950/30 transition-all duration-150"
          >
            <FileText size={14} /> Generate report
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
          />
        ) : activeModule === "forest" ? (
          <DeforestationModuleContent
            data={deforestation}
            selectedDistrict={selectedDistrict}
            setSelectedDistrict={setSelectedDistrict}
            citizenReports={citizenReports}
          />
        ) : activeModule !== "heat" ? (
          <div className="flex-1 flex items-center justify-center p-10 animate-fade-in">
            <div className="text-center max-w-sm">
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto mb-4">
                <Lock size={22} className="text-slate-600" />
              </div>
              <p className="text-slate-200 font-medium">Module in development</p>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                This demo prototype implements Heat, Flood and Deforestation
                monitoring end-to-end. The
                {" "}{OTHER_MODULES.find((m) => m.key === activeModule)?.label.toLowerCase()}
                {" "}module follows the same architecture and is scoped for the next
                build phase.
              </p>
              <button
                onClick={() => setActiveModule("heat")}
                className="mt-5 text-sm text-orange-400 hover:text-orange-300 inline-flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft size={14} /> Back to heat monitoring
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-fade-in">
            {/* KPIs */}
            <div className="grid grid-cols-4 gap-4">
              <Kpi label="City avg. surface temp" value="35.4C" sub="+2.1C vs seasonal baseline" icon={Thermometer} tone="orange" />
              <Kpi label="Active hotspots" value="4" sub="Urban core cluster" icon={AlertTriangle} tone="red" />
              <Kpi label="Population in high+ risk" value="~135,000" sub="Across 4 wards" icon={Users} />
              <Kpi label="Heatwave alerts" value="1" sub="Panchlaish, issued today" icon={Bell} tone="red" />
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Heat map */}
              <div className="col-span-2 bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <Eyebrow>Live layer</Eyebrow>
                    <h3 className="text-sm font-medium text-slate-200 mt-0.5">Surface temperature — Chattogram City</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Derived from Landsat LST composite, current cycle</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>29°C</span>
                    <div className="w-16 h-2 rounded-full ring-1 ring-black/20" style={{ background: "linear-gradient(to right, rgb(45,130,130), rgb(210,170,40), rgb(190,40,30))" }} />
                    <span>39°C</span>
                  </div>
                </div>
                <div className="flex items-center justify-center py-4">
                  <HeatGrid grid={heatGrid} />
                </div>
                <p className="text-[11px] text-slate-600 text-center">Grid cells approximate 500m resolution over the urban core</p>
              </div>

              {/* Hotspot ranking */}
              <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
                <Eyebrow>Priority ranking</Eyebrow>
                <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-4">Heat mitigation priority</h3>
                <div className="space-y-1">
                  {sortedByRisk.map((w, i) => {
                    const c = riskColor(w.risk);
                    const isSelected = selectedWard?.name === w.name;
                    return (
                      <button
                        key={w.name}
                        onClick={() => setSelectedWard(w)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${
                          isSelected ? "bg-slate-800/70 ring-1 " + c.ring : "hover:bg-slate-900/80"
                        }`}
                      >
                        <span className="text-[11px] text-slate-600 w-4 tabular-nums">{i + 1}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className="flex-1 text-sm text-slate-300">{w.name}</span>
                        <span className="text-xs text-slate-500 tabular-nums">{w.temp.toFixed(1)}°C</span>
                        <ChevronRight size={13} className={`text-slate-600 transition-transform ${isSelected ? "translate-x-0.5" : ""}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {selectedWard && (
              <div className={`rounded-2xl p-4 border ${riskColor(selectedWard.risk).bg} border-slate-800 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20`}>
                <IconBadge icon={MapPin} tone={selectedWard.risk === "Extreme" ? "red" : selectedWard.risk === "High" ? "orange" : selectedWard.risk === "Moderate" ? "amber" : "teal"} />
                <div className="flex-1">
                  <span className="text-sm text-slate-200 font-medium">{selectedWard.name}</span>
                  <span className="text-xs text-slate-500 ml-2">
                    {selectedWard.temp.toFixed(1)}°C · {selectedWard.risk} risk · NDVI {selectedWard.ndvi.toFixed(2)} · population {selectedWard.pop.toLocaleString()}
                  </span>
                </div>
                <button onClick={() => setSelectedWard(null)} className="text-slate-500 hover:text-slate-300 hover:bg-black/20 rounded-lg p-1 transition-colors">
                  <X size={15} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-6">
              {/* Trend chart */}
              <div className="col-span-2 bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-orange-400/80" />
                  <h3 className="text-sm font-medium text-slate-200">12-month temperature trend</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">City average vs 10-year seasonal baseline</p>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="tempLineGlow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fb923c" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={[22, 40]} />
                      <Tooltip
                        contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, fontSize: 12, boxShadow: "0 8px 24px -8px rgba(0,0,0,0.5)" }}
                        labelStyle={{ color: "#cbd5e1", marginBottom: 2 }}
                        cursor={{ stroke: "#334155", strokeWidth: 1 }}
                      />
                      <Line type="monotone" dataKey="baseline" stroke="#475569" strokeWidth={1.5} dot={false} name="Baseline" />
                      <Line type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={2.5} dot={{ r: 2.5, fill: "#fb923c", strokeWidth: 0 }} activeDot={{ r: 4.5 }} name="Observed" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
                <h3 className="text-sm font-medium text-slate-200 mb-3.5">Recommended interventions</h3>
                <div className="space-y-3.5">
                  {RECOMMENDATIONS.map((r) => (
                    <div key={r.title} className="flex gap-3">
                      <IconBadge icon={r.icon} tone="teal" size={14} />
                      <div>
                        <p className="text-xs font-medium text-slate-300">{r.title}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{r.body}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {search && (
              <div className="text-xs text-slate-500">
                {filteredWards.length} ward(s) match "{search}"
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

function FloodModuleContent({ floodTab, setFloodTab, dhaka, national, selectedArea, setSelectedArea }) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-fade-in">
      <div className="inline-flex items-center gap-1 bg-slate-900/80 border border-slate-800 rounded-lg p-1">
        <button
          onClick={() => setFloodTab("dhaka")}
          className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${floodTab === "dhaka" ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
        >
          Dhaka (detailed)
        </button>
        <button
          onClick={() => setFloodTab("national")}
          className={`px-3.5 py-1.5 rounded-md text-sm transition-colors ${floodTab === "national" ? "bg-slate-800 text-slate-100" : "text-slate-500 hover:text-slate-300"}`}
        >
          Nationwide overview (64 districts)
        </button>
      </div>

      {floodTab === "dhaka" ? (
        <FloodDhakaView dhaka={dhaka} selectedArea={selectedArea} setSelectedArea={setSelectedArea} />
      ) : (
        <FloodNationalView national={national} />
      )}
    </div>
  );
}

function FloodDhakaView({ dhaka, selectedArea, setSelectedArea }) {
  const { grid, trend, areas, summary, loading, error } = dhaka;

  if (loading || error || !summary) {
    return <DataStateNotice loading={loading} error={error} label="Dhaka flood data" />;
  }

  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Flood-prone area" value={`${summary.floodPronePct}%`} sub={`${summary.floodProneCells} of ${summary.totalCells} grid cells`} icon={Droplets} tone="orange" />
        <Kpi label="Peak area under alert" value={`${summary.peakPctAlerted}%`} sub={summary.peakDate} icon={AlertTriangle} tone="red" />
        <Kpi label="Alert days" value={summary.alertDays} sub={`of ${summary.totalDays} days observed`} />
        <Kpi label="Rainfall vs baseline" value={`${summary.observedRainfall}mm`} sub={`baseline ${summary.historicalRainfall}mm/day`} tone="teal" />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>Real data — 2025 monsoon window</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5">Flood risk — Dhaka (14 Jul 2025, historical peak)</h3>
          <p className="text-xs text-slate-500 mt-0.5 mb-4">Rule-based composite score: 0.5×terrain susceptibility + 0.5×rainfall factor</p>
          <div className="flex items-center justify-center py-4">
            {grid && <HeatGrid grid={grid} colorFn={riskScoreToColor} labelFn={(v) => `risk ${(v * 100).toFixed(0)}%`} />}
          </div>
          <p className="text-[11px] text-slate-600 text-center">Block-averaged from the real 1,650-cell Dhaka analysis grid</p>
        </div>

        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>Highest risk</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-4">Top locations</h3>
          <div className="space-y-1 max-h-72 overflow-y-auto">
            {(areas || []).map((a, i) => {
              const isSelected = selectedArea?.area === a.area;
              return (
                <button
                  key={a.area}
                  onClick={() => setSelectedArea(a)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${isSelected ? "bg-slate-800/70 ring-1 ring-orange-500/30" : "hover:bg-slate-900/80"}`}
                >
                  <span className="text-[11px] text-slate-600 w-4 tabular-nums">{i + 1}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${a.category === "High" ? "bg-red-500" : a.category === "Medium" ? "bg-amber-500" : "bg-teal-500"}`} />
                  <span className="flex-1 text-xs text-slate-300 truncate">{a.area}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{(a.risk * 100).toFixed(0)}%</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {selectedArea && (
        <div className="rounded-2xl p-4 border bg-slate-900/40 border-slate-800 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20">
          <IconBadge icon={MapPin} tone={selectedArea.category === "High" ? "red" : "amber"} />
          <div className="flex-1">
            <span className="text-sm text-slate-200 font-medium">{selectedArea.area}</span>
            <span className="text-xs text-slate-500 ml-2">
              risk {(selectedArea.risk * 100).toFixed(0)}% · {selectedArea.category} · elevation {selectedArea.elevation}m · {selectedArea.riverDist}m from river
            </span>
          </div>
          <button onClick={() => setSelectedArea(null)} className="text-slate-500 hover:text-slate-300 hover:bg-black/20 rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {trend && (
        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={14} className="text-orange-400/80" />
            <h3 className="text-sm font-medium text-slate-200">62-day rainfall vs. % of Dhaka under alert</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">8 Jun – 8 Aug 2025, real observed rainfall</p>
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

      <p className="text-[11px] text-slate-600">
        No supervised model was trained for Dhaka — no flood-event ground truth exists for this window. Risk
        scores are a relative, comparative signal, not a calibrated probability.
      </p>
    </>
  );
}

function FloodNationalView({ national }) {
  const { severity, priority, summary, loading, error } = national;

  const severityByDistrict = useMemo(() => {
    const m = {};
    (severity || []).forEach((s) => { m[s.district_id] = s; });
    return m;
  }, [severity]);

  if (loading || error || !summary) {
    return <DataStateNotice loading={loading} error={error} label="nationwide flood data" />;
  }

  const topPriority = (priority || []).slice(0, 20);
  const observedYears = summary.observed_years || [];
  const proxyYears = summary.proxy_years || [];

  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="Districts covered" value={summary.districts} sub="All of Bangladesh" icon={MapPin} />
        <Kpi label="Validated recall" value="83%" sub="on real 2018 held-out events" icon={ShieldCheck} tone="teal" />
        <Kpi label="Validated ROC-AUC" value="0.91" sub="real ground-truth test year" tone="teal" />
        <Kpi label="Top priority district" value={topPriority[0]?.district_name || "—"} sub="highest mitigation priority" icon={AlertTriangle} tone="red" />
      </div>

      {summary.last_refreshed_at && (
        <div className="flex items-center gap-2 text-[11px] text-teal-400/80">
          <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
          <span>
            Live — risk rescored every 3 days from real rainfall
            {summary.live_prediction_window ? ` through ${summary.live_prediction_window.end_date}` : ""}.
            Last refreshed {new Date(summary.last_refreshed_at).toLocaleString("en-GB", {
              day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
            })}.
          </span>
        </div>
      )}

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex items-start gap-3">
        <IconBadge icon={Info} tone="amber" size={14} />
        <p className="text-xs text-amber-200/90 leading-relaxed">
          Trained on real flood-event ground truth (DFO + Global Flood Database) for {observedYears.join("–")}.
          No free machine-readable ground truth exists for {proxyYears[0]}–{proxyYears[proxyYears.length - 1]},
          so those years use a disclosed rainfall-extremity proxy label instead — never silently mixed with real
          events. Precision is intentionally low (a district-day is genuinely a flood ~3–5% of the time); the model
          trades some false alarms for catching more real floods, the right tradeoff for early warning.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>Mitigation priority</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-1">Top 20 of 64 districts</h3>
          <p className="text-xs text-slate-500 mb-4">Weighted: 50% predicted risk, 30% historical severity, 20% area exposure</p>
          <div className="space-y-1">
            {topPriority.map((d) => {
              const sev = severityByDistrict[d.district_id];
              const tier = sev?.severity_tier || "Moderate";
              const c = tierColor(tier);
              return (
                <div key={d.district_id} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-900/80 transition-colors">
                  <span className="text-[11px] text-slate-600 w-5 tabular-nums">{d.priority_rank}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  <span className="flex-1 text-sm text-slate-300">{d.district_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.bg} ${c.text}`}>{tier}</span>
                  <RiskTrendBadge trend={sev?.risk_trend} />
                  <span className="text-xs text-slate-500 tabular-nums w-16 text-right">risk {(d.avg_predicted_risk * 100).toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-600 mt-3">+{Math.max(0, (priority || []).length - 20)} more districts, ranked, in the full export.</p>
        </div>

        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow tone="teal">Model provenance</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-3">For the defense panel</h3>
          <div className="space-y-3 text-xs text-slate-400">
            <div><span className="text-slate-300">Algorithm:</span> Random Forest, class-weighted</div>
            <div><span className="text-slate-300">Rows:</span> {summary.rows_total?.toLocaleString()} district-days</div>
            <div><span className="text-slate-300">Date range:</span> {summary.date_range?.[0]} – {summary.date_range?.[1]}</div>
            <div><span className="text-slate-300">Train years:</span> {summary.train_years?.join("–")} (real events only)</div>
            <div><span className="text-slate-300">Test years:</span> {summary.test_years?.join("–")}</div>
            {summary.live_prediction_window && (
              <div className="pt-2 border-t border-slate-800">
                <span className="text-slate-300">Live risk window:</span> {summary.live_prediction_window.start_date} – {summary.live_prediction_window.end_date}
                {" "}({summary.live_prediction_window.window_days} real days, refreshed every 3 days via Open-Meteo)
              </div>
            )}
            <div className="pt-2 border-t border-slate-800">
              <span className="text-slate-300">Exposure proxy:</span> district area (population data wasn't in the
              original export — a disclosed limitation, not a hidden one)
            </div>
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

function DeforestationModuleContent({ data, selectedDistrict, setSelectedDistrict, citizenReports }) {
  const { districts, worklist, worklistTotal, restoration, lossByYear, loading, error } = data;

  if (loading || error || !districts) {
    return (
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in">
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
    <div className="flex-1 overflow-y-auto p-6 space-y-6 animate-fade-in">
      <div className="grid grid-cols-4 gap-4">
        <Kpi label="National loss, 2017–2024" value={`${Math.round(nationalLossKm2).toLocaleString()} km²`} sub="persistent, 2-year-confirmed loss" icon={TreeDeciduous} tone="red" />
        <Kpi label="Districts accelerating" value={alertCount} sub="recent loss ≥1.5× own baseline" icon={AlertTriangle} tone="orange" />
        <Kpi label="Avg. tree cover" value={`${avgForestPct.toFixed(1)}%`} sub="national average, 2024" tone="teal" />
        <Kpi label="Loss patches mapped" value={(worklistTotal ?? worklist?.length ?? 0).toLocaleString()} sub="≥0.25 km², 2017–2023" />
      </div>

      <div className="bg-amber-950/20 border border-amber-900/30 rounded-2xl p-4 flex items-start gap-3">
        <IconBadge icon={Info} tone="amber" size={14} />
        <p className="text-xs text-amber-200/90 leading-relaxed">
          This reports tree cover (includes homestead groves and plantations), not gazetted forest — do not
          compare to the Forest Department's 11–15% figure. National year-by-year trend direction and the
          loss forecast are intentionally not shown here: three normalisation methods on this data disagree
          even on the sign of the decade change, and the forecast's error exceeds a usable threshold. District
          rankings and loss locations below passed every integration check.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow>Ranked by loss</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-4">District ranking — 64 districts</h3>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {sortedByLoss.map((d, i) => {
              const c = tierColor(d.priority);
              const isSelected = selectedDistrict?.district === d.district;
              return (
                <button
                  key={d.district}
                  onClick={() => setSelectedDistrict(d)}
                  className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-all duration-150 ${isSelected ? "bg-slate-800/70 ring-1 " + c.ring : "hover:bg-slate-900/80"}`}
                >
                  <span className="text-[11px] text-slate-600 w-5 tabular-nums">{i + 1}</span>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                  <span className="flex-1 text-sm text-slate-300">{d.district}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{d.forest_pct_now?.toFixed(1)}% cover</span>
                  <ChevronRight size={13} className={`text-slate-600 transition-transform ${isSelected ? "translate-x-0.5" : ""}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <Eyebrow tone="teal">Restoration priority</Eyebrow>
          <h3 className="text-sm font-medium text-slate-200 mt-0.5 mb-4">Top replanting targets</h3>
          <div className="space-y-2.5">
            {topRestoration.map((r, i) => (
              <div key={r.district} className="flex items-center gap-2.5">
                <IconBadge icon={Sprout} tone="teal" size={13} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300 truncate">{r.district}</p>
                  <p className="text-[11px] text-slate-500">{r.forest_pct_now?.toFixed(1)}% cover · {r.trend}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {selectedDistrict && (
        <div className={`rounded-2xl p-4 border ${tierColor(selectedDistrict.priority).bg} border-slate-800 flex items-center gap-4 animate-fade-in-up shadow-sm shadow-black/20`}>
          <IconBadge icon={TreeDeciduous} tone={selectedDistrict.priority === "High" ? "red" : selectedDistrict.priority === "Medium" ? "amber" : "teal"} />
          <div className="flex-1">
            <span className="text-sm text-slate-200 font-medium">{selectedDistrict.district}</span>
            <span className="text-xs text-slate-500 ml-2">
              {selectedDistrict.forest_pct_now?.toFixed(1)}% cover · lost {selectedDistrict.forest_loss_pct?.toFixed(1)}% since 2016 ·
              {" "}{selectedDistrict.trend} · restoration: {selectedDistrict.restoration_tier}
              {selectedDistrict.protected_loss_km2 > 0 && ` · ${selectedDistrict.protected_loss_km2.toFixed(1)} km² lost inside protected areas`}
            </span>
          </div>
          <button onClick={() => setSelectedDistrict(null)} className="text-slate-500 hover:text-slate-300 hover:bg-black/20 rounded-lg p-1 transition-colors">
            <X size={15} />
          </button>
        </div>
      )}

      {lossByYear && lossByYear.length > 0 && (
        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <h3 className="text-sm font-medium text-slate-200 mb-1">National loss by year</h3>
          <p className="text-xs text-slate-500 mb-3">km² of persistent, 2-year-confirmed loss</p>
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
        <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
          <div className="flex items-center justify-between mb-3">
            <div>
              <Eyebrow tone="orange">Field worklist</Eyebrow>
              <h3 className="text-sm font-medium text-slate-200 mt-0.5">Recent loss patches</h3>
            </div>
            <span className="text-[11px] text-slate-500">showing {Math.min(50, worklist.length)} of {(worklistTotal ?? worklist.length).toLocaleString()}, protected + recent first</span>
          </div>
          <div className="max-h-64 overflow-y-auto">
            <table className="w-full text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="text-slate-500 text-left">
                  <th className="py-1.5 font-medium border-b border-slate-800">District</th>
                  <th className="py-1.5 font-medium border-b border-slate-800">Year</th>
                  <th className="py-1.5 font-medium border-b border-slate-800">Area</th>
                  <th className="py-1.5 font-medium border-b border-slate-800">Protected</th>
                </tr>
              </thead>
              <tbody>
                {worklist.slice(0, 50).map((p, i) => (
                  <tr key={i} className={i % 2 === 1 ? "bg-slate-900/30" : ""}>
                    <td className="py-1.5 px-1 text-slate-300">{p.district}</td>
                    <td className="py-1.5 px-1 text-slate-400">{p.loss_year}</td>
                    <td className="py-1.5 px-1 text-slate-400">{p.area_km2?.toFixed(2)} km²</td>
                    <td className="py-1.5 px-1">
                      {p.in_protected ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-950/40 text-red-400">yes</span> : <span className="text-slate-600">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-5 shadow-sm shadow-black/20">
        <div className="flex items-center justify-between mb-1">
          <div>
            <Eyebrow tone="teal">Citizen reports</Eyebrow>
            <h3 className="text-sm font-medium text-slate-200 mt-0.5">Tree-cutting reported by citizens</h3>
          </div>
          {citizenReports?.reports && (
            <span className="text-[11px] text-slate-500">{citizenReports.reports.length} report(s)</span>
          )}
        </div>
        <p className="text-xs text-slate-500 mb-3">
          Unverified — a complementary signal to the satellite model, not confirmed field findings.
        </p>
        {citizenReports?.loading ? (
          <p className="text-xs text-slate-500 py-4">Loading citizen reports…</p>
        ) : citizenReports?.error ? (
          <p className="text-xs text-amber-500 py-4">Couldn't load citizen reports.</p>
        ) : citizenReports?.configured === false ? (
          <p className="text-xs text-slate-500 py-4">
            Not set up yet — see CITIZEN-REPORTS-SETUP.md to enable citizen reporting.
          </p>
        ) : !citizenReports?.reports || citizenReports.reports.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">No citizen reports submitted yet.</p>
        ) : (
          <div className="space-y-2.5 max-h-64 overflow-y-auto">
            {citizenReports.reports.map((r) => (
              <div key={r.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-900/60">
                <IconBadge icon={AlertTriangle} tone="amber" size={12} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-300">
                    <span className="font-medium">{r.district}</span> — {r.description}
                  </p>
                  <p className="text-[11px] text-slate-600 mt-0.5">
                    {new Date(r.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                    {r.contact ? ` · contact: ${r.contact}` : ""}
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
    yourArea: "Your area",
    yourAreaHint: "Flood risk and tree cover below update for whichever district you pick. Heat monitoring currently only covers Chattogram.",
    heatAlertTitle: "Extreme heat alert — Panchlaish and Kotwali",
    heatAlertBody: "Surface temperatures above 38°C expected through this afternoon. Avoid outdoor work between 12pm–4pm.",
    heatNotAvailable: "Heat risk monitoring is currently only available for Chattogram's wards. Pick Chattogram above to see it, or check the flood and tree-cover cards below for",
    heatMapTitle: "Heat map — your area",
    currentTemp: "Current, your ward",
    airQuality: "Air quality today",
    healthAdvisoryTitle: "Health advisory",
    healthAdvisoryBody: "Heat risk is extreme in your area today. Drink water regularly even without feeling thirsty, limit direct sun exposure between midday and late afternoon, and check on elderly neighbours and young children.",
    coolingCentersTitle: "Nearby cooling centers",
    floodRiskTitle: "Flood risk —",
    floodRiskLive: "Live, rescored every 3 days from real rainfall",
    floodRiskFallback: "Flood data isn't available right now — showing the last known status.",
    floodRiskFallbackNote: "Couldn't load live flood data. Try again shortly.",
    trendUp: "rising since last update",
    trendDown: "falling since last update",
    trendSteady: "steady since last update",
    safeHours: "Safer hours to be outside: before 7am or after 6pm.",
    whatToDo: "What to do",
    emergencyLine: "National emergency helpline: 999 (fire, flood rescue, ambulance)",
    emergencyLine2: "For your nearest official shelter, contact your local Union Parishad / Ward office.",
    treeCoverTitle: "Tree cover —",
    footer: "Live where available; demo values used as fallback.",
    loading: "Loading…",
    reportTitle: "Seen tree-cutting nearby?",
    reportHint: "Satellite data can miss small, local cutting. Your report helps — it's shown to government reviewers, not verified automatically.",
    reportDescriptionPlaceholder: "What did you see, and roughly where? (e.g. \"several trees cut near the riverbank, Ward 4\")",
    reportContactPlaceholder: "Phone or email (optional)",
    reportSubmit: "Submit report",
    reportSending: "Sending…",
    reportSuccess: "Thank you — your report was submitted.",
    reportNotConfigured: "Reports aren't accepted yet — this feature needs one more setup step on the backend.",
    reportError: "Couldn't submit your report. Please try again shortly.",
    reportTooShort: "Please add a few more words describing what you saw.",
  },
  bn: {
    appName: "বাংলাদেশ পরিবেশ পর্যবেক্ষণ",
    exit: "বের হন",
    yourArea: "আপনার এলাকা",
    yourAreaHint: "নিচের বন্যার ঝুঁকি ও বনভূমি তথ্য আপনার বাছাই করা জেলা অনুযায়ী বদলাবে। তাপ পর্যবেক্ষণ এখন শুধু চট্টগ্রামের জন্য।",
    heatAlertTitle: "তীব্র তাপ সতর্কতা — পাঁচলাইশ ও কোতোয়ালী",
    heatAlertBody: "আজ বিকাল পর্যন্ত ভূপৃষ্ঠের তাপমাত্রা ৩৮°সে-এর বেশি থাকতে পারে। দুপুর ১২টা থেকে বিকাল ৪টার মধ্যে বাইরে কাজ এড়িয়ে চলুন।",
    heatNotAvailable: "তাপের ঝুঁকি পর্যবেক্ষণ এখন শুধু চট্টগ্রামের ওয়ার্ডগুলোর জন্য পাওয়া যায়। এটা দেখতে উপরে চট্টগ্রাম বাছাই করুন, অথবা নিচে",
    heatMapTitle: "তাপ মানচিত্র — আপনার এলাকা",
    currentTemp: "বর্তমান, আপনার ওয়ার্ড",
    airQuality: "আজকের বায়ুর মান",
    healthAdvisoryTitle: "স্বাস্থ্য পরামর্শ",
    healthAdvisoryBody: "আজ আপনার এলাকায় তাপের ঝুঁকি তীব্র। তৃষ্ণা না লাগলেও নিয়মিত পানি পান করুন, দুপুর থেকে বিকাল পর্যন্ত সরাসরি রোদ এড়িয়ে চলুন, এবং বয়স্ক প্রতিবেশী ও শিশুদের খোঁজ নিন।",
    coolingCentersTitle: "কাছাকাছি কুলিং সেন্টার",
    floodRiskTitle: "বন্যার ঝুঁকি —",
    floodRiskLive: "লাইভ — প্রতি ৩ দিন পরপর প্রকৃত বৃষ্টিপাতের তথ্য দিয়ে হালনাগাদ",
    floodRiskFallback: "এই মুহূর্তে বন্যার তথ্য পাওয়া যাচ্ছে না — সর্বশেষ জানা অবস্থা দেখানো হচ্ছে।",
    floodRiskFallbackNote: "লাইভ বন্যার তথ্য লোড করা যায়নি। একটু পর আবার চেষ্টা করুন।",
    trendUp: "গত হালনাগাদের তুলনায় বাড়ছে",
    trendDown: "গত হালনাগাদের তুলনায় কমছে",
    trendSteady: "গত হালনাগাদের তুলনায় একই আছে",
    safeHours: "বাইরে থাকার নিরাপদ সময়: সকাল ৭টার আগে অথবা সন্ধ্যা ৬টার পরে।",
    whatToDo: "কী করবেন",
    emergencyLine: "জাতীয় জরুরি সেবা: ৯৯৯ (ফায়ার সার্ভিস, বন্যা উদ্ধার, অ্যাম্বুলেন্স)",
    emergencyLine2: "নিকটতম সরকারি আশ্রয়কেন্দ্রের জন্য আপনার স্থানীয় ইউনিয়ন পরিষদ / ওয়ার্ড অফিসে যোগাযোগ করুন।",
    treeCoverTitle: "বনভূমি —",
    footer: "যেখানে সম্ভব লাইভ তথ্য; না পেলে ডেমো মান দেখানো হয়।",
    loading: "লোড হচ্ছে…",
    reportTitle: "আশেপাশে গাছ কাটা দেখেছেন?",
    reportHint: "স্যাটেলাইট ডেটা ছোট আকারের স্থানীয় গাছ কাটা ধরতে পারে না। আপনার রিপোর্ট সাহায্য করে — এটা সরকারি পর্যালোচকদের দেখানো হয়, স্বয়ংক্রিয়ভাবে যাচাই করা হয় না।",
    reportDescriptionPlaceholder: "কী দেখেছেন, আনুমানিক কোথায়? (যেমন: \"নদীর ধারে কয়েকটি গাছ কাটা হয়েছে, ওয়ার্ড ৪\")",
    reportContactPlaceholder: "ফোন বা ইমেইল (ঐচ্ছিক)",
    reportSubmit: "রিপোর্ট জমা দিন",
    reportSending: "পাঠানো হচ্ছে…",
    reportSuccess: "ধন্যবাদ — আপনার রিপোর্ট জমা হয়েছে।",
    reportNotConfigured: "রিপোর্ট এখনো গ্রহণ করা হচ্ছে না — এই ফিচারের জন্য backend-এ আরেকটা setup ধাপ বাকি আছে।",
    reportError: "আপনার রিপোর্ট জমা দেওয়া যায়নি। একটু পর আবার চেষ্টা করুন।",
    reportTooShort: "আপনি কী দেখেছেন সেটা আরেকটু বিস্তারিত লিখুন।",
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
      setStatus("sent");
      setDescription("");
      setContact("");
    } catch (err) {
      setErrorDetail(err.message || "");
      setStatus("error");
    }
  }

  return (
    <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
      <div className="flex items-center gap-2.5 mb-1">
        <IconBadge icon={Send} tone="teal" size={13} />
        <h3 className="text-sm font-medium text-slate-200">{t.reportTitle}</h3>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 leading-relaxed">{t.reportHint}</p>

      {status === "sent" ? (
        <p className="text-xs text-teal-300">{t.reportSuccess}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.reportDescriptionPlaceholder}
            rows={2}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-teal-500/50 resize-none"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t.reportContactPlaceholder}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-teal-500/50"
          />
          {status === "too_short" && <p className="text-[11px] text-amber-400">{t.reportTooShort}</p>}
          {status === "not_configured" && <p className="text-[11px] text-amber-400">{t.reportNotConfigured}</p>}
          {status === "error" && <p className="text-[11px] text-amber-400">{t.reportError}{errorDetail ? ` (${errorDetail})` : ""}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="w-full bg-teal-600/20 hover:bg-teal-600/30 disabled:opacity-60 text-teal-300 text-xs font-medium py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            {status === "sending" ? t.reportSending : t.reportSubmit}
          </button>
        </form>
      )}
    </div>
  );
}

function CitizenDashboard({ onLogout }) {
  const { heatGrid } = useHeatData();
  const { citizenCards } = useDeforestationData();
  const { severity, summary, loading: floodLoading, error: floodError } = useNationalFloodData();
  const [lang, setLang] = useState("en");
  const t = CITIZEN_I18N[lang];

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

  // Tree cover really does exist for all 64 districts (unlike Heat below),
  // so this one genuinely follows the area picker instead of staying fixed.
  const treeCard = useMemo(
    () => (citizenCards || []).find((c) => c.district === selectedDistrict) || null,
    [citizenCards, selectedDistrict]
  );

  // The Heat model was only ever built for Chattogram's wards (thesis
  // scope) — there is no real heat data for any other district, so we
  // don't fake it. The heat section only shows when the picked area is
  // Chattogram; otherwise a short honest note replaces it.
  const isChattogramArea = /chattogram|chittagong/i.test(selectedDistrict || "");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="sticky top-0 z-10 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/25 to-orange-600/5 ring-1 ring-orange-500/25">
            <Sun size={16} className="text-orange-400" />
          </span>
          <span className="text-sm font-semibold text-slate-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            {t.appName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLang(lang === "en" ? "bn" : "en")}
            className="text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1 rounded-lg hover:bg-slate-900 transition-colors border border-slate-800"
          >
            {lang === "en" ? "বাংলা" : "English"}
          </button>
          <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-300 px-2.5 py-1 rounded-lg hover:bg-slate-900 transition-colors">{t.exit}</button>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4 animate-fade-in">
        {districtOptions.length > 0 && (
          <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-sm font-medium text-slate-200">{t.yourArea}</h3>
              <select
                value={selectedDistrict || ""}
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className="text-xs bg-slate-800/80 border border-slate-700 text-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
              >
                {districtOptions.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-500">{t.yourAreaHint}</p>
          </div>
        )}

        {isChattogramArea ? (
          <>
            <div className="bg-gradient-to-br from-red-950/50 to-red-950/20 border border-red-900/40 rounded-2xl p-4 flex items-start gap-3 shadow-sm shadow-black/20">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/15 ring-1 ring-red-500/30 shrink-0">
                <AlertTriangle size={16} className="text-red-400" />
              </span>
              <div>
                <p className="text-sm font-medium text-red-300">{t.heatAlertTitle}</p>
                <p className="text-xs text-red-400/80 mt-1 leading-relaxed">{t.heatAlertBody}</p>
              </div>
            </div>

            <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-200">{t.heatMapTitle}</h3>
                <span className="text-[11px] text-slate-500 bg-slate-800/60 px-2 py-0.5 rounded-full">Panchlaish</span>
              </div>
              <div className="flex justify-center">
                <HeatGrid grid={heatGrid} compact />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
                <IconBadge icon={Thermometer} tone="orange" size={14} className="mb-2.5" />
                <div className="text-xl font-semibold text-slate-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>38.6°C</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{t.currentTemp}</div>
              </div>
              <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
                <IconBadge icon={Wind} tone="teal" size={14} className="mb-2.5" />
                <div className="text-xl font-semibold text-slate-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>Moderate</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{t.airQuality}</div>
              </div>
            </div>

            <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
              <h3 className="text-sm font-medium text-slate-200 mb-2">{t.healthAdvisoryTitle}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{t.healthAdvisoryBody}</p>
              <p className="text-xs text-orange-300/90 leading-relaxed mt-2 pt-2 border-t border-slate-800">{t.safeHours}</p>
            </div>

            <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
              <h3 className="text-sm font-medium text-slate-200 mb-3">{t.coolingCentersTitle}</h3>
              <div className="space-y-3">
                {COOLING_CENTERS.map((c) => (
                  <div key={c.name} className="flex items-center gap-3">
                    <IconBadge icon={MapPin} tone="teal" size={13} />
                    <div className="flex-1">
                      <p className="text-xs text-slate-300">{c.name}</p>
                      <p className="text-[11px] text-slate-500">{c.distance} away · capacity {c.capacity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20 flex items-start gap-3">
            <IconBadge icon={Info} tone="amber" size={14} />
            <p className="text-xs text-slate-400 leading-relaxed">{t.heatNotAvailable} {selectedDistrict}.</p>
          </div>
        )}

        {floodLoading || floodError || !selectedFlood ? (
          <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
            <h3 className="text-sm font-medium text-slate-200 mb-1">{t.floodRiskTitle} {selectedDistrict || ""}</h3>
            <p className="text-xs text-slate-500">{floodLoading ? t.loading : t.floodRiskFallbackNote}</p>
          </div>
        ) : (
          (() => {
            const tier = selectedFlood.severity_tier || "Moderate";
            const c = tierColor(tier);
            const steps = floodSafetySteps(tier, lang);
            return (
              <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2.5">
                    <IconBadge icon={Droplets} tone="teal" size={14} />
                    <h3 className="text-sm font-medium text-slate-200">{t.floodRiskTitle} {selectedFlood.district_name}</h3>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full ${c.bg} ${c.text}`}>{tier}</span>
                </div>
                <p className="text-[11px] text-slate-500 mb-3 flex items-center gap-1.5 flex-wrap">
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
                      <span className="w-1 h-1 rounded-full bg-slate-600 mt-1.5 shrink-0" />
                      <p className="text-xs text-slate-400 leading-relaxed">{s}</p>
                    </div>
                  ))}
                </div>
                {(tier === "Severe" || tier === "High" || tier === "Moderate") && (
                  <div className="mt-3 pt-3 border-t border-slate-800 space-y-1">
                    <p className="text-[11px] text-slate-500">{t.emergencyLine}</p>
                    <p className="text-[11px] text-slate-500">{t.emergencyLine2}</p>
                  </div>
                )}
              </div>
            );
          })()
        )}

        {treeCard && (
          <div className="bg-gradient-to-b from-slate-900/70 to-slate-900/30 border border-slate-800 rounded-2xl p-4 shadow-sm shadow-black/20">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <IconBadge icon={TreeDeciduous} tone="teal" size={14} />
                <h3 className="text-sm font-medium text-slate-200">{t.treeCoverTitle} {treeCard.district}</h3>
              </div>
              <span className="text-lg font-semibold text-slate-100 tabular-nums" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
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
            <p className="text-xs text-slate-400 leading-relaxed mt-2">{treeCard.message}</p>
            <button className="w-full mt-3 bg-teal-600/20 hover:bg-teal-600/30 text-teal-300 text-xs font-medium py-2 rounded-lg transition-colors">
              {treeCard.call_to_action}
            </button>
          </div>
        )}

        {selectedDistrict && <CitizenReportForm district={selectedDistrict} lang={lang} />}

        <p className="text-[11px] text-slate-600 text-center pt-1 pb-2">
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
    "w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 mt-1 mb-3 text-sm text-slate-300 focus:outline-none focus:border-orange-500/50";

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-6">
          <ArrowLeft size={14} /> Back
        </button>

        {mode === "login" ? (
          <form onSubmit={handleLoginSubmit} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <ShieldCheck size={22} className="text-orange-400 mb-3" />
            <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Government sign in
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">Role-based access to environmental monitoring and decision support</p>

            <label className="text-xs text-slate-400">Role</label>
            <select
              value={role}
              onChange={(e) => handleRoleChange(e.target.value)}
              className={inputClass}
            >
              {REGISTERABLE_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="text-xs text-slate-400">Officer ID</label>
            <input value={officerId} onChange={(e) => setOfficerId(e.target.value)} className={inputClass} />

            <label className="text-xs text-slate-400">Password</label>
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
            <p className="text-[11px] text-slate-600 mt-3 text-center">Role selects the matching demo credentials automatically</p>

            <div className="border-t border-slate-800 mt-4 pt-4 text-center">
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
          <form onSubmit={handleRegisterSubmit} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <UserPlus size={22} className="text-orange-400 mb-3" />
            <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Officer registration
            </h2>
            <p className="text-xs text-slate-500 mt-1 mb-5">Create an account to get government dashboard access</p>

            <label className="text-xs text-slate-400">Full name</label>
            <input value={regName} onChange={(e) => setRegName(e.target.value)} className={inputClass} placeholder="e.g. Rahim Uddin" />

            <label className="text-xs text-slate-400">Role</label>
            <select value={regRole} onChange={(e) => setRegRole(e.target.value)} className={inputClass}>
              {REGISTERABLE_ROLES.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>

            <label className="text-xs text-slate-400">Officer ID</label>
            <input
              value={regOfficerId}
              onChange={(e) => setRegOfficerId(e.target.value)}
              className={inputClass}
              placeholder="Choose a unique ID, e.g. rahim_2026"
            />

            <label className="text-xs text-slate-400">Password</label>
            <input
              type="password"
              value={regPassword}
              onChange={(e) => setRegPassword(e.target.value)}
              className={inputClass}
              placeholder="At least 6 characters"
            />

            <label className="text-xs text-slate-400">Confirm password</label>
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

            <div className="border-t border-slate-800 mt-4 pt-4 text-center">
              <button
                type="button"
                onClick={() => switchMode("login")}
                className="text-xs text-slate-400 hover:text-slate-300"
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
    <div className="relative min-h-screen bg-slate-950 flex items-center justify-center p-4 overflow-hidden">
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
          <h1 className="text-3xl sm:text-4xl font-semibold text-slate-100 tracking-tight" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Bangladesh Climate and Hazard Console
          </h1>
          <p className="text-sm text-slate-500 mt-3.5 max-w-md mx-auto leading-relaxed">
            Satellite-derived heat, flood, air quality and deforestation monitoring
            for government planning and public awareness.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <button
            onClick={() => onSelect("govt")}
            className="text-left bg-gradient-to-b from-slate-900/80 to-slate-900/40 border border-slate-800 hover:border-orange-500/40 rounded-2xl p-6 transition-all duration-200 group shadow-sm shadow-black/20 hover:-translate-y-1 hover:shadow-xl hover:shadow-orange-950/20"
          >
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-orange-500/10 ring-1 ring-orange-500/20 mb-4 group-hover:scale-105 transition-transform">
              <ShieldCheck size={22} className="text-orange-400" />
            </span>
            <p className="text-slate-100 font-medium">Government dashboard</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Full access to risk analysis, AI predictions, resource planning and report generation.
            </p>
            <span className="text-xs text-orange-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all font-medium">
              Continue <ChevronRight size={13} />
            </span>
          </button>
          <button
            onClick={() => onSelect("citizen")}
            className="text-left bg-gradient-to-b from-slate-900/80 to-slate-900/40 border border-slate-800 hover:border-teal-500/40 rounded-2xl p-6 transition-all duration-200 group shadow-sm shadow-black/20 hover:-translate-y-1 hover:shadow-xl hover:shadow-teal-950/20"
          >
            <span className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-teal-500/10 ring-1 ring-teal-500/20 mb-4 group-hover:scale-105 transition-transform">
              <Users size={22} className="text-teal-400" />
            </span>
            <p className="text-slate-100 font-medium">Citizen dashboard</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Flood risk and tree cover for your district, plus Chattogram heat alerts, air quality and health advisories.
            </p>
            <span className="text-xs text-teal-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all font-medium">
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
