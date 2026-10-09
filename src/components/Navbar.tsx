import React, { useRef, useState } from 'react';
import { BasemapOption, GisLayer, AppMode } from '../types/gis';

import { 
  Upload, Download, Send, CheckCircle2
} from 'lucide-react';

interface NavbarProps {
  layers: GisLayer[];
  activeBasemap: BasemapOption;
  appMode?: AppMode;
  onOpenBasemapModal: () => void;
  onOpenExportModal: () => void;
  onLoadGeoJsonFile: (file: File) => void;
  onLoadSampleDataset?: (datasetId: string) => void;
  onRequireAuth?: (callback: () => void) => void;
  onPublishToPublic?: () => void;
  lastPublishedAt?: number | null;
  hasUnpublishedChanges?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  layers,
  activeBasemap,
  appMode = 'gestor',
  onOpenBasemapModal,
  onOpenExportModal,
  onLoadGeoJsonFile,
  onRequireAuth,
  onPublishToPublic,
  lastPublishedAt,
  hasUnpublishedChanges = false
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [publishSuccess, setPublishSuccess] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        onLoadGeoJsonFile(files[i]);
      }
      e.target.value = '';
    }
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

  const totalFeatures = layers.reduce((acc, l) => acc + l.featureCount, 0);
  const totalFiltered = layers.reduce((acc, l) => acc + l.filteredCount, 0);

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
    </header>
  );
};
