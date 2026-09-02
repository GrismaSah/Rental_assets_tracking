import React, { useState } from 'react';
import { ArrowRight, Sparkles, TrendingUp, Fuel, Gauge, DollarSign, CheckCircle2, X, Truck, UserPlus, RotateCcw } from 'lucide-react';
import { OptimizationRecommendation } from '../types';

interface OptimizationPanelProps {
  recommendations: OptimizationRecommendation[];
  onAccept: (id: string) => Promise<void> | void;
  onDismiss: (id: string) => Promise<void> | void;
  onViewAsset: (assetId: string) => void;
}

const typeMeta: Record<string, { label: string; icon: React.ElementType; tone: string }> = {
  RELOCATE_ASSET: { label: 'Relocate Asset', icon: Truck, tone: 'text-cyan-700 bg-cyan-50 border-cyan-200' },
  RETURN_EARLY: { label: 'Return Early', icon: RotateCcw, tone: 'text-amber-700 bg-amber-50 border-amber-200' },
  ASSIGN_OPERATOR: { label: 'Assign Operator', icon: UserPlus, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};

export const OptimizationPanel: React.FC<OptimizationPanelProps> = ({ recommendations, onAccept, onDismiss, onViewAsset }) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const pending = recommendations.filter((r) => r.decision === 'PENDING');
  const decided = recommendations.filter((r) => r.decision !== 'PENDING').slice(0, 6);

  const totalSavings = pending.reduce((sum, r) => sum + r.estimated_savings, 0);

  const act = async (fn: (id: string) => Promise<void> | void, id: string) => {
    setBusyId(id);
    try {
      await fn(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-neutral-200/70 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-cyan-50 text-cyan-700 flex items-center justify-center border border-cyan-100 shadow-xs">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-neutral-900">Smart Fleet Optimization &amp; Dispatch Engine</h2>
            <p className="text-xs text-neutral-500">
              Rules-based recommendations computed live from utilization, idle cost, geofence, and certification data — every number is real, no guesses.
            </p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] uppercase font-bold text-neutral-400">Potential Weekly Savings</div>
          <div className="text-xl font-black text-emerald-700">${totalSavings.toLocaleString()}</div>
        </div>
      </div>

      <div className="space-y-3">
        {pending.length === 0 && (
          <div className="bg-white p-8 rounded-2xl border border-neutral-200/70 text-center text-sm text-neutral-400">
            No optimization opportunities detected right now — fleet allocation looks efficient.
          </div>
        )}
        {pending.map((rec) => {
          const meta = typeMeta[rec.type];
          const Icon = meta.icon;
          const isBusy = busyId === rec.id;
          return (
            <div key={rec.id} className="bg-white p-5 rounded-2xl border border-neutral-200/70 shadow-xs space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${meta.tone}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${meta.tone}`}>{meta.label}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rec.priority === 'HIGH' ? 'bg-rose-50 text-rose-700 border border-rose-200' : rec.priority === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-neutral-100 text-neutral-600 border border-neutral-200'
                        }`}
                      >
                        {rec.priority}
                      </span>
                      <button onClick={() => onViewAsset(rec.asset_id)} className="font-mono text-xs font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded hover:bg-neutral-200 cursor-pointer">
                        {rec.asset_id}
                      </button>
                      {rec.from_site && rec.to_site && rec.from_site !== rec.to_site && (
                        <span className="text-[11px] text-neutral-500 flex items-center gap-1">
                          {rec.from_site} <ArrowRight className="w-3 h-3" /> {rec.to_site}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-700 leading-relaxed mt-1.5 max-w-2xl">{rec.reason}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase font-bold text-neutral-400">Confidence</div>
                  <div className="text-sm font-black text-neutral-900">{rec.confidence}%</div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-100 text-center">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-600 mx-auto" />
                  <div className="text-xs font-bold text-neutral-900 mt-0.5">${rec.estimated_savings.toLocaleString()}</div>
                  <div className="text-[9px] text-neutral-500">Est. savings</div>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-100 text-center">
                  <Gauge className="w-3.5 h-3.5 text-cyan-600 mx-auto" />
                  <div className="text-xs font-bold text-neutral-900 mt-0.5">-{rec.idle_reduction_percent}%</div>
                  <div className="text-[9px] text-neutral-500">Idle reduction</div>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-100 text-center">
                  <TrendingUp className="w-3.5 h-3.5 text-violet-600 mx-auto" />
                  <div className="text-xs font-bold text-neutral-900 mt-0.5">+{rec.utilization_gain_percent}%</div>
                  <div className="text-[9px] text-neutral-500">Utilization</div>
                </div>
                <div className="p-2.5 bg-neutral-50 rounded-xl border border-neutral-100 text-center">
                  <Fuel className="w-3.5 h-3.5 text-amber-600 mx-auto" />
                  <div className="text-xs font-bold text-neutral-900 mt-0.5">-{rec.fuel_impact_percent}%</div>
                  <div className="text-[9px] text-neutral-500">Fuel impact</div>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  disabled={isBusy}
                  onClick={() => act(onAccept, rec.id)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {isBusy ? 'Applying…' : 'Accept Recommendation'}
                </button>
                <button
                  disabled={isBusy}
                  onClick={() => act(onDismiss, rec.id)}
                  className="px-3.5 py-2 rounded-xl text-xs font-bold bg-white text-neutral-700 border border-neutral-200 hover:bg-neutral-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  Dismiss
                </button>
                <span className="text-[10px] text-neutral-400 ml-1">{rec.actions.join(' · ')}</span>
              </div>
            </div>
          );
        })}
      </div>

      {decided.length > 0 && (
        <div className="bg-white p-5 rounded-2xl border border-neutral-200/70">
          <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Recent Decisions</h3>
          <div className="space-y-2">
            {decided.map((rec) => (
              <div key={rec.id} className="flex items-center justify-between text-xs py-1.5 border-b border-neutral-100 last:border-0">
                <span className="font-mono font-semibold text-neutral-700">{rec.asset_id}</span>
                <span className="text-neutral-500">{typeMeta[rec.type].label}</span>
                <span className={`font-bold ${rec.decision === 'ACCEPTED' ? 'text-emerald-600' : 'text-neutral-400'}`}>{rec.decision}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
