import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { FleetMapView } from './components/FleetMapView';
import { TelemetryAnalytics } from './components/TelemetryAnalytics';
import { CheckInOutModal } from './components/CheckInOutModal';
import { InspectionModal } from './components/InspectionModal';
import { AiDemandForecaster } from './components/AiDemandForecaster';
import { AnomalyAlertsPanel } from './components/AnomalyAlertsPanel';
import { AlertHistoryPanel } from './components/AlertHistoryPanel';
import { QrCodeModal } from './components/QrCodeModal';
import { INITIAL_ASSETS, SITES, OPERATORS } from './data/initialAssets';
import { Asset, Site, Operator, AnomalyAlert, AlertHistoryEntry, InspectionCheckItem } from './types';
import { runAnomalyDetection } from './utils/anomalyDetector';
import { dispatchNotification } from './utils/notificationDispatcher';
import { CheckCircle2, AlertCircle } from 'lucide-react';

export default function App() {
  const [assets, setAssets] = useState<Asset[]>(INITIAL_ASSETS);
  const [sites, setSites] = useState<Site[]>(SITES);
  const [operators, setOperators] = useState<Operator[]>(OPERATORS);
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  // Permanent audit trail: every alert ever raised, including ones whose
  // underlying condition has since cleared (asset returned, idle dropped,
  // etc). `alerts` above only ever reflects what's true right now.
  const [alertHistory, setAlertHistory] = useState<AlertHistoryEntry[]>([]);

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<'map' | 'analytics' | 'checkinout' | 'ai-forecasting' | 'inspection' | 'anomalies' | 'history'>('map');

  // Selected asset state for drawer/map
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  // Modals state
  const [isCheckInOutOpen, setIsCheckInOutOpen] = useState<boolean>(false);
  const [checkInOutMode, setCheckInOutMode] = useState<'checkout' | 'checkin'>('checkout');
  const [modalAsset, setModalAsset] = useState<Asset | null>(null);

  const [isInspectionOpen, setIsInspectionOpen] = useState<boolean>(false);
  const [inspectionTargetAsset, setInspectionTargetAsset] = useState<Asset | null>(null);

  // Whether the check-in/out form currently open was reached via a real QR
  // scan or manual entry -- tagged onto the API call so the rental_events
  // history table records how each event actually happened.
  const [checkInOutSource, setCheckInOutSource] = useState<'manual' | 'qr'>('manual');
  const [isQrCodeModalOpen, setIsQrCodeModalOpen] = useState<boolean>(false);
  const [qrCodeAsset, setQrCodeAsset] = useState<Asset | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<{ title: string; desc: string; type: 'success' | 'warning' } | null>(null);

  const showToast = (title: string, desc: string, type: 'success' | 'warning' = 'success') => {
    setToastMessage({ title, desc, type });
    setTimeout(() => setToastMessage(null), 3500);
  };

  // Re-run the rules engine, auto-dispatching Email + SMS + in-cab console
  // notifications the instant a *new* alert appears (mirrors how a real
  // telematics platform like VisionLink pushes alerts automatically rather
  // than waiting for someone to click a button). Alerts that already existed
  // keep their prior resolved/notification state instead of being recomputed
  // from scratch, so acknowledging or notifying an alert isn't undone the
  // next time assets change. Every alert, past and present, is also logged
  // into the permanent audit trail (alertHistory).
  const refreshAlerts = () => {
    const detectedAlerts = runAnomalyDetection(assets);
    const prevById = new Map<string, AnomalyAlert>(alerts.map((a) => [a.id, a]));
    const now = new Date().toISOString();
    let newlyNotifiedCount = 0;

    const merged = detectedAlerts.map((alert) => {
      const prev = prevById.get(alert.id);
      if (prev) {
        return { ...alert, resolved: prev.resolved, notifications: prev.notifications, notified_at: prev.notified_at };
      }

      const asset = assets.find((a) => a.id === alert.asset_id);
      const site = sites.find((s) => s.id === asset?.site_id);
      const operator = operators.find((o) => o.id === asset?.operator_id);
      const dispatches = dispatchNotification(alert, asset, site, operator);
      newlyNotifiedCount += 1;

      return { ...alert, notifications: dispatches, notified_at: now };
    });

    setAlerts(merged);

    if (newlyNotifiedCount > 0) {
      showToast(
        'Auto-Notification Dispatched',
        `${newlyNotifiedCount} new alert(s) auto-notified via Email, SMS & in-cab console alert.`
      );
    }

    const detectedIds = new Set(merged.map((a) => a.id));
    const historyById = new Map<string, AlertHistoryEntry>(alertHistory.map((h) => [h.id, h]));

    const clearedHistory = alertHistory.map((h) =>
      !detectedIds.has(h.id) && !h.cleared_at ? { ...h, cleared_at: now } : h
    );
    const newHistoryEntries: AlertHistoryEntry[] = merged
      .filter((a) => !historyById.has(a.id))
      .map((a) => ({ ...a, first_seen_at: now }));

    setAlertHistory([...newHistoryEntries, ...clearedHistory]);
  };

  // Run anomaly detection whenever assets change
  useEffect(() => {
    refreshAlerts();
  }, [assets]);

  // Load initial backend assets if running fullstack
  useEffect(() => {
    fetch('/api/assets')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.assets) {
          setAssets(data.assets);
        }
      })
      .catch((err) => {
        console.log('Using embedded local dataset:', err);
      });
  }, []);

  // Handler: Handle Check-Out from Form
  const handleCheckOutSubmit = async (data: {
    asset_id: string;
    site_id: string;
    operator_id: string;
    checkout_date: string;
    checkin_date: string;
    starting_fuel: number;
  }) => {
    const site = sites.find((s) => s.id === data.site_id);
    const operator = operators.find((o) => o.id === data.operator_id);

    setAssets((prev) =>
      prev.map((asset) => {
        if (asset.id.toLowerCase() === data.asset_id.toLowerCase()) {
          return {
            ...asset,
            status: 'Active',
            site_id: data.site_id,
            site_name: site ? site.name : asset.site_name,
            operator_id: data.operator_id || null,
            operator_name: operator ? operator.name : null,
            checkout_date: data.checkout_date,
            checkin_date: data.checkin_date,
            fuel_level_pct: data.starting_fuel,
            location: site ? site.location : asset.location,
            anomalies: [],
          };
        }
        return asset;
      })
    );

    // Call backend API -- tag whether this came from a real QR scan or
    // manual entry, so the rental_events history table reflects it.
    fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, source: checkInOutSource }),
    }).catch((e) => console.log(e));
    setCheckInOutSource('manual');

    showToast(
      'Equipment Check-Out Authorized',
      `Unit ${data.asset_id} deployed to ${site?.name || data.site_id} under operator ${operator?.name || 'Unassigned'}.`
    );
  };

  // Handler: Handle Check-In from Form
  const handleCheckInSubmit = async (data: {
    asset_id: string;
    return_site_id: string;
    ending_engine_hours: number;
    fuel_level_pct: number;
    inspection_notes: string;
    status: 'Idle' | 'Under Maintenance';
  }) => {
    setAssets((prev) =>
      prev.map((asset) => {
        if (asset.id.toLowerCase() === data.asset_id.toLowerCase()) {
          return {
            ...asset,
            status: data.status,
            operator_id: null,
            operator_name: null,
            fuel_level_pct: data.fuel_level_pct,
            anomalies: [],
          };
        }
        return asset;
      })
    );

    // Call backend API -- tag whether this came from a real QR scan or
    // manual entry, so the rental_events history table reflects it.
    fetch('/api/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, source: checkInOutSource }),
    }).catch((e) => console.log(e));
    setCheckInOutSource('manual');

    showToast(
      'Check-In Handover Finalized',
      `Unit ${data.asset_id} returned successfully with status set to ${data.status}.`
    );
  };

  // Handler: Handle Inspection Submit
  const handleInspectionSubmit = (record: {
    asset_id: string;
    operator_id: string;
    check_type: string;
    items: InspectionCheckItem[];
    risk_score: number;
    risk_level: string;
    odometer_hours: number;
    inspector_name: string;
    passed: boolean;
    notes: string;
  }) => {
    if (record.risk_score > 60) {
      setAssets((prev) =>
        prev.map((a) =>
          a.id === record.asset_id
            ? { ...a, status: 'Under Maintenance', health_score: Math.max(30, 100 - record.risk_score) }
            : a
        )
      );
      showToast(
        'Inspection Flagged: Maintenance Required',
        `Asset ${record.asset_id} scored risk index ${record.risk_score}%. Unit placed under maintenance lock.`,
        'warning'
      );
    } else {
      showToast(
        'Safety Inspection Certified',
        `Asset ${record.asset_id} certified by ${record.inspector_name} with ${record.risk_level} Risk score (${record.risk_score}%).`
      );
    }

    // Call backend API
    fetch('/api/inspections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    }).catch((e) => console.log(e));
  };

  // Helper: Open CheckIn/Out modal with preselected asset
  const triggerCheckInOutForAsset = (asset: Asset, mode: 'checkin' | 'checkout') => {
    setCheckInOutSource('manual');
    setModalAsset(asset);
    setCheckInOutMode(mode);
    setIsCheckInOutOpen(true);
  };

  // Helper: Open Inspection modal for specific asset
  const triggerInspectionForAsset = (asset: Asset) => {
    setInspectionTargetAsset(asset);
    setIsInspectionOpen(true);
  };

  // Handler: a machine's QR tag was opened (via ?scan=<id> in the URL) --
  // open the check-in/out form pre-filled for it, defaulting to whichever
  // direction makes sense given its current status (Active units are coming
  // back in, everything else is going out to a customer).
  const handleQrScanSuccess = (asset: Asset) => {
    setCheckInOutSource('qr');
    setModalAsset(asset);
    setCheckInOutMode(asset.status === 'Active' ? 'checkin' : 'checkout');
    setIsCheckInOutOpen(true);
    showToast('QR Tag Recognized', `${asset.id} (${asset.model}) matched — form pre-filled.`);
  };

  // Helper: Open the QR tag modal for a specific asset
  const triggerShowQrCode = (asset: Asset) => {
    setQrCodeAsset(asset);
    setIsQrCodeModalOpen(true);
  };

  // Real-world QR entry point: a machine's tag encodes a URL back to this
  // app (?scan=<id>) so ANY phone's default camera app can open it directly
  // -- no in-app scanner needed, same pattern as Caterpillar's own "Cat QR
  // Codes" on real machines. On load, if the app was opened this way, jump
  // straight to the pre-filled check-in/out form and clean the URL up.
  useEffect(() => {
    const scanId = new URLSearchParams(window.location.search).get('scan');
    if (!scanId) return;

    const asset = assets.find((a) => a.id.toLowerCase() === scanId.toLowerCase());
    if (asset) {
      handleQrScanSuccess(asset);
    } else {
      showToast('Unrecognized QR Tag', `"${scanId}" doesn't match any known machine.`, 'warning');
    }

    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('scan');
    window.history.replaceState({}, '', cleanUrl.toString());
  }, []);

  // Helper: Resolve anomaly alert
  const handleResolveAlert = (alertId: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, resolved: true } : a))
    );
    setAlertHistory((prev) =>
      prev.map((h) => (h.id === alertId ? { ...h, resolved: true } : h))
    );
    showToast('Alert Acknowledged', `Anomaly flag ${alertId} marked as reviewed.`);
  };

  // Handler: Dispatch multi-channel notification for an alert (Email + SMS + in-cab console)
  const handleNotifyAlert = (alert: AnomalyAlert) => {
    const asset = assets.find((a) => a.id === alert.asset_id);
    const site = sites.find((s) => s.id === asset?.site_id);
    const operator = operators.find((o) => o.id === asset?.operator_id);

    const dispatches = dispatchNotification(alert, asset, site, operator);
    const notifiedAt = new Date().toISOString();

    setAlerts((prev) =>
      prev.map((a) => (a.id === alert.id ? { ...a, notifications: dispatches, notified_at: notifiedAt } : a))
    );
    setAlertHistory((prev) =>
      prev.map((h) => (h.id === alert.id ? { ...h, notifications: dispatches, notified_at: notifiedAt } : h))
    );

    showToast(
      'Notification Dispatched',
      `${alert.asset_id}: alerted via ${dispatches.map((d) => d.channel).join(', ')}.`
    );
  };

  // Handler: Quick action from anomaly panel
  const handleAnomalyAction = (asset: Asset, actionType: 'checkout' | 'checkin' | 'inspect') => {
    if (actionType === 'inspect') {
      triggerInspectionForAsset(asset);
    } else {
      triggerCheckInOutForAsset(asset, actionType);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F] flex flex-col antialiased">
      
      {/* Executive Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        assets={assets}
        alerts={alerts}
        onOpenCheckInOut={(mode) => {
          setCheckInOutSource('manual');
          setModalAsset(null);
          setCheckInOutMode(mode);
          setIsCheckInOutOpen(true);
        }}
        onOpenInspection={() => {
          setInspectionTargetAsset(assets[0]);
          setIsInspectionOpen(true);
        }}
        onRefresh={() => {
          refreshAlerts();
          showToast('Telemetry Synced', 'Refreshed live Caterpillar telematic sensor streams.');
        }}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        
        {/* Layer 3: Executive Fleet Map View */}
        {activeTab === 'map' && (
          <FleetMapView
            assets={assets}
            sites={sites}
            selectedAsset={selectedAsset}
            onSelectAsset={setSelectedAsset}
            onCheckInOut={triggerCheckInOutForAsset}
            onInspect={triggerInspectionForAsset}
            onShowQrCode={triggerShowQrCode}
          />
        )}

        {/* Layer 1: Usage & Telemetry Analytics */}
        {activeTab === 'analytics' && (
          <TelemetryAnalytics
            assets={assets}
            sites={sites}
            onFocusAsset={(asset) => {
              setSelectedAsset(asset);
              setActiveTab('map');
            }}
          />
        )}

        {/* Layer 1: Check-In / Out Hub Tab */}
        {activeTab === 'checkinout' && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-neutral-900">
                  Equipment Check-In & Check-Out Terminal
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Authorize heavy machinery handovers, scan RFID tags, assign certified operators, and log odometer engine hours.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setModalAsset(null);
                    setCheckInOutMode('checkout');
                    setIsCheckInOutOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-all shadow-2xs cursor-pointer"
                >
                  + Deploy New Check-Out
                </button>
                <button
                  onClick={() => {
                    setModalAsset(null);
                    setCheckInOutMode('checkin');
                    setIsCheckInOutOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-all shadow-2xs cursor-pointer"
                >
                  Return / Check-In Unit
                </button>
              </div>
            </div>

            {/* Quick Fleet Quick-Deploy Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between space-y-4 hover:shadow-md transition-shadow"
                >
                  <div>
                    <div className="flex items-start justify-between">
                      <span className="font-mono text-xs font-bold bg-neutral-100 px-2 py-0.5 rounded text-neutral-700">
                        {asset.id}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          asset.status === 'Active'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : asset.status === 'Idle'
                            ? 'bg-amber-50 text-amber-700 border border-amber-200'
                            : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}
                      >
                        {asset.status}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-neutral-900 mt-2">
                      {asset.model}
                    </h3>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      {asset.site_name}
                    </p>
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl text-xs space-y-1 text-neutral-600">
                    <div className="flex justify-between">
                      <span>Operator:</span>
                      <span className="font-semibold text-neutral-900">
                        {asset.operator_name || 'Unassigned (Standby)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Fuel Level:</span>
                      <span className="font-semibold text-neutral-900">
                        {asset.fuel_level_pct}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Daily Rate:</span>
                      <span className="font-semibold text-neutral-900">
                        ${asset.rental_rate_daily}/day
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {asset.status === 'Active' ? (
                      <button
                        onClick={() => triggerCheckInOutForAsset(asset, 'checkin')}
                        className="w-full py-2 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors"
                      >
                        Check-In Return
                      </button>
                    ) : (
                      <button
                        onClick={() => triggerCheckInOutForAsset(asset, 'checkout')}
                        className="w-full py-2 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors"
                      >
                        Deploy Unit
                      </button>
                    )}

                    <button
                      onClick={() => triggerInspectionForAsset(asset)}
                      className="w-full py-2 rounded-xl text-xs font-bold bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 transition-colors"
                    >
                      Inspect
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Layer 2: AI Demand Forecasting */}
        {activeTab === 'ai-forecasting' && (
          <AiDemandForecaster
            sites={sites}
            onApplyFleetToJob={(siteId, recommendations) => {
              showToast('Fleet Sizing Applied', `Scheduled ${recommendations.length} machines for site allocation.`);
              setActiveTab('map');
            }}
          />
        )}

        {/* Layer 2: Safety & Condition Inspection */}
        {activeTab === 'inspection' && (
          <div className="space-y-5">
            <div className="bg-white p-6 rounded-2xl border border-black/5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-neutral-900">
                  Caterpillar Fleet Safety & Inspection Center
                </h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Perform digital 5-point walkaround checks, hydraulic fluid tests, undercarriage assessments, and generate official release certificates.
                </p>
              </div>

              <button
                onClick={() => {
                  setInspectionTargetAsset(assets[0]);
                  setIsInspectionOpen(true);
                }}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors shadow-2xs"
              >
                + Start New Walkaround Check
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-xs font-bold text-neutral-700 bg-neutral-100 px-2 py-0.5 rounded">
                        {asset.id}
                      </span>
                      <h3 className="text-sm font-bold text-neutral-900 mt-1.5">{asset.model}</h3>
                      <p className="text-xs text-neutral-500">{asset.site_name}</p>
                    </div>

                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-neutral-400">Cat Health</div>
                      <div className="text-sm font-black text-neutral-900">{asset.health_score}%</div>
                    </div>
                  </div>

                  <div className="p-3 bg-neutral-50 rounded-xl text-xs space-y-1 text-neutral-600">
                    <div className="flex justify-between">
                      <span>Last Inspection:</span>
                      <span className="font-semibold text-neutral-900">{asset.last_maintenance_date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Next Service Due:</span>
                      <span className="font-semibold text-neutral-900">{asset.next_maintenance_hours}h remaining</span>
                    </div>
                  </div>

                  <button
                    onClick={() => triggerInspectionForAsset(asset)}
                    className="w-full py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                  >
                    Conduct Inspection
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Layer 2: Rules & Anomaly Alerts */}
        {activeTab === 'anomalies' && (
          <AnomalyAlertsPanel
            alerts={alerts}
            assets={assets}
            onResolveAlert={handleResolveAlert}
            onTakeAction={handleAnomalyAction}
            onNotify={handleNotifyAlert}
          />
        )}

        {/* Layer 2: Alert & Notification Audit Trail */}
        {activeTab === 'history' && (
          <AlertHistoryPanel history={alertHistory} />
        )}

      </main>

      {/* Check In / Out Modal */}
      <CheckInOutModal
        isOpen={isCheckInOutOpen}
        onClose={() => setIsCheckInOutOpen(false)}
        mode={checkInOutMode}
        preSelectedAsset={modalAsset}
        assets={assets}
        sites={sites}
        operators={operators}
        onSubmitCheckOut={handleCheckOutSubmit}
        onSubmitCheckIn={handleCheckInSubmit}
      />

      {/* Inspection Modal */}
      <InspectionModal
        isOpen={isInspectionOpen}
        onClose={() => setIsInspectionOpen(false)}
        asset={inspectionTargetAsset || assets[0]}
        operators={operators}
        onSubmitInspection={handleInspectionSubmit}
      />

      {/* QR Tag viewer -- the permanent, printable QR code for one machine */}
      <QrCodeModal
        isOpen={isQrCodeModalOpen}
        onClose={() => setIsQrCodeModalOpen(false)}
        asset={qrCodeAsset}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 animate-slideUp">
          <div
            className={`p-4 rounded-2xl shadow-xl border flex items-start gap-3 max-w-sm backdrop-blur-md ${
              toastMessage.type === 'warning'
                ? 'bg-amber-50/95 border-amber-200 text-amber-900'
                : 'bg-neutral-900/95 text-white border-neutral-800'
            }`}
          >
            {toastMessage.type === 'warning' ? (
              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-[#FFCD00] shrink-0 mt-0.5" />
            )}
            <div>
              <div className="text-xs font-bold">{toastMessage.title}</div>
              <div className="text-[11px] text-neutral-300 mt-0.5 leading-snug">
                {toastMessage.desc}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
