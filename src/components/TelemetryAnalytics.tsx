import React, { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Doughnut, Bar } from 'react-chartjs-2';
import { 
  Fuel, 
  Clock, 
  DollarSign, 
  Leaf, 
  TrendingDown, 
  AlertTriangle, 
  Zap,
  Layers,
  ArrowUpRight
} from 'lucide-react';
import { Asset, Site } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface TelemetryAnalyticsProps {
  assets: Asset[];
  sites: Site[];
  onFocusAsset: (asset: Asset) => void;
}

export const TelemetryAnalytics: React.FC<TelemetryAnalyticsProps> = ({
  assets,
  sites,
  onFocusAsset,
}) => {
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d');

  // Compute Aggregate Telemetry Metrics
  const totalEngineHoursDay = assets.reduce((acc, a) => acc + a.engine_hours_day, 0);
  const totalIdleHoursDay = assets.reduce((acc, a) => acc + a.idle_hours_day, 0);
  const totalShiftHours = totalEngineHoursDay + totalIdleHoursDay;
  const overallIdlePercentage = totalShiftHours > 0 ? Math.round((totalIdleHoursDay / totalShiftHours) * 100) : 0;

  // Financial Waste: Avg $38/hr (Diesel fuel + wear on idling engine components)
  const dailyIdleWasteDollars = Math.round(totalIdleHoursDay * 38);
  const monthlyIdleWasteDollars = dailyIdleWasteDollars * 30;

  // Carbon Waste: 2.68 kg CO2 per liter of diesel burned at idle (~3.5 L/hr at idle)
  const dailyIdleCO2Kg = Math.round(totalIdleHoursDay * 3.5 * 2.68);

  // Usage & Downtime Summary Per Site: cumulative rented hours over the life of each
  // check-out (engine/idle rate x operating_days), grouped by site_id, with a
  // separate downtime tally for units sidelined under maintenance at that site.
  const siteUsageSummary = sites
    .map((site) => {
      const siteAssets = assets.filter((a) => a.site_id === site.id);
      if (siteAssets.length === 0) return null;

      const totalRentalDays = siteAssets.reduce((acc, a) => acc + a.operating_days, 0);
      const totalEngineHours = siteAssets.reduce((acc, a) => acc + a.engine_hours_day * a.operating_days, 0);
      const totalIdleHours = siteAssets.reduce((acc, a) => acc + a.idle_hours_day * a.operating_days, 0);
      const totalHours = totalEngineHours + totalIdleHours;
      const idlePct = totalHours > 0 ? Math.round((totalIdleHours / totalHours) * 100) : 0;

      const downtimeAssets = siteAssets.filter((a) => a.status === 'Under Maintenance');
      const downtimeDays = downtimeAssets.reduce((acc, a) => acc + a.operating_days, 0);

      return {
        siteId: site.id,
        siteName: site.name,
        machineCount: siteAssets.length,
        totalRentalDays,
        totalEngineHours: Math.round(totalEngineHours),
        totalIdleHours: Math.round(totalIdleHours),
        idlePct,
        downtimeUnits: downtimeAssets.length,
        downtimeDays,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.totalIdleHours - a.totalIdleHours);

  // 1. Line Chart Data: 7-Day Fuel Burn Trend (Liters / Hour)
  const daysLabels = timeRange === '7d' 
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] 
    : ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4'];

  const fuelBurnLineData = {
    labels: daysLabels,
    datasets: [
      {
        label: 'Cat Bulldozers (D6T/D8T)',
        data: timeRange === '7d' ? [21.5, 23.2, 22.8, 25.1, 24.6, 18.2, 19.0] : [22.1, 23.5, 24.0, 22.8],
        borderColor: '#FFCD00',
        backgroundColor: 'rgba(255, 205, 0, 0.12)',
        tension: 0.35,
        fill: true,
        pointBackgroundColor: '#FFCD00',
        pointRadius: 4,
      },
      {
        label: 'Cat Excavators (320/349)',
        data: timeRange === '7d' ? [14.2, 15.1, 16.0, 14.8, 15.5, 12.0, 13.5] : [14.9, 15.2, 15.8, 14.5],
        borderColor: '#1D1D1F',
        backgroundColor: 'rgba(29, 29, 31, 0.05)',
        tension: 0.35,
        fill: true,
        pointBackgroundColor: '#1D1D1F',
        pointRadius: 4,
      },
      {
        label: 'Cat Graders & Cranes',
        data: timeRange === '7d' ? [11.0, 12.4, 10.8, 11.5, 12.0, 8.5, 9.0] : [11.2, 11.8, 12.1, 10.9],
        borderColor: '#10B981',
        borderDash: [5, 5],
        tension: 0.35,
        pointRadius: 3,
      },
      {
        label: 'Cat Eco-Mode Target (Max)',
        data: timeRange === '7d' ? [16, 16, 16, 16, 16, 16, 16] : [16, 16, 16, 16],
        borderColor: '#94A3B8',
        borderDash: [3, 3],
        pointRadius: 0,
      }
    ],
  };

  const fuelLineOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          boxWidth: 12,
          font: { family: 'inherit', size: 11, weight: '500' },
          color: '#475569',
        },
      },
      tooltip: {
        backgroundColor: 'rgba(15, 23, 42, 0.9)',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      y: {
        title: { display: true, text: 'Fuel Burn (Liters / Hour)', font: { size: 11 } },
        grid: { color: 'rgba(0, 0, 0, 0.04)' },
        ticks: { color: '#64748B', font: { size: 10 } },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#64748B', font: { size: 10 } },
      },
    },
  };

  // 2. Doughnut Chart: Runtime vs. Idle Hour Breakdown across Fleet
  const doughnutData = {
    labels: ['Productive Engine Work', 'Excess Idle Standby'],
    datasets: [
      {
        data: [Number(totalEngineHoursDay.toFixed(1)), Number(totalIdleHoursDay.toFixed(1))],
        backgroundColor: ['#10B981', '#FFCD00'],
        hoverBackgroundColor: ['#059669', '#F5C400'],
        borderWidth: 2,
        borderColor: '#FFFFFF',
      },
    ],
  };

  const doughnutOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          boxWidth: 10,
          font: { size: 11 },
          color: '#334155',
        },
      },
    },
  };

  // 3. Bar Chart: Individual Machine Utilization Comparison
  const barData = {
    labels: assets.map((a) => a.id),
    datasets: [
      {
        label: 'Engine Work (h/day)',
        data: assets.map((a) => a.engine_hours_day),
        backgroundColor: '#10B981',
        borderRadius: 6,
      },
      {
        label: 'Idle Standby (h/day)',
        data: assets.map((a) => a.idle_hours_day),
        backgroundColor: '#F59E0B',
        borderRadius: 6,
      },
    ],
  };

  const barOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: { boxWidth: 10, font: { size: 11 } },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: { font: { size: 10 } },
      },
      y: {
        stacked: true,
        title: { display: true, text: 'Hours / Day', font: { size: 11 } },
        grid: { color: 'rgba(0, 0, 0, 0.04)' },
        ticks: { font: { size: 10 } },
      },
    },
  };

  return (
    <div className="space-y-5">
      {/* Metric Cards Top Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: Fleet Idle Ratio */}
        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">Fleet Idle Ratio</span>
            <div className="p-2 rounded-xl bg-amber-50 text-amber-600">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-neutral-900 flex items-baseline gap-1.5">
              <span>{overallIdlePercentage}%</span>
              <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">
                {totalIdleHoursDay}h Idle/day
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              {totalEngineHoursDay}h active work vs {totalIdleHoursDay}h unworked idle
            </p>
          </div>
        </div>

        {/* Card 2: Financial Idle Waste */}
        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">Daily Idling Waste</span>
            <div className="p-2 rounded-xl bg-rose-50 text-rose-600">
              <DollarSign className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-neutral-900 flex items-baseline gap-1.5">
              <span>${dailyIdleWasteDollars.toLocaleString()}</span>
              <span className="text-xs font-normal text-neutral-400">/day</span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              Est. ~${monthlyIdleWasteDollars.toLocaleString()} / month in non-productive fuel & wear
            </p>
          </div>
        </div>

        {/* Card 3: Avg Fleet Fuel Burn */}
        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">Fleet Avg Burn</span>
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
              <Fuel className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-neutral-900 flex items-baseline gap-1.5">
              <span>15.2</span>
              <span className="text-xs font-normal text-neutral-400">Liters / Hr</span>
            </div>
            <p className="text-[11px] text-emerald-600 font-medium mt-1 flex items-center gap-1">
              <span>Within Cat OEM tolerance for tier 4 engines</span>
            </p>
          </div>
        </div>

        {/* Card 4: CO2 Environmental Impact */}
        <div className="bg-white p-4 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-500">Idle CO2 Footprint</span>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600">
              <Leaf className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-3">
            <div className="text-2xl font-black text-neutral-900 flex items-baseline gap-1.5">
              <span>{dailyIdleCO2Kg}</span>
              <span className="text-xs font-normal text-neutral-400">kg CO2 / day</span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1">
              Mitigable with Cat Auto-Shutdown System
            </p>
          </div>
        </div>

      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* 7-Day Fuel Burn Trend Line Chart */}
        <div className="lg:col-span-8 bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Fuel Burn Velocity & Telemetry Trends
              </h3>
              <p className="text-xs text-neutral-500">
                Hourly diesel consumption (L/hr) by equipment family vs Eco target
              </p>
            </div>

            <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl text-xs">
              <button
                onClick={() => setTimeRange('7d')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  timeRange === '7d' ? 'bg-white text-neutral-900 shadow-2xs font-semibold' : 'text-neutral-500'
                }`}
              >
                7 Days
              </button>
              <button
                onClick={() => setTimeRange('30d')}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                  timeRange === '30d' ? 'bg-white text-neutral-900 shadow-2xs font-semibold' : 'text-neutral-500'
                }`}
              >
                30 Days
              </button>
            </div>
          </div>

          <div className="h-[280px] w-full pt-2">
            <Line data={fuelBurnLineData} options={fuelLineOptions} />
          </div>
        </div>

        {/* Runtime vs Idle Hours Doughnut Distribution */}
        <div className="lg:col-span-4 bg-white p-5 rounded-2xl border border-black/5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              Shift Productivity Distribution
            </h3>
            <p className="text-xs text-neutral-500">
              Fleet-wide engine work vs unproductive standby
            </p>
          </div>

          <div className="h-[210px] relative flex items-center justify-center my-2">
            <Doughnut data={doughnutData} options={doughnutOptions} />
            {/* Center Stat */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -mt-4">
              <span className="text-2xl font-black text-neutral-900">{overallIdlePercentage}%</span>
              <span className="text-[10px] text-neutral-400 font-semibold uppercase tracking-wider">Idle Share</span>
            </div>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200/60 rounded-xl text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] leading-tight">
              <strong>Optimization Target:</strong> Lower idle hours to &lt;20% via Cat Product Link™ auto-shutdown dispatch.
            </p>
          </div>
        </div>

      </div>

      {/* Machine-by-Machine Utilization Bar & Leaderboard Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* Machine Breakdown Stacked Bar Chart */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              Asset Runtime vs. Idle Hours Breakdown
            </h3>
            <p className="text-xs text-neutral-500">
              Hours logged per day for each tracked Caterpillar unit
            </p>
          </div>

          <div className="h-[260px] w-full pt-2">
            <Bar data={barData} options={barOptions} />
          </div>
        </div>

        {/* Machine Roster Utilization Rank Table */}
        <div className="lg:col-span-6 bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-neutral-900">
                Machine Utilization & Efficiency Index
              </h3>
              <p className="text-xs text-neutral-500">
                Ranked by operational efficiency and health score
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-400 font-medium">
                  <th className="pb-2 pl-1">Equipment</th>
                  <th className="pb-2">Site</th>
                  <th className="pb-2 text-right">Work (h/d)</th>
                  <th className="pb-2 text-right">Idle (h/d)</th>
                  <th className="pb-2 text-right">Health</th>
                  <th className="pb-2 text-right pr-1">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {assets.map((asset) => {
                  const idleRatio = Math.round((asset.idle_hours_day / Math.max(asset.idle_hours_day + asset.engine_hours_day, 0.1)) * 100);
                  const isHighIdle = asset.idle_hours_day > 8;

                  return (
                    <tr key={asset.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-2.5 pl-1">
                        <div className="font-mono font-bold text-neutral-900">{asset.id}</div>
                        <div className="text-[11px] text-neutral-500">{asset.model}</div>
                      </td>
                      <td className="py-2.5 text-neutral-600 max-w-[130px] truncate">
                        {asset.site_name}
                      </td>
                      <td className="py-2.5 text-right font-semibold text-emerald-700">
                        {asset.engine_hours_day}h
                      </td>
                      <td className="py-2.5 text-right font-semibold">
                        <span className={isHighIdle ? 'text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md' : 'text-neutral-700'}>
                          {asset.idle_hours_day}h
                        </span>
                      </td>
                      <td className="py-2.5 text-right">
                        <span className="font-bold text-neutral-800">{asset.health_score}%</span>
                      </td>
                      <td className="py-2.5 text-right pr-1">
                        <button
                          onClick={() => onFocusAsset(asset)}
                          className="p-1 text-neutral-400 hover:text-neutral-900 rounded-lg hover:bg-neutral-100 transition-colors"
                          title="View on map"
                        >
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* Usage & Downtime Summary Per Site */}
      <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-neutral-100 text-neutral-600">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-neutral-900">
              Usage & Downtime Summary by Site
            </h3>
            <p className="text-xs text-neutral-500">
              Cumulative rented hours and maintenance downtime, rolled up per job site
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-100 text-neutral-400 font-medium">
                <th className="pb-2 pl-1">Site</th>
                <th className="pb-2 text-right">Machines</th>
                <th className="pb-2 text-right">Total Rental Days</th>
                <th className="pb-2 text-right">Engine Hours</th>
                <th className="pb-2 text-right">Idle Hours</th>
                <th className="pb-2 text-right">Idle %</th>
                <th className="pb-2 text-right pr-1">Downtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {siteUsageSummary.map((row) => (
                <tr key={row.siteId} className="hover:bg-neutral-50/80 transition-colors">
                  <td className="py-2.5 pl-1">
                    <div className="font-semibold text-neutral-900">{row.siteName}</div>
                    <div className="text-[11px] text-neutral-400 font-mono">{row.siteId}</div>
                  </td>
                  <td className="py-2.5 text-right text-neutral-700">{row.machineCount}</td>
                  <td className="py-2.5 text-right text-neutral-700">{row.totalRentalDays}d</td>
                  <td className="py-2.5 text-right font-semibold text-emerald-700">{row.totalEngineHours}h</td>
                  <td className="py-2.5 text-right font-semibold text-amber-600">{row.totalIdleHours}h</td>
                  <td className="py-2.5 text-right">
                    <span className={row.idlePct > 50 ? 'text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded-md font-bold' : 'text-neutral-700 font-semibold'}>
                      {row.idlePct}%
                    </span>
                  </td>
                  <td className="py-2.5 text-right pr-1">
                    {row.downtimeUnits > 0 ? (
                      <span className="text-rose-600 font-semibold">
                        {row.downtimeUnits} unit{row.downtimeUnits > 1 ? 's' : ''} · {row.downtimeDays}d
                      </span>
                    ) : (
                      <span className="text-neutral-400">None</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
