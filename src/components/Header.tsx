import React, { useState } from 'react';
import { AlertTriangle, BarChart3, Bell, ClipboardCheck, Cpu, History, Layers, Map as MapIcon, Menu, RefreshCw, ScanLine, Search, Sparkles, Wrench, X } from 'lucide-react';
import { Asset, AnomalyAlert } from '../types';

export type Tab = 'map' | 'fleetmap' | 'analytics' | 'checkinout' | 'ai-forecasting' | 'inspection' | 'anomalies' | 'history' | 'optimization' | 'copilot';
interface HeaderProps { activeTab: Tab; setActiveTab: (tab: Tab) => void; assets: Asset[]; alerts: AnomalyAlert[]; onOpenCheckInOut: (type: 'checkout' | 'checkin') => void; onOpenInspection: () => void; onRefresh: () => void; }
const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'map', label: 'Executive Dashboard', icon: Layers },
  { id: 'fleetmap', label: 'Fleet Map', icon: MapIcon },
  { id: 'checkinout', label: 'Equipment / Fleet', icon: ScanLine },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'optimization', label: 'AI Action Center', icon: Sparkles },
  { id: 'copilot', label: 'SmartRent Copilot', icon: Sparkles },
  { id: 'ai-forecasting', label: 'Demand Forecast', icon: Cpu },
  { id: 'inspection', label: 'Maintenance', icon: Wrench },
  { id: 'anomalies', label: 'Alerts', icon: AlertTriangle },
  { id: 'history', label: 'Audit History', icon: History },
];

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, assets, alerts, onOpenCheckInOut, onOpenInspection, onRefresh }) => {
  const [isOpen, setIsOpen] = useState(false);
  const unresolvedAlerts = alerts.filter((a) => !a.resolved).length;
  const navigate = (tab: Tab) => { setActiveTab(tab); setIsOpen(false); };
  return <>
    <aside className={`smartrent-rail ${isOpen ? 'is-open' : ''}`} aria-label="Primary navigation">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-6"><div className="smartrent-mark">S</div><div><div className="font-bold tracking-tight text-white">SMARTRENT</div><div className="text-[9px] font-mono tracking-[0.18em] text-cyan-300">AI OPERATIONS</div></div><button className="ml-auto text-slate-400 sm:hidden" onClick={() => setIsOpen(false)} aria-label="Close navigation"><X className="h-5 w-5" /></button></div>
      <nav className="space-y-1 p-3"><p className="px-3 pb-2 pt-3 text-[10px] font-bold tracking-[0.12rem] text-slate-500">COMMAND CENTER</p>{NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} className={`smartrent-nav ${activeTab === id ? 'is-active' : ''}`}><Icon className="h-4 w-4" /><span>{label}</span>{id === 'anomalies' && unresolvedAlerts > 0 && <span className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">{unresolvedAlerts}</span>}</button>)}</nav>
      <div className="absolute inset-x-0 bottom-0 p-4"><div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400"><span className="mr-2 text-emerald-400">●</span>{assets.filter((a) => a.status === 'Active').length} units reporting</div></div>
    </aside>
    {isOpen && <button className="fixed inset-0 z-30 bg-slate-950/55 sm:hidden" onClick={() => setIsOpen(false)} aria-label="Close navigation overlay" />}
    <header className="smartrent-topbar"><div className="flex items-center gap-3"><button className="rounded-md p-2 hover:bg-slate-200 sm:hidden" onClick={() => setIsOpen(true)} aria-label="Open navigation"><Menu className="h-5 w-5" /></button><div className="smartrent-search"><Search className="h-4 w-4 text-slate-500" /><input placeholder="Search assets, rentals, sites…" aria-label="Search assets" /></div></div><div className="flex items-center gap-2"><button onClick={onRefresh} className="rounded-md p-2 hover:bg-slate-200" title="Refresh fleet data"><RefreshCw className="h-4 w-4" /></button><button onClick={() => navigate('anomalies')} className="relative rounded-md p-2 hover:bg-slate-200" aria-label="Open alerts"><Bell className="h-5 w-5" />{unresolvedAlerts > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" />}</button><button onClick={onOpenInspection} className="hidden rounded-md p-2 hover:bg-slate-200 lg:block" title="Start inspection"><ClipboardCheck className="h-4 w-4" /></button><button onClick={() => onOpenCheckInOut('checkout')} className="smartrent-primary"><ScanLine className="h-4 w-4" />New Rental</button></div></header>
  </>;
};
