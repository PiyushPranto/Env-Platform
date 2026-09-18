import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Thermometer, Droplets, Wind, TreeDeciduous, AlertTriangle, MapPin,
  Download, LogOut, Users, ShieldCheck, Bell, Search, TrendingUp,
  FileText, X, Lock, ChevronRight, Sun, Building2, Sprout, ArrowLeft,
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
  { key: "flood", label: "Flood monitoring", icon: Droplets },
  { key: "air", label: "Air pollution", icon: Wind },
  { key: "forest", label: "Deforestation", icon: TreeDeciduous },
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
// Shared bits
// ---------------------------------------------------------------------------

function HeatGrid({ grid, compact }) {
  const cell = compact ? 26 : 34;
  return (
    <div className="inline-block rounded-lg overflow-hidden border border-slate-800">
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((t, ci) => (
            <div
              key={ci}
              title={`${t.toFixed(0)}C`}
              style={{ width: cell, height: cell, background: tempToColor(t) }}
              className="border border-slate-950/40"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub, icon: Icon, tone = "slate" }) {
  const toneMap = {
    slate: "text-slate-200",
    orange: "text-orange-400",
    red: "text-red-400",
    teal: "text-teal-400",
  };
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        {Icon && <Icon size={16} className="text-slate-600" />}
      </div>
      <div className={`text-2xl font-semibold ${toneMap[tone]}`}>{value}</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-950 border border-slate-800 rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2 text-slate-300">
            <FileText size={16} />
            <span className="text-sm font-medium">Heat risk report — Chattogram City</span>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
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
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 text-left border-b border-slate-800">
                <th className="py-1.5">Ward</th>
                <th className="py-1.5">Temp</th>
                <th className="py-1.5">Risk</th>
                <th className="py-1.5">NDVI</th>
              </tr>
            </thead>
            <tbody>
              {wards.map((w) => (
                <tr key={w.name} className="border-b border-slate-900">
                  <td className="py-1.5 text-slate-300">{w.name}</td>
                  <td className="py-1.5 text-slate-400">{w.temp.toFixed(1)}C</td>
                  <td className="py-1.5 text-slate-400">{w.risk}</td>
                  <td className="py-1.5 text-slate-400">{w.ndvi.toFixed(2)}</td>
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
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-900"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            className="px-3 py-1.5 text-sm rounded-lg bg-orange-600 text-white hover:bg-orange-500 flex items-center gap-1.5"
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

  const { wards, heatGrid, trend, loading, error } = useHeatData();

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
      <aside className="w-60 border-r border-slate-800 flex flex-col shrink-0">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-orange-400" />
            <span className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              PBK Environmental Console
            </span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Government dashboard - {role}</div>
        </div>

        <nav className="flex-1 py-3 px-3 space-y-1">
          <button
            onClick={() => setActiveModule("heat")}
            className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
              activeModule === "heat" ? "bg-orange-500/10 text-orange-400" : "text-slate-400 hover:bg-slate-900"
            }`}
          >
            <Thermometer size={16} />
            Heat monitoring
          </button>
          {OTHER_MODULES.map((m) => (
            <button
              key={m.key}
              onClick={() => setActiveModule(m.key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activeModule === m.key ? "bg-slate-800 text-slate-300" : "text-slate-500 hover:bg-slate-900"
              }`}
            >
              <m.icon size={16} />
              <span className="flex-1 text-left">{m.label}</span>
              <Lock size={12} className="text-slate-600" />
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-slate-800">
          <button
            onClick={onLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-900 hover:text-slate-300"
          >
            <LogOut size={15} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="border-b border-slate-800 px-6 py-3.5 flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by district, upazila or ward"
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-sm text-slate-300 placeholder:text-slate-500 focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div className="flex-1" />
          {loading && <span className="text-[11px] text-slate-500">Loading live data…</span>}
          {error && !loading && (
            <span className="text-[11px] text-amber-500" title={error}>
              Live data unavailable — showing demo values
            </span>
          )}
          <button className="relative text-slate-500 hover:text-slate-300">
            <Bell size={17} />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" />
          </button>
          <button
            onClick={() => setShowReport(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 text-white"
          >
            <FileText size={14} /> Generate report
          </button>
        </div>

        {activeModule !== "heat" ? (
          <div className="flex-1 flex items-center justify-center p-10">
            <div className="text-center max-w-sm">
              <Lock size={28} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-300 font-medium">Module in development</p>
              <p className="text-sm text-slate-500 mt-1.5">
                This demo prototype implements Heat Monitoring end-to-end. The
                {" "}{OTHER_MODULES.find((m) => m.key === activeModule)?.label.toLowerCase()}
                {" "}module follows the same architecture and is scoped for the next
                build phase.
              </p>
              <button
                onClick={() => setActiveModule("heat")}
                className="mt-4 text-sm text-orange-400 hover:text-orange-300 inline-flex items-center gap-1"
              >
                <ArrowLeft size={14} /> Back to heat monitoring
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* KPIs */}
            <div className="grid grid-cols-4 gap-4">
              <Kpi label="City avg. surface temp" value="35.4C" sub="+2.1C vs seasonal baseline" icon={Thermometer} tone="orange" />
              <Kpi label="Active hotspots" value="4" sub="Urban core cluster" icon={AlertTriangle} tone="red" />
              <Kpi label="Population in high+ risk" value="~135,000" sub="Across 4 wards" icon={Users} />
              <Kpi label="Heatwave alerts" value="1" sub="Panchlaish, issued today" icon={Bell} tone="red" />
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Heat map */}
              <div className="col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-medium text-slate-200">Surface temperature - Chattogram City</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Derived from Landsat LST composite, current cycle</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <span>29C</span>
                    <div className="w-16 h-2 rounded-full" style={{ background: "linear-gradient(to right, rgb(45,130,130), rgb(210,170,40), rgb(190,40,30))" }} />
                    <span>39C</span>
                  </div>
                </div>
                <div className="flex items-center justify-center py-4">
                  <HeatGrid grid={heatGrid} />
                </div>
                <p className="text-[11px] text-slate-600 text-center">Grid cells approximate 500m resolution over the urban core</p>
              </div>

              {/* Hotspot ranking */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-medium text-slate-200 mb-1">Heat mitigation priority</h3>
                <p className="text-xs text-slate-500 mb-4">Ranked by risk score</p>
                <div className="space-y-2">
                  {sortedByRisk.map((w, i) => {
                    const c = riskColor(w.risk);
                    return (
                      <button
                        key={w.name}
                        onClick={() => setSelectedWard(w)}
                        className={`w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-900 text-left ${
                          selectedWard?.name === w.name ? "ring-1 " + c.ring : ""
                        }`}
                      >
                        <span className="text-xs text-slate-600 w-4">{i + 1}</span>
                        <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                        <span className="flex-1 text-sm text-slate-300">{w.name}</span>
                        <span className="text-xs text-slate-500">{w.temp.toFixed(1)}C</span>
                        <ChevronRight size={13} className="text-slate-600" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {selectedWard && (
              <div className={`rounded-xl p-4 border ${riskColor(selectedWard.risk).bg} border-slate-800 flex items-center gap-4`}>
                <MapPin size={18} className={riskColor(selectedWard.risk).text} />
                <div className="flex-1">
                  <span className="text-sm text-slate-200 font-medium">{selectedWard.name}</span>
                  <span className="text-xs text-slate-500 ml-2">
                    {selectedWard.temp.toFixed(1)}C - {selectedWard.risk} risk - NDVI {selectedWard.ndvi.toFixed(2)} - population {selectedWard.pop.toLocaleString()}
                  </span>
                </div>
                <button onClick={() => setSelectedWard(null)} className="text-slate-500 hover:text-slate-300">
                  <X size={15} />
                </button>
              </div>
            )}

            <div className="grid grid-cols-3 gap-6">
              {/* Trend chart */}
              <div className="col-span-2 bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp size={14} className="text-slate-500" />
                  <h3 className="text-sm font-medium text-slate-200">12-month temperature trend</h3>
                </div>
                <p className="text-xs text-slate-500 mb-3">City average vs 10-year seasonal baseline</p>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={[22, 40]} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }} />
                      <Line type="monotone" dataKey="baseline" stroke="#475569" strokeWidth={1.5} dot={false} name="Baseline" />
                      <Line type="monotone" dataKey="temp" stroke="#fb923c" strokeWidth={2} dot={{ r: 2 }} name="Observed" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Recommendations */}
              <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
                <h3 className="text-sm font-medium text-slate-200 mb-3">Recommended interventions</h3>
                <div className="space-y-3">
                  {RECOMMENDATIONS.map((r) => (
                    <div key={r.title} className="flex gap-2.5">
                      <r.icon size={15} className="text-teal-400 mt-0.5 shrink-0" />
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
// Citizen dashboard
// ---------------------------------------------------------------------------

function CitizenDashboard({ onLogout }) {
  const { heatGrid } = useHeatData();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <div className="border-b border-slate-800 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sun size={17} className="text-orange-400" />
          <span className="text-sm font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Chattogram Heat Watch
          </span>
        </div>
        <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-300">Exit</button>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 space-y-4">
        <div className="bg-red-950/30 border border-red-900/40 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-300">Extreme heat alert - Panchlaish and Kotwali</p>
            <p className="text-xs text-red-400/80 mt-1">Surface temperatures above 38C expected through this afternoon. Avoid outdoor work between 12pm-4pm.</p>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-200">Heat map - your area</h3>
            <span className="text-[11px] text-slate-500">Panchlaish</span>
          </div>
          <div className="flex justify-center">
            <HeatGrid grid={heatGrid} compact />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <Thermometer size={16} className="text-orange-400 mb-2" />
            <div className="text-xl font-semibold text-slate-100">38.6C</div>
            <div className="text-[11px] text-slate-500">Current, your ward</div>
          </div>
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
            <Wind size={16} className="text-teal-400 mb-2" />
            <div className="text-xl font-semibold text-slate-100">Moderate</div>
            <div className="text-[11px] text-slate-500">Air quality today</div>
          </div>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-2">Health advisory</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Heat risk is extreme in your area today. Drink water regularly even without
            feeling thirsty, limit direct sun exposure between midday and late afternoon,
            and check on elderly neighbours and young children.
          </p>
        </div>

        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Nearby cooling centers</h3>
          <div className="space-y-2.5">
            {COOLING_CENTERS.map((c) => (
              <div key={c.name} className="flex items-center gap-3">
                <MapPin size={14} className="text-teal-400 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-slate-300">{c.name}</p>
                  <p className="text-[11px] text-slate-500">{c.distance} away - capacity {c.capacity}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-slate-600 text-center pt-1">
          Live where available; demo values used as fallback.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth / role select
// ---------------------------------------------------------------------------

function GovtLogin({ onBack, onLogin }) {
  const [officerId, setOfficerId] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
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
      onLogin(data.role || "Environmental Analyst");
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 mb-6">
          <ArrowLeft size={14} /> Back
        </button>
        <form onSubmit={handleSubmit} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
          <ShieldCheck size={22} className="text-orange-400 mb-3" />
          <h2 className="text-lg font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Government sign in
          </h2>
          <p className="text-xs text-slate-500 mt-1 mb-5">Role-based access to environmental monitoring and decision support</p>

          <label className="text-xs text-slate-400">Officer ID</label>
          <input
            value={officerId}
            onChange={(e) => setOfficerId(e.target.value)}
            placeholder="env_project"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 mt-1 mb-3 text-sm text-slate-300 focus:outline-none focus:border-orange-500/50"
          />

          <label className="text-xs text-slate-400">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 mt-1 mb-3 text-sm text-slate-300 focus:outline-none focus:border-orange-500/50"
          />

          {error && (
            <p className="text-xs text-red-400 mb-3">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-60 text-white text-sm font-medium py-2.5 rounded-lg"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
          <p className="text-[11px] text-slate-600 mt-3 text-center">Demo credentials: env_project / env_project_400</p>
        </form>
      </div>
    </div>
  );
}

function RoleSelect({ onSelect }) {
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-10">
          <p className="text-xs tracking-normal text-orange-400 mb-2">Environmental Risk Monitoring Platform</p>
          <h1 className="text-3xl font-semibold text-slate-100" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
            Chattogram Climate and Hazard Console
          </h1>
          <p className="text-sm text-slate-500 mt-3 max-w-md mx-auto">
            Satellite-derived heat, flood, air quality and deforestation monitoring
            for government planning and public awareness.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-5">
          <button
            onClick={() => onSelect("govt")}
            className="text-left bg-slate-900/60 border border-slate-800 hover:border-orange-500/40 rounded-2xl p-6 transition-colors group"
          >
            <ShieldCheck size={24} className="text-orange-400 mb-4" />
            <p className="text-slate-100 font-medium">Government dashboard</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Full access to risk analysis, AI predictions, resource planning and report generation.
            </p>
            <span className="text-xs text-orange-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              Continue <ChevronRight size={13} />
            </span>
          </button>
          <button
            onClick={() => onSelect("citizen")}
            className="text-left bg-slate-900/60 border border-slate-800 hover:border-teal-500/40 rounded-2xl p-6 transition-colors group"
          >
            <Users size={24} className="text-teal-400 mb-4" />
            <p className="text-slate-100 font-medium">Citizen dashboard</p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Heat and flood alerts, air quality, health advisories and nearby shelters.
            </p>
            <span className="text-xs text-teal-400 mt-4 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
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
