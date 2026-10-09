import React from 'react';
import { AlertTriangle, Compass, CheckCircle2, X, ArrowRight, ShieldAlert } from 'lucide-react';

interface CrsWarningModalProps {
  isOpen: boolean;
  layerName: string;
  detectedCrs: string;
  warningMessage?: string;
  sampleCoords?: [number, number];
  onConfirmReproject: () => void;
  onCancel: () => void;
}

export const CrsWarningModal: React.FC<CrsWarningModalProps> = ({
  isOpen,
  layerName,
  detectedCrs,
  warningMessage,
  sampleCoords,
  onConfirmReproject,
  onCancel
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/80 w-full max-w-xl overflow-hidden flex flex-col scale-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        {/* Top Accent Strip */}
        <div className="h-1.5 w-full bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600" />

        {/* Modal Header */}
        <div className="px-6 pt-5 pb-4 bg-slate-50/80 border-b border-slate-200 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 text-amber-700 shadow-sm">
            <AlertTriangle className="w-6 h-6 stroke-[2.2]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                Padrão Cartográfico WGS84
              </span>
            </div>
            <h3 className="text-base font-bold text-slate-900 mt-1">
              Aviso: Arquivo fora do padrão WGS84 (EPSG:4326)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Camada de destino: <strong className="text-slate-800 font-semibold">{layerName}</strong>
            </p>
          </div>
          <button
            onClick={onCancel}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors -mr-1 -mt-1"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4 text-slate-700 text-xs sm:text-sm leading-relaxed">
          <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-3.5 flex gap-3 text-amber-900">
            <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-950 text-xs sm:text-sm">
                Conformidade Geoespacial Adotada: WGS84
              </p>
              <p className="text-xs text-amber-800 mt-0.5 leading-normal">
                O GeoPortal opera no padrão internacional <strong>WGS84 (EPSG:4326)</strong> em graus decimais [Longitude, Latitude].
                O arquivo selecionado possui coordenadas em outro sistema geodésico ou fora da ordem padrão.
              </p>
            </div>
          </div>

          {/* Technical Diagnostics Card */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2.5">
            <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/80">
              <span className="text-slate-500 font-medium flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-slate-400" /> CRS / Projeção Detectada:
              </span>
              <span className="font-mono font-bold text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                {detectedCrs}
              </span>
            </div>

            {sampleCoords && (
              <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-200/80">
                <span className="text-slate-500 font-medium">Amostra de Vértice (X, Y):</span>
                <span className="font-mono text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200">
                  [{sampleCoords[0].toLocaleString('pt-BR')}, {sampleCoords[1].toLocaleString('pt-BR')}]
                </span>
              </div>
            )}

            {warningMessage && (
              <div className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-200">
                <span className="font-semibold text-slate-800">Diagnóstico: </span>
                {warningMessage}
              </div>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Deseja que o motor geoespacial do portal <strong>converta automaticamente para WGS84</strong> para plotar as feições com precisão no mapa, ou prefere cancelar para ajustar seu arquivo no QGIS/ArcGIS?
          </p>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/70 rounded-xl transition-colors border border-slate-300 sm:border-transparent text-center"
          >
            Cancelar Atualização
          </button>
          <button
            onClick={onConfirmReproject}
            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="w-4 h-4" />
            Converter para WGS84 e Atualizar
          </button>
        </div>
      </div>
    </div>
  );
};
