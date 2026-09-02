import React, { useState } from 'react';
import { FlaskConical, MapPinOff, Clock, Wrench, CalendarClock } from 'lucide-react';
import { Asset } from '../types';

interface DemoControlsProps {
  assets: Asset[];
  onTriggered: (message: string) => void;
}

const SCENARIOS: { key: string; label: string; icon: React.ElementType; endpoint: (id: string) => string; requiresSite?: boolean }[] = [
  { key: 'geofence', label: 'Simulate Geofence Violation', icon: MapPinOff, endpoint: (id) => `/api/demo/simulate-geofence-violation/${id}`, requiresSite: true },
  { key: 'idle', label: 'Simulate High Idle', icon: Clock, endpoint: (id) => `/api/demo/simulate-high-idle/${id}` },
  { key: 'maintenance', label: 'Simulate Maintenance Alert', icon: Wrench, endpoint: (id) => `/api/demo/simulate-maintenance-alert/${id}` },
  { key: 'overdue', label: 'Simulate Overdue Rental', icon: CalendarClock, endpoint: (id) => `/api/demo/simulate-overdue-rental/${id}` },
];

export const DemoControls: React.FC<DemoControlsProps> = ({ assets, onTriggered }) => {
  const [assetId, setAssetId] = useState(assets[0]?.id || '');
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (scenario: (typeof SCENARIOS)[number]) => {
    if (!assetId) return;
    setBusy(scenario.key);
    try {
      const response = await fetch(scenario.endpoint(assetId), { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Simulation failed');
      onTriggered(`${scenario.label} applied to ${assetId} — this hit the real backend rule engine, not a UI mock.`);
    } catch (error: any) {
      onTriggered(`Simulation failed: ${error.message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-neutral-50 border border-neutral-200/70 rounded-2xl p-4 flex flex-col md:flex-row md:items-center gap-3">
      <div className="flex items-center gap-2 text-xs font-bold text-neutral-600 shrink-0">
        <FlaskConical className="w-4 h-4 text-neutral-500" />
        Demo Scenarios
      </div>
      <select
        value={assetId}
        onChange={(e) => setAssetId(e.target.value)}
        className="px-3 py-1.5 rounded-lg text-xs bg-white border border-neutral-200 font-mono"
      >
        {assets.map((a) => (
          <option key={a.id} value={a.id}>{a.id} — {a.model}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <button
            key={s.key}
            disabled={busy !== null}
            onClick={() => run(s)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 flex items-center gap-1.5"
          >
            <s.icon className="w-3.5 h-3.5" />
            {busy === s.key ? 'Running…' : s.label}
          </button>
        ))}
      </div>
    </div>
  );
};
