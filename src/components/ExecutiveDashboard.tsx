import React from 'react';
import { AlertTriangle, ArrowUpRight, Fuel, Gauge, MapPin, Wrench } from 'lucide-react';
import { Asset, AnomalyAlert, Site, GeofenceEvent, OptimizationRecommendation } from '../types';

interface Props {
  assets: Asset[];
  sites: Site[];
  alerts: AnomalyAlert[];
  geofenceEvents?: GeofenceEvent[];
  recommendations?: OptimizationRecommendation[];
  onSelectAsset: (asset: Asset) => void;
  onOpenAlerts: () => void;
}
const statusTone = (asset: Asset) => asset.status === 'Under Maintenance' ? 'maintenance' : asset.status === 'Idle' ? 'idle' : 'inuse';

export function ExecutiveDashboard({ assets, sites, alerts, geofenceEvents = [], recommendations = [], onSelectAsset, onOpenAlerts }: Props) {
  const active = assets.filter((a) => a.status === 'Active').length;
  const idle = assets.filter((a) => a.status === 'Idle').length;
  const maintenance = assets.filter((a) => a.status === 'Under Maintenance').length;
  const overdue = alerts.filter((a) => a.type === 'Overdue Rental' && !a.resolved).length;
  const totalEngine = assets.reduce((sum, a) => sum + a.engine_hours_day * a.operating_days, 0);
  const totalIdle = assets.reduce((sum, a) => sum + a.idle_hours_day * a.operating_days, 0);
  const fuel = Math.round(assets.reduce((sum, a) => sum + (a.engine_hours_day + a.idle_hours_day) * a.operating_days * a.fuel_burn_rate_lph, 0));
  const utilization = Math.round((totalEngine / Math.max(totalEngine + totalIdle, 1)) * 100);
  // Day-by-day utilization across each unit's own rental window (Day 1 -> its
  // operating_days), same technique as the Telemetry tab's trend chart --
  // derived from real per-asset fields, not fabricated numbers.
  const maxOperatingDays = Math.max(...assets.map((a) => a.operating_days), 1);
  const utilizationTrend = Array.from({ length: Math.min(7, maxOperatingDays) }, (_, i) => {
    const day = i + 1;
    const onRent = assets.filter((a) => a.operating_days >= day);
    const engine = onRent.reduce((acc, a) => acc + a.engine_hours_day, 0);
    const idleH = onRent.reduce((acc, a) => acc + a.idle_hours_day, 0);
    return Math.round((engine / Math.max(engine + idleH, 1)) * 100);
  });
  const openViolations = geofenceEvents.filter((e) => !e.resolved_at);
  const violatedSites = new Set(openViolations.map((e) => e.site_id));
  const geofenceCompliance = Math.round(((sites.length - Math.min(violatedSites.size, sites.length)) / Math.max(sites.length, 1)) * 100);
  const potentialSavings = recommendations.filter((r) => r.decision === 'PENDING').reduce((sum, r) => sum + r.estimated_savings, 0);
  const kpis = [ ['Total equipment', assets.length, 'Connected units'], ['Currently rented', active, `${Math.round(active / Math.max(assets.length, 1) * 100)}% of fleet`], ['Idle', idle, 'Needs allocation'], ['Overdue', overdue, overdue ? 'Needs attention' : 'On schedule'], ['Under maintenance', maintenance, 'Service queue'], ['Geofence compliance', `${geofenceCompliance}%`, openViolations.length ? `${openViolations.length} active violation(s)` : 'All sites compliant'], ['Potential savings', `$${potentialSavings.toLocaleString()}`, 'From pending AI recommendations'], ['Fuel consumed', `${fuel.toLocaleString()} L`, 'Estimated from usage'] ];
  return <div className="space-y-6">
    <section className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end"><div><p className="smartrent-eyebrow">Executive asset dashboard</p><h1 className="smartrent-title">Fleet command center</h1><p className="mt-1 text-sm text-slate-500">Live rental, utilization and condition signals across your connected equipment.</p></div><button onClick={onOpenAlerts} className="smartrent-outline"><AlertTriangle className="h-4 w-4" /> {alerts.filter((a) => !a.resolved).length} active signals</button></section>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{kpis.map(([label, value, note]) => <article key={label} className="smartrent-metric"><p className="smartrent-eyebrow">{label}</p><p className="mt-2 font-mono text-2xl font-bold tracking-tight text-slate-800">{value}</p><p className={`mt-2 text-xs ${label === 'Overdue' && overdue ? 'text-red-600' : 'text-emerald-700'}`}>{note}</p></article>)}</section>
    <section className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]"><article className="smartrent-panel p-5"><div className="flex items-start justify-between"><div><p className="smartrent-eyebrow">Fleet allocation</p><h2 className="text-xl font-bold">Fleet utilization</h2></div><Gauge className="h-5 w-5 text-cyan-600" /></div><div className="mt-6 flex items-center gap-6"><div className="smartrent-donut" style={{ '--pct': `${utilization * 3.6}deg` } as React.CSSProperties}><div><strong>{utilization}%</strong><small>UTILIZED</small></div></div><div className="space-y-3 text-sm"><p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-cyan-400" />Active <b className="float-right ml-7">{active}</b></p><p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-amber-400" />Idle <b className="float-right ml-7">{idle}</b></p><p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-violet-400" />Maintenance <b className="float-right ml-7">{maintenance}</b></p><p><span className="mr-2 inline-block h-2 w-2 rounded-full bg-red-400" />Overdue <b className="float-right ml-7">{overdue}</b></p></div></div></article><article className="smartrent-panel p-5"><div className="flex items-start justify-between"><div><p className="smartrent-eyebrow">Usage intelligence</p><h2 className="text-xl font-bold">Fleet utilization trend</h2></div><span className="rounded-full bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700">● Live</span></div><div className="mt-6 flex h-32 items-end gap-2 border-b border-slate-200 pb-2">{utilizationTrend.map((v,i) => <div key={i} className="flex-1 rounded-t bg-cyan-400/80" style={{height:`${v}%`}} title={`Day ${i + 1}: ${v}% utilized`} />)}</div><div className="mt-2 flex justify-between text-[10px] font-mono text-slate-400">{utilizationTrend.map((_, i) => <span key={i}>DAY {i + 1}</span>)}</div></article></section>
    <section className="grid gap-5 xl:grid-cols-[1.65fr_.75fr]"><article className="smartrent-panel overflow-hidden"><div className="flex items-center justify-between p-5 pb-3"><div><p className="smartrent-eyebrow">Live operations</p><h2 className="text-xl font-bold">Equipment operations</h2></div><button className="text-sm font-semibold text-cyan-700">View fleet <ArrowUpRight className="inline h-4 w-4" /></button></div><div className="overflow-x-auto"><table className="smartrent-table"><thead><tr><th>Asset</th><th>Site</th><th>Status</th><th>Fuel</th><th>Operator</th></tr></thead><tbody>{assets.map((asset) => <tr key={asset.id} onClick={() => onSelectAsset(asset)}><td><b>{asset.model}</b><small>{asset.id} · {asset.type}</small></td><td><span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{asset.site_name}</span></td><td><span className={`smartrent-status ${statusTone(asset)}`}>{asset.status}</span></td><td><span className="inline-flex items-center gap-1"><Fuel className="h-3 w-3 text-amber-500" />{asset.fuel_level_pct}%</span></td><td>{asset.operator_name || 'Unassigned'}</td></tr>)}</tbody></table></div></article><article className="smartrent-panel p-5"><p className="smartrent-eyebrow">Priority signals</p><h2 className="text-xl font-bold">Attention required</h2><div className="mt-4 space-y-3">{alerts.filter((a) => !a.resolved).slice(0,4).map((a) => <div key={a.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between"><b className="text-sm">{a.asset_id}</b><span className={a.severity === 'Critical' ? 'text-xs font-bold text-red-600' : 'text-xs font-bold text-amber-600'}>{a.severity}</span></div><p className="mt-1 text-xs text-slate-500">{a.type}</p></div>)}{alerts.length === 0 && <p className="py-6 text-sm text-slate-500">No active fleet signals.</p>}</div></article></section>
  </div>;
}
