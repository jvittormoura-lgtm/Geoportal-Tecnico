import React, { useRef, useState } from 'react';
import { BasemapOption, GisLayer, AppMode } from '../types/gis';

import { 
  Upload, Download, Send, CheckCircle2, Layers, ShieldOff, X, FileText
} from 'lucide-react';

interface NavbarProps {
  layers: GisLayer[];
  activeBasemap: BasemapOption;
  onSelectBasemap?: (basemap: BasemapOption) => void;
  appMode?: AppMode;
  onOpenBasemapModal: () => void;
  onOpenExportModal: () => void;
  onLoadGeoJsonFile: (file: File, options?: { ignoreGlobalFilter?: boolean }) => void;
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
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [ignoreGlobalFilterOption, setIgnoreGlobalFilterOption] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const selectedFiles = Array.from(files);
      setPendingUploadFiles(selectedFiles);
      setIgnoreGlobalFilterOption(false);
      e.target.value = '';
    }
  };

  const handleConfirmUpload = () => {
    if (pendingUploadFiles.length === 0) return;
    for (let i = 0; i < pendingUploadFiles.length; i++) {
      onLoadGeoJsonFile(pendingUploadFiles[i], {
        ignoreGlobalFilter: ignoreGlobalFilterOption
      });
    }
    setPendingUploadFiles([]);
    setIgnoreGlobalFilterOption(false);
  };

  const handleCancelUpload = () => {
    setPendingUploadFiles([]);
    setIgnoreGlobalFilterOption(false);
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
    <>
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
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 shadow-amber-100 transition-all cursor-pointer whitespace-nowrap shrink-0"
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
            className="px-3 py-1.5 bg-emerald-100 hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed text-emerald-700 border border-emerald-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exportar (KML/SHP/CSV)</span>
          </button>

          {/* Save to Local Browser Storage Button */}
          {onPublishToPublic && (
            <button
              id="btn-publish-to-citizen"
              onClick={handlePublishClick}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-md transition-all whitespace-nowrap shrink-0 ${
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
      </header>

      {/* Quick Upload Configuration Modal */}
      {pendingUploadFiles.length > 0 && (
        <div
          id="upload-geojson-options-modal"
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={handleCancelUpload}
        >
          <div
            className="bg-white border border-slate-200 rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600 shrink-0" />
                <h3 className="text-sm font-bold text-slate-900">
                  Configurar Upload de Camada
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCancelUpload}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg transition-colors"
                title="Cancelar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected Files List */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-slate-600">
                {pendingUploadFiles.length === 1 ? 'Arquivo selecionado:' : `Arquivos selecionados (${pendingUploadFiles.length}):`}
              </span>
              <div className="max-h-28 overflow-y-auto bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                {pendingUploadFiles.map((file, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-xs text-slate-800">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                      <span className="font-medium truncate" title={file.name}>{file.name}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-500 shrink-0 tabular-nums">
                      {(file.size / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Checkbox Option: Exclude from Global Filter (Overlay Layer) */}
            <label
              htmlFor="chk-ignore-global-filter"
              className={`flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors select-none ${
                ignoreGlobalFilterOption
                  ? 'bg-amber-50/90 border-amber-400 text-slate-900'
                  : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-800'
              }`}
            >
              <input
                id="chk-ignore-global-filter"
                type="checkbox"
                checked={ignoreGlobalFilterOption}
                onChange={(e) => setIgnoreGlobalFilterOption(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-amber-600 rounded cursor-pointer shrink-0"
              />
              <div className="flex flex-col gap-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <ShieldOff className={`w-3.5 h-3.5 shrink-0 ${ignoreGlobalFilterOption ? 'text-amber-700' : 'text-slate-500'}`} />
                  <span className="text-xs font-semibold leading-snug">
                    Essa camada não faz parte do filtro global
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Ative para camadas de sobreposição e referência cartográfica. Bloqueia qualquer tipo de filtragem nesta camada para que 100% das suas feições permaneçam sempre visíveis no mapa.
                </p>
              </div>
            </label>

            {/* Modal Footer Controls */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={handleCancelUpload}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
              >
                Cancelar
              </button>
              <button
                id="btn-confirm-upload-geojson"
                type="button"
                onClick={handleConfirmUpload}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{pendingUploadFiles.length > 1 ? 'Subir Camadas' : 'Subir Camada'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

