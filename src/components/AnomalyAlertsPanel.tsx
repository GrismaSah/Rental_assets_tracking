import React, { useState } from 'react';
import {
  AlertTriangle,
  Clock,
  UserX,
  MapPinOff,
  CalendarX,
  Wrench,
  CheckCircle2,
  Fuel,
  ArrowRight,
  Filter,
  ShieldAlert,
  Zap,
  BellRing,
  Mail,
  MessageSquare,
  MonitorSmartphone
} from 'lucide-react';
import { Asset, AnomalyAlert, NotificationChannel } from '../types';

interface AnomalyAlertsPanelProps {
  alerts: AnomalyAlert[];
  assets: Asset[];
  onResolveAlert: (alertId: string) => void;
  onTakeAction: (asset: Asset, actionType: 'checkout' | 'checkin' | 'inspect') => void;
  onNotify: (alert: AnomalyAlert) => void;
}

const channelIcon = (channel: NotificationChannel) => {
  if (channel === 'Email') return Mail;
  if (channel === 'SMS') return MessageSquare;
  return MonitorSmartphone;
};

export const AnomalyAlertsPanel: React.FC<AnomalyAlertsPanelProps> = ({
  alerts,
  assets,
  onResolveAlert,
  onTakeAction,
  onNotify,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'all' | 'Critical' | 'Warning'>('all');

  const filteredAlerts = alerts.filter((a) => {
    if (severityFilter === 'all') return true;
    return a.severity === severityFilter;
  });

  const criticalCount = alerts.filter((a) => a.severity === 'Critical' && !a.resolved).length;
  const warningCount = alerts.filter((a) => a.severity === 'Warning' && !a.resolved).length;

  return (
    <div className="space-y-5">
      {/* Header Stat Row */}
      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center font-bold border border-rose-100 shadow-xs">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-neutral-900">
                Fleet Anomaly & Maintenance Rules Engine
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                {criticalCount} Critical Flags Active
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Automated anomaly detection: excessive idle standby (&gt;8 hrs), unassigned operators, expiring rentals, and Cat telemetry faults
            </p>
          </div>
        </div>

        {/* Severity Filter Pills */}
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setSeverityFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-all ${
              severityFilter === 'all' ? 'bg-white text-neutral-900 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            All Alerts ({alerts.length})
          </button>
          <button
            onClick={() => setSeverityFilter('Critical')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              severityFilter === 'Critical' ? 'bg-white text-rose-700 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            Critical ({criticalCount})
          </button>
          <button
            onClick={() => setSeverityFilter('Warning')}
            className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
              severityFilter === 'Warning' ? 'bg-white text-amber-700 shadow-2xs font-bold' : 'text-neutral-500'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            Warning ({warningCount})
          </button>
        </div>
      </div>

      {/* Alerts Stream List */}
      <div className="space-y-3">
        {filteredAlerts.map((alert) => {
          const asset = assets.find((a) => a.id === alert.asset_id);
          const isCritical = alert.severity === 'Critical';

          // Icon based on type
          let TypeIcon = AlertTriangle;
          if (alert.type === 'High Idle') TypeIcon = Clock;
          if (alert.type === 'Unassigned Operator') TypeIcon = UserX;
          if (alert.type === 'Unassigned Equipment') TypeIcon = MapPinOff;
          if (alert.type === 'Overdue Rental' || alert.type === 'Approaching Return') TypeIcon = CalendarX;
          if (alert.type === 'Low Health / Maintenance') TypeIcon = Wrench;

          return (
            <div
              key={alert.id}
              className={`p-4 sm:p-5 rounded-2xl border transition-all ${
                alert.resolved
                  ? 'bg-neutral-50 border-neutral-200 opacity-60'
                  : isCritical
                  ? 'bg-white border-rose-200/90 shadow-xs ring-1 ring-rose-100'
                  : 'bg-white border-amber-200/90 shadow-xs'
              }`}
            >
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                
                {/* Left Side: Icon & Details */}
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      alert.resolved
                        ? 'bg-neutral-200 text-neutral-500'
                        : isCritical
                        ? 'bg-rose-50 text-rose-600 border border-rose-200'
                        : 'bg-amber-50 text-amber-600 border border-amber-200'
                    }`}
                  >
                    <TypeIcon className="w-5 h-5" />
                  </div>

                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-neutral-900 bg-neutral-100 px-2 py-0.5 rounded-md">
                        {alert.asset_id}
                      </span>
                      <span className="text-xs font-bold text-neutral-800">
                        {asset ? asset.model : 'Caterpillar Unit'}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          isCritical
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {alert.type}
                      </span>
                      <span className="text-[11px] text-neutral-400 font-mono">
                        {alert.metric_value}
                      </span>
                    </div>

                    <p className="text-xs text-neutral-700 leading-relaxed font-medium">
                      {alert.description}
                    </p>

                    {/* Recommendation Box */}
                    <div className="mt-2 p-2.5 rounded-xl bg-neutral-50 border border-neutral-100 text-xs text-neutral-600 flex items-start gap-2">
                      <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                      <p className="text-[11px]">
                        <strong>Recommended Protocol:</strong> {alert.recommendation}
                      </p>
                    </div>

                    {/* Notification Delivery Log */}
                    {alert.notifications && alert.notifications.length > 0 && (
                      <div className="mt-2 p-2.5 rounded-xl bg-emerald-50/60 border border-emerald-100 space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                          Notified {alert.notified_at ? new Date(alert.notified_at).toLocaleTimeString() : ''}
                        </p>
                        {alert.notifications.map((n, idx) => {
                          const ChannelIcon = channelIcon(n.channel);
                          return (
                            <div key={idx} className="flex items-start gap-2 text-[11px] text-neutral-700">
                              <ChannelIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>
                                <strong>{n.channel}</strong> → {n.recipient}
                                <span className="text-neutral-500"> — {n.detail}</span>
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side Action Buttons */}
                <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                  {!alert.resolved && (
                    <button
                      onClick={() => onNotify(alert)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors flex items-center gap-1.5"
                      title="Send Email + SMS + in-cab console alert"
                    >
                      <BellRing className="w-3.5 h-3.5" />
                      {alert.notifications ? 'Re-Notify' : 'Notify'}
                    </button>
                  )}

                  {asset && !alert.resolved && (
                    <>
                      {alert.type === 'Unassigned Operator' && (
                        <button
                          onClick={() => onTakeAction(asset, 'checkout')}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors shadow-2xs"
                        >
                          Assign Operator
                        </button>
                      )}

                      {(alert.type === 'High Idle' || alert.type === 'Overdue Rental') && (
                        <button
                          onClick={() => onTakeAction(asset, 'checkin')}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors shadow-2xs"
                        >
                          Check-In / Return
                        </button>
                      )}

                      {alert.type === 'Low Health / Maintenance' && (
                        <button
                          onClick={() => onTakeAction(asset, 'inspect')}
                          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors shadow-2xs"
                        >
                          Safety Inspection
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => onResolveAlert(alert.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                      alert.resolved
                        ? 'bg-neutral-200 text-neutral-600'
                        : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'
                    }`}
                  >
                    {alert.resolved ? 'Resolved ✓' : 'Acknowledge'}
                  </button>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
