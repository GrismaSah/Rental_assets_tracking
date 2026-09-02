import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/Header';
import { TelemetryAnalytics } from './components/TelemetryAnalytics';
import { CheckInOutModal } from './components/CheckInOutModal';
import { InspectionModal } from './components/InspectionModal';
import { AiDemandForecaster } from './components/AiDemandForecaster';
import { AnomalyAlertsPanel } from './components/AnomalyAlertsPanel';
import { AlertHistoryPanel } from './components/AlertHistoryPanel';
import { QrCodeModal } from './components/QrCodeModal';
import { ExecutiveDashboard } from './components/ExecutiveDashboard';
import { INITIAL_ASSETS, SITES, OPERATORS } from './data/initialAssets';
import { Asset, Site, Operator, AnomalyAlert, AlertHistoryEntry, InspectionCheckItem } from './types';
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

  // The server owns the latest fleet snapshot and persisted alert state.
  // Polling keeps the dashboard current today; this endpoint can be swapped
  // for Server-Sent Events when a production telemetry provider is connected.
  const syncDashboard = useCallback(async () => {
    try {
      const [dashboardResponse, historyResponse] = await Promise.all([
        fetch('/api/dashboard'),
        fetch('/api/alerts?history=true'),
      ]);
      if (!dashboardResponse.ok || !historyResponse.ok) throw new Error('Fleet API is unavailable');
      const [dashboard, history] = await Promise.all([dashboardResponse.json(), historyResponse.json()]);
      if (dashboard.success && dashboard.assets) {
        setAssets(dashboard.assets);
        setAlerts(dashboard.alerts || []);
      }
      if (history.success) setAlertHistory(history.alerts || []);
    } catch (err) {
      console.warn('Fleet API sync failed; retaining the last visible fleet snapshot.', err);
    }
  }, []);

  useEffect(() => {
    syncDashboard();
    const timer = window.setInterval(syncDashboard, 5000);
    return () => window.clearInterval(timer);
  }, [syncDashboard]);

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
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || 'Check-out failed');
      await syncDashboard();
    }).catch((e) => showToast('Check-Out Failed', e.message, 'warning'));
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
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || 'Check-in failed');
      await syncDashboard();
    }).catch((e) => showToast('Check-In Failed', e.message, 'warning'));
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
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || 'Inspection submission failed');
      await syncDashboard();
    }).catch((e) => showToast('Inspection Failed', e.message, 'warning'));
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
    fetch(`/api/assets/${asset.id}/scan`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'QR scan could not be recorded');
        await syncDashboard();
        showToast('QR Scan Recorded', `${asset.id} matched. Live telemetry tracking has started and the handover form is pre-filled.`);
      })
      .catch((error) => showToast('QR Scan Failed', error.message, 'warning'));
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
    fetch(`/api/alerts/${alertId}/acknowledge`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Acknowledgement failed');
        await syncDashboard();
        showToast('Alert Acknowledged', `Anomaly flag ${alertId} marked as reviewed.`);
      })
      .catch((error) => showToast('Alert Update Failed', error.message, 'warning'));
  };

  // Handler: Dispatch multi-channel notification for an alert (Email + SMS + in-cab console)
  const handleNotifyAlert = (alert: AnomalyAlert) => {
    fetch(`/api/alerts/${alert.id}/notify`, { method: 'POST' })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json()).error || 'Notification failed');
        await syncDashboard();
        showToast('Notification Recorded', `${alert.asset_id}: email, SMS and in-cab demo notifications were recorded.`);
      })
      .catch((error) => showToast('Notification Failed', error.message, 'warning'));
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
    <div className="min-h-screen bg-[#edf0ec] text-[#20272a] antialiased sm:pl-[248px]">

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
          void syncDashboard();
          showToast('Telemetry Synced', 'Refreshed live Caterpillar telematic sensor streams.');
        }}
      />

      {/* Main Content Area */}
      <main className="mx-auto w-full max-w-[1660px] space-y-6 p-4 sm:p-8 lg:p-10 animate-fadeIn">
        
        {/* Layer 3: Executive Fleet Map View */}
        {activeTab === 'map' && <ExecutiveDashboard assets={assets} sites={sites} alerts={alerts} onSelectAsset={(asset) => { setSelectedAsset(asset); setActiveTab('checkinout'); }} onOpenAlerts={() => setActiveTab('anomalies')} />}

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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-neutral-200/70">
              <div>
                <h2 className="text-[17px] font-semibold text-neutral-900 tracking-tight">
                  Check-In & Check-Out
                </h2>
                <p className="text-[13px] text-neutral-500 mt-0.5">
                  Authorize handovers, assign operators, and log engine hours.
                </p>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => {
                    setModalAsset(null);
                    setCheckInOutMode('checkout');
                    setIsCheckInOutOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-lg text-[12.5px] font-semibold bg-[#FFCD00] text-neutral-950 hover:bg-[#F0C300] transition-colors cursor-pointer"
                >
                  New Check-Out
                </button>
                <button
                  onClick={() => {
                    setModalAsset(null);
                    setCheckInOutMode('checkin');
                    setIsCheckInOutOpen(true);
                  }}
                  className="px-4 py-2.5 rounded-lg text-[12.5px] font-semibold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Check-In Unit
                </button>
              </div>
            </div>

            {/* Quick Fleet Quick-Deploy Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-white p-5 rounded-2xl border border-neutral-200/70 flex flex-col justify-between space-y-4 hover:border-neutral-300 hover:shadow-sm transition-all"
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
                        className="w-full py-2 rounded-lg text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        Check-In Return
                      </button>
                    ) : (
                      <button
                        onClick={() => triggerCheckInOutForAsset(asset, 'checkout')}
                        className="w-full py-2 rounded-lg text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F0C300] transition-colors cursor-pointer"
                      >
                        Deploy Unit
                      </button>
                    )}

                    <button
                      onClick={() => triggerInspectionForAsset(asset)}
                      className="w-full py-2 rounded-lg text-xs font-bold bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 transition-colors cursor-pointer"
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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-neutral-200/70">
              <div>
                <h2 className="text-[17px] font-semibold text-neutral-900 tracking-tight">
                  Safety & Condition Inspection
                </h2>
                <p className="text-[13px] text-neutral-500 mt-0.5">
                  Digital walkaround checks and condition certificates for every unit.
                </p>
              </div>

              <button
                onClick={() => {
                  setInspectionTargetAsset(assets[0]);
                  setIsInspectionOpen(true);
                }}
                className="px-4 py-2.5 rounded-lg text-[12.5px] font-semibold bg-[#FFCD00] text-neutral-950 hover:bg-[#F0C300] transition-colors cursor-pointer"
              >
                Start Walkaround Check
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="bg-white p-5 rounded-2xl border border-neutral-200/70 hover:border-neutral-300 hover:shadow-sm transition-all space-y-4"
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
                    className="w-full py-2.5 rounded-lg text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors cursor-pointer"
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
            className={`p-4 rounded-xl shadow-lg border flex items-start gap-3 max-w-sm backdrop-blur-md ${
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
              <div className={`text-[11px] mt-0.5 leading-snug ${toastMessage.type === 'warning' ? 'text-amber-700' : 'text-neutral-300'}`}>
                {toastMessage.desc}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
