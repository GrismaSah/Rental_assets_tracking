import React from 'react';
import {
  Radio,
  Layers,
  BarChart3,
  ScanLine,
  Cpu,
  ClipboardCheck,
  AlertTriangle,
  RefreshCw,
  Clock,
  ShieldCheck,
  History
} from 'lucide-react';
import { Asset, AnomalyAlert } from '../types';

interface HeaderProps {
  activeTab: 'map' | 'analytics' | 'checkinout' | 'ai-forecasting' | 'inspection' | 'anomalies' | 'history';
  setActiveTab: (tab: 'map' | 'analytics' | 'checkinout' | 'ai-forecasting' | 'inspection' | 'anomalies' | 'history') => void;
  assets: Asset[];
  alerts: AnomalyAlert[];
  onOpenCheckInOut: (type: 'checkout' | 'checkin') => void;
  onOpenInspection: () => void;
  onRefresh: () => void;
}

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
    <header className="sticky top-0 z-40 bg-white/85 backdrop-blur-md border-b border-black/5 px-4 lg:px-8 py-3.5 transition-all">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
        
        {/* Brand & Live Pulse */}
        <div className="flex items-center gap-3.5">
          {/* Caterpillar Brand Badge */}
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-neutral-900 shadow-sm border border-neutral-800 text-[#FFCD00] relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-br from-[#FFCD00]/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="font-extrabold text-sm tracking-tighter flex items-center gap-0.5">
              <span>CAT</span>
              <div className="w-1.5 h-1.5 bg-[#FFCD00] rotate-45" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-neutral-900">
                Smart Asset Rental Tracking
              </h1>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#FFCD00]/15 text-neutral-900 border border-[#FFCD00]/30">
                <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
                Product Link™ Live
              </span>
            </div>
            <p className="text-xs text-neutral-500 font-medium">
              Caterpillar Heavy Fleet Telematics & AI Logistics
            </p>
          </div>
        </div>

        {/* Fleet Stat Pills */}
        <div className="hidden lg:flex items-center gap-2 bg-neutral-100/80 p-1 rounded-xl border border-neutral-200/60 text-xs">
          <div className="px-3 py-1 bg-white rounded-lg shadow-2xs font-medium text-neutral-800 flex items-center gap-1.5">
            <span className="text-neutral-500 font-normal">Fleet:</span>
            <span className="font-bold">{assets.length} Units</span>
          </div>
          <div className="px-2.5 py-1 text-emerald-700 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>{activeCount} Active</span>
          </div>
          <div className="px-2.5 py-1 text-amber-700 font-medium flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>{idleCount} Idle</span>
          </div>
          {maintCount > 0 && (
            <div className="px-2.5 py-1 text-rose-700 font-medium flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>{maintCount} Maintenance</span>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            id="quick-rfid-scan-btn"
            onClick={() => onOpenCheckInOut('checkout')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors shadow-2xs cursor-pointer active:scale-98"
          >
            <ScanLine className="w-4 h-4" />
            <span>RFID / QR Scan</span>
          </button>

          <button
            id="quick-inspection-btn"
            onClick={onOpenInspection}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 transition-colors shadow-2xs cursor-pointer active:scale-98"
          >
            <ClipboardCheck className="w-4 h-4 text-neutral-600" />
            <span>Inspect Asset</span>
          </button>

          <button
            id="refresh-fleet-data-btn"
            onClick={onRefresh}
            title="Refresh Telemetry"
            className="p-2 rounded-xl text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 border border-neutral-200/60 transition-colors cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Modern Apple-like Navigation Tabs */}
      <div className="max-w-7xl mx-auto mt-3 flex items-center justify-between overflow-x-auto pb-1 scrollbar-none gap-2">
        <div className="flex items-center gap-1.5 bg-neutral-100/90 p-1 rounded-xl border border-neutral-200/70">
          <button
            id="tab-map"
            onClick={() => setActiveTab('map')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'map'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Executive Fleet Map</span>
          </button>

          <button
            id="tab-analytics"
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Usage & Fuel Telematics</span>
          </button>

          <button
            id="tab-checkinout"
            onClick={() => setActiveTab('checkinout')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'checkinout'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <ScanLine className="w-3.5 h-3.5" />
            <span>Check-In / Out Hub</span>
          </button>

          <button
            id="tab-ai-forecast"
            onClick={() => setActiveTab('ai-forecasting')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'ai-forecasting'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-amber-600" />
            <span>AI Demand Forecast</span>
          </button>

          <button
            id="tab-inspection"
            onClick={() => setActiveTab('inspection')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'inspection'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Safety Inspection</span>
          </button>

          <button
            id="tab-anomalies"
            onClick={() => setActiveTab('anomalies')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer relative ${
              activeTab === 'anomalies'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <AlertTriangle className={`w-3.5 h-3.5 ${unresolvedAlerts > 0 ? 'text-rose-500' : ''}`} />
            <span>Rules & Anomalies</span>
            {unresolvedAlerts > 0 && (
              <span className="w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unresolvedAlerts}
              </span>
            )}
          </button>

          <button
            id="tab-history"
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'history'
                ? 'bg-white text-neutral-900 shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Audit Trail</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-2 text-[11px] text-neutral-500 font-mono">
          <Clock className="w-3.5 h-3.5" />
          <span>Real-time GPS Sync: Active</span>
        </div>
      </div>
    </header>
  );
};
