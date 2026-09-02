import React from 'react';
import {
  Layers,
  BarChart3,
  ScanLine,
  Cpu,
  ClipboardCheck,
  AlertTriangle,
  RefreshCw,
  History
} from 'lucide-react';
import { Asset, AnomalyAlert } from '../types';

type Tab = 'map' | 'analytics' | 'checkinout' | 'ai-forecasting' | 'inspection' | 'anomalies' | 'history';

interface HeaderProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  assets: Asset[];
  alerts: AnomalyAlert[];
  onOpenCheckInOut: (type: 'checkout' | 'checkin') => void;
  onOpenInspection: () => void;
  onRefresh: () => void;
}

const NAV_ITEMS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'map', label: 'Fleet Map', icon: Layers },
  { id: 'analytics', label: 'Telematics', icon: BarChart3 },
  { id: 'checkinout', label: 'Check-In / Out', icon: ScanLine },
  { id: 'ai-forecasting', label: 'AI Forecast', icon: Cpu },
  { id: 'inspection', label: 'Inspection', icon: ClipboardCheck },
  { id: 'anomalies', label: 'Alerts', icon: AlertTriangle },
  { id: 'history', label: 'History', icon: History },
];

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  assets,
  alerts,
  onOpenCheckInOut,
  onOpenInspection,
  onRefresh,
}) => {
  const activeCount = assets.filter((a) => a.status === 'Active').length;
  const idleCount = assets.filter((a) => a.status === 'Idle').length;
  const maintCount = assets.filter((a) => a.status === 'Under Maintenance' || a.status === 'Alert').length;
  const unresolvedAlerts = alerts.filter((a) => !a.resolved).length;

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-neutral-900/[0.06]">
      {/* Top row: brand, live stats, primary actions */}
      <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between gap-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-neutral-900 text-[#FFCD00] shrink-0">
            <span className="font-extrabold text-[13px] tracking-tighter">CAT</span>
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-semibold tracking-tight text-neutral-900 leading-tight truncate">
              Fleet Rental Tracker
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 leading-tight">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Live telemetry</span>
            </div>
          </div>
        </div>

        {/* Fleet snapshot — quiet, numeric, no boxes-in-boxes */}
        <div className="hidden lg:flex items-center gap-5 text-[13px] shrink-0">
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-neutral-900">{assets.length}</span>
            <span className="text-neutral-400">units</span>
          </div>
          <span className="w-px h-3.5 bg-neutral-200" />
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-emerald-600">{activeCount}</span>
            <span className="text-neutral-400">active</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="font-semibold text-amber-600">{idleCount}</span>
            <span className="text-neutral-400">idle</span>
          </div>
          {maintCount > 0 && (
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-rose-600">{maintCount}</span>
              <span className="text-neutral-400">flagged</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            id="quick-rfid-scan-btn"
            onClick={() => onOpenCheckInOut('checkout')}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold bg-[#FFCD00] text-neutral-950 hover:bg-[#F0C300] active:scale-[0.98] transition-all cursor-pointer"
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Check-In / Out</span>
          </button>

          <button
            id="quick-inspection-btn"
            onClick={onOpenInspection}
            className="hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-semibold text-neutral-700 border border-neutral-200 hover:bg-neutral-50 active:scale-[0.98] transition-all cursor-pointer"
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            <span>Inspect</span>
          </button>

          <button
            id="refresh-fleet-data-btn"
            onClick={onRefresh}
            title="Refresh telemetry"
            className="p-2 rounded-lg text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Nav row: minimal underline tabs, no pill chrome */}
      <nav className="max-w-7xl mx-auto px-4 lg:px-8 flex items-center gap-1 overflow-x-auto scrollbar-none">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          const showAlertBadge = id === 'anomalies' && unresolvedAlerts > 0;
          return (
            <button
              key={id}
              id={`tab-${id === 'ai-forecasting' ? 'ai-forecast' : id}`}
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors cursor-pointer ${
                isActive
                  ? 'border-neutral-900 text-neutral-900'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-neutral-900' : 'text-neutral-400'}`} />
              <span>{label}</span>
              {showAlertBadge && (
                <span className="ml-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {unresolvedAlerts}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </header>
  );
};
