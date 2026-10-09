import React, { useState, useEffect } from 'react';
import { X, ArrowRight, AlertCircle, Database, Check, Link2, CheckCircle2 } from 'lucide-react';
import { GisLayer, PropertySchema } from '../types/gis';

interface FieldMappingModalProps {
  layer: GisLayer;
  newSchema: PropertySchema[];
  standardSchema?: PropertySchema[];
  onConfirm: (mapping: Record<string, string>) => void;
  onCancel: () => void;
}

// Known GIS and GRAPROHAB synonyms for intelligent automatic field mapping
const KNOWN_SYNONYMS: Record<string, string[]> = {
  'PROTOCOLO': ['protocolo', 'nu_protocolo', 'num_protocolo', 'n_protocolo', 'nr_protocolo', 'protocolo_num', 'processo'],
  'EXPEDIENTE DISPENSA': ['expediente', 'dispensa', 'expediente_dispensa', 'nu_dispensa', 'num_dispensa', 'processo_dispensa', 'expediente_num'],
  'MUNICIPIO': ['municipio', 'cidade', 'nm_municipio', 'nome_municipio', 'cd_municipio', 'nome_cidade', 'municipio_nome'],
  'PROPRIETARIO': ['proprietario', 'proprietaria', 'empreendedor', 'interessado', 'requerente', 'dono', 'empresa', 'nome_proprietario'],
  'NOME DO EMPREENDIMENTO': ['empreendimento', 'nome_empreendimento', 'nome_do_empreendimento', 'denominacao', 'local', 'titulo', 'nome_emp'],
  'SITUAÇÃO': ['situacao', 'status', 'fase', 'situacao_processo', 'estado', 'parecer'],
  'ANO ENTRADA': ['ano', 'ano_entrada', 'ano_exercicio', 'ano_processo'],
  'DATA DE ENTRADA': ['data_entrada', 'dt_entrada', 'data_de_entrada', 'entrada'],
  'DATA DO CERTIFICADO': ['data_certificado', 'dt_certificado', 'data_do_certificado', 'data_cert', 'dt_cert'],
  'Nº DO CERTIFICADO': ['num_certificado', 'numero_certificado', 'nr_certificado', 'n_certificado', 'certificado', 'no_certificado', 'cert'],
  'Nº DE UNIDADES HABITACIONAIS': ['unidades', 'unidades_habitacionais', 'uh', 'num_unidades', 'nr_unidades', 'qtd_unidades', 'unid_hab', 'unidades_hab'],
  'ÁREA TOTAL DA GLEBA/M²': ['area_gleba', 'area_total', 'gleba', 'area_m2', 'area', 'area_gleba_m2', 'area_terreno'],
  'LOCALIZAÇÃO/ENDEREÇO': ['endereco', 'localizacao', 'logradouro', 'rua', 'localizacao_endereco', 'end'],
  'TIPOLOGIA DA CONSTRUÇÃO': ['tipologia', 'tipo_construcao', 'tipologia_construcao', 'padrao_construcao'],
  'TIPO DE EMPREENDIMENTO': ['tipo_empreendimento', 'tipo', 'modalidade', 'categoria']
};

function normalizeForComparison(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export const FieldMappingModal: React.FC<FieldMappingModalProps> = ({
  layer,
  newSchema,
  standardSchema: explicitStandardSchema,
  onConfirm,
  onCancel
}) => {
  const [mapping, setMapping] = useState<Record<string, string>>({});

  // Obter o padrão oficial da camada
  const activeStandardSchema: PropertySchema[] = (explicitStandardSchema && explicitStandardSchema.length > 0)
    ? explicitStandardSchema
    : (layer.propertiesSchema && layer.propertiesSchema.length > 0)
      ? layer.propertiesSchema
      : (Array.isArray(layer.popupFieldOrder) && layer.popupFieldOrder.length > 0)
        ? layer.popupFieldOrder.map(f => ({ key: f, type: 'string', sampleValues: [] }))
        : [];

  useEffect(() => {
    const initialMapping: Record<string, string> = {};

    activeStandardSchema.forEach(stdProp => {
      const stdKey = stdProp.key;
      const cleanStd = normalizeForComparison(stdKey);

      // 1. Exact match
      let match = newSchema.find(n => n.key === stdKey);

      // 2. Normalized match (accents and lowercase)
      if (!match) {
        match = newSchema.find(n => normalizeForComparison(n.key) === cleanStd);
      }

      // 3. Known synonyms dictionary
      if (!match) {
        const synonyms = KNOWN_SYNONYMS[stdKey.toUpperCase()] || [];
        match = newSchema.find(n => {
          const cleanN = normalizeForComparison(n.key);
          return synonyms.some(syn => {
            const cleanSyn = normalizeForComparison(syn);
            return cleanN === cleanSyn || cleanN.includes(cleanSyn) || cleanSyn.includes(cleanN);
          });
        });
      }

      // 4. Substring match for longer strings
      if (!match && cleanStd.length >= 4) {
        match = newSchema.find(n => {
          const cleanN = normalizeForComparison(n.key);
          if (cleanN.length >= 4) {
            return cleanN.includes(cleanStd) || cleanStd.includes(cleanN);
          }
          return false;
        });
      }

      initialMapping[stdKey] = match ? match.key : '';
    });

    setMapping(initialMapping);
  }, [layer, newSchema, explicitStandardSchema]);

  const handleSelectChange = (stdKey: string, sourceKey: string) => {
    setMapping(prev => ({ ...prev, [stdKey]: sourceKey }));
  };

  const linkedCount = activeStandardSchema.filter(p => Boolean(mapping[p.key])).length;
  const totalCount = activeStandardSchema.length;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden max-h-[90vh] border border-slate-200">
        
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
              <Link2 className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Ligações de Campos com o Padrão da Camada</h2>
              <p className="text-xs text-slate-500">
                Camada: <span className="font-semibold text-slate-700">{layer.name}</span>
                <span className="mx-2 text-slate-300">•</span>
                <span className="text-blue-600 font-medium">{linkedCount} de {totalCount} campos vinculados</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onCancel} 
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 rounded-full transition-colors"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Alert: Padrão mantido, nada de somar campos */}
        <div className="bg-blue-50/90 border-b border-blue-100 px-6 py-3.5 flex gap-3 shrink-0">
          <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="text-xs text-blue-900 leading-relaxed space-y-1">
            <p>
              <strong>Padrão Oficial Mantido:</strong> O GeoPortal preserva estritamente os campos padrão desta camada. 
              <strong> Nenhum campo extra será adicionado</strong> à camada.
            </p>
            <p className="text-blue-800">
              Faça apenas as <strong>ligações</strong>: selecione qual coluna do arquivo novo corresponde a cada campo do padrão oficial.
            </p>
          </div>
        </div>

        {/* Table Area */}
        <div className="p-6 overflow-y-auto flex-1 bg-slate-50/40">
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
            <div className="grid grid-cols-2 bg-slate-100 border-b border-slate-200 px-4 py-3 text-xs font-bold text-slate-600 uppercase tracking-wider">
              <div className="flex items-center gap-2">
                <Database className="w-3.5 h-3.5 text-blue-600" />
                Campo Padrão da Camada
              </div>
              <div className="flex items-center gap-2">
                <Link2 className="w-3.5 h-3.5 text-emerald-600" />
                Coluna no Arquivo Enviado
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {activeStandardSchema.map(stdProp => {
                const mappedTo = mapping[stdProp.key];
                const isMapped = Boolean(mappedTo);
                
                return (
                  <div key={stdProp.key} className="grid grid-cols-2 px-4 py-3 items-center hover:bg-slate-50/80 transition-colors">
                    <div className="flex items-center gap-3 pr-4">
                      <div 
                        className={`w-2.5 h-2.5 rounded-full shrink-0 transition-colors ${
                          isMapped ? 'bg-emerald-500 shadow-sm shadow-emerald-300' : 'bg-amber-400'
                        }`} 
                        title={isMapped ? 'Campo vinculado' : 'Campo não vinculado (ficará vazio)'}
                      />
                      <span className="text-xs font-semibold text-slate-800 truncate" title={stdProp.key}>
                        {stdProp.key}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0 ml-auto" />
                    </div>
                    <div>
                      <select
                        value={mappedTo || ''}
                        onChange={(e) => handleSelectChange(stdProp.key, e.target.value)}
                        className={`w-full text-xs font-medium rounded-lg border px-3 py-2 outline-none transition-all ${
                          isMapped 
                            ? 'border-emerald-300 bg-white text-slate-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-100' 
                            : 'border-slate-300 bg-slate-50/60 text-slate-500 focus:border-amber-500 focus:ring-2 focus:ring-amber-100'
                        }`}
                      >
                        <option value="">-- Não vincular (Deixar campo vazio no padrão) --</option>
                        {newSchema.map(newProp => (
                          <option key={newProp.key} value={newProp.key}>
                            {newProp.key}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white border-t border-slate-100 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Campos padrão preservados: <strong>{totalCount}</strong></span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onConfirm(mapping)}
              className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors flex items-center gap-2 shadow-sm shadow-blue-500/20"
            >
              <Check className="w-4 h-4" />
              Confirmar Ligações e Atualizar
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

