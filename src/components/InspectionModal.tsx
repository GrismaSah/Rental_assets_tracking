import React, { useState } from 'react';
import { 
  ShieldCheck, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  ShieldAlert, 
  FileText, 
  Download, 
  UserCheck,
  Activity,
  Award
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Asset, InspectionCheckItem, Operator } from '../types';
import { DEFAULT_INSPECTION_ITEMS } from '../data/initialAssets';

interface InspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  asset: Asset | null;
  operators: Operator[];
  onSubmitInspection: (record: {
    asset_id: string;
    operator_id: string;
    check_type: 'Check-In' | 'Check-Out' | 'Pre-Shift Safety';
    items: InspectionCheckItem[];
    risk_score: number;
    risk_level: 'Low' | 'Moderate' | 'High' | 'Critical';
    odometer_hours: number;
    inspector_name: string;
    passed: boolean;
    notes: string;
  }) => void;
}

export const InspectionModal: React.FC<InspectionModalProps> = ({
  isOpen,
  onClose,
  asset,
  operators,
  onSubmitInspection,
}) => {
  const [items, setItems] = useState<InspectionCheckItem[]>(DEFAULT_INSPECTION_ITEMS);
  const [inspectorName, setInspectorName] = useState('Chief Fleet Inspector Vance');
  const [checkType, setCheckType] = useState<'Check-In' | 'Check-Out' | 'Pre-Shift Safety'>('Pre-Shift Safety');
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>(asset?.operator_id || operators[0]?.id || 'OP101');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [showCertificate, setShowCertificate] = useState(false);

  if (!isOpen || !asset) return null;

  // Calculate Dynamic Risk Score
  let calculatedRisk = 5; // Base baseline
  items.forEach((item) => {
    if (item.status === 'warning') calculatedRisk += 18;
    if (item.status === 'fail') calculatedRisk += 35;
  });
  if (asset.health_score < 70) calculatedRisk += 15;
  if (asset.idle_hours_day > 8) calculatedRisk += 10;
  calculatedRisk = Math.min(100, Math.max(0, calculatedRisk));

  let riskLevel: 'Low' | 'Moderate' | 'High' | 'Critical' = 'Low';
  let riskColor = 'text-emerald-700 bg-emerald-50 border-emerald-200';

  if (calculatedRisk > 75) {
    riskLevel = 'Critical';
    riskColor = 'text-rose-700 bg-rose-50 border-rose-300';
  } else if (calculatedRisk > 50) {
    riskLevel = 'High';
    riskColor = 'text-orange-700 bg-orange-50 border-orange-300';
  } else if (calculatedRisk > 25) {
    riskLevel = 'Moderate';
    riskColor = 'text-amber-700 bg-amber-50 border-amber-300';
  }

  const passed = calculatedRisk <= 50;

  const handleStatusChange = (itemId: string, status: 'pass' | 'warning' | 'fail') => {
    setItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, status } : item))
    );
  };

  const handleComplete = (e: React.FormEvent) => {
    e.preventDefault();

    onSubmitInspection({
      asset_id: asset.id,
      operator_id: selectedOperatorId,
      check_type: checkType,
      items,
      risk_score: calculatedRisk,
      risk_level: riskLevel,
      odometer_hours: Math.round(asset.engine_hours_day * asset.operating_days),
      inspector_name: inspectorName,
      passed,
      notes: additionalNotes,
    });

    setShowCertificate(true);

    if (passed) {
      confetti({
        particleCount: 50,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#FFCD00', '#10B981', '#1D1D1F'],
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/60 backdrop-blur-sm animate-fadeIn">
      <div className="bg-white w-full max-w-2xl rounded-2xl border border-black/5 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-neutral-900">
                Safety & Condition Inspection Questionnaire
              </h2>
              <p className="text-xs text-neutral-500">
                Cat OEM pre-shift & return inspection protocol with dynamic risk scoring
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

        {/* Dynamic Risk Gauge Header Card */}
        <div className="px-5 py-3.5 bg-neutral-100/70 border-b border-neutral-200/60 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white border border-neutral-200 flex items-center justify-center font-mono font-bold text-xs text-neutral-800">
              {asset.id}
            </div>
            <div>
              <div className="font-bold text-xs text-neutral-900">{asset.model}</div>
              <div className="text-[11px] text-neutral-500">{asset.site_name}</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase font-bold text-neutral-400">Dynamic Risk Score</div>
              <div className="text-sm font-black text-neutral-900">{calculatedRisk} / 100</div>
            </div>

            <div className={`px-3 py-1 rounded-xl text-xs font-bold border ${riskColor}`}>
              {riskLevel} Risk
            </div>
          </div>
        </div>

        {/* Certificate View vs Checklist Form */}
        {showCertificate ? (
          <div className="p-6 text-center space-y-4 overflow-y-auto">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 mx-auto flex items-center justify-center border-4 border-emerald-100">
              <Award className="w-8 h-8" />
            </div>

            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#FFCD00] bg-neutral-900 px-3 py-1 rounded-full">
                Cat Certified Release
              </span>
              <h3 className="text-lg font-black text-neutral-900 mt-2">
                Digital Safety Certificate Issued
              </h3>
              <p className="text-xs text-neutral-500 max-w-md mx-auto mt-1">
                Asset <strong>{asset.id}</strong> ({asset.model}) evaluated with Risk Index of{' '}
                <strong>{calculatedRisk}%</strong>. Signed by {inspectorName}.
              </p>
            </div>

            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200 max-w-md mx-auto text-left text-xs space-y-1.5">
              <div className="flex justify-between text-neutral-600">
                <span>Inspection Type:</span>
                <span className="font-semibold text-neutral-900">{checkType}</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Certified Operator:</span>
                <span className="font-semibold text-neutral-900">
                  {operators.find((o) => o.id === selectedOperatorId)?.name || 'Marcus Vance'}
                </span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Cat Telemetry Link:</span>
                <span className="font-semibold text-emerald-600">Passed (Solid GPS)</span>
              </div>
              <div className="flex justify-between text-neutral-600">
                <span>Audit Hash:</span>
                <span className="font-mono text-[10px] text-neutral-400">CAT-{Date.now().toString(16).toUpperCase()}</span>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-center gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors"
              >
                Close & Return to Fleet
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleComplete} className="p-5 overflow-y-auto space-y-4 flex-1">
            
            {/* Context Info (Type, Operator, Inspector) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                  Inspection Mode
                </label>
                <select
                  value={checkType}
                  onChange={(e) => setCheckType(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-neutral-50 border border-neutral-200"
                >
                  <option value="Pre-Shift Safety">Pre-Shift Safety</option>
                  <option value="Check-Out">Check-Out Dispatch</option>
                  <option value="Check-In">Check-In Return</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                  Assigned Operator
                </label>
                <select
                  value={selectedOperatorId}
                  onChange={(e) => setSelectedOperatorId(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-neutral-50 border border-neutral-200"
                >
                  {operators.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-neutral-600 mb-1">
                  Inspector Name
                </label>
                <input
                  type="text"
                  value={inspectorName}
                  onChange={(e) => setInspectorName(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded-xl text-xs bg-neutral-50 border border-neutral-200"
                />
              </div>
            </div>

            {/* Checklist Category Table */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold text-neutral-800">
                5-Point Machine Condition Assessment
              </label>

              <div className="space-y-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl border border-neutral-200/80 bg-neutral-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-500 bg-neutral-200/60 px-1.5 py-0.5 rounded">
                          {item.category}
                        </span>
                        <span className="text-xs font-bold text-neutral-900">{item.title}</span>
                      </div>
                      <p className="text-[11px] text-neutral-500 mt-0.5">{item.description}</p>
                    </div>

                    {/* Status Tri-Toggle */}
                    <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-neutral-200 shrink-0 text-xs">
                      <button
                        type="button"
                        onClick={() => handleStatusChange(item.id, 'pass')}
                        className={`px-2 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          item.status === 'pass'
                            ? 'bg-emerald-500 text-white shadow-2xs'
                            : 'text-neutral-500 hover:text-neutral-800'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Pass</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(item.id, 'warning')}
                        className={`px-2 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          item.status === 'warning'
                            ? 'bg-amber-500 text-white shadow-2xs'
                            : 'text-neutral-500 hover:text-neutral-800'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>Warn</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleStatusChange(item.id, 'fail')}
                        className={`px-2 py-1 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer ${
                          item.status === 'fail'
                            ? 'bg-rose-500 text-white shadow-2xs'
                            : 'text-neutral-500 hover:text-neutral-800'
                        }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Fail</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Additional Inspector Findings */}
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1">
                Additional Observations & Oil Sample Notes
              </label>
              <textarea
                rows={2}
                value={additionalNotes}
                onChange={(e) => setAdditionalNotes(e.target.value)}
                placeholder="E.g. No hydraulic leaks observed; tracks tensioned to 35mm spec..."
                className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 focus:bg-white"
              />
            </div>

            {/* Submit Bar */}
            <div className="pt-3 border-t border-neutral-100 flex items-center justify-between">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
              >
                Cancel
              </button>

              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] shadow-2xs cursor-pointer flex items-center gap-1.5"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>Sign & Issue Safety Certificate</span>
              </button>
            </div>

          </form>
        )}

      </div>
    </div>
  );
};
