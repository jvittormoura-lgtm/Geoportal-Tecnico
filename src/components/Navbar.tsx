import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BasemapOption, GisLayer, AppMode } from '../types/gis';

import { 
  Upload, Download, Send, CheckCircle2, Layers, X, FileText, Filter
} from 'lucide-react';

interface NavbarProps {
  layers: GisLayer[];
  activeBasemap: BasemapOption;
  onSelectBasemap?: (basemap: BasemapOption) => void;
  appMode?: AppMode;
  onOpenBasemapModal: () => void;
  onOpenExportModal: () => void;
  onLoadGeoJsonFile: (file: File, options?: { ignoreGlobalFilters?: boolean }) => void;
  onLoadSampleDataset?: (datasetId: string) => void;
  onRequireAuth?: (callback: () => void) => void;
  onPublishToPublic?: () => void;
  lastPublishedAt?: number | null;
  hasUnpublishedChanges?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  layers,
  onOpenExportModal,
  onLoadGeoJsonFile,
  onPublishToPublic,
  hasUnpublishedChanges = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [ignoreGlobalFilters, setIgnoreGlobalFilters] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray: File[] = [];
      for (let i = 0; i < files.length; i++) {
        fileArray.push(files[i]);
      }
      setPendingFiles(fileArray);
      setIgnoreGlobalFilters(false);
      e.target.value = '';
    }
  };

  const handleConfirmUpload = () => {
    if (pendingFiles.length === 0) return;
    pendingFiles.forEach((file) => {
      onLoadGeoJsonFile(file, { ignoreGlobalFilters });
    });
    setPendingFiles([]);
    setIgnoreGlobalFilters(false);
  };

  const handleCancelUpload = () => {
    setPendingFiles([]);
    setIgnoreGlobalFilters(false);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handlePublishClick = () => {
    if (onPublishToPublic) {
      onPublishToPublic();
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 3000);
    }
  };

  return (
    <header 
      id="app-navbar"
      className="h-14 bg-slate-50 border-b border-slate-200 px-4 flex items-center justify-between select-none relative z-30 shrink-0"
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".geojson,.json,.kml,.csv"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Brand & Logo - GRAPROHAB SP */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex flex-col justify-center min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl sm:text-2xl tracking-tighter leading-none whitespace-nowrap">
                <span className="text-slate-900 font-black">Grapro</span><span className="text-red-600 font-black">h@b</span>
              </h1>
            </div>
            <span className="text-xs sm:text-sm text-slate-500 font-medium whitespace-nowrap truncate mt-0.5">
              GeoPortal Técnico
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Upload Button */}
        <button
          id="btn-upload-geojson"
          onClick={handleUploadClick}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 shadow-amber-100 transition-all cursor-pointer"
          title="Subir novos arquivos GeoJSON"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Subir Camada GeoJSON</span>
        </button>

        {/* Export Button */}
        <button
          id="btn-open-export-modal"
          onClick={onOpenExportModal}
          disabled={layers.length === 0}
          className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Exportar (KML/SHP/CSV)</span>
        </button>

        {/* Save to Local Browser Storage Button */}
        {onPublishToPublic && (
          <button
            id="btn-publish-to-citizen"
            onClick={handlePublishClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md transition-all ${
              publishSuccess 
                ? 'bg-emerald-500 text-slate-950 shadow-emerald-200' 
                : hasUnpublishedChanges
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-200 animate-pulse'
                : 'bg-emerald-600 hover:bg-emerald-500 text-slate-900 shadow-emerald-200'
            }`}
            title="Salvar alterações na memória do navegador"
          >
            {publishSuccess ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Salvo com Sucesso!</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>{hasUnpublishedChanges ? 'Salvar no navegador (Alterações)' : 'Salvar no navegador'}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Upload Options Modal */}
      {pendingFiles.length > 0 && createPortal(
        <div 
          className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          onClick={handleCancelUpload}
        >
          <div 
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 leading-tight">
                    Configurar Importação de Camada
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Defina o comportamento da camada no GeoPortal
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCancelUpload}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer"
                title="Cancelar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 space-y-4">
              {/* Selected Files List */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {pendingFiles.length === 1 ? 'Arquivo selecionado' : `Arquivos selecionados (${pendingFiles.length})`}
                </span>
                <div className="max-h-28 overflow-y-auto space-y-1 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
                  {pendingFiles.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs text-slate-700 font-medium truncate">
                      <FileText className="w-3.5 h-3.5 text-red-600 shrink-0" />
                      <span className="truncate">{f.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Checkbox Option: Ignore Global Filter */}
              <label 
                className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
                  ignoreGlobalFilters
                    ? 'bg-red-50/70 border-red-500 ring-1 ring-red-500/20'
                    : 'bg-white hover:bg-slate-50 border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={ignoreGlobalFilters}
                  onChange={(e) => setIgnoreGlobalFilters(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-red-600 rounded cursor-pointer shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                    <Filter className="w-3.5 h-3.5 text-red-600 shrink-0" />
                    <span>Essa camada não faz parte do filtro global</span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                    Ideal para camadas de sobreposição (ex: hidrografia, zoneamento, limites). Ela permanecerá visível durante buscas e não será somada nas contagens de empreendimentos.
                  </p>
                </div>
              </label>
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCancelUpload}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmUpload}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-200 flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Subir Camada{pendingFiles.length > 1 ? 's' : ''}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </header>
  );
};

