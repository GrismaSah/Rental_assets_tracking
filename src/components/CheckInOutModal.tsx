import React, { useState, useEffect } from 'react';
import {
  ScanLine,
  X,
  QrCode,
  Building2,
  User,
  Calendar,
  Fuel,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Asset, Site, Operator } from '../types';
import { QrScanner } from './QrScanner';

interface CheckInOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'checkout' | 'checkin';
  preSelectedAsset?: Asset | null;
  assets: Asset[];
  sites: Site[];
  operators: Operator[];
  // Performs the REAL backend QR scan (POST /api/assets/:id/scan) and
  // returns the matched, freshly-synced asset -- or null if no match.
  onScanAsset: (assetId: string) => Promise<Asset | null>;
  onSubmitCheckOut: (data: {
    asset_id: string;
    site_id: string;
    operator_id: string;
    checkout_date: string;
    checkin_date: string;
    starting_fuel: number;
  }) => void;
  onSubmitCheckIn: (data: {
    asset_id: string;
    return_site_id: string;
    ending_engine_hours: number;
    fuel_level_pct: number;
    inspection_notes: string;
    status: 'Idle' | 'Under Maintenance';
  }) => void;
}

export const CheckInOutModal: React.FC<CheckInOutModalProps> = ({
  isOpen,
  onClose,
  mode: initialMode,
  preSelectedAsset,
  assets,
  sites,
  operators,
  onScanAsset,
  onSubmitCheckOut,
  onSubmitCheckIn,
}) => {
  const [activeTab, setActiveTab] = useState<'checkout' | 'checkin'>(initialMode);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [scanSuccess, setScanSuccess] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Form State
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>('');
  const [checkoutDate, setCheckoutDate] = useState<string>('2025-04-01');
  const [checkinDate, setCheckinDate] = useState<string>('2025-04-25');
  const [fuelPct, setFuelPct] = useState<number>(100);
  const [engineHours, setEngineHours] = useState<number>(0);
  const [inspectionNotes, setInspectionNotes] = useState<string>('Standard equipment check completed without major faults.');
  const [postCheckinStatus, setPostCheckinStatus] = useState<'Idle' | 'Under Maintenance'>('Idle');

  useEffect(() => {
    setActiveTab(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (preSelectedAsset) {
      setSelectedAssetId(preSelectedAsset.id);
      setSelectedSiteId(preSelectedAsset.site_id);
      setSelectedOperatorId(preSelectedAsset.operator_id || '');
      setFuelPct(preSelectedAsset.fuel_level_pct);
      setEngineHours(preSelectedAsset.lifetime_engine_hours);
    } else if (assets.length > 0 && !selectedAssetId) {
      setSelectedAssetId(assets[0].id);
      setSelectedSiteId(sites[0]?.id || 'S001');
    }
  }, [preSelectedAsset, assets, sites]);

  if (!isOpen) return null;

  const currentAsset = assets.find((a) => a.id === selectedAssetId);

  // Real QR scan handler: onScanAsset hits the actual backend
  // (POST /api/assets/:id/scan), persists the scan event to SQLite, and
  // returns the freshly-synced asset. This pre-fills the form from real
  // equipment state and switches to the correct tab (Active units come
  // back in, everything else goes out) -- no fabricated success state.
  const handleQrDetected = async (assetId: string) => {
    setScanError(null);
    const asset = await onScanAsset(assetId);
    setIsScannerOpen(false);
    if (!asset) {
      setScanError(`No equipment found matching "${assetId}".`);
      return;
    }
    setSelectedAssetId(asset.id);
    setSelectedSiteId(asset.site_id || sites[0]?.id || '');
    setSelectedOperatorId(asset.operator_id || '');
    setFuelPct(asset.fuel_level_pct);
    setEngineHours(asset.lifetime_engine_hours);
    setActiveTab(asset.status === 'Active' ? 'checkin' : 'checkout');
    setScanSuccess(true);
    confetti({
      particleCount: 40,
      spread: 60,
      origin: { y: 0.6 },
      colors: ['#FFCD00', '#10B981', '#1D1D1F'],
    });
    setTimeout(() => setScanSuccess(false), 2500);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (activeTab === 'checkout') {
      onSubmitCheckOut({
        asset_id: selectedAssetId,
        site_id: selectedSiteId,
        operator_id: selectedOperatorId,
        checkout_date: checkoutDate,
        checkin_date: checkinDate,
        starting_fuel: Number(fuelPct),
      });
    } else {
      onSubmitCheckIn({
        asset_id: selectedAssetId,
        return_site_id: selectedSiteId,
        ending_engine_hours: Number(engineHours),
        fuel_level_pct: Number(fuelPct),
        inspection_notes: inspectionNotes,
        status: postCheckinStatus,
      });
    }

    onClose();
  };

  // Filter certified operators for the chosen machine type
  const qualifiedOperators = currentAsset
    ? operators.filter((o) => o.certified_equipment.includes(currentAsset.type))
    : operators;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-2xl border border-black/5 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold shadow-xs">
              <ScanLine className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                Caterpillar Asset Check-In / Check-Out Hub
              </h2>
              <p className="text-xs text-neutral-500">
                QR code scan & digital equipment handover
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector & RFID Simulation Bar */}
        <div className="px-5 pt-4 pb-2 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100">
          <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl text-xs font-semibold">
            <button
              onClick={() => setActiveTab('checkout')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'checkout'
                  ? 'bg-[#FFCD00] text-neutral-950 shadow-2xs font-bold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Check-Out (Deploy)
            </button>
            <button
              onClick={() => setActiveTab('checkin')}
              className={`px-3.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                activeTab === 'checkin'
                  ? 'bg-neutral-900 text-white shadow-2xs font-bold'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              Check-In (Return)
            </button>
          </div>

          {/* Real camera QR scanner trigger */}
          <button
            type="button"
            onClick={() => { setScanError(null); setIsScannerOpen(true); }}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              scanSuccess
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                : 'bg-white border-neutral-200 text-neutral-800 hover:bg-neutral-50'
            }`}
          >
            <QrCode className="w-4 h-4 text-[#FFCD00]" />
            <span>{scanSuccess ? '✓ Equipment Matched' : 'Scan QR Code'}</span>
          </button>
        </div>

        {scanError && (
          <div className="mx-5 mt-2 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-[11px] text-rose-700">
            {scanError}
          </div>
        )}

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-5 overflow-y-auto space-y-4 flex-1">
          
          {/* Target Machinery Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1.5">
              Select Caterpillar Equipment Unit *
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {assets.map((asset) => {
                const isSelected = asset.id === selectedAssetId;
                return (
                  <div
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-[#FFCD00] bg-[#FFCD00]/10 ring-2 ring-[#FFCD00]/30'
                        : 'border-neutral-200 hover:border-neutral-300 bg-neutral-50/50'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-neutral-900">{asset.id}</span>
                        <span className="text-neutral-500">• {asset.type}</span>
                      </div>
                      <div className="text-[11px] text-neutral-600 font-medium truncate max-w-[170px]">
                        {asset.model}
                      </div>
                    </div>

                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                        asset.status === 'Active'
                          ? 'bg-emerald-100 text-emerald-800'
                          : asset.status === 'Idle'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {asset.status}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Machine Summary Preview Box */}
          {currentAsset && (
            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/80 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold">
                  CAT
                </div>
                <div>
                  <div className="font-bold text-neutral-900">
                    {currentAsset.model} ({currentAsset.serial_number})
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Day Rate: ${currentAsset.rental_rate_daily}/day • Health: {currentAsset.health_score}%
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-neutral-400">Current Site</div>
                <div className="font-semibold text-neutral-800 truncate max-w-[140px]">
                  {currentAsset.site_name}
                </div>
              </div>
            </div>
          )}

          {/* Conditional Fields: Check-Out vs Check-In */}
          {activeTab === 'checkout' ? (
            <>
              {/* Site & Operator Assignment */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-neutral-400" />
                    Destination Job Site *
                  </label>
                  <select
                    value={selectedSiteId}
                    onChange={(e) => setSelectedSiteId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  >
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.city})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <User className="w-3.5 h-3.5 text-neutral-400" />
                    Assign Certified Operator
                  </label>
                  <select
                    value={selectedOperatorId}
                    onChange={(e) => setSelectedOperatorId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  >
                    <option value="">-- No Operator Assigned (Standby) --</option>
                    {qualifiedOperators.map((op) => (
                      <option key={op.id} value={op.id}>
                        {op.name} (Safety: {op.safety_score}%)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Rental Dates */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    Check-Out Date
                  </label>
                  <input
                    type="date"
                    value={checkoutDate}
                    onChange={(e) => setCheckoutDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                    Expected Return Date
                  </label>
                  <input
                    type="date"
                    value={checkinDate}
                    onChange={(e) => setCheckinDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  />
                </div>
              </div>

              {/* Initial Fuel Level Slider */}
              <div>
                <div className="flex items-center justify-between text-xs font-bold text-neutral-700 mb-1">
                  <span className="flex items-center gap-1">
                    <Fuel className="w-3.5 h-3.5 text-neutral-500" />
                    Handover Fuel Level
                  </span>
                  <span className="text-neutral-900 font-mono">{fuelPct}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={fuelPct}
                  onChange={(e) => setFuelPct(Number(e.target.value))}
                  className="w-full accent-[#FFCD00]"
                />
              </div>
            </>
          ) : (
            <>
              {/* Check-In Form Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-neutral-400" />
                    Engine Meter Reading (Cumulative Hours)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    min={currentAsset?.lifetime_engine_hours ?? 0}
                    value={engineHours}
                    onChange={(e) => setEngineHours(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
                    <Fuel className="w-3.5 h-3.5 text-neutral-400" />
                    Return Fuel Level (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={fuelPct}
                    onChange={(e) => setFuelPct(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  />
                </div>
              </div>

              {/* Status after return */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Post-Rental Machine Availability
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPostCheckinStatus('Idle')}
                    className={`p-2.5 rounded-xl border text-xs font-semibold cursor-pointer text-left transition-all ${
                      postCheckinStatus === 'Idle'
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-800'
                        : 'border-neutral-200 text-neutral-600'
                    }`}
                  >
                    ✓ Clean & Ready for Next Deployment (Idle)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPostCheckinStatus('Under Maintenance')}
                    className={`p-2.5 rounded-xl border text-xs font-semibold cursor-pointer text-left transition-all ${
                      postCheckinStatus === 'Under Maintenance'
                        ? 'border-rose-500 bg-rose-50 text-rose-800'
                        : 'border-neutral-200 text-neutral-600'
                    }`}
                  >
                    ⚠️ Flag for Workshop Maintenance
                  </button>
                </div>
              </div>

              {/* Inspection notes */}
              <div>
                <label className="block text-xs font-bold text-neutral-700 mb-1">
                  Receiving Inspector Notes
                </label>
                <textarea
                  rows={2}
                  value={inspectionNotes}
                  onChange={(e) => setInspectionNotes(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white focus:ring-2 focus:ring-[#FFCD00]/50"
                  placeholder="Record cosmetic or mechanical observations..."
                />
              </div>
            </>
          )}

          {/* Modal Footer Controls */}
          <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors shadow-2xs cursor-pointer flex items-center gap-1.5"
            >
              <span>{activeTab === 'checkout' ? 'Authorize Check-Out' : 'Finalize Check-In Handover'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

        </form>

      </div>

      {isScannerOpen && (
        <QrScanner onDetect={handleQrDetected} onClose={() => setIsScannerOpen(false)} />
      )}
    </div>
  );
};
