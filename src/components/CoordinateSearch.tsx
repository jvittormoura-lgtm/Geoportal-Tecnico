import React, { useState, useEffect, useRef } from 'react';
import { Crosshair, X, AlertTriangle, Navigation, Zap } from 'lucide-react';
import { 
  parseCoordinateInput, 
  CoordinateParseResult,
  UtmZone,
  dmsToDecimal,
  formatCoordinates,
  isWithinSaoPauloBounds
} from '../utils/coordinateParser';

interface CoordinateSearchProps {
  onLocateCoordinate: (result: CoordinateParseResult) => void;
  getMapCenter?: () => { lat: number; lng: number } | null;
}

type TabType = 'paste' | 'gms';

export const CoordinateSearch: React.FC<CoordinateSearchProps> = ({ 
  onLocateCoordinate,
  getMapCenter 
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('paste');

  // Mode 1: Universal Smart Paste
  const [inputVal, setInputVal] = useState('');
  const [parsedPreview, setParsedPreview] = useState<CoordinateParseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Mode 2: Structured GMS inputs (for typing without getting lost in symbols)
  const [latDeg, setLatDeg] = useState('23');
  const [latMin, setLatMin] = useState('33');
  const [latSec, setLatSec] = useState('01.8');
  const [latDir, setLatDir] = useState<'S' | 'N'>('S');

  const [lngDeg, setLngDeg] = useState('46');
  const [lngMin, setLngMin] = useState('37');
  const [lngSec, setLngSec] = useState('59.9');
  const [lngDir, setLngDir] = useState<'W' | 'E'>('W');

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded && activeTab === 'paste' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded, activeTab]);

  // Click outside and Escape key handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Real-time parsing preview for Universal Paste with Auto Fuso Detection
  useEffect(() => {
    if (!inputVal.trim()) {
      setParsedPreview(null);
      setErrorMessage(null);
      return;
    }

    const mapCenter = getMapCenter?.();
    const res = parseCoordinateInput(inputVal, 'auto', mapCenter?.lng);
    if (res.success) {
      setParsedPreview(res);
      setErrorMessage(null);
    } else {
      setParsedPreview(null);
      setErrorMessage((res as { error: string }).error || 'Formato de coordenada não reconhecido.');
    }
  }, [inputVal, getMapCenter]);

  // Live calculation for GMS auto-zone based on Longitude
  const currentGmsLngVal = React.useMemo(() => {
    const gd = parseFloat(lngDeg) || 0;
    const gm = parseFloat(lngMin) || 0;
    const gs = parseFloat(lngSec.replace(',', '.')) || 0;
    return dmsToDecimal(gd, gm, gs, lngDir);
  }, [lngDeg, lngMin, lngSec, lngDir]);
  const gmsAutoZone: UtmZone = currentGmsLngVal < -48.0 ? 22 : 23;

  const handleExecuteFreeSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputVal.trim()) return;

    const mapCenter = getMapCenter?.();
    const res = parseCoordinateInput(inputVal, 'auto', mapCenter?.lng);
    if (res.success) {
      onLocateCoordinate(res);
      setIsExpanded(false);
    } else {
      setErrorMessage((res as { error: string }).error || 'Formato de coordenada não reconhecido.');
    }
  };

  const handleExecuteGmsSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const ld = parseFloat(latDeg);
    const lm = parseFloat(latMin);
    const ls = parseFloat(latSec.replace(',', '.'));

    const gd = parseFloat(lngDeg);
    const gm = parseFloat(lngMin);
    const gs = parseFloat(lngSec.replace(',', '.'));

    if (isNaN(ld) || isNaN(lm) || isNaN(ls) || isNaN(gd) || isNaN(gm) || isNaN(gs)) {
      setErrorMessage('Preencha todos os campos sexagesimais com valores numéricos válidos.');
      return;
    }

    const lat = dmsToDecimal(ld, lm, ls, latDir);
    const lng = dmsToDecimal(gd, gm, gs, lngDir);

    const autoZone: UtmZone = lng < -48.0 ? 22 : 23;
    const formatted = formatCoordinates(lat, lng, autoZone);
    const inSP = isWithinSaoPauloBounds(lat, lng);

    const result: CoordinateParseResult = {
      success: true,
      lat,
      lng,
      format: 'GMS',
      detectedType: `Graus-Minutos-Segundos (Fuso ${autoZone}S Auto)`,
      zone: autoZone,
      isAutoZone: true,
      zoneReason: `Calculado da Longitude (${lng.toFixed(4)}°)`,
      warning: inSP ? undefined : 'Ponto fora dos limites do Estado de São Paulo.',
      formatted
    };

    onLocateCoordinate(result);
    setIsExpanded(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex flex-col items-center justify-center w-11 h-11 rounded-lg transition-colors ${
          isExpanded ? 'bg-red-50 text-red-600' : 'text-slate-700 hover:text-red-600 hover:bg-slate-100'
        }`}
        title="Buscador Universal de Coordenadas (UTM, GMS, Decimal)"
      >
        <Crosshair className="w-4 h-4 mb-0.5" />
        <span className="text-[8px] font-bold tracking-widest leading-none">COORD</span>
      </button>

      {isExpanded && (
        <div className="absolute top-0 left-[110%] ml-2 w-80 sm:w-96 z-[1001] bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden flex flex-col text-slate-800">
          
          {/* Header */}
          <div className="px-3.5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-red-600" />
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Buscador de Coordenadas
              </span>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded-md transition-colors"
              title="Fechar"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Mode Switcher: 2 Clean Options (Colar Texto vs Digitar GMS) in Red theme */}
          <div className="flex border-b border-slate-200 bg-slate-100/70 p-1 gap-1">
            <button
              type="button"
              onClick={() => { setActiveTab('paste'); setErrorMessage(null); }}
              className={`flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-all ${
                activeTab === 'paste' 
                  ? 'bg-white text-red-700 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Colar Texto (UTM / DD)
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('gms'); setErrorMessage(null); }}
              className={`flex-1 py-1.5 px-2 text-[11px] font-semibold rounded-lg transition-all ${
                activeTab === 'gms' 
                  ? 'bg-white text-red-700 shadow-xs' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Digitar GMS (° ' ")
            </button>
          </div>

          {/* Tab 1: Universal Smart Input */}
          {activeTab === 'paste' && (
            <form onSubmit={handleExecuteFreeSearch} className="p-3.5 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Cole ou digite qualquer coordenada
                </label>
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder="Ex: 438263 7447040 ou -23.5505 -46.6333"
                    className="w-full h-10 px-3 pr-8 bg-white border border-slate-300 rounded-lg text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500 transition-all"
                  />
                  {inputVal && (
                    <button
                      type="button"
                      onClick={() => setInputVal('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      title="Limpar"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Real-time Recognition Preview with Auto Fuso Detection */}
              {parsedPreview && (
                <div className="p-2.5 bg-red-50/50 border border-red-200 rounded-lg flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-red-900 uppercase tracking-wider">
                      Formato Reconhecido:
                    </span>
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-white text-red-700 border border-red-200 rounded-md">
                        {parsedPreview.format}
                      </span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-600 text-white rounded-md flex items-center gap-0.5">
                        <Zap className="w-2.5 h-2.5" />
                        Fuso {parsedPreview.zone}S
                      </span>
                    </div>
                  </div>

                  <div className="text-[11px] font-mono text-slate-700 leading-tight">
                    {parsedPreview.detectedType}
                  </div>

                  {parsedPreview.zoneReason && (
                    <div className="text-[10px] text-red-700 font-medium">
                      🎯 {parsedPreview.zoneReason}
                    </div>
                  )}

                  <div className="text-[11px] font-mono font-bold text-slate-900">
                    Lat: {parsedPreview.lat.toFixed(5)}° · Lng: {parsedPreview.lng.toFixed(5)}°
                  </div>

                  {parsedPreview.warning && (
                    <div className="flex items-center gap-1.5 text-[10px] text-amber-700 font-medium mt-0.5">
                      <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>{parsedPreview.warning}</span>
                    </div>
                  )}
                </div>
              )}

              {errorMessage && (
                <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700">
                  {errorMessage}
                </div>
              )}

              {/* Action Button */}
              <button
                type="submit"
                disabled={!inputVal.trim()}
                className="w-full py-2 px-4 bg-red-600 hover:bg-red-500 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-lg text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-2"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Localizar Ponto no Mapa</span>
              </button>
            </form>
          )}

          {/* Tab 2: Structured GMS Form */}
          {activeTab === 'gms' && (
            <form onSubmit={handleExecuteGmsSearch} className="p-3.5 flex flex-col gap-3">
              {/* Latitude GMS */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Latitude (Graus ° Minutos ' Segundos ")
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={latDeg}
                    onChange={(e) => setLatDeg(e.target.value)}
                    placeholder="23"
                    className="w-14 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">°</span>
                  <input
                    type="number"
                    value={latMin}
                    onChange={(e) => setLatMin(e.target.value)}
                    placeholder="33"
                    className="w-14 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">'</span>
                  <input
                    type="text"
                    value={latSec}
                    onChange={(e) => setLatSec(e.target.value)}
                    placeholder="01.8"
                    className="flex-1 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">"</span>
                  <select
                    value={latDir}
                    onChange={(e) => setLatDir(e.target.value as any)}
                    className="h-8 px-2 bg-slate-100 border border-slate-300 rounded text-xs font-bold text-slate-700"
                  >
                    <option value="S">S (Sul)</option>
                    <option value="N">N (Norte)</option>
                  </select>
                </div>
              </div>

              {/* Longitude GMS */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Longitude (Graus ° Minutos ' Segundos ")
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={lngDeg}
                    onChange={(e) => setLngDeg(e.target.value)}
                    placeholder="46"
                    className="w-14 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">°</span>
                  <input
                    type="number"
                    value={lngMin}
                    onChange={(e) => setLngMin(e.target.value)}
                    placeholder="37"
                    className="w-14 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">'</span>
                  <input
                    type="text"
                    value={lngSec}
                    onChange={(e) => setLngSec(e.target.value)}
                    placeholder="59.9"
                    className="flex-1 h-8 px-2 bg-white border border-slate-300 rounded text-xs font-mono text-center focus:ring-1 focus:ring-red-500"
                  />
                  <span className="text-xs font-bold text-slate-400">"</span>
                  <select
                    value={lngDir}
                    onChange={(e) => setLngDir(e.target.value as any)}
                    className="h-8 px-2 bg-slate-100 border border-slate-300 rounded text-xs font-bold text-slate-700"
                  >
                    <option value="W">W (Oeste)</option>
                    <option value="E">E (Leste)</option>
                  </select>
                </div>
              </div>

              {errorMessage && (
                <div className="p-2 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-700">
                  {errorMessage}
                </div>
              )}

              <button
                type="submit"
                className="w-full py-2 px-4 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-bold transition-colors shadow-xs flex items-center justify-center gap-2"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Localizar Ponto Sexagesimal</span>
              </button>
            </form>
          )}

        </div>
      )}
    </div>
  );
};
