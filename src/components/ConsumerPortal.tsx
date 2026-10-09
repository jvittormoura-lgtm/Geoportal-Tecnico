import React, { useMemo, useState } from 'react';
import { 
  Search, Building, Home, Filter, ChevronUp, ChevronDown, Trees, Calendar, CheckCircle2, AlertCircle, X, BarChart3
} from 'lucide-react';
import { GisLayer, BasemapOption, AppMode } from '../types/gis';
import { DualRangeSlider } from './DualRangeSlider';
import { 
  extractFeaturesMetrics, 
  matchSmartSearch, 
  extractUhFromProperties,
  normalizeSearchText,
  extractYearFromProperties,
  filterFeatures,
  getFeatureMunicipio,
  getFeatureProtocolo,
  getFeatureDisplayProtocolo,
  getFeatureDispensa,
  getFeatureSituacao,
  isSituacaoProperty
} from '../utils/geoJsonParser';

interface ConsumerPortalProps {
  layers: GisLayer[];
  onSelectFeature: (feature: GeoJSON.Feature) => void;
  onFilterChange: (
    municipio: string, 
    empreendedor: string, 
    protocolo: string, 
    dispensa: string, 
    anoRange: [number, number] | null,
    situacao?: string
  ) => void;
  municipioFilter: string;
  empreendedorFilter: string;
  protocoloFilter: string;
  dispensaFilter: string;
  anoFilter: [number, number] | null;
  situacaoFilter?: string;
  onOpenGlobalFilters: () => void;
  globalFiltersCount: number;
  onClearGlobalFilters: () => void;
  onClearAllFilters?: () => void;
  activeBasemap?: BasemapOption;
  onSelectBasemap?: (basemap: BasemapOption) => void;
  appMode?: AppMode;
}

export const ConsumerPortal: React.FC<ConsumerPortalProps> = ({
  layers,
  onSelectFeature,
  onFilterChange,
  municipioFilter,
  empreendedorFilter,
  protocoloFilter,
  dispensaFilter,
  anoFilter,
  situacaoFilter = '',
  onOpenGlobalFilters,
  globalFiltersCount,
  onClearGlobalFilters,
  onClearAllFilters,
}) => {
  const [showAnoFilter, setShowAnoFilter] = useState(false);
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(true);
  const [isResultsExpanded, setIsResultsExpanded] = useState(true);
  const [isResultsDismissed, setIsResultsDismissed] = useState(false);

  // Extract all features from visible layers after applying layer filters
  const allFeatures = useMemo(() => {
    const list: GeoJSON.Feature[] = [];
    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        const visibleFeatures = filterFeatures(l.data.features, l.filters);
        list.push(...visibleFeatures);
      }
    });
    return list;
  }, [layers]);

  // Extract unique municipalities in the dataset (normalized & sorted)
  // Extract from raw visible features to ensure the dropdown NEVER collapses when a filter is applied
  const municipalities = useMemo(() => {
    const map = new Map<string, string>(); // normKey -> displayKey
    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        l.data.features.forEach(f => {
          const p = f.properties || {};
          const rawMun = getFeatureMunicipio(p);
          if (rawMun && rawMun.trim()) {
            const trimmed = rawMun.trim();
            const norm = normalizeSearchText(trimmed);
            if (!map.has(norm)) {
              map.set(norm, trimmed);
            }
          }
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [layers]);

  // Extract unique protocols and dispensas from raw features so suggestions never vanish
  const protocolosList = useMemo(() => {
    const set = new Set<string>();
    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        l.data.features.forEach(f => {
          const p = f.properties || {};
          const rawProt = getFeatureProtocolo(p);
          if (rawProt && rawProt.trim()) {
            // Protocolo é estritamente sequencial desde o início: sem /ano
            const seq = String(rawProt).trim().split('/')[0].trim();
            if (seq) {
              set.add(seq);
            }
          }
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [layers]);

  const dispensasList = useMemo(() => {
    const set = new Set<string>();
    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        l.data.features.forEach(f => {
          const p = f.properties || {};
          const rawDisp = getFeatureDispensa(p);
          if (rawDisp && rawDisp.trim()) {
            set.add(rawDisp.trim());
          }
        });
      }
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [layers]);

  // Extract global available year range from all raw features in visible layers
  // This avoids collapsing the range when an active year filter is applied (preventing 2020-2022 lockup)
  const globalAnoRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        l.data.features.forEach(f => {
          const p = f.properties || {};
          const numAno = extractYearFromProperties(p);
          if (numAno !== null) {
            if (numAno < min) min = numAno;
            if (numAno > max) max = numAno;
          }
        });
      }
    });
    // Se nenhum ano for encontrado em todo o dataset, mostrar um range padrão (ex: 2000 a ano atual)
    if (min === Infinity || max === -Infinity) {
      const currentYear = new Date().getFullYear();
      return [2000, currentYear] as [number, number];
    }
    if (min === max) {
      return [min - 1, max + 1] as [number, number];
    }
    return [min, max] as [number, number];
  }, [layers]);

  // Key metrics calculation using coherent extractor for 'ÁREA TOTAL DA GLEBA/M²' & 'Nº DE LOTES UNIDADES HABITACIONAIS'
  const stats = useMemo(() => {
    return extractFeaturesMetrics(allFeatures);
  }, [allFeatures]);

  // Contagem dinâmica de empreendimentos por Situação (Dispensado, Certificado, Em Análise, etc.)
  const situacaoCounts = useMemo(() => {
    let total = 0;
    let dispensados = 0;
    let certificados = 0;
    let analise = 0;
    let cancelados = 0;

    // Filtros base contextuais (município, empreendedor, ano), mantendo situação aberta para ver a distribuição
    const baseFilters: any[] = [];
    if (municipioFilter.trim()) {
      baseFilters.push({ id: 'cnt_mun', property: '*', type: 'string', operator: 'match_municipio', value: municipioFilter.trim(), active: true });
    }
    if (empreendedorFilter.trim()) {
      baseFilters.push({ id: 'cnt_emp', property: '*', type: 'string', operator: 'match_empreendedor', value: empreendedorFilter.trim(), active: true });
    }
    if (protocoloFilter.trim()) {
      baseFilters.push({ id: 'cnt_prot', property: '*', type: 'string', operator: 'match_protocolo', value: protocoloFilter.trim(), active: true });
    }
    if (dispensaFilter.trim()) {
      baseFilters.push({ id: 'cnt_disp', property: '*', type: 'string', operator: 'match_dispensa', value: dispensaFilter.trim(), active: true });
    }
    if (anoFilter) {
      baseFilters.push({ id: 'cnt_ano', property: '*', type: 'number', operator: 'match_ano_entrada', value: anoFilter, active: true });
    }

    layers.filter(l => l.visible).forEach(l => {
      if (l.data && l.data.features) {
        // Mantém filtros manuais de atributos que não sejam de situação
        const layerManualFilters = (l.filters || []).filter(f => !f.id.startsWith('search_') && !isSituacaoProperty(f.property));
        const combined = [...layerManualFilters, ...baseFilters];
        const feats = filterFeatures(l.data.features, combined);

        feats.forEach(f => {
          total++;
          const p = f.properties || {};
          const rawSit = getFeatureSituacao(p);
          const norm = normalizeSearchText(rawSit);
          const hasDisp = Boolean(getFeatureDispensa(p));

          if (norm.includes('CANCELAD') || norm.includes('INDEFER') || norm.includes('REVOGAD') || norm.includes('CASSAD')) {
            cancelados++;
          } else if (norm.includes('DISPENS') || hasDisp) {
            dispensados++;
          } else if (norm.includes('CERTIFICAD') || norm.includes('APROVAD')) {
            certificados++;
          } else if (norm.includes('ANALIS') || norm.includes('EXIGENC') || norm.includes('TRAMIT')) {
            analise++;
          } else {
            // Empreendimentos com tramitação ativa
            analise++;
          }
        });
      }
    });

    return {
      total,
      dispensados,
      certificados,
      analise,
      cancelados
    };
  }, [layers, municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, anoFilter]);

  // Handler para clicar em um card de situação no painel
  const handleSituacaoCardClick = (targetSit: string) => {
    if (!targetSit) {
      onFilterChange(municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, anoFilter, '');
      return;
    }

    const currentNorm = normalizeSearchText(situacaoFilter);
    const targetNorm = normalizeSearchText(targetSit);

    const isCertSelected = (targetNorm.includes('CERTIFICAD') || targetNorm.includes('APROVAD')) && (currentNorm.includes('CERTIFICAD') || currentNorm.includes('APROVAD'));
    const isDispSelected = targetNorm.includes('DISPENS') && currentNorm.includes('DISPENS');
    const isAnaliseSelected = (targetNorm.includes('ANALIS') || targetNorm.includes('EXIGENC')) && (currentNorm.includes('ANALIS') || currentNorm.includes('EXIGENC'));
    const isCanceladoSelected = (targetNorm.includes('CANCELAD') || targetNorm.includes('INDEFER')) && (currentNorm.includes('CANCELAD') || currentNorm.includes('INDEFER'));

    // Se clicar no que já está selecionado, desseleciona (volta a ver todos)
    if (
      currentNorm === targetNorm || 
      isCertSelected || 
      isDispSelected || 
      isAnaliseSelected || 
      isCanceladoSelected
    ) {
      onFilterChange(municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, anoFilter, '');
      return;
    }

    // Se selecionar DISPENSADO, limpa protocoloFilter conflitante; se selecionar não-dispensa, limpa dispensaFilter conflitante
    const isDisp = targetNorm.includes('DISPENS');
    const isNonDisp = targetNorm.includes('CERTIFICAD') || targetNorm.includes('ANALIS');
    onFilterChange(
      municipioFilter,
      empreendedorFilter,
      isDisp ? '' : protocoloFilter,
      isNonDisp ? '' : dispensaFilter,
      anoFilter,
      targetSit
    );
  };

  const hasTextSearch = Boolean(municipioFilter.trim() || empreendedorFilter.trim() || protocoloFilter.trim() || dispensaFilter.trim() || situacaoFilter.trim());
  const hasQuickFilter = hasTextSearch || !!anoFilter;
  const hasLayerFilters = layers.some(l => l.filters && l.filters.length > 0);
  const hasAnyFilter = hasQuickFilter || globalFiltersCount > 0 || hasLayerFilters;

  // Filtered matching list for quick dropdown / preview:
  // Auto-expand when text query, quick filter, or advanced filters are active
  const filteredList = useMemo(() => {
    if (!hasTextSearch && globalFiltersCount === 0 && !hasLayerFilters) return [];
    return allFeatures;
  }, [allFeatures, hasTextSearch, globalFiltersCount, hasLayerFilters]);

  const previewList = useMemo(() => {
    return filteredList.slice(0, 40);
  }, [filteredList]);

  // Reset dismissed state whenever user alters search inputs
  React.useEffect(() => {
    setIsResultsDismissed(false);
  }, [municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, situacaoFilter]);

  const handleClearAll = () => {
    setShowAnoFilter(false);
    setIsResultsDismissed(true);
    onFilterChange('', '', '', '', null, '');
    if (onClearGlobalFilters) {
      onClearGlobalFilters();
    }
    if (onClearAllFilters) {
      onClearAllFilters();
    }
  };

  return (
    <div className="bg-slate-50/95 backdrop-blur-md border-b-2 border-red-600/20 px-4 sm:px-6 py-2.5 text-xs text-slate-900 z-20 shadow-md">
      <div className="w-full flex flex-col gap-2.5">
        {/* Panel Header */}
        <div 
          className="flex items-center justify-between text-red-700 font-bold px-1 cursor-pointer select-none"
          onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
        >
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            <span className="text-[13px] uppercase tracking-wide">Filtros & Situação dos Empreendimentos</span>
          </div>
          <div className="p-1 hover:bg-slate-200/50 rounded-full transition-colors">
            {isFiltersExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>

        {isFiltersExpanded && (
          <>
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2 duration-300">
            {/* PAINEL DE SITUAÇÃO DOS EMPREENDIMENTOS (Alinhamento perfeitamente sincronizado em 2 linhas de 36px) */}
            <div className="flex items-center gap-2.5 xl:border-r xl:border-slate-300/80 xl:pr-3.5 shrink-0">
              {/* Identificação / Bloco de Título e Total Geral (h-[80px]) */}
              <div className="flex flex-col justify-between h-[80px] p-2 bg-white/90 border border-slate-300/80 rounded-xl shadow-2xs min-w-[110px] shrink-0">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-5 bg-red-100/90 text-red-600 rounded-lg flex items-center justify-center shrink-0">
                      <BarChart3 className="w-3 h-3" />
                    </div>
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider leading-none">
                      Situação
                    </span>
                  </div>
                  {situacaoFilter && (
                    <button
                      type="button"
                      onClick={() => handleSituacaoCardClick('')}
                      className="p-0.5 text-slate-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                      title="Limpar filtro de situação e ver todos"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div>
                  <div className="text-base font-black text-slate-900 leading-tight">
                    {situacaoFilter ? allFeatures.length.toLocaleString('pt-BR') : situacaoCounts.total.toLocaleString('pt-BR')}
                  </div>
                  <div className="text-[10px] font-medium text-slate-500 leading-tight truncate">
                    {situacaoFilter ? `de ${situacaoCounts.total.toLocaleString('pt-BR')} filtrados` : 'empreendimentos'}
                  </div>
                </div>
              </div>

              {/* Grid 2x2 Estético de KPIs por Situação (2 linhas de h-9 perfeitamente alinhadas com os inputs) */}
              <div className="grid grid-cols-2 gap-2 h-[80px]">
                {/* Linha 1, Coluna 1: CERTIFICADOS */}
                <button
                  type="button"
                  onClick={() => handleSituacaoCardClick('CERTIFICADO')}
                  className={`h-9 px-2.5 rounded-xl border text-xs transition-all shadow-2xs cursor-pointer min-w-[145px] sm:min-w-[155px] flex items-center justify-between gap-2 ${
                    normalizeSearchText(situacaoFilter).includes('CERTIFICAD') || normalizeSearchText(situacaoFilter).includes('APROVAD')
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-950 font-bold ring-2 ring-emerald-500/20'
                      : 'bg-white/90 hover:bg-emerald-50/50 border-slate-300/80 text-slate-700'
                  }`}
                  title="Clique para filtrar apenas processos CERTIFICADOS"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                    <span className="text-xs font-semibold whitespace-nowrap text-slate-700">Certificados:</span>
                  </div>
                  <span className="font-mono font-bold text-xs bg-emerald-100/90 text-emerald-800 px-1.5 py-0.5 rounded-md shrink-0">
                    {situacaoCounts.certificados.toLocaleString('pt-BR')}
                  </span>
                </button>

                {/* Linha 1, Coluna 2: EM ANÁLISE */}
                <button
                  type="button"
                  onClick={() => handleSituacaoCardClick('Em Análise')}
                  className={`h-9 px-2.5 rounded-xl border text-xs transition-all shadow-2xs cursor-pointer min-w-[145px] sm:min-w-[155px] flex items-center justify-between gap-2 ${
                    normalizeSearchText(situacaoFilter).includes('ANALIS') || normalizeSearchText(situacaoFilter).includes('EXIGENC')
                      ? 'bg-blue-50 border-blue-500 text-blue-950 font-bold ring-2 ring-blue-500/20'
                      : 'bg-white/90 hover:bg-blue-50/50 border-slate-300/80 text-slate-700'
                  }`}
                  title="Clique para filtrar apenas processos EM ANÁLISE"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0" />
                    <span className="text-xs font-semibold whitespace-nowrap text-slate-700">Em Análise:</span>
                  </div>
                  <span className="font-mono font-bold text-xs bg-blue-100/90 text-blue-800 px-1.5 py-0.5 rounded-md shrink-0">
                    {situacaoCounts.analise.toLocaleString('pt-BR')}
                  </span>
                </button>

                {/* Linha 2, Coluna 1: DISPENSADOS */}
                <button
                  type="button"
                  onClick={() => handleSituacaoCardClick('DISPENSADO')}
                  className={`h-9 px-2.5 rounded-xl border text-xs transition-all shadow-2xs cursor-pointer min-w-[145px] sm:min-w-[155px] flex items-center justify-between gap-2 ${
                    normalizeSearchText(situacaoFilter).includes('DISPENS')
                      ? 'bg-orange-50 border-orange-500 text-orange-950 font-bold ring-2 ring-orange-500/20'
                      : 'bg-white/90 hover:bg-orange-50/50 border-slate-300/80 text-slate-700'
                  }`}
                  title="Clique para filtrar apenas processos DISPENSADOS"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
                    <span className="text-xs font-semibold whitespace-nowrap text-slate-700">Dispensados:</span>
                  </div>
                  <span className="font-mono font-bold text-xs bg-orange-100/90 text-orange-800 px-1.5 py-0.5 rounded-md shrink-0">
                    {situacaoCounts.dispensados.toLocaleString('pt-BR')}
                  </span>
                </button>

                {/* Linha 2, Coluna 2: CANCELADOS */}
                <button
                  type="button"
                  onClick={() => handleSituacaoCardClick('Cancelado')}
                  className={`h-9 px-2.5 rounded-xl border text-xs transition-all shadow-2xs cursor-pointer min-w-[145px] sm:min-w-[155px] flex items-center justify-between gap-2 ${
                    normalizeSearchText(situacaoFilter).includes('CANCELAD') || normalizeSearchText(situacaoFilter).includes('INDEFER') || normalizeSearchText(situacaoFilter).includes('REVOGAD')
                      ? 'bg-rose-50 border-rose-500 text-rose-950 font-bold ring-2 ring-rose-500/20'
                      : 'bg-white/90 hover:bg-rose-50/50 border-slate-300/80 text-slate-700'
                  }`}
                  title="Clique para filtrar processos CANCELADOS / INDEFERIDOS"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
                    <span className="text-xs font-semibold whitespace-nowrap text-slate-700">Cancelados:</span>
                  </div>
                  <span className="font-mono font-bold text-xs bg-rose-100/90 text-rose-800 px-1.5 py-0.5 rounded-md shrink-0">
                    {situacaoCounts.cancelados.toLocaleString('pt-BR')}
                  </span>
                </button>
              </div>
            </div>

            {/* Container de Filtros de Busca (Grid 2x2 perfeitamente alinhado em 2 linhas de h-9) */}
            <div className="flex-1 flex flex-col md:flex-row gap-2.5 items-stretch relative">
              {/* Grid 2x2 dos 4 Campos de Busca Textual (Colunas 100% alinhadas verticalmente) */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {/* Coluna 1, Linha 1: Município */}
                <div className="relative z-50 flex items-center h-9">
                  <select
                    value={municipioFilter}
                    onChange={(e) => onFilterChange(e.target.value, empreendedorFilter, protocoloFilter, dispensaFilter, anoFilter, situacaoFilter)}
                    className="w-full h-9 px-3 pr-8 bg-white/90 border border-slate-300/80 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-red-600 transition-all shadow-2xs appearance-none cursor-pointer"
                  >
                    <option value="">Todos Municípios</option>
                    {municipalities.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                  {municipioFilter ? (
                    <button
                      type="button"
                      onClick={() => onFilterChange('', empreendedorFilter, protocoloFilter, dispensaFilter, anoFilter, situacaoFilter)}
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Limpar município"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  ) : null}
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-500 text-[10px]">
                    ▼
                  </div>
                </div>

                {/* Coluna 2, Linha 1: Empreendedor */}
                <div className="relative z-50 flex items-center h-9">
                  <input
                    type="text"
                    placeholder="Empreendedor / Interessado"
                    value={empreendedorFilter}
                    onChange={(e) => onFilterChange(municipioFilter, e.target.value, protocoloFilter, dispensaFilter, anoFilter, situacaoFilter)}
                    className="w-full h-9 px-3 pr-7 bg-white/90 border border-slate-300/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 transition-all shadow-2xs"
                  />
                  {empreendedorFilter && (
                    <button
                      type="button"
                      onClick={() => onFilterChange(municipioFilter, '', protocoloFilter, dispensaFilter, anoFilter, situacaoFilter)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Limpar empreendedor"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Coluna 1, Linha 2: Protocolo (Alinhado exatamente abaixo de Município) */}
                <div className="relative z-50 flex items-center h-9">
                  <input
                    type="text"
                    placeholder="Nº Protocolo (ex: 17197)"
                    value={protocoloFilter}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Protocolo e Dispensa são mutualmente exclusivos
                      onFilterChange(municipioFilter, empreendedorFilter, val, val ? '' : dispensaFilter, anoFilter, situacaoFilter);
                    }}
                    className="w-full h-9 px-3 pr-7 bg-white/90 border border-slate-300/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 transition-all shadow-2xs"
                    list="protocolos-datalist"
                  />
                  {protocoloFilter && (
                    <button
                      type="button"
                      onClick={() => onFilterChange(municipioFilter, empreendedorFilter, '', dispensaFilter, anoFilter, situacaoFilter)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Limpar protocolo"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <datalist id="protocolos-datalist">
                    {protocolosList.map(p => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>

                {/* Coluna 2, Linha 2: Dispensa (Alinhado exatamente abaixo de Empreendedor) */}
                <div className="relative z-50 flex items-center h-9">
                  <input
                    type="text"
                    placeholder="Nº Dispensa (ex: 123/2024)"
                    value={dispensaFilter}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Protocolo e Dispensa são mutualmente exclusivos
                      onFilterChange(municipioFilter, empreendedorFilter, val ? '' : protocoloFilter, val, anoFilter, situacaoFilter);
                    }}
                    className="w-full h-9 px-3 pr-7 bg-white/90 border border-slate-300/80 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-red-600 transition-all shadow-2xs"
                    list="dispensas-datalist"
                  />
                  {dispensaFilter && (
                    <button
                      type="button"
                      onClick={() => onFilterChange(municipioFilter, empreendedorFilter, protocoloFilter, '', anoFilter, situacaoFilter)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Limpar dispensa"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <datalist id="dispensas-datalist">
                    {dispensasList.map(p => (
                      <option key={p} value={p} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Coluna de Ações e Controles (2 linhas de h-9 sincronizadas com o grid) */}
              <div className="flex flex-row md:flex-col justify-between gap-2 shrink-0">
                {/* Linha 1 de Botões: Filtros Avançados + Limpar */}
                <div className="flex items-center gap-1.5 h-9">
                  <button
                    onClick={onOpenGlobalFilters}
                    className={`h-9 px-3 rounded-xl text-xs flex items-center gap-1.5 transition-colors border shadow-2xs cursor-pointer shrink-0 ${
                      globalFiltersCount > 0
                        ? 'bg-indigo-50 border-indigo-500/40 text-indigo-700 font-semibold ring-1 ring-indigo-500/20'
                        : 'bg-white/90 border-slate-300/80 text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                    title="Filtros Avançados Globais"
                  >
                    <Filter className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="whitespace-nowrap">Avançados</span>
                    {globalFiltersCount > 0 && (
                      <span className="px-1.5 py-0.5 bg-indigo-600 text-[10px] text-white rounded-full font-mono leading-none">
                        {globalFiltersCount}
                      </span>
                    )}
                  </button>

                  {hasAnyFilter && (
                    <button
                      onClick={handleClearAll}
                      className="h-9 px-3 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0 shadow-2xs cursor-pointer"
                      title="Limpar todos os filtros da busca"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Limpar</span>
                    </button>
                  )}
                </div>

                {/* Linha 2 de Botões: Filtro de Ano */}
                <div className="flex items-center gap-1.5 h-9">
                  {globalAnoRange && (
                    <div className="relative z-50 flex items-center shrink-0 h-9">
                      <button
                        type="button"
                        onClick={() => setShowAnoFilter(!showAnoFilter)}
                        className={`h-9 px-3 rounded-xl flex items-center gap-1.5 shrink-0 transition-all border shadow-2xs text-xs cursor-pointer ${
                          anoFilter
                            ? 'bg-red-50 border-red-500 text-red-700 font-semibold ring-1 ring-red-500/20'
                            : showAnoFilter
                            ? 'bg-slate-100 border-slate-400 text-slate-900'
                            : 'bg-white/90 border-slate-300/80 text-slate-700 hover:text-slate-900 hover:bg-slate-50'
                        }`}
                        title="Filtro por Ano de Entrada"
                      >
                        <Calendar className="w-3.5 h-3.5 text-red-600" />
                        <span className="whitespace-nowrap">
                          {anoFilter ? `${anoFilter[0]}–${anoFilter[1]}` : 'Filtrar Ano'}
                        </span>
                      </button>

                      {anoFilter && (
                        <button
                          type="button"
                          onClick={() => onFilterChange(municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, null, situacaoFilter)}
                          className="ml-1 p-1 text-slate-400 hover:text-red-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                          title="Remover filtro de ano"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {showAnoFilter && (
                        <>
                          <div 
                            className="fixed inset-0 z-40 bg-transparent" 
                            onClick={() => setShowAnoFilter(false)} 
                          />
                          <div className="absolute top-full right-0 mt-2 w-[290px] sm:w-[320px] z-50 animate-in fade-in zoom-in-95 duration-150">
                            <DualRangeSlider
                              min={globalAnoRange[0]}
                              max={globalAnoRange[1]}
                              value={anoFilter}
                              onChange={(value) => {
                                onFilterChange(municipioFilter, empreendedorFilter, protocoloFilter, dispensaFilter, value, situacaoFilter);
                              }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Search Preview Results Popup (Vertical Dropdown) */}
              {(hasQuickFilter || globalFiltersCount > 0 || hasLayerFilters) && !isResultsDismissed && filteredList.length > 0 && (
                <div className="absolute top-full left-0 w-full md:w-[420px] mt-2 bg-white/95 backdrop-blur-xl border border-slate-300/80 rounded-xl shadow-2xl flex flex-col p-1.5 gap-0.5 overflow-hidden z-[100]">
                  <div className="px-2 pt-1 pb-1.5 mb-1 border-b border-slate-200/80 text-[10px] text-slate-500 font-semibold uppercase tracking-wider flex items-center justify-between">
                    <span>Resultados da Busca</span>
                    <div className="flex items-center gap-1.5">
                      <span>{filteredList.length} encontrados</span>
                      <button 
                        onClick={() => setIsResultsExpanded(!isResultsExpanded)}
                        className="p-1 hover:bg-slate-200/50 rounded-md transition-colors text-slate-400 hover:text-slate-600 cursor-pointer"
                        title={isResultsExpanded ? "Recolher resultados" : "Expandir resultados"}
                      >
                        {isResultsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      <button 
                        onClick={() => setIsResultsDismissed(true)}
                        className="p-1 hover:bg-slate-200/50 rounded-md transition-colors text-slate-400 hover:text-slate-600 cursor-pointer"
                        title="Fechar pré-visualização"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  
                  <div className={`overflow-y-auto results-scrollbar transition-all duration-300 ease-in-out ${isResultsExpanded ? 'max-h-[350px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <div className="flex flex-col gap-0.5">
                  {previewList.map((f, idx) => {
                    const p = f.properties || {};
                    
                    let title = 'Sem identificação';
                    const rawProt = getFeatureProtocolo(p);
                    const rawDisp = getFeatureDispensa(p);
                    const dispProt = getFeatureDisplayProtocolo(p);

                    if (rawProt) {
                      title = `Protocolo ${dispProt}`;
                    } else if (rawDisp) {
                      title = `Dispensa ${rawDisp}`;
                    } else if (p['NOME DO EMPREENDIMENTO'] || p.nome_empreendimento || p.empreendimento) {
                      title = String(p['NOME DO EMPREENDIMENTO'] || p.nome_empreendimento || p.empreendimento);
                    }

                    let badge = null;

                    const rawSit = getFeatureSituacao(p);
                    if (rawSit) {
                      const normSit = normalizeSearchText(rawSit);
                      let badgeClass = 'bg-blue-500/10 text-blue-600 border-blue-500/20';
                      if (normSit.includes('cancelad') || normSit.includes('indefer') || normSit.includes('revogad')) {
                        badgeClass = 'bg-rose-500/10 text-rose-600 border-rose-500/20';
                      } else if (normSit.includes('aprovad') || normSit.includes('certificad')) {
                        badgeClass = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20';
                      } else if (normSit.includes('analis') || normSit.includes('exigenc') || normSit.includes('tramit')) {
                        badgeClass = 'bg-amber-500/10 text-amber-600 border-amber-500/20';
                      } else if (normSit.includes('dispens')) {
                        badgeClass = 'bg-orange-500/10 text-orange-600 border-orange-500/20';
                      }
                      badge = (
                        <span className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md text-[8px] border font-semibold ml-2 shrink-0 ${badgeClass}`}>
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          {rawSit}
                        </span>
                      );
                    } else if (rawProt) {
                      badge = (
                        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md bg-emerald-500/10 text-emerald-600 text-[8px] border border-emerald-500/20 font-semibold ml-2 shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Aprovado
                        </span>
                      );
                    } else if (rawDisp) {
                      badge = (
                        <span className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md bg-orange-500/10 text-orange-600 text-[8px] border border-orange-500/20 font-semibold ml-2 shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Dispensado
                        </span>
                      );
                    }

                    const mun = p.municipio || p.cidade || p.MUNICIPIO || '';
                    const prop = p.PROPRIETARIO || p.proprietario || p.Proprietario || p.interessado_empreendedor || p.Interessado || p.INTERESSADO || '';
                    const uh = extractUhFromProperties(p);
                    
                    return (
                      <button
                        key={idx}
                        onClick={() => onSelectFeature(f)}
                        className="w-full text-left px-2.5 py-2 bg-transparent hover:bg-slate-100/80 rounded-lg text-slate-800 transition-colors flex items-center gap-2 group"
                        title={`Clique para centralizar no mapa: ${title}`}
                      >
                        <div className="p-1.5 bg-slate-100 group-hover:bg-red-50/60 rounded-md border border-slate-300 group-hover:border-red-600/30 transition-colors shrink-0">
                          <Building className="w-3.5 h-3.5 text-slate-500 group-hover:text-red-600 transition-colors" />
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col">
                          <div className="flex items-center">
                            <span className="font-semibold text-[11px] truncate">{title}</span>
                            {badge}
                          </div>
                          {(mun || prop) && (
                            <span className="text-[10px] text-slate-500 font-mono truncate">
                              {mun}
                              {mun && prop && ' • '}
                              {prop}
                            </span>
                          )}
                        </div>
                        {uh > 0 && (
                          <div className="flex flex-col items-end shrink-0 ml-2">
                            <span className="text-[8px] text-slate-500 uppercase tracking-wider mb-[2px]">Lotes/UH</span>
                            <span className="text-[10px] px-1.5 py-[1px] bg-red-50/40 text-red-500 rounded-md font-mono font-bold border border-red-600/20">
                              {uh}
                            </span>
                          </div>
                        )}
                      </button>
                    );
                  })}
                    </div>
                    {filteredList.length > previewList.length && (
                      <div className="px-3 py-1.5 text-[10px] text-slate-500 text-center bg-slate-50 border-t border-slate-200">
                        Exibindo os primeiros {previewList.length} de {filteredList.length} resultados. Todos estão visíveis no mapa.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Indicadores Globais / HUD Metrics (h-[80px] perfeitamente alinhado) */}
            <div className="flex items-center gap-3 xl:border-l xl:border-slate-300/80 xl:pl-4 shrink-0 h-[80px] self-center">
              <div className="text-right flex flex-col justify-center h-full">
                <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 uppercase font-mono">
                  <Home className="w-3 h-3 text-red-600" />
                  <span>Unidades/Lotes</span>
                </div>
                <span className="text-sm font-bold text-red-600 font-mono tracking-tight mt-0.5" title="Soma total do campo Nº de Unidades Habitacionais (UH)">
                  {stats.totalUh > 0 ? stats.totalUh.toLocaleString('pt-BR') : '0'} <span className="text-xs font-normal text-red-500">UH</span>
                </span>
              </div>

              <div className="w-px h-8 bg-slate-300/70" />

              <div className="text-right flex flex-col justify-center h-full">
                <div className="flex items-center justify-end gap-1 text-[10px] text-slate-500 uppercase font-mono">
                  <Trees className="w-3 h-3 text-emerald-600" />
                  <span>Área Mapeada</span>
                </div>
                <span className="text-sm font-bold text-emerald-600 font-mono tracking-tight mt-0.5" title={`Área total da gleba: ${stats.totalAreaM2.toLocaleString('pt-BR')} m²`}>
                  {stats.totalHectares} <span className="text-xs font-normal text-emerald-700">ha</span>
                </span>
              </div>
            </div>
          </div>
          </>
        )}
      </div>
    </div>
  );
};

