import React, { useState } from 'react';
import { 
  Cpu, 
  Sparkles, 
  Building2, 
  Calendar, 
  Layers, 
  TrendingUp, 
  Fuel, 
  DollarSign, 
  Leaf, 
  CheckCircle2, 
  ArrowRight,
  RefreshCw,
  Sliders,
  Check
} from 'lucide-react';
import { Site, DemandForecastResult } from '../types';

interface AiDemandForecasterProps {
  sites: Site[];
  onApplyFleetToJob: (siteId: string, fleetRecommendations: any[]) => void;
}

export const AiDemandForecaster: React.FC<AiDemandForecasterProps> = ({
  sites,
  onApplyFleetToJob,
}) => {
  const [selectedSiteId, setSelectedSiteId] = useState<string>(sites[0]?.id || 'S001');
  const [projectType, setProjectType] = useState<string>('Urban Transit Infrastructure');
  const [durationWeeks, setDurationWeeks] = useState<number>(6);
  const [targetVolume, setTargetVolume] = useState<number>(45000);
  const [terrainType, setTerrainType] = useState<string>('Compacted Clay & Gravel');
  const [loading, setLoading] = useState<boolean>(false);
  const [forecastResult, setForecastResult] = useState<DemandForecastResult | null>(null);

  const currentSite = sites.find((s) => s.id === selectedSiteId) || sites[0];

  const handleRunForecast = async () => {
    setLoading(true);

    try {
      const response = await fetch('/api/forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_id: selectedSiteId,
          project_type: projectType,
          duration_weeks: durationWeeks,
          target_volume_m3: targetVolume,
          terrain: terrainType,
        }),
      });

      const data = await response.json();
      if (data.success && data.forecast) {
        setForecastResult(data.forecast);
      }
    } catch (err) {
      console.error('Forecast error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Title Card */}
      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold shadow-xs">
            <Cpu className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-neutral-900">
                AI Heavy Machinery Demand Forecasting
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FFCD00]/20 text-neutral-900 border border-[#FFCD00]/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-600" />
                Gemini 3.7 Fleet Logistics Model
              </span>
            </div>
            <p className="text-xs text-neutral-500">
              Predict equipment quantity, cycle velocity, and diesel fuel requirements based on soil type & earthwork volume
            </p>
          </div>
        </div>

        <button
          onClick={handleRunForecast}
          disabled={loading}
          className="px-5 py-2.5 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-all shadow-2xs cursor-pointer flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Simulating Fleet Telemetry...</span>
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              <span>Generate AI Demand Forecast</span>
            </>
          )}
        </button>
      </div>

      {/* Input Parameter Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Left Side: Parameters Controller */}
        <div className="lg:col-span-5 bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-4">
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5" />
              Project Site Parameters
            </h3>
            <span className="text-[11px] text-neutral-400">Step 1 of 2</span>
          </div>

          {/* Site Selector */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-neutral-400" />
              Target Construction Project / Site
            </label>
            <select
              value={selectedSiteId}
              onChange={(e) => {
                setSelectedSiteId(e.target.value);
                const s = sites.find((x) => x.id === e.target.value);
                if (s) setProjectType(s.project_type);
              }}
              className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 text-neutral-800 font-medium focus:bg-white"
            >
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name} ({site.city}, {site.state})
                </option>
              ))}
            </select>
          </div>

          {/* Project Type */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Infrastructure Archetype
            </label>
            <select
              value={projectType}
              onChange={(e) => setProjectType(e.target.value)}
              className="w-full px-3 py-2 rounded-xl text-xs bg-neutral-50 border border-neutral-200 text-neutral-800 font-medium focus:bg-white"
            >
              <option value="Urban Transit Infrastructure">Urban Transit & Metro Civils</option>
              <option value="Renewable Energy Installation">Renewable Energy & Wind Farm Foundations</option>
              <option value="Interstate Highway Grading">Interstate Highway Grading & Paving</option>
              <option value="Petrochemical Infrastructure">Petrochemical Refinery Civils</option>
              <option value="Commercial Logistics Center">Commercial Logistics Hub & Earthmoving</option>
              <option value="Open Pit Mining & Quarry">Open Pit Mining & Heavy Quarry</option>
            </select>
          </div>

          {/* Project Duration Slider */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-neutral-700 mb-1">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-neutral-500" />
                Project Duration
              </span>
              <span className="text-neutral-900 font-mono">{durationWeeks} Weeks</span>
            </div>
            <input
              type="range"
              min="2"
              max="24"
              step="1"
              value={durationWeeks}
              onChange={(e) => setDurationWeeks(Number(e.target.value))}
              className="w-full accent-[#FFCD00]"
            />
            <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
              <span>2 Weeks</span>
              <span>12 Weeks</span>
              <span>24 Weeks</span>
            </div>
          </div>

          {/* Earthwork Volume Slider */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-neutral-700 mb-1">
              <span className="flex items-center gap-1">
                <Layers className="w-3.5 h-3.5 text-neutral-500" />
                Estimated Earthwork Volume
              </span>
              <span className="text-neutral-900 font-mono">{targetVolume.toLocaleString()} m³</span>
            </div>
            <input
              type="range"
              min="5000"
              max="150000"
              step="5000"
              value={targetVolume}
              onChange={(e) => setTargetVolume(Number(e.target.value))}
              className="w-full accent-[#FFCD00]"
            />
            <div className="flex justify-between text-[10px] text-neutral-400 mt-1">
              <span>5,000 m³</span>
              <span>75,000 m³</span>
              <span>150,000 m³</span>
            </div>
          </div>

          {/* Ground / Soil condition */}
          <div>
            <label className="block text-xs font-bold text-neutral-700 mb-1">
              Soil / Terrain Hardness Index
            </label>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {['Soft Sand/Loam', 'Compacted Clay', 'Hard Rock/Granite'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTerrainType(t)}
                  className={`p-2 rounded-xl border text-center font-medium transition-all ${
                    terrainType === t
                      ? 'border-[#FFCD00] bg-[#FFCD00]/15 text-neutral-950 font-bold'
                      : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleRunForecast}
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recalculate AI Sizing Matrix</span>
          </button>
        </div>

        {/* Right Side: Prediction Results Display */}
        <div className="lg:col-span-7 space-y-4">
          {forecastResult ? (
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-4 animate-fadeIn">
              
              {/* Top Output Stats */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-neutral-400">
                    Optimized Sizing Forecast for
                  </span>
                  <h3 className="text-sm font-bold text-neutral-900">
                    {forecastResult.site_name}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Peak Load: Week {forecastResult.peak_workload_week}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-neutral-100 text-neutral-700">
                    {forecastResult.source === 'gemini' ? 'Gemini 3.7 Flash' : 'Cat Telematics Engine'}
                  </span>
                </div>
              </div>

              {/* Aggregated KPI Badges */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                    <DollarSign className="w-3.5 h-3.5 text-neutral-600" />
                    Est. Rental Cost
                  </div>
                  <div className="text-base font-black text-neutral-900 mt-0.5">
                    ${forecastResult.total_fleet_cost.toLocaleString()}
                  </div>
                  <div className="text-[10px] text-neutral-400">For {forecastResult.duration_weeks} weeks</div>
                </div>

                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                    <Fuel className="w-3.5 h-3.5 text-amber-600" />
                    Fuel Burn
                  </div>
                  <div className="text-base font-black text-neutral-900 mt-0.5">
                    {forecastResult.recommended_fleet.reduce((a, b) => a + b.est_fuel_burn_liters, 0).toLocaleString()} <span className="text-xs font-normal text-neutral-500">L</span>
                  </div>
                  <div className="text-[10px] text-neutral-400">Low-idle optimized</div>
                </div>

                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                    <Leaf className="w-3.5 h-3.5 text-emerald-600" />
                    Est. CO2
                  </div>
                  <div className="text-base font-black text-neutral-900 mt-0.5">
                    {forecastResult.co2_emission_est_tons} <span className="text-xs font-normal text-neutral-500">Tons</span>
                  </div>
                  <div className="text-[10px] text-emerald-600 font-medium">-18% vs unmanaged</div>
                </div>
              </div>

              {/* Recommended Fleet Machinery Cards */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-neutral-800">
                  Recommended Heavy Machinery Mix ({forecastResult.recommended_fleet.length} Machine Types)
                </label>

                <div className="space-y-2">
                  {forecastResult.recommended_fleet.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-neutral-50/80 rounded-xl border border-neutral-200/80 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold text-xs">
                          {item.count}x
                        </div>
                        <div>
                          <div className="font-bold text-neutral-900">
                            {item.model}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {item.hours_needed} shift hrs • {item.est_fuel_burn_liters.toLocaleString()} L diesel
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-bold text-neutral-900">
                          ${item.est_rental_cost.toLocaleString()}
                        </div>
                        <div className="text-[10px] font-semibold text-emerald-600 flex items-center justify-end gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {item.utilization_confidence}% confidence
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Engineering Insights Narrative */}
              <div className="p-3.5 bg-[#FFCD00]/10 border border-[#FFCD00]/30 rounded-xl space-y-1 text-xs">
                <div className="flex items-center gap-1.5 font-bold text-neutral-900">
                  <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                  Caterpillar AI Logistics Insights:
                </div>
                <p className="text-neutral-700 leading-relaxed text-[11px]">
                  {forecastResult.ai_insights}
                </p>
              </div>

            </div>
          ) : (
            <div className="bg-white p-12 rounded-2xl border border-black/5 shadow-xs flex flex-col items-center justify-center text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-neutral-100 text-neutral-400 flex items-center justify-center">
                <Sparkles className="w-7 h-7 text-[#FFCD00]" />
              </div>
              <h3 className="text-sm font-bold text-neutral-800">
                Ready to Generate Demand Forecast
              </h3>
              <p className="text-xs text-neutral-500 max-w-sm">
                Configure your job site parameters on the left and click <strong>Generate AI Demand Forecast</strong> to simulate machine counts, work hours, and fuel consumption.
              </p>
              <button
                onClick={handleRunForecast}
                className="mt-2 px-4 py-2 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors"
              >
                Simulate Demo Scenario
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
