import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { 
  MapPin, 
  Search, 
  Filter, 
  Fuel, 
  Clock, 
  User, 
  Building2, 
  AlertCircle, 
  CheckCircle2, 
  SlidersHorizontal,
  ChevronRight,
  ArrowRight,
  Shield,
  Gauge
} from 'lucide-react';
import { Asset, Site } from '../types';

interface FleetMapViewProps {
  assets: Asset[];
  sites: Site[];
  selectedAsset: Asset | null;
  onSelectAsset: (asset: Asset | null) => void;
  onCheckInOut: (asset: Asset, mode: 'checkin' | 'checkout') => void;
  onInspect: (asset: Asset) => void;
}

export const FleetMapView: React.FC<FleetMapViewProps> = ({
  assets,
  sites,
  selectedAsset,
  onSelectAsset,
  onCheckInOut,
  onInspect,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Record<string, L.Marker>>({});

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [mapStyle, setMapStyle] = useState<'carto' | 'osm' | 'satellite'>('carto');

  // Filtered asset list
  const filteredAssets = assets.filter((asset) => {
    const matchesSearch = 
      asset.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.site_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (asset.operator_name && asset.operator_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesStatus = statusFilter === 'all' || asset.status.toLowerCase() === statusFilter.toLowerCase();
    const matchesType = typeFilter === 'all' || asset.type.toLowerCase() === typeFilter.toLowerCase();

    return matchesSearch && matchesStatus && matchesType;
  });

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        scrollWheelZoom: true,
      }).setView([37.0902, -95.7129], 4); // US Center View

      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;

    // Tile Layer based on mapStyle
    map.eachLayer((layer) => {
      if (layer instanceof L.TileLayer) {
        map.removeLayer(layer);
      }
    });

    let tileUrl = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    let attribution = '&copy; <a href="https://carto.com/">CARTO</a> OpenStreetMap';

    if (mapStyle === 'osm') {
      tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      attribution = '&copy; OpenStreetMap contributors';
    } else if (mapStyle === 'satellite') {
      tileUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      attribution = '&copy; Esri &mdash; Earthstar Geographics';
    }

    L.tileLayer(tileUrl, {
      attribution,
      maxZoom: 19,
    }).addTo(map);

    // Invalidate size on mount for responsive containers
    setTimeout(() => {
      map.invalidateSize();
    }, 250);

    return () => {
      // Map cleanup if container is destroyed
    };
  }, [mapStyle]);

  // Update Markers when assets or selectedAsset changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Clear previous markers
    const currentMarkers = markersRef.current;
    for (const key in currentMarkers) {
      if (Object.prototype.hasOwnProperty.call(currentMarkers, key)) {
        currentMarkers[key]?.remove();
      }
    }
    markersRef.current = {};

    filteredAssets.forEach((asset) => {
      const [lat, lng] = asset.location;
      const isSelected = selectedAsset?.id === asset.id;

      // Status color styling
      let badgeColor = '#10B981'; // Active Green
      let statusBg = 'bg-emerald-500';
      if (asset.status === 'Idle') {
        badgeColor = '#F59E0B'; // Amber
        statusBg = 'bg-amber-500';
      } else if (asset.status === 'Under Maintenance') {
        badgeColor = '#EF4444'; // Red
        statusBg = 'bg-rose-500';
      }

      // Equipment type icon abbreviation
      const typeAbbr = asset.type === 'Excavator' ? 'EX' : asset.type === 'Bulldozer' ? 'DZ' : asset.type === 'Crane' ? 'CR' : 'GR';

      // Custom Leaflet DivIcon with Caterpillar styling
      const customIcon = L.divIcon({
        className: 'custom-cat-marker',
        html: `
          <div class="relative cursor-pointer transition-transform duration-200 ${isSelected ? 'scale-125 z-50' : 'hover:scale-110'}">
            <!-- Pin Container -->
            <div class="w-10 h-10 rounded-2xl bg-neutral-900 shadow-lg border-2 ${isSelected ? 'border-[#FFCD00] ring-4 ring-[#FFCD00]/30' : 'border-white'} flex flex-col items-center justify-center text-white relative">
              <span class="text-[10px] font-black tracking-tighter text-[#FFCD00]">${typeAbbr}</span>
              <span class="text-[8px] font-mono text-neutral-300 -mt-1">${asset.id.replace('EQX', '')}</span>
              
              <!-- Status Dot -->
              <span class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full ${statusBg} border-2 border-white shadow-xs"></span>
            </div>
            <!-- Pin Triangle Arrow -->
            <div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-neutral-900 mx-auto -mt-0.5"></div>
          </div>
        `,
        iconSize: [40, 48],
        iconAnchor: [20, 48],
        popupAnchor: [0, -48],
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);

      marker.on('click', () => {
        onSelectAsset(asset);
        map.setView([lat, lng], 8, { animate: true });
      });

      markersRef.current[asset.id] = marker;
    });
  }, [filteredAssets, selectedAsset, onSelectAsset]);

  return (
    <div className="space-y-4">
      {/* Top Filter and Search Control Bar */}
      <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-black/5 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              id="asset-search-input"
              type="text"
              placeholder="Search ID, Model, Site, Operator..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl text-xs bg-neutral-100/90 border border-neutral-200/80 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#FFCD00]/50 transition-all"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-neutral-100/80 p-1 rounded-xl border border-neutral-200/60 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
                statusFilter === 'all' ? 'bg-white text-neutral-900 shadow-2xs' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              All ({assets.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-all ${
                statusFilter === 'active' ? 'bg-white text-emerald-700 shadow-2xs font-semibold' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Active
            </button>
            <button
              onClick={() => setStatusFilter('idle')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-all ${
                statusFilter === 'idle' ? 'bg-white text-amber-700 shadow-2xs font-semibold' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Idle
            </button>
            <button
              onClick={() => setStatusFilter('under maintenance')}
              className={`px-2.5 py-1 rounded-lg font-medium flex items-center gap-1 transition-all ${
                statusFilter === 'under maintenance' ? 'bg-white text-rose-700 shadow-2xs font-semibold' : 'text-neutral-500 hover:text-neutral-800'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
              Alert / Maint
            </button>
          </div>

          {/* Machine Type Filter */}
          <select
            id="machine-type-filter"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl text-xs bg-neutral-100/90 border border-neutral-200/80 text-neutral-700 font-medium focus:outline-none focus:ring-2 focus:ring-[#FFCD00]/50"
          >
            <option value="all">All Equipment Types</option>
            <option value="excavator">Excavators</option>
            <option value="bulldozer">Bulldozers</option>
            <option value="crane">Hydraulic Cranes</option>
            <option value="grader">Motor Graders</option>
          </select>
        </div>

        {/* Map Layers Mode Toggle */}
        <div className="flex items-center gap-1 bg-neutral-100/80 p-1 rounded-xl border border-neutral-200/60 text-xs">
          <button
            onClick={() => setMapStyle('carto')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              mapStyle === 'carto' ? 'bg-white text-neutral-900 shadow-2xs font-semibold' : 'text-neutral-500'
            }`}
          >
            Clean Map
          </button>
          <button
            onClick={() => setMapStyle('satellite')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              mapStyle === 'satellite' ? 'bg-white text-neutral-900 shadow-2xs font-semibold' : 'text-neutral-500'
            }`}
          >
            Satellite View
          </button>
          <button
            onClick={() => setMapStyle('osm')}
            className={`px-2.5 py-1 rounded-lg font-medium transition-all ${
              mapStyle === 'osm' ? 'bg-white text-neutral-900 shadow-2xs font-semibold' : 'text-neutral-500'
            }`}
          >
            OSM
          </button>
        </div>
      </div>

      {/* Main Map + Asset Drawer Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        
        {/* Left Side: Leaflet Interactive Map View */}
        <div className="lg:col-span-8 bg-white p-2 rounded-2xl border border-black/5 shadow-xs overflow-hidden relative">
          <div 
            ref={mapContainerRef} 
            className="w-full h-[540px] rounded-xl bg-neutral-100 relative z-10"
          />

          {/* Quick Map Overlay Summary Badge */}
          <div className="absolute bottom-5 left-5 z-20 bg-neutral-950/85 backdrop-blur-md text-white px-3.5 py-2.5 rounded-xl border border-white/10 shadow-lg text-xs flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#10B981] animate-ping" />
              <span className="font-semibold text-neutral-200">Active Geofences: 6 Sites</span>
            </div>
            <div className="h-3 w-px bg-neutral-700" />
            <div className="text-neutral-400">
              Showing <span className="font-bold text-[#FFCD00]">{filteredAssets.length}</span> of {assets.length} Assets
            </div>
          </div>
        </div>

        {/* Right Side: Selected Asset Inspector Card / Fleet Carousel */}
        <div className="lg:col-span-4 space-y-4">
          {selectedAsset ? (
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-4 animate-fadeIn">
              {/* Card Top Title & Close */}
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-md">
                      {selectedAsset.id}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        selectedAsset.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : selectedAsset.status === 'Idle'
                          ? 'bg-amber-50 text-amber-700 border border-amber-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      }`}
                    >
                      {selectedAsset.status}
                    </span>
                  </div>
                  <h2 className="text-base font-bold text-neutral-900 mt-1">
                    {selectedAsset.model}
                  </h2>
                  <p className="text-xs text-neutral-500 flex items-center gap-1 mt-0.5">
                    <Building2 className="w-3.5 h-3.5 text-neutral-400" />
                    {selectedAsset.site_name}
                  </p>
                </div>

                <button
                  onClick={() => onSelectAsset(null)}
                  className="text-xs text-neutral-400 hover:text-neutral-700 p-1"
                >
                  ✕
                </button>
              </div>

              {/* Anomaly Alerts on this Machine */}
              {selectedAsset.anomalies.length > 0 && (
                <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                    Telematics & Utilization Flags:
                  </div>
                  {selectedAsset.anomalies.map((anom, idx) => (
                    <p key={idx} className="text-[11px] text-amber-800 leading-snug">
                      • {anom}
                    </p>
                  ))}
                </div>
              )}

              {/* Key Metrics Grid */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* Engine Runtime */}
                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="flex items-center justify-between text-neutral-500 text-[11px]">
                    <span>Engine Work</span>
                    <Clock className="w-3 h-3 text-emerald-600" />
                  </div>
                  <div className="text-sm font-bold text-neutral-900 mt-1">
                    {selectedAsset.engine_hours_day} <span className="text-xs font-normal text-neutral-500">hrs/day</span>
                  </div>
                  <div className="text-[10px] text-neutral-400 mt-0.5">
                    Operating: {selectedAsset.operating_days} days
                  </div>
                </div>

                {/* Idle Hours */}
                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="flex items-center justify-between text-neutral-500 text-[11px]">
                    <span>Idle Standby</span>
                    <Clock className="w-3 h-3 text-amber-500" />
                  </div>
                  <div className="text-sm font-bold text-neutral-900 mt-1">
                    {selectedAsset.idle_hours_day} <span className="text-xs font-normal text-neutral-500">hrs/day</span>
                  </div>
                  <div className="text-[10px] text-amber-600 font-medium mt-0.5">
                    {selectedAsset.idle_hours_day > 8 ? '⚠️ Critical Idling' : 'Standard'}
                  </div>
                </div>

                {/* Fuel Level */}
                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="flex items-center justify-between text-neutral-500 text-[11px]">
                    <span>Fuel Level</span>
                    <Fuel className="w-3 h-3 text-neutral-600" />
                  </div>
                  <div className="text-sm font-bold text-neutral-900 mt-1 flex items-baseline gap-1">
                    <span>{selectedAsset.fuel_level_pct}%</span>
                    <span className="text-[10px] font-normal text-neutral-500">({selectedAsset.fuel_burn_rate_lph} L/h)</span>
                  </div>
                  {/* Progress bar */}
                  <div className="w-full h-1.5 bg-neutral-200 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        selectedAsset.fuel_level_pct > 50 ? 'bg-emerald-500' : selectedAsset.fuel_level_pct > 25 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${selectedAsset.fuel_level_pct}%` }}
                    />
                  </div>
                </div>

                {/* Health & Maintenance */}
                <div className="bg-neutral-50 p-3 rounded-xl border border-neutral-100">
                  <div className="flex items-center justify-between text-neutral-500 text-[11px]">
                    <span>Cat Health</span>
                    <Gauge className="w-3 h-3 text-blue-600" />
                  </div>
                  <div className="text-sm font-bold text-neutral-900 mt-1">
                    {selectedAsset.health_score}%
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">
                    Next service: {selectedAsset.next_maintenance_hours}h
                  </div>
                </div>
              </div>

              {/* Assigned Operator & Contract details */}
              <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-neutral-500 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-neutral-400" />
                    Operator:
                  </span>
                  <span className="font-semibold text-neutral-800">
                    {selectedAsset.operator_name || (
                      <span className="text-rose-600 font-bold">Unassigned (NULL)</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Rental Lease:</span>
                  <span className="font-mono text-neutral-700">
                    {selectedAsset.checkout_date} → {selectedAsset.checkin_date}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-neutral-500">Day Rate:</span>
                  <span className="font-bold text-neutral-900">
                    ${selectedAsset.rental_rate_daily.toLocaleString()}/day
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {selectedAsset.status === 'Active' ? (
                  <button
                    onClick={() => onCheckInOut(selectedAsset, 'checkin')}
                    className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-neutral-900 text-white hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Check-In / Return</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onCheckInOut(selectedAsset, 'checkout')}
                    className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-[#FFCD00] text-neutral-950 hover:bg-[#F5C400] transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                  >
                    <span>Deploy / Check-Out</span>
                  </button>
                )}

                <button
                  onClick={() => onInspect(selectedAsset)}
                  className="w-full py-2 px-3 rounded-xl text-xs font-bold bg-white text-neutral-800 border border-neutral-200 hover:bg-neutral-50 transition-colors shadow-2xs cursor-pointer flex items-center justify-center gap-1"
                >
                  <Shield className="w-3.5 h-3.5 text-neutral-600" />
                  <span>Inspect Condition</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="bg-white p-5 rounded-2xl border border-black/5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-neutral-900">
                  Fleet Roster ({filteredAssets.length})
                </h2>
                <span className="text-[11px] text-neutral-400">Click any unit to focus</span>
              </div>

              <div className="divide-y divide-neutral-100 max-h-[460px] overflow-y-auto pr-1">
                {filteredAssets.map((asset) => (
                  <div
                    key={asset.id}
                    onClick={() => {
                      onSelectAsset(asset);
                      if (mapInstanceRef.current) {
                        mapInstanceRef.current.setView(asset.location, 8, { animate: true });
                      }
                    }}
                    className="py-2.5 px-2 rounded-xl hover:bg-neutral-50 transition-colors cursor-pointer flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-neutral-900 text-[#FFCD00] flex items-center justify-center font-bold text-xs">
                        {asset.type === 'Excavator' ? 'EX' : asset.type === 'Bulldozer' ? 'DZ' : asset.type === 'Crane' ? 'CR' : 'GR'}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-neutral-900">
                            {asset.id}
                          </span>
                          <span className="text-xs font-medium text-neutral-600">
                            • {asset.model}
                          </span>
                        </div>
                        <div className="text-[11px] text-neutral-400 truncate max-w-[170px]">
                          {asset.site_name}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <div className="text-right hidden sm:block">
                        <div className="text-[9px] uppercase tracking-wider text-neutral-400 font-semibold">Due Back</div>
                        <div className="text-[11px] font-mono font-semibold text-neutral-700">{asset.checkin_date}</div>
                      </div>
                      <span
                        className={`w-2 h-2 rounded-full ${
                          asset.status === 'Active'
                            ? 'bg-emerald-500'
                            : asset.status === 'Idle'
                            ? 'bg-amber-500'
                            : 'bg-rose-500'
                        }`}
                      />
                      <ChevronRight className="w-4 h-4 text-neutral-300 group-hover:text-neutral-700 transition-colors" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
