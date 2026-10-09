import React, { useState, useMemo, useEffect } from 'react';
import { GisLayer, AttributeFilter, FilterOperator } from '../types/gis';
import { 
  Filter, Plus, Trash2, CheckCircle2, SlidersHorizontal, Map, X, 
  MapPin, Building, ChevronDown, ChevronUp, Layers, Sparkles, AlertCircle, ArrowRight
} from 'lucide-react';
import { 
  filterFeatures, 
  extractUhFromProperties, 
  getFeatureProtocolo, 
  getFeatureDisplayProtocolo, 
  getFeatureDispensa, 
  getFeatureSituacao, 
  normalizeSearchText,
  isSituacaoProperty,
  extractPropertySchemas
} from '../utils/geoJsonParser';

interface FilterPanelProps {
  layer: GisLayer | null;
  allLayers?: GisLayer[];
  isOpen: boolean;
  onClose: () => void;
  onUpdateFilters: (layerId: string, filters: AttributeFilter[]) => void;
  onRequestPickRadiusCenter?: () => void;
  onSelectFeature?: (feature: GeoJSON.Feature) => void;
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  '=': 'Igual a (=)',
  '!=': 'Diferente de (!=)',
  '>': 'Maior que (>)',
  '>=': 'Maior ou igual (>=)',
  '<': 'Menor que (<)',
  '<=': 'Menor ou igual (<=)',
  'contains': 'Contém o texto',
  'startsWith': 'Começa com',
  'in': 'Está na lista (valores separados por vírgula)',
  'between': 'Está no intervalo (Entre Min e Max)',
  'isNull': 'É nulo / Vazio',
  'isNotNull': 'Não é nulo / Preenchido',
  'global_search': 'Busca Global',
  'match_municipio': 'Município (Busca)',
  'match_empreendedor': 'Empreendedor (Busca)',
  'match_protocolo': 'Protocolo (Busca)',
  'match_dispensa': 'Dispensa (Busca)',
  'match_ano_entrada': 'Ano de Entrada (Busca)',
  'match_status': 'Status (Busca)',
  'match_situacao': 'Situação (Busca)',
  'match_tipo_empreendimento': 'Tipo de Empreendimento (Busca)'
};

export const FilterPanel: React.FC<FilterPanelProps> = ({
  layer,
  allLayers = [],
  isOpen,
  onClose,
  onUpdateFilters,
  onSelectFeature
}) => {
  // Target layer ID: 'GLOBAL' for all layers or specific layer id
  const [targetLayerId, setTargetLayerId] = useState<string>('GLOBAL');

  const [filters, setFilters] = useState<AttributeFilter[]>([]);

  // New filter creation state
  const [newProp, setNewProp] = useState<string>('');
  const [newOp, setNewOp] = useState<FilterOperator>('contains');
  const [newVal, setNewVal] = useState<string>('');
  const [newSecVal, setNewSecVal] = useState<string>('');

  const [isResultsExpanded, setIsResultsExpanded] = useState(true);

  // Initialize targetLayerId when modal opens
  useEffect(() => {
    if (isOpen) {
      if (layer && layer.id !== 'GLOBAL') {
        setTargetLayerId(layer.id);
      } else {
        setTargetLayerId('GLOBAL');
      }
    }
  }, [isOpen, layer]);

  // Construct effective layer based on current targetLayerId
  const effectiveLayer = useMemo(() => {
    if (targetLayerId === 'GLOBAL') {
      const candidateLayers = allLayers.length > 0 ? allLayers : (layer ? [layer] : []);
      const visibleLayers = candidateLayers.filter(l => l.visible);
      const layersToUse = visibleLayers.length > 0 ? visibleLayers : candidateLayers;
      
      const allFeatures = layersToUse.flatMap(l => l.data?.features || []);
      const globalFeatureCount = layersToUse.reduce((acc, l) => acc + (l.data?.features?.length || 0), 0);
      const globalFilteredCount = layersToUse.reduce((acc, l) => acc + (l.filteredCount || 0), 0);
      const globalFilters = layersToUse[0]?.filters?.filter(f => !f.id.startsWith('search_')) || [];

      return {
        id: 'GLOBAL',
        name: 'Todas as Camadas (Global)',
        propertiesSchema: extractPropertySchemas(allFeatures),
        filters: globalFilters,
        featureCount: globalFeatureCount,
        filteredCount: globalFilteredCount,
        data: { features: allFeatures },
        type: 'polygon',
        visible: true,
        opacity: 1,
        style: {} as any
      } as unknown as GisLayer;
    }

    const found = allLayers.find(l => l.id === targetLayerId);
    return found || layer;
  }, [targetLayerId, allLayers, layer]);

  // List of property names that are already covered by main quick filters.
  const EXCLUDED_PROPS = useMemo(() => new Set([
    'municipio', 'MUNICIPIO', 'cidade', 'CIDADE', 'Municipio',
    'PROPRIETARIO', 'proprietario', 'Proprietario', 
    'PROTOCOLO', 'protocolo', 'Protocolo',
    'expediente_dispensa', 'dispensa', 'DISPENSA', 'Expediente Dispensa', 'EXPEDIENTE DISPENSA',
    'ANO ENTRADA', 'ANO', 'ano', 'Ano', 'ano_entrada', 'ANO_ENTRADA',
    'DATA DE ENTRADA', 'DATA DO CERTIFICADO', 'data', 'DATA', 'Data'
  ]), []);

  const filteredSchema = useMemo(() => {
    if (!effectiveLayer) return [];
    return effectiveLayer.propertiesSchema.filter(p => !EXCLUDED_PROPS.has(p.key));
  }, [effectiveLayer, EXCLUDED_PROPS]);

  // Sync state when effectiveLayer or isOpen changes
  useEffect(() => {
    if (effectiveLayer && isOpen) {
      setFilters(effectiveLayer.filters?.filter(f => !f.id.startsWith('search_')) || []);
      const initialProp = filteredSchema[0]?.key || '';
      setNewProp(initialProp);
      const schema = filteredSchema.find(p => p.key === initialProp);
      setNewOp(schema?.type === 'number' ? '>' : 'contains');
      setNewVal('');
      setNewSecVal('');
    }
  }, [effectiveLayer?.id, isOpen]);

  const filteredList = useMemo(() => {
    if (!effectiveLayer || !effectiveLayer.data?.features || filters.length === 0) return [];
    return filterFeatures(effectiveLayer.data.features, filters);
  }, [effectiveLayer, filters]);

  // Count dispensados across all candidate layers to guide user if single layer has 0 results
  const globalDispensadosCount = useMemo(() => {
    if (!allLayers || allLayers.length === 0) return 0;
    let count = 0;
    allLayers.forEach(l => {
      (l.data?.features || []).forEach(f => {
        if (getFeatureSituacao(f.properties || '') === 'DISPENSADO' || getFeatureDispensa(f.properties || '')) {
          count++;
        }
      });
    });
    return count;
  }, [allLayers]);

  if (!isOpen || !effectiveLayer) return null;

  const propSchema = effectiveLayer.propertiesSchema.find(p => p.key === newProp);

  // Generate intelligent suggestions for the currently selected property
  const suggestions = useMemo(() => {
    if (!newProp || newOp === 'isNull' || newOp === 'isNotNull') return [];
    const normProp = normalizeSearchText(newProp);

    // 1. Situação / Status: prominently include DISPENSADO and standard GRAPROHAB statuses
    if (normProp.includes('SITUAC') || normProp.includes('STATUS') || normProp === 'FASE' || normProp.includes('SITUACAO_DO_PROCESSO')) {
      const standardSit = [
        'DISPENSADO',
        'CERTIFICADO',
        'EM ANÁLISE',
        'COM EXIGÊNCIAS TÉCNICAS',
        'INDEFERIDO',
        'CANCELADO'
      ];
      const extras = (propSchema?.sampleValues || [])
        .map(v => String(v).trim())
        .filter(v => v && !standardSit.some(s => normalizeSearchText(s) === normalizeSearchText(v)));
      return [...standardSit, ...extras];
    }

    // 2. Tipologia da Construção
    if (normProp.includes('TIPOLOG')) {
      const standardTip = ['VERTICAL', 'HORIZONTAL', 'DE LOTES'];
      const extras = (propSchema?.sampleValues || [])
        .map(v => String(v).trim())
        .filter(v => v && !standardTip.includes(v.toUpperCase()));
      return [...standardTip, ...extras];
    }

    // 3. Tipo de Empreendimento
    if (normProp.includes('TIPO') && (normProp.includes('EMPREEND') || normProp.includes('BASE'))) {
      const standardTipos = [
        'Condomínio',
        'Loteamento Aberto',
        'Loteamento Fechado / Acesso Controlado',
        'Conjunto Habitacional HIS',
        'Desmembramento'
      ];
      const extras = (propSchema?.sampleValues || [])
        .map(v => String(v).trim())
        .filter(v => v && !standardTipos.some(st => normalizeSearchText(st) === normalizeSearchText(v)));
      return [...standardTipos, ...extras].slice(0, 8);
    }

    // 4. Ano de Entrada / Ano
    if (normProp.includes('ANO')) {
      if (propSchema?.sampleValues) {
        const years = propSchema.sampleValues
          .map(v => Number(v))
          .filter(v => !isNaN(v) && v >= 1990 && v <= 2035);
        const uniqueYears = Array.from(new Set(years)).sort((a: number, b: number) => b - a);
        if (uniqueYears.length > 0) return uniqueYears.slice(0, 8);
      }
      return [2026, 2024, 2023, 2022, 2021, 2020];
    }

    // 5. General sample values
    if (propSchema && propSchema.sampleValues) {
      const set = new Set<string>();
      propSchema.sampleValues.forEach(v => {
        if (v !== null && v !== undefined) {
          const str = String(v).trim();
          if (str && str !== 'null' && str !== 'undefined' && str !== 'NaN') {
            set.add(str);
          }
        }
      });
      return Array.from(set).slice(0, 8);
    }

    return [];
  }, [newProp, newOp, propSchema]);

  const handleAddFilter = () => {
    if (!newProp) return;
    if (newOp !== 'isNull' && newOp !== 'isNotNull' && newVal === '') return;

    const schema = effectiveLayer.propertiesSchema.find(p => p.key === newProp);
    const newFilter: AttributeFilter = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      property: newProp,
      type: schema?.type === 'number' ? 'number' : schema?.type === 'boolean' ? 'boolean' : 'string',
      operator: newOp,
      value: schema?.type === 'number' ? Number(newVal) : newVal,
      secondaryValue: newOp === 'between' ? Number(newSecVal) : undefined,
      active: true
    };

    const updated = [...filters, newFilter];
    setFilters(updated);
    setNewVal('');
    setNewSecVal('');
    saveChanges(updated);
  };

  const handleRemoveFilter = (id: string) => {
    const updated = filters.filter(f => f.id !== id);
    setFilters(updated);
    saveChanges(updated);
  };

  const handleToggleFilter = (id: string) => {
    const updated = filters.map(f => f.id === id ? { ...f, active: !f.active } : f);
    setFilters(updated);
    saveChanges(updated);
  };

  const handleClearAll = () => {
    setFilters([]);
    saveChanges([]);
  };

  const saveChanges = (currentFilters: AttributeFilter[]) => {
    onUpdateFilters(targetLayerId, currentFilters);
  };

  const handleSwitchTarget = (newTargetId: string) => {
    setTargetLayerId(newTargetId);
  };

  // Helper to switch to global filter with DISPENSADO
  const handleApplyDispensadoGlobally = () => {
    setTargetLayerId('GLOBAL');
    const dispensadoFilter: AttributeFilter = {
      id: 'f_disp_' + Date.now(),
      property: 'SITUAÇÃO',
      type: 'string',
      operator: 'contains',
      value: 'DISPENSADO',
      active: true
    };
    const updated = [dispensadoFilter];
    setFilters(updated);
    onUpdateFilters('GLOBAL', updated);
  };

  const applicableOperators: FilterOperator[] = propSchema?.type === 'number'
    ? ['=', '!=', '>', '>=', '<', '<=', 'between', 'isNull', 'isNotNull']
    : propSchema?.type === 'boolean'
    ? ['=', '!=', 'isNull', 'isNotNull']
    : ['contains', '=', '!=', 'startsWith', 'in', 'isNull', 'isNotNull'];

  const isFilteringDispensado = filters.some(f => 
    isSituacaoProperty(f.property) && 
    normalizeSearchText(String(f.value)).includes('DISPENS') && 
    f.active
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
      <div 
        id="filter-panel-modal"
        className="w-full max-w-2xl bg-white border border-slate-300/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white/95">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 text-indigo-600 rounded-lg">
              <Filter className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900">Filtragem Avançada de Atributos</h2>
                {targetLayerId === 'GLOBAL' && (
                  <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-md text-[10px] font-bold">
                    GLOBAL
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Feições ativas:{' '}
                <span className="text-emerald-600 font-mono font-bold">{effectiveLayer.filteredCount}</span> de{' '}
                <span className="font-mono text-slate-700">{effectiveLayer.featureCount}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {filters.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 hover:border-red-300 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                title="Limpar todos os filtros avançados"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Limpar Filtros</span>
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer" title="Fechar painel">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Layer Selector Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2 text-xs">
              <Layers className="w-4 h-4 text-indigo-500 shrink-0" />
              <span className="font-semibold text-slate-700">Camada Alvo:</span>
            </div>
            <div className="flex-1 sm:max-w-xs">
              <select
                value={targetLayerId}
                onChange={(e) => handleSwitchTarget(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 shadow-xs cursor-pointer"
              >
                <option value="GLOBAL">🌐 Todas as Camadas (Global)</option>
                {allLayers.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.featureCount} feições)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Add Filter Box */}
          <div className="p-4 bg-slate-100/70 rounded-xl border border-slate-300/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                Criar Nova Regra de Filtro
              </span>
              <span className="text-[11px] text-slate-500">
                Alvo: <strong className="text-slate-800">{effectiveLayer.name}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Field Select */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Campo de Atributo</label>
                <select
                  value={newProp}
                  onChange={(e) => {
                    setNewProp(e.target.value);
                    const sc = filteredSchema.find(p => p.key === e.target.value);
                    setNewOp(sc?.type === 'number' ? '>' : 'contains');
                  }}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
                >
                  {filteredSchema.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} ({p.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Operator Select */}
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Operador Lógico</label>
                <select
                  value={newOp}
                  onChange={(e) => setNewOp(e.target.value as FilterOperator)}
                  className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:border-indigo-500 cursor-pointer shadow-xs"
                >
                  {applicableOperators.map((op) => (
                    <option key={op} value={op}>{OPERATOR_LABELS[op]}</option>
                  ))}
                </select>
              </div>

              {/* Value input */}
              {newOp !== 'isNull' && newOp !== 'isNotNull' && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-600 mb-1">
                    {newOp === 'between' ? 'Valor Mínimo' : 'Valor do Filtro'}
                  </label>
                  {propSchema?.type === 'number' ? (
                    <input
                      type="number"
                      placeholder={propSchema.min !== undefined ? `Min: ${propSchema.min}` : 'Valor...'}
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-indigo-500 font-mono shadow-xs"
                    />
                  ) : propSchema?.type === 'boolean' ? (
                    <select
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-indigo-500 shadow-xs cursor-pointer"
                    >
                      <option value="">Selecione...</option>
                      <option value="true">Verdadeiro (True)</option>
                      <option value="false">Falso (False)</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      placeholder="Texto ou valor..."
                      value={newVal}
                      onChange={(e) => setNewVal(e.target.value)}
                      className="w-full px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-indigo-500 shadow-xs"
                    />
                  )}
                </div>
              )}
            </div>

            {/* If Between operator */}
            {newOp === 'between' && (
              <div>
                <label className="block text-[11px] font-medium text-slate-600 mb-1">Valor Máximo</label>
                <input
                  type="number"
                  placeholder={propSchema?.max !== undefined ? `Max: ${propSchema.max}` : 'Valor Max...'}
                  value={newSecVal}
                  onChange={(e) => setNewSecVal(e.target.value)}
                  className="w-full sm:w-1/3 px-2.5 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-indigo-500 font-mono shadow-xs"
                />
              </div>
            )}

            {/* Quick sample values / Suggestions buttons */}
            {suggestions.length > 0 && newOp !== 'isNull' && newOp !== 'isNotNull' && (
              <div className="pt-2 border-t border-slate-200/80">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Sugestões Disponíveis:</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {suggestions.map((sv, idx) => {
                    const strVal = String(sv);
                    const isSelected = newVal.trim().toLowerCase() === strVal.trim().toLowerCase();
                    const isDisp = strVal.toUpperCase().includes('DISPENS');
                    const isCert = strVal.toUpperCase().includes('CERTIFICAD') || strVal.toUpperCase().includes('APROVAD');

                    let buttonClass = 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300';
                    if (isSelected) {
                      buttonClass = 'bg-indigo-600 text-white font-bold border-indigo-600 shadow-xs';
                    } else if (isDisp) {
                      buttonClass = 'bg-orange-50 hover:bg-orange-100 text-orange-700 border-orange-300 font-semibold';
                    } else if (isCert) {
                      buttonClass = 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300 font-semibold';
                    }

                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setNewVal(strVal)}
                        className={`px-2.5 py-1 rounded-md text-xs border transition-all cursor-pointer ${buttonClass}`}
                        title={`Usar valor sugerido: ${strVal}`}
                      >
                        {strVal}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <button
              onClick={handleAddFilter}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/30 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Adicionar Regra de Filtro
            </button>
          </div>

          {/* Active Filters List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Filtros Ativos ({filters.length})
              </span>
              {filters.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-xs text-rose-600 hover:text-rose-800 flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar Todos
                </button>
              )}
            </div>

            {filters.length === 0 ? (
              <div className="p-5 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
                Nenhum filtro de atributo ativo nesta camada. Todas as {effectiveLayer.featureCount} feições estão ativas.
              </div>
            ) : (
              <div className="space-y-2">
                {filters.map((f) => (
                  <div
                    key={f.id}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                      f.active
                        ? 'bg-slate-50 border-indigo-300 text-slate-800 shadow-xs'
                        : 'bg-white border-slate-200 text-slate-400 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={f.active}
                        onChange={() => handleToggleFilter(f.id)}
                        className="w-4 h-4 rounded text-indigo-600 bg-white border-slate-300 cursor-pointer"
                      />
                      <div className="text-xs">
                        <span className="font-bold text-slate-900 font-mono">{f.property}</span>{' '}
                        <span className="text-indigo-600 font-medium">{OPERATOR_LABELS[f.operator]}</span>{' '}
                        {f.operator !== 'isNull' && f.operator !== 'isNotNull' && (
                          <strong className="text-amber-700 font-mono bg-amber-50 px-1 py-0.5 rounded border border-amber-200 ml-1">
                            {String(f.value)}
                            {f.secondaryValue !== undefined ? ` e ${f.secondaryValue}` : ''}
                          </strong>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleRemoveFilter(f.id)}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors cursor-pointer"
                      title="Excluir este filtro"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            {/* Resultados Preview */}
            {filters.length > 0 && filteredList.length > 0 && (
              <div className="mt-4 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xs">
                <div className="px-3 py-2 bg-slate-100 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                      Resultados Filtrados ({filteredList.length})
                    </span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-1.5 py-0.5 rounded">
                      {targetLayerId === 'GLOBAL' ? 'Global' : effectiveLayer.name}
                    </span>
                  </div>
                  <button 
                    onClick={() => setIsResultsExpanded(!isResultsExpanded)}
                    className="p-1 hover:bg-slate-200 rounded-md transition-colors text-slate-500 cursor-pointer"
                  >
                    {isResultsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>
                
                <div className={`overflow-y-auto results-scrollbar transition-all duration-300 ease-in-out ${isResultsExpanded ? 'max-h-[300px] opacity-100' : 'max-h-0 opacity-0'}`}>
                  <div className="flex flex-col gap-0.5 p-1">
                    {filteredList.map((f, idx) => {
                      const p = f.properties || {};
                      
                      const rawProt = getFeatureProtocolo(p);
                      const rawDisp = getFeatureDispensa(p);
                      const dispProt = getFeatureDisplayProtocolo(p);
                      const nomeEmp = p['NOME DO EMPREENDIMENTO'] || p.nome_empreendimento || p.empreendimento;

                      // Fix: Title determination prioritizes real project name, then dispensa/protocol
                      let title = 'Sem identificação';
                      if (nomeEmp && String(nomeEmp).trim()) {
                        title = String(nomeEmp).trim();
                      } else if (rawDisp) {
                        title = `Dispensa ${rawDisp}`;
                      } else if (rawProt) {
                        title = `Protocolo ${dispProt}`;
                      }

                      // Badge determination
                      let badge = null;
                      const rawSit = getFeatureSituacao(p);
                      if (rawSit) {
                        const normSit = normalizeSearchText(rawSit);
                        let badgeClass = 'bg-blue-500/10 text-blue-700 border-blue-500/20';
                        if (normSit.includes('CANCELAD') || normSit.includes('INDEFER') || normSit.includes('REVOGAD')) {
                          badgeClass = 'bg-rose-500/10 text-rose-700 border-rose-500/20';
                        } else if (normSit.includes('APROVAD') || normSit.includes('CERTIFICAD')) {
                          badgeClass = 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
                        } else if (normSit.includes('ANALIS') || normSit.includes('EXIGENC') || normSit.includes('TRAMIT')) {
                          badgeClass = 'bg-amber-500/10 text-amber-700 border-amber-500/20';
                        } else if (normSit.includes('DISPENS')) {
                          badgeClass = 'bg-orange-500/10 text-orange-700 border-orange-500/30 font-bold';
                        }
                        badge = (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-[1px] rounded-md text-[9px] border font-semibold ml-2 shrink-0 ${badgeClass}`}>
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            {rawSit}
                          </span>
                        );
                      }

                      const mun = p.municipio || p.cidade || p.MUNICIPIO || '';
                      const prop = p.PROPRIETARIO || p.proprietario || p.Proprietario || p.interessado_empreendedor || p.Interessado || p.INTERESSADO || '';
                      const uh = extractUhFromProperties(p);
                      
                      return (
                        <button
                          key={idx}
                          onClick={() => {
                            if (onSelectFeature) onSelectFeature(f);
                          }}
                          className="w-full text-left px-2.5 py-2 bg-transparent hover:bg-slate-100 rounded-lg text-slate-800 transition-colors flex items-center gap-2 group cursor-pointer"
                          title={`Clique para centralizar no mapa: ${title}`}
                        >
                          <div className="p-1.5 bg-slate-100 group-hover:bg-red-50 rounded-md border border-slate-300 group-hover:border-red-500/30 transition-colors shrink-0">
                            <Building className="w-3.5 h-3.5 text-slate-500 group-hover:text-red-600 transition-colors" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center">
                              <span className="text-[11px] font-bold text-slate-900 truncate">{title}</span>
                              {badge}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[9px] text-slate-500">
                              {rawDisp && (
                                <span className="font-semibold text-orange-600 bg-orange-50 px-1 rounded border border-orange-200">
                                  Disp: {rawDisp}
                                </span>
                              )}
                              {rawProt && !rawDisp && (
                                <span className="font-semibold text-emerald-600 bg-emerald-50 px-1 rounded border border-emerald-200">
                                  Prot: {dispProt}
                                </span>
                              )}
                              {mun && (
                                <span className="flex items-center gap-0.5 max-w-[120px] truncate" title={String(mun)}>
                                  <MapPin className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                                  <span className="truncate">{mun}</span>
                                </span>
                              )}
                              {prop && (
                                <span className="flex items-center gap-0.5 max-w-[150px] truncate" title={String(prop)}>
                                  <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0"></span>
                                  <span className="truncate">{prop}</span>
                                </span>
                              )}
                              {uh > 0 && (
                                <span className="flex items-center gap-0.5 font-semibold text-slate-600 ml-auto bg-slate-100 px-1 rounded">
                                  {uh.toLocaleString('pt-BR')} UHs
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Empty state & smart guidance if DISPENSADO filtered on single layer with 0 results */}
            {filters.length > 0 && filteredList.length === 0 && (
              <div className="mt-4 p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50 text-center space-y-2">
                <p className="text-xs text-slate-600 font-medium">Nenhum empreendimento nesta camada corresponde aos filtros aplicados.</p>
                
                {isFilteringDispensado && targetLayerId !== 'GLOBAL' && globalDispensadosCount > 0 && (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg text-left mt-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                      <div className="text-xs text-orange-900">
                        <strong className="block font-semibold">Procurando empreendimentos DISPENSADOS?</strong>
                        <span>
                          A camada <em>{effectiveLayer.name}</em> contém apenas processos protocolados.
                          Existem <strong>{globalDispensadosCount.toLocaleString('pt-BR')}</strong> empreendimentos com Situação DISPENSADO nas demais camadas.
                        </span>
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={handleApplyDispensadoGlobally}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md shadow-xs flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
                          >
                            <span>Aplicar a Todas as Camadas ({globalDispensadosCount.toLocaleString('pt-BR')} Dispensados)</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-white/95 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>
              Resultado instantâneo: <strong className="text-emerald-700">{filteredList.length}</strong> de <strong>{effectiveLayer.featureCount}</strong> feições
            </span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
