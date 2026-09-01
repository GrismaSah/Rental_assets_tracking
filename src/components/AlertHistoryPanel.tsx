import React, { useState } from 'react';
import { History, Clock, CheckCircle2, Mail, MessageSquare, MonitorSmartphone } from 'lucide-react';
import { AlertHistoryEntry, NotificationChannel } from '../types';

interface AlertHistoryPanelProps {
  history: AlertHistoryEntry[];
}

const channelIcon = (channel: NotificationChannel) => {
  if (channel === 'Email') return Mail;
  if (channel === 'SMS') return MessageSquare;
  return MonitorSmartphone;
};

export const AlertHistoryPanel: React.FC<AlertHistoryPanelProps> = ({ history }) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'cleared'>('all');

  const sorted = [...history].sort(
    (a, b) => new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime()
  );

  const filtered = sorted.filter((h) => {
    if (statusFilter === 'active') return !h.cleared_at;
    if (statusFilter === 'cleared') return !!h.cleared_at;
    return true;
  });

  const activeCount = history.filter((h) => !h.cleared_at).length;
  const clearedCount = history.filter((h) => !!h.cleared_at).length;

  return (
    <div className="space-y-5">
      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold shadow-xs">
            <History className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-neutral-900">
              Alert & Notification Audit Trail
            </h2>
            <p className="text-xs text-neutral-500">
              Permanent record of every anomaly ever raised, when it was first detected, how it was notified, and when it cleared
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === 'all' ? 'bg-white text-neutral-900 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            All ({history.length})
          </button>
          <button
            onClick={() => setStatusFilter('active')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === 'active' ? 'bg-white text-rose-700 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            Still Active ({activeCount})
          </button>
          <button
            onClick={() => setStatusFilter('cleared')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              statusFilter === 'cleared' ? 'bg-white text-emerald-700 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            Cleared ({clearedCount})
          </button>
        </div>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs">
        {filtered.length === 0 ? (
          <p className="text-xs text-neutral-400 text-center py-8">No alert history matches this filter yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-400 font-medium">
                  <th className="pb-2 pl-1">Asset</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">First Detected</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Notified Via</th>
                  <th className="pb-2 pr-1">Cleared</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {filtered.map((h) => (
                  <tr key={h.id} className="hover:bg-neutral-50/80 transition-colors align-top">
                    <td className="py-2.5 pl-1">
                      <div className="font-mono font-bold text-neutral-900">{h.asset_id}</div>
                      <span
                        className={`inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                          h.severity === 'Critical'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {h.severity}
                      </span>
                    </td>
                    <td className="py-2.5 text-neutral-700 max-w-[160px]">{h.type}</td>
                    <td className="py-2.5 text-neutral-600 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 text-neutral-400" />
                        {new Date(h.first_seen_at).toLocaleString()}
                      </div>
                    </td>
                    <td className="py-2.5">
                      {h.cleared_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Cleared
                        </span>
                      ) : h.resolved ? (
                        <span className="text-neutral-600 font-semibold">Acknowledged</span>
                      ) : (
                        <span className="text-rose-600 font-semibold">Active</span>
                      )}
                    </td>
                    <td className="py-2.5">
                      {h.notifications && h.notifications.length > 0 ? (
                        <div className="flex items-center gap-1.5">
                          {h.notifications.map((n, idx) => {
                            const Icon = channelIcon(n.channel);
                            return <Icon key={idx} className="w-3.5 h-3.5 text-blue-600" title={`${n.channel} → ${n.recipient}`} />;
                          })}
                        </div>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-1 text-neutral-500 whitespace-nowrap">
                      {h.cleared_at ? new Date(h.cleared_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
