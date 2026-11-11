import React, { useState, useMemo } from 'react';
import { GisLayer } from '../types/gis';
import {
  parseGeoJson,
  detectGeometryType,
  calculateBoundingBox,
  extractPropertySchemas,
  normalizeAndReprojectGeoJson,
} from '../utils/geoJsonParser';
import { fetchPublicAsset } from '../utils/assetUrl';
import {
  Globe,
  Search,
  Layers,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Plus,
  X,
  Server,
  Map as MapIcon,
  FileCode,
  Sparkles,
  RefreshCw,
} from 'lucide-react';

interface WmsModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingLayers: GisLayer[];
  onAddLayer: (layer: GisLayer) => void;
}

export interface WmsCapabilityLayer {
  name: string;
  title: string;
  abstract: string;
  bbox?: [number, number, number, number];
}

// Catálogo embarcado de contingência para o DataGeo SP (garante operação contínua mesmo se o GeoServer externo oscilar)
export const DATAGEO_FALLBACK_LAYERS: WmsCapabilityLayer[] = [
  {
    name: 'datageo:VWM_MUNICIPIO_LIMITE_50_10_IGC_2021_POL',
    title: 'Limites Municipais Oficiais do Estado de São Paulo (IGC 2021)',
    abstract: 'Poligonais oficiais dos 645 municípios paulistas segundo o Instituto Geográfico e Cartográfico (IGC).',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:LimiteUgrhiDAEE',
    title: 'Unidades de Gerenciamento de Recursos Hídricos - UGRHI (DAEE)',
    abstract: 'Divisão hidrográfica oficial das 22 UGRHIs do Estado de São Paulo (Bacias Hidrográficas DAEE/CRH).',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:APRMB',
    title: 'Área de Proteção e Recuperação dos Mananciais - APRM Billings',
    abstract: 'Perímetro legal da Área de Proteção e Recuperação dos Mananciais da Bacia Hidrográfica do Reservatório Billings.',
    bbox: [-46.78, -23.96, -46.28, -23.62],
  },
  {
    name: 'datageo:APRMP_GUA',
    title: 'Área de Proteção e Recuperação dos Mananciais - APRM Guarapiranga',
    abstract: 'Perímetro legal da Área de Proteção e Recuperação dos Mananciais da Bacia do Reservatório Guarapiranga.',
    bbox: [-47.03, -23.95, -46.63, -23.63],
  },
  {
    name: 'datageo:UnidadesConservacaoEstadual',
    title: 'Unidades de Conservação Estaduais (Fundação Florestal / SIMA)',
    abstract: 'Parques Estaduais, Estações Ecológicas, APAs e Reservas sob gestão estadual em São Paulo.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:UnidadesConservacaoFederal',
    title: 'Unidades de Conservação Federais no Estado de São Paulo (ICMBio)',
    abstract: 'Parques Nacionais, APAs Federais e Reservas Biológicas localizadas no território paulista.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:VWM_TRECHO_DRENAGEM_50_10_IGC_2021_LIN',
    title: 'Rede de Drenagem e Hidrografia Oficial (IGC 1:50.000 / 1:10.000)',
    abstract: 'Cursos d’água e trechos de drenagem mapeados pelo Instituto Geográfico e Cartográfico.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:InventFlorestal2020',
    title: 'Inventário Florestal da Vegetação Natural do Estado de São Paulo (2020)',
    abstract: 'Mapeamento dos remanescentes de vegetação nativa (Mata Atlântica e Cerrado) do Estado de São Paulo.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:BiomasIBGE250mil',
    title: 'Biomas no Estado de São Paulo (IBGE 1:250.000)',
    abstract: 'Delimitação dos biomas Mata Atlântica e Cerrado no Estado de São Paulo.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:GeomorfologiaIBGE',
    title: 'Compartimentos Geomorfológicos do Estado de São Paulo',
    abstract: 'Unidades geomorfológicas e relevo do território paulista.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
  {
    name: 'datageo:PedologiaRossi2017',
    title: 'Mapa Pedológico do Estado de São Paulo (Rossi, 2017)',
    abstract: 'Classificação de solos do Estado de São Paulo revisada e unificada.',
    bbox: [-53.11, -25.31, -44.16, -19.78],
  },
];

export type CatalogFilterCategory =
  | 'all'
  | 'sp'
  | 'meio_ambiente'
  | 'uc_restricoes'
  | 'vegetacao_biomas'
  | 'infraestrutura';

export interface ServicePreset {
  id: string;
  name: string;
  serviceType: 'wms' | 'xyz' | 'geojson';
  category: Exclude<CatalogFilterCategory, 'all'>;
  categoryLabel: string;
  description: string;
  url: string;
  layers?: string;
  format?: string;
  attribution: string;
  badge: string;
  bbox?: [number, number, number, number];
}

const PRESET_SERVICES: ServicePreset[] = [
  {
    id: 'sp-limites-municipais',
    name: 'Malha Municipal do Estado de SP (645 Municípios - IBGE/IGC)',
    serviceType: 'geojson',
    category: 'sp',
    categoryLabel: 'Estado de São Paulo',
    description: 'Malha oficial completa com todos os 645 municípios paulistas enriquecida com metadados cadastrais do IBGE (Nome do Município, Código IBGE, Microrregião, Mesorregião, Região Imediata e Intermediária). Polígonos nítidos, leves e interativos.',
    url: 'data/sp_municipios_ibge.geojson',
    attribution: 'IBGE / IGC SP',
    badge: 'Vetor 645 Mun. + Metadados'
  },
  {
    id: 'sp-limite-estadual',
    name: 'Limite Oficial do Estado de São Paulo (IBGE / IGC SP)',
    serviceType: 'geojson',
    category: 'sp',
    categoryLabel: 'Estado de São Paulo',
    description: 'Perímetro e polígono territorial completo do Estado de São Paulo enriquecido com metadados oficiais (Capital, Código IBGE, Total de Municípios, Região Sudeste).',
    url: 'data/sp_limite_estadual.geojson',
    attribution: 'IBGE / IGC SP',
    badge: 'Vetor SP + Metadados'
  },
  {
    id: 'sp-mananciais-apm-perimetros',
    name: 'Perímetros das Áreas de Proteção aos Mananciais - APM / APRM (SIMA / DAEE)',
    serviceType: 'geojson',
    category: 'meio_ambiente',
    categoryLabel: 'Recursos Hídricos / Mananciais',
    description: 'Apenas os perímetros oficiais externos (sem preenchimento, 100% vazado) das Áreas de Proteção e Recuperação aos Mananciais (APRM Billings, Guarapiranga, Juquery e Cabeceiras do Tietê). Traçado perimetral nítido para sobreposição territorial.',
    url: 'data/mananciais_apm_sp.geojson',
    attribution: 'DataGeo SP / SIMA / DAEE / CETESB',
    badge: 'Perímetro Vazado (APM)',
    bbox: [-46.9425, -24.0082, -45.6325, -23.2189]
  },
  {
    id: 'datageo-bacias',
    name: 'DataGeo SP - UGRHI & Bacias Hidrográficas (DAEE / SIGRH)',
    serviceType: 'geojson',
    category: 'meio_ambiente',
    categoryLabel: 'Recursos Hídricos',
    description: 'Todas as 22 UGRHIs (Unidades de Gerenciamento de Recursos Hídricos do Estado de SP - DAEE / SIGRH) enriquecidas com metadados cadastrais e regulatórios completos (Comitê CBH, Bacia Hidrográfica, Sede, Rios Principais, Situação Hídrica e Diretrizes GRAPROHAB).',
    url: 'data/sp_ugrhi_bacias.geojson',
    attribution: 'DataGeo SP / DAEE / SIGRH',
    badge: 'Vetor 22 UGRHIs + Metadados',
    bbox: [-53.15, -25.35, -44.11, -19.73]
  },
  {
    id: 'sp-rede-hidrografica',
    name: "Rede Hidrográfica e Cursos d'Água Oficiais (IGC / DAEE / DataGeo SP)",
    serviceType: 'geojson',
    category: 'meio_ambiente',
    categoryLabel: 'Recursos Hídricos / Drenagem',
    description: 'Traçado vetorial dos principais rios, afluentes e eixos de drenagem do Estado de São Paulo enriquecido com classificação de porte, UGRHI, domínio hídrico e faixa mínima de APP pelo Código Florestal.',
    url: 'data/sp_rede_hidrografica.geojson',
    attribution: 'IGC / DAEE / DataGeo SP',
    badge: 'Hidrografia & Faixas APP',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-ucs-protecao-integral',
    name: 'Unidades de Conservação Estaduais - Proteção Integral (Parques / EE)',
    serviceType: 'geojson',
    category: 'uc_restricoes',
    categoryLabel: 'Unidades de Conservação',
    description: 'Parques Estaduais e Estações Ecológicas sob gestão da Fundação Florestal / SIMA-SP onde o parcelamento urbano é vedado (PE Serra do Mar, Cantareira, Juquery, Ilhabela, Intervales, Carlos Botelho, PETAR, Juréia-Itatins, Morro do Diabo e Vassununga).',
    url: 'data/sp_ucs_protecao_integral.geojson',
    attribution: 'Fundação Florestal / SIMA / DataGeo SP',
    badge: 'Proteção Integral (SNUC)',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-ucs-uso-sustentavel',
    name: 'Unidades de Conservação Estaduais - Uso Sustentável (APAs / ARIEs)',
    serviceType: 'geojson',
    category: 'uc_restricoes',
    categoryLabel: 'Unidades de Conservação',
    description: 'Áreas de Proteção Ambiental Estaduais (APA Sistema Cantareira, Várzea do Rio Tietê, Piracicaba/Juqueri-Mirim, Campinas, Jundiaí/Cabreúva, Itupararanga, Corumbataí-Botucatu-Tejupá e Sapucaí-Mirim) com diretrizes de zoneamento para loteamentos.',
    url: 'data/sp_ucs_uso_sustentavel.geojson',
    attribution: 'Fundação Florestal / SIMA / DataGeo SP',
    badge: 'APAs Estaduais + Zoneamento',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-ucs-federais-icmbio',
    name: 'Unidades de Conservação Federais no Estado de SP (ICMBio)',
    serviceType: 'geojson',
    category: 'uc_restricoes',
    categoryLabel: 'Unidades de Conservação',
    description: 'Parques Nacionais, Florestas Nacionais e APAs Federais localizadas em São Paulo (APA Serra da Mantiqueira, APA Bacia do Paraíba do Sul, PARNA Serra da Bocaina, FLONA de Ipanema e Capão Bonito) com regras de anuência ICMBio.',
    url: 'data/sp_ucs_federais_icmbio.geojson',
    attribution: 'ICMBio / MMA',
    badge: 'UCs Federais (ICMBio)',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-zonas-amortecimento-ucs',
    name: 'Zonas de Amortecimento de Unidades de Conservação (CONAMA 428)',
    serviceType: 'geojson',
    category: 'uc_restricoes',
    categoryLabel: 'Unidades de Conservação',
    description: 'Envoltórias perimetrais de amortecimento (100% vazadas) no entorno das Unidades de Conservação de Proteção Integral, onde novos parcelamentos dependem de manifestação do órgão gestor (Resolução CONAMA nº 428/2010).',
    url: 'data/sp_zonas_amortecimento.geojson',
    attribution: 'DataGeo SP / Fundação Florestal / CONAMA',
    badge: 'Perímetro Vazado (ZA)',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-areas-umidas-varzeas',
    name: 'Áreas Úmidas e Várzeas Protegidas do Estado de SP (SIMA / IG)',
    serviceType: 'geojson',
    category: 'uc_restricoes',
    categoryLabel: 'Várzeas & Restrição Hídrica',
    description: 'Planícies aluviais, solos hidromórficos e várzeas sujeitas a inundação sazonal nos principais vales paulistas, com restrição ao parcelamento do solo (Art. 3º da Lei Federal nº 6.766/1979).',
    url: 'data/sp_areas_umidas_varzeas.geojson',
    attribution: 'SIMA / Instituto Geológico / DAEE',
    badge: 'Planícies Aluviais & Várzeas',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-perimetro-mata-atlantica',
    name: 'Perímetro da Lei da Mata Atlântica (Lei Federal nº 11.428/2006)',
    serviceType: 'geojson',
    category: 'vegetacao_biomas',
    categoryLabel: 'Vegetação & Biomas',
    description: 'Delimitação legal (perímetro 100% vazado) de aplicação da Lei da Mata Atlântica no Estado de São Paulo (IBGE/MMA), definindo o regime jurídico de proteção e compensação de fragmentos florestais na CETESB.',
    url: 'data/sp_perimetro_mata_atlantica.geojson',
    attribution: 'IBGE / MMA / CETESB',
    badge: 'Perímetro Legal (Lei 11.428)',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  },
  {
    id: 'sp-malha-rodoviaria-der',
    name: 'Malha Rodoviária Estadual e Concessões (DER-SP / ARTESP)',
    serviceType: 'geojson',
    category: 'infraestrutura',
    categoryLabel: 'Infraestrutura & Rodovias',
    description: 'Principais rodovias estaduais e concedidas de São Paulo (Bandeirantes, Anhanguera, Castello Branco, Raposo Tavares, Ayrton Senna, Dutra, Anchieta-Imigrantes, Rodoanel, Dom Pedro I, Washington Luís, Marechal Rondon) com diretrizes de faixa non aedificandi e acesso.',
    url: 'data/sp_malha_rodoviaria_der.geojson',
    attribution: 'DER-SP / ARTESP',
    badge: 'Eixos Rodoviários + Acessos',
    bbox: [-53.11, -25.31, -44.16, -19.78]
  }
];

const PRESET_VECTOR_CONFIG: Record<
  string,
  {
    color: string;
    style: {
      fillColor: string;
      strokeColor: string;
      strokeWidth: number;
      fillOpacity: number;
      strokeOpacity: number;
      pointRadius: number;
      pointShape: 'circle';
      smoothFactor: number;
    };
    popupTitleField: string;
    popupFieldOrder: string[];
  }
> = {
  'sp-limites-municipais': {
    color: '#475569',
    style: {
      fillColor: '#64748b',
      strokeColor: '#334155',
      strokeWidth: 1.2,
      fillOpacity: 0.08,
      strokeOpacity: 0.85,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DO MUNICÍPIO',
    popupFieldOrder: [
      'NOME DO MUNICÍPIO',
      'CÓDIGO IBGE',
      'UF',
      'MESORREGIÃO',
      'MICRORREGIÃO',
      'REGIÃO INTERMEDIÁRIA',
      'REGIÃO IMEDIATA',
      'UGRHI / BACIA HIDROGRÁFICA',
      'COMITÊ DE BACIA',
    ],
  },
  'sp-limite-estadual': {
    color: '#dc2626',
    style: {
      fillColor: '#ef4444',
      strokeColor: '#dc2626',
      strokeWidth: 3,
      fillOpacity: 0.05,
      strokeOpacity: 0.95,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'ESTADO',
    popupFieldOrder: [
      'ESTADO',
      'SIGLA / UF',
      'CAPITAL',
      'CÓDIGO IBGE',
      'REGIÃO',
      'TOTAL DE MUNICÍPIOS',
      'ÁREA TERRITORIAL (KM²)',
      'UGRHIS (BACIAS HIDROGRÁFICAS)',
      'ÓRGÃO GESTOR',
    ],
  },
  'sp-mananciais-apm-perimetros': {
    color: '#0284c7',
    style: {
      fillColor: '#0284c7',
      strokeColor: '#0284c7',
      strokeWidth: 2.8,
      fillOpacity: 0, // 100% vazado (sem preenchimento)
      strokeOpacity: 0.95,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DO MANANCIAL (APRM)',
    popupFieldOrder: [
      'NOME DO MANANCIAL (APRM)',
      'SIGLA',
      'LEGISLAÇÃO ESPECÍFICA',
      'SISTEMA PRODUTOR',
      'UGRHI / SUB-BACIA',
      'MUNICÍPIOS ABRANGIDOS',
      'ÓRGÃOS ENVOLVIDOS',
      'DIRETRIZ GRAPROHAB',
    ],
  },
  'datageo-bacias': {
    color: '#0ea5e9',
    style: {
      fillColor: '#0ea5e9',
      strokeColor: '#0369a1',
      strokeWidth: 2,
      fillOpacity: 0.18,
      strokeOpacity: 0.9,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DA BACIA HIDROGRÁFICA',
    popupFieldOrder: [
      'CÓDIGO UGRHI',
      'NOME DA BACIA HIDROGRÁFICA',
      'COMITÊ DE BACIA (CBH)',
      'MUNICÍPIO SEDE',
      'MUNICÍPIOS ABRANGIDOS',
      'RIOS PRINCIPAIS',
      'SITUAÇÃO HÍDRICA',
      'DIRETRIZES GRAPROHAB',
      'ÓRGÃO GESTOR',
    ],
  },
  'sp-rede-hidrografica': {
    color: '#0284c7',
    style: {
      fillColor: '#0284c7',
      strokeColor: '#0284c7',
      strokeWidth: 2.5,
      fillOpacity: 0,
      strokeOpacity: 0.92,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DO CURSO D ÁGUA',
    popupFieldOrder: [
      'NOME DO CURSO D ÁGUA',
      'CLASSIFICAÇÃO / PORTE',
      'UGRHI / BACIA HIDROGRÁFICA',
      'FAIXA DE APP MÍNIMA (CÓDIGO FLORESTAL)',
      'DOMÍNIO HÍDRICO (ESTADUAL/UNIÃO)',
      'DIRETRIZ DAEE / CETESB',
    ],
  },
  'sp-ucs-protecao-integral': {
    color: '#15803d',
    style: {
      fillColor: '#16a34a',
      strokeColor: '#15803d',
      strokeWidth: 2.2,
      fillOpacity: 0.28,
      strokeOpacity: 0.95,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DA UNIDADE DE CONSERVAÇÃO',
    popupFieldOrder: [
      'NOME DA UNIDADE DE CONSERVAÇÃO',
      'CATEGORIA SNUC',
      'GRUPO',
      'ÓRGÃO GESTOR',
      'ATO LEGAL DE CRIAÇÃO',
      'BIOMA PREDOMINANTE',
      'MUNICÍPIOS ABRANGIDOS',
      'RESTRIÇÃO GRAPROHAB',
    ],
  },
  'sp-ucs-uso-sustentavel': {
    color: '#65a30d',
    style: {
      fillColor: '#84cc16',
      strokeColor: '#4d7c0f',
      strokeWidth: 2,
      fillOpacity: 0.16,
      strokeOpacity: 0.9,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DA APA / UC',
    popupFieldOrder: [
      'NOME DA APA / UC',
      'CATEGORIA SNUC',
      'GRUPO',
      'ÓRGÃO GESTOR',
      'LEGISLAÇÃO / ZONEAMENTO',
      'MUNICÍPIOS ABRANGIDOS',
      'DIRETRIZ GRAPROHAB / CETESB',
    ],
  },
  'sp-ucs-federais-icmbio': {
    color: '#0d9488',
    style: {
      fillColor: '#14b8a6',
      strokeColor: '#0f766e',
      strokeWidth: 2.2,
      fillOpacity: 0.2,
      strokeOpacity: 0.92,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'NOME DA UC FEDERAL',
    popupFieldOrder: [
      'NOME DA UC FEDERAL',
      'CATEGORIA SNUC',
      'ÓRGÃO GESTOR (ICMBIO)',
      'ATO DE CRIAÇÃO',
      'REGIÃO / MUNICÍPIOS',
      'EXIGÊNCIA DE ANUÊNCIA ICMBIO',
    ],
  },
  'sp-zonas-amortecimento-ucs': {
    color: '#d97706',
    style: {
      fillColor: '#d97706',
      strokeColor: '#d97706',
      strokeWidth: 2.2,
      fillOpacity: 0, // 100% vazado
      strokeOpacity: 0.92,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'ZONA DE AMORTECIMENTO',
    popupFieldOrder: [
      'ZONA DE AMORTECIMENTO',
      'UC DE REFERÊNCIA',
      'NORMA APLICÁVEL (CONAMA 428/2010)',
      'FAIXA DE CONTROLE',
      'ÓRGÃO ANUENTE',
      'DIRETRIZ PARA LOTEAMENTOS',
    ],
  },
  'sp-areas-umidas-varzeas': {
    color: '#0891b2',
    style: {
      fillColor: '#06b6d4',
      strokeColor: '#0e7490',
      strokeWidth: 1.8,
      fillOpacity: 0.22,
      strokeOpacity: 0.9,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'UNIDADE DE VÁRZEA / ÁREA ÚMIDA',
    popupFieldOrder: [
      'UNIDADE DE VÁRZEA / ÁREA ÚMIDA',
      'BACIA HIDROGRÁFICA (UGRHI)',
      'SUSCETIBILIDADE A INUNDAÇÃO',
      'TIPO DE SOLO HIDROMÓRFICO',
      'RESTRIÇÃO AMBIENTAL E DRENAGEM',
    ],
  },
  'sp-perimetro-mata-atlantica': {
    color: '#16a34a',
    style: {
      fillColor: '#16a34a',
      strokeColor: '#16a34a',
      strokeWidth: 2.6,
      fillOpacity: 0, // 100% vazado
      strokeOpacity: 0.95,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'DOMÍNIO LEGAL',
    popupFieldOrder: [
      'DOMÍNIO LEGAL',
      'LEGISLAÇÃO FEDERAL',
      'REGIME JURÍDICO DE SUPRESSÃO',
      'COMPENSAÇÃO EXIGIDA (CETESB)',
      'ABRANGÊNCIA NO ESTADO DE SP',
    ],
  },
  'sp-malha-rodoviaria-der': {
    color: '#ea580c',
    style: {
      fillColor: '#ea580c',
      strokeColor: '#ea580c',
      strokeWidth: 2.6,
      fillOpacity: 0,
      strokeOpacity: 0.92,
      pointRadius: 7,
      pointShape: 'circle',
      smoothFactor: 1.0,
    },
    popupTitleField: 'RODOVIA (SIGLA)',
    popupFieldOrder: [
      'RODOVIA (SIGLA)',
      'DENOMINAÇÃO OFICIAL',
      'JURISDIÇÃO / CONCESSIONÁRIA',
      'TRECHO / EIXO DE LIGAÇÃO',
      'FAIXA NON AEDIFICANDI (LEI 6.766/79)',
      'EXIGÊNCIA DE ACESSO (DER / ARTESP)',
    ],
  },
};

export const WmsModal: React.FC<WmsModalProps> = ({
  isOpen,
  onClose,
  existingLayers,
  onAddLayer,
}) => {
  const [activeTab, setActiveTab] = useState<'catalog' | 'custom'>('catalog');

  // Tab 1: Catalog state
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CatalogFilterCategory>('all');
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null);

  // Tab 2: Custom connection state
  const [protocol, setProtocol] = useState<'wms' | 'xyz' | 'geojson'>('wms');
  const [wmsServerUrl, setWmsServerUrl] = useState('https://datageo.ambiente.sp.gov.br/geoserver/datageo/ows');
  const [wmsVersion, setWmsVersion] = useState<'1.1.1' | '1.3.0'>('1.1.1');
  const [wmsFormat, setWmsFormat] = useState<'image/png' | 'image/jpeg'>('image/png');
  const [wmsLayerIdentifier, setWmsLayerIdentifier] = useState('');
  const [wmsDisplayName, setWmsDisplayName] = useState('');
  const [wmsSelectedBbox, setWmsSelectedBbox] = useState<[number, number, number, number] | null>(null);

  // WMS Capabilities Explorer state
  const [capabilitiesLayers, setCapabilitiesLayers] = useState<WmsCapabilityLayer[]>([]);
  const [capabilitiesSearch, setCapabilitiesSearch] = useState('');
  const [isLoadingCapabilities, setIsLoadingCapabilities] = useState(false);
  const [capabilitiesNotice, setCapabilitiesNotice] = useState<{
    type: 'success' | 'warning' | 'error';
  } & { text: string } | null>(null);

  // XYZ state
  const [xyzUrl, setXyzUrl] = useState('');
  const [xyzName, setXyzName] = useState('');
  const [xyzMaxZoom, setXyzMaxZoom] = useState<number>(19);
  const [xyzAttribution, setXyzAttribution] = useState('');

  // Remote GeoJSON state
  const [geojsonUrl, setGeojsonUrl] = useState('');
  const [geojsonName, setGeojsonName] = useState('');
  const [isLoadingGeojson, setIsLoadingGeojson] = useState(false);

  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const filteredCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return PRESET_SERVICES.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.attribution.toLowerCase().includes(q) ||
        item.categoryLabel.toLowerCase().includes(q) ||
        item.badge.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });
  }, [catalogSearch, selectedCategory]);

  const filteredCapabilities = useMemo(() => {
    const q = capabilitiesSearch.trim().toLowerCase();
    if (!q) return capabilitiesLayers.slice(0, 80);
    return capabilitiesLayers
      .filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.name.toLowerCase().includes(q) ||
          (l.abstract && l.abstract.toLowerCase().includes(q))
      )
      .slice(0, 80);
  }, [capabilitiesLayers, capabilitiesSearch]);

  if (!isOpen) return null;

  const isPresetAdded = (preset: ServicePreset): boolean => {
    return existingLayers.some((l) => l.url === preset.url || l.name === preset.name);
  };

  const handleAddCatalogPreset = async (preset: ServicePreset) => {
    setLoadingPresetId(preset.id);
    setStatusMessage(null);

    try {
      const res = await fetchPublicAsset(preset.url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ao carregar ${preset.url}`);
      }
      const text = await res.text();
      const rawGeojson = parseGeoJson(text);
      const { geojson: normalizedGeojson } = normalizeAndReprojectGeoJson(rawGeojson);
      const features = normalizedGeojson.features || [];

      if (features.length === 0) {
        throw new Error('O arquivo vetorial não contém feições válidas.');
      }

      const geomType = detectGeometryType(features);
      const bbox = preset.bbox || calculateBoundingBox(features);
      const schema = extractPropertySchemas(features);
      const presetCfg = PRESET_VECTOR_CONFIG[preset.id];

      const orderedKeys = presetCfg?.popupFieldOrder || schema.map((s) => s.key);

      const newLayer: GisLayer = {
        id: `preset_${preset.id}_${Date.now()}`,
        name: preset.name,
        description: `${preset.attribution} — ${preset.description}`,
        geometryType: geomType,
        data: normalizedGeojson,
        visible: true,
        opacity: 1,
        style: presetCfg
          ? { ...presetCfg.style }
          : {
              fillColor: '#0ea5e9',
              strokeColor: '#0284c7',
              strokeWidth: 2,
              fillOpacity: 0.25,
              strokeOpacity: 0.9,
              pointRadius: 7,
              pointShape: 'circle',
              smoothFactor: 1.0,
            },
        filters: [],
        featureCount: features.length,
        filteredCount: features.length,
        propertiesSchema: schema,
        popupTitleField: presetCfg?.popupTitleField,
        popupFieldOrder: orderedKeys,
        popupVisibleFields: orderedKeys,
        bbox,
        createdAt: Date.now(),
        ignoreGlobalFilter: true,
        serviceType: 'geojson',
        isServiceLayer: false,
        url: preset.url,
      };

      onAddLayer(newLayer);
      setStatusMessage({
        type: 'success',
        text: `Camada "${preset.name}" (${features.length} feições) ativada como sobreposição no mapa!`,
      });
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: `Falha ao ativar camada "${preset.name}": ${err.message}`,
      });
    } finally {
      setLoadingPresetId(null);
    }
  };

  const handleFetchWmsCapabilities = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl ?? wmsServerUrl).trim();
    if (!targetUrl) {
      setCapabilitiesNotice({
        type: 'error',
        text: 'Informe a URL base do servidor OGC WMS.',
      });
      return;
    }

    setIsLoadingCapabilities(true);
    setCapabilitiesNotice(null);
    setStatusMessage(null);

    const isDataGeo = targetUrl.toLowerCase().includes('datageo.ambiente.sp.gov.br');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    try {
      const apiEndpoint = `/api/wms/capabilities?url=${encodeURIComponent(targetUrl)}&version=${encodeURIComponent(wmsVersion)}`;
      const res = await fetch(apiEndpoint, {
        signal: controller.signal,
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`Status HTTP ${res.status}`);
      }

      const data = await res.json();
      if (data && Array.isArray(data.layers) && data.layers.length > 0) {
        setCapabilitiesLayers(data.layers);
        setCapabilitiesNotice({
          type: 'success',
          text: `${data.layers.length} camada(s) carregadas do catálogo WMS${data.cached ? ' (cache instantâneo)' : ''}. Selecione uma camada abaixo.`,
        });
      } else if (isDataGeo) {
        setCapabilitiesLayers(DATAGEO_FALLBACK_LAYERS);
        setCapabilitiesNotice({
          type: 'warning',
          text: `Catálogo oficial embarcado do DataGeo SP carregado (${DATAGEO_FALLBACK_LAYERS.length} camadas principais).`,
        });
      } else {
        setCapabilitiesLayers([]);
        setCapabilitiesNotice({
          type: 'warning',
          text: 'Nenhuma camada encontrada no XML GetCapabilities deste servidor. Você ainda pode digitar o identificador manualmente.',
        });
      }
    } catch (err: any) {
      if (isDataGeo) {
        setCapabilitiesLayers(DATAGEO_FALLBACK_LAYERS);
        setCapabilitiesNotice({
          type: 'warning',
          text: `Servidor DataGeo SP com alta latência no momento — catálogo oficial embarcado ativado (${DATAGEO_FALLBACK_LAYERS.length} camadas prontas para uso).`,
        });
      } else {
        setCapabilitiesNotice({
          type: 'error',
          text: `Falha ao consultar GetCapabilities (${err.name === 'AbortError' ? 'tempo limite de 28s excedido' : err.message}). Você pode informar o identificador LAYERS manualmente abaixo.`,
        });
      }
    } finally {
      clearTimeout(timeoutId);
      setIsLoadingCapabilities(false);
    }
  };

  const handleSelectCapabilityLayer = (cap: WmsCapabilityLayer) => {
    setWmsLayerIdentifier(cap.name);
    setWmsDisplayName(cap.title || cap.name);
    if (cap.bbox) {
      setWmsSelectedBbox(cap.bbox);
    } else {
      setWmsSelectedBbox([-53.11, -25.31, -44.16, -19.78]);
    }
  };

  const handleAddCustomLayer = async () => {
    setStatusMessage(null);

    if (protocol === 'wms') {
      const cleanBaseUrl = wmsServerUrl.trim().split('?')[0].trim();
      const cleanLayers = wmsLayerIdentifier.trim();
      if (!cleanBaseUrl || !cleanLayers) {
        setStatusMessage({
          type: 'error',
          text: 'Preencha a URL Base do Servidor WMS e o Identificador da Camada (LAYERS).',
        });
        return;
      }

      const displayTitle = wmsDisplayName.trim() || cleanLayers;
      const bbox: [number, number, number, number] = wmsSelectedBbox || [-53.11, -25.31, -44.16, -19.78];

      const newLayer: GisLayer = {
        id: `web_wms_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: displayTitle,
        description: `Serviço OGC WMS (${cleanLayers})`,
        geometryType: 'Mixed',
        data: { type: 'FeatureCollection', features: [] },
        visible: true,
        opacity: 0.8,
        style: {
          fillColor: '#dc2626',
          strokeColor: '#dc2626',
          strokeWidth: 2,
          fillOpacity: 0.45,
          strokeOpacity: 0.9,
          pointRadius: 7,
          pointShape: 'circle',
        },
        filters: [],
        featureCount: 0,
        filteredCount: 0,
        propertiesSchema: [],
        bbox,
        createdAt: Date.now(),
        ignoreGlobalFilter: true,
        serviceType: 'wms',
        isServiceLayer: true,
        url: cleanBaseUrl,
        wmsConfig: {
          url: cleanBaseUrl,
          layers: cleanLayers,
          format: wmsFormat,
          transparent: wmsFormat === 'image/png',
          version: wmsVersion,
        },
      };

      onAddLayer(newLayer);
      setStatusMessage({
        type: 'success',
        text: `Camada WMS "${displayTitle}" conectada e adicionada ao mapa!`,
      });
      return;
    }

    if (protocol === 'xyz') {
      const cleanUrl = xyzUrl.trim();
      if (!cleanUrl || !cleanUrl.includes('{z}') || !cleanUrl.includes('{x}') || !cleanUrl.includes('{y}')) {
        setStatusMessage({
          type: 'error',
          text: 'Informe uma URL de Tiles XYZ válida contendo os placeholders {z}, {x} e {y}.',
        });
        return;
      }

      const displayTitle = xyzName.trim() || 'Camada Tiles XYZ';
      const newLayer: GisLayer = {
        id: `web_xyz_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        name: displayTitle,
        description: `Serviço de Tiles XYZ (${cleanUrl})`,
        geometryType: 'Mixed',
        data: { type: 'FeatureCollection', features: [] },
        visible: true,
        opacity: 0.8,
        style: {
          fillColor: '#0284c7',
          strokeColor: '#0284c7',
          strokeWidth: 2,
          fillOpacity: 0.45,
          strokeOpacity: 0.9,
          pointRadius: 7,
          pointShape: 'circle',
        },
        filters: [],
        featureCount: 0,
        filteredCount: 0,
        propertiesSchema: [],
        bbox: [-53.11, -25.31, -44.16, -19.78],
        createdAt: Date.now(),
        ignoreGlobalFilter: true,
        serviceType: 'xyz',
        isServiceLayer: true,
        url: cleanUrl,
        xyzConfig: {
          url: cleanUrl,
          maxZoom: Number(xyzMaxZoom) || 19,
          attribution: xyzAttribution.trim() || undefined,
          isOverlay: true,
        },
      };

      onAddLayer(newLayer);
      setStatusMessage({
        type: 'success',
        text: `Camada XYZ "${displayTitle}" adicionada ao mapa!`,
      });
      return;
    }

    if (protocol === 'geojson') {
      const cleanUrl = geojsonUrl.trim();
      if (!cleanUrl) {
        setStatusMessage({
          type: 'error',
          text: 'Informe a URL pública do arquivo ou endpoint GeoJSON.',
        });
        return;
      }

      setIsLoadingGeojson(true);
      try {
        const res = await fetch(cleanUrl, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const text = await res.text();
        const rawGeojson = parseGeoJson(text);
        const { geojson: normalizedGeojson } = normalizeAndReprojectGeoJson(rawGeojson);
        const features = normalizedGeojson.features || [];

        if (features.length === 0) {
          throw new Error('O GeoJSON remoto não contém feições válidas.');
        }

        const geomType = detectGeometryType(features);
        const bbox = calculateBoundingBox(features);
        const schema = extractPropertySchemas(features);
        const displayTitle =
          geojsonName.trim() ||
          cleanUrl.split('/').pop()?.replace(/\.[^/.]+$/, '') ||
          'Camada GeoJSON Remota';

        const newLayer: GisLayer = {
          id: `web_geojson_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: displayTitle,
          description: `GeoJSON Remoto (${cleanUrl})`,
          geometryType: geomType,
          data: normalizedGeojson,
          visible: true,
          opacity: 1,
          style: {
            fillColor: '#0ea5e9',
            strokeColor: '#0284c7',
            strokeWidth: geomType === 'LineString' ? 3 : 2,
            fillOpacity: geomType === 'Point' ? 0.85 : 0.45,
            strokeOpacity: 0.9,
            pointRadius: 7,
            pointShape: 'circle',
            smoothFactor: 1.0,
          },
          filters: [],
          featureCount: features.length,
          filteredCount: features.length,
          propertiesSchema: schema,
          bbox,
          createdAt: Date.now(),
          ignoreGlobalFilter: true,
          serviceType: 'geojson',
          isServiceLayer: false,
          url: cleanUrl,
        };

        onAddLayer(newLayer);
        setStatusMessage({
          type: 'success',
          text: `Camada GeoJSON "${displayTitle}" carregada (${features.length} feições)!`,
        });
      } catch (err: any) {
        setStatusMessage({
          type: 'error',
          text: `Falha ao carregar GeoJSON remoto: ${err.message}`,
        });
      } finally {
        setIsLoadingGeojson(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        id="wms-modal"
        className="w-full max-w-4xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 text-red-600 border border-red-200 rounded-xl">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900">
                Adicionar Camadas Web & Serviços OGC (WMS / XYZ / GeoJSON)
              </h2>
              <p className="text-xs text-slate-500">
                Conecte camadas oficiais do DataGeo SP, IBGE, Tiles XYZ ou APIs GeoJSON como sobreposição cartográfica
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-800 p-2 rounded-lg hover:bg-slate-200/60 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 px-6 pt-3 border-b border-slate-200 bg-slate-50/50">
          <button
            type="button"
            onClick={() => {
              setActiveTab('catalog');
              setStatusMessage(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'catalog'
                ? 'border-red-600 text-red-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Catálogo Pré-configurado (1 Clique)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab('custom');
              setStatusMessage(null);
            }}
            className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors flex items-center gap-2 cursor-pointer whitespace-nowrap ${
              activeTab === 'custom'
                ? 'border-red-600 text-red-600 bg-white rounded-t-lg'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <Server className="w-3.5 h-3.5" />
            <span>Conexão Personalizada (WMS DataGeo / XYZ / GeoJSON)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {activeTab === 'catalog' ? (
            <div className="space-y-4">
              {/* Search & Category Filter */}
              <div className="flex flex-col gap-2.5">
                <div className="relative w-full">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Buscar camada por nome, órgão (IBGE, IGC, DataGeo, DAEE, SIMA, ICMBio, DER) ou metadado..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs text-slate-900 focus:outline-none focus:border-red-600"
                  />
                </div>
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl overflow-x-auto">
                  {(
                    [
                      { id: 'all', label: 'Todas (12)' },
                      { id: 'sp', label: 'Estado de SP (2)' },
                      { id: 'meio_ambiente', label: 'Recursos Hídricos (3)' },
                      { id: 'uc_restricoes', label: 'UCs & Várzeas (5)' },
                      { id: 'vegetacao_biomas', label: 'Vegetação & Biomas (1)' },
                      { id: 'infraestrutura', label: 'Rodovias DER-SP (1)' },
                    ] as { id: CatalogFilterCategory; label: string }[]
                  ).map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setSelectedCategory(cat.id)}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        selectedCategory === cat.id
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Catalog Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {filteredCatalog.map((preset) => {
                  const alreadyAdded = isPresetAdded(preset);
                  const isLoadingThis = loadingPresetId === preset.id;
                  const presetCfg = PRESET_VECTOR_CONFIG[preset.id];
                  const isHollow = presetCfg?.style.fillOpacity === 0;
                  const swatchColor = presetCfg?.color || '#dc2626';

                  return (
                    <div
                      key={preset.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-red-300 hover:shadow-md transition-all flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">
                            {preset.categoryLabel}
                          </span>
                          <span className="text-[10px] font-mono font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md shrink-0">
                            {preset.badge}
                          </span>
                        </div>

                        <div className="flex items-start gap-2.5 pt-0.5">
                          <span
                            className="w-3.5 h-3.5 rounded-sm shrink-0 mt-0.5"
                            style={{
                              backgroundColor: isHollow ? 'transparent' : swatchColor,
                              border: `2px solid ${swatchColor}`,
                            }}
                            title={isHollow ? 'Perímetro 100% vazado (sem preenchimento)' : 'Polígono vetorial'}
                          />
                          <h4 className="text-xs font-bold text-slate-900 leading-snug">
                            {preset.name}
                          </h4>
                        </div>

                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          {preset.description}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-2.5 border-t border-slate-100">
                        <span className="text-[10px] font-medium text-slate-500">
                          Fonte: <strong className="text-slate-700">{preset.attribution}</strong>
                        </span>
                        <button
                          type="button"
                          disabled={isLoadingThis}
                          onClick={() => handleAddCatalogPreset(preset)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0 disabled:opacity-60 ${
                            alreadyAdded
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
                              : 'bg-red-600 hover:bg-red-700 text-white shadow-xs'
                          }`}
                        >
                          {isLoadingThis ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Carregando...</span>
                            </>
                          ) : alreadyAdded ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Ativa no Mapa</span>
                            </>
                          ) : (
                            <>
                              <Plus className="w-3.5 h-3.5" />
                              <span>Ativar no Mapa</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Protocol Selector */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  1. Selecione o Tipo de Protocolo Geoespacial
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setProtocol('wms');
                      setStatusMessage(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      protocol === 'wms'
                        ? 'bg-red-50/70 border-red-600 text-slate-900 ring-1 ring-red-600'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                      <Server className="w-4 h-4 text-red-600 shrink-0" />
                      <span>OGC WMS</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      GeoServer / DataGeo SP / IBGE / SIGGEO
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProtocol('xyz');
                      setStatusMessage(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      protocol === 'xyz'
                        ? 'bg-red-50/70 border-red-600 text-slate-900 ring-1 ring-red-600'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                      <MapIcon className="w-4 h-4 text-sky-600 shrink-0" />
                      <span>Tiles XYZ / TMS</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Mapas Base, Ortofotos & Overlays ({'{z}/{x}/{y}'})
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setProtocol('geojson');
                      setStatusMessage(null);
                    }}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      protocol === 'geojson'
                        ? 'bg-red-50/70 border-red-600 text-slate-900 ring-1 ring-red-600'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-bold text-xs text-slate-900">
                      <FileCode className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>GeoJSON Remoto</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      API REST ou Arquivo Vetorial Web (.geojson)
                    </p>
                  </button>
                </div>
              </div>

              {/* Protocol-specific Form */}
              {protocol === 'wms' && (
                <div className="space-y-4 bg-slate-50/70 border border-slate-200 rounded-xl p-4">
                  {/* Server URL & Quick Shortcuts */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="text-xs font-bold text-slate-800">
                        URL Base do Servidor OGC WMS
                      </label>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-slate-500">Atalhos oficiais:</span>
                        <button
                          type="button"
                          onClick={() => {
                            const url = 'https://datageo.ambiente.sp.gov.br/geoserver/datageo/ows';
                            setWmsServerUrl(url);
                            handleFetchWmsCapabilities(url);
                          }}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white hover:bg-red-50 text-red-700 border border-slate-300 hover:border-red-300 transition-colors cursor-pointer"
                        >
                          DataGeo SP (Ambiental/IGC)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const url = 'https://geoservicos.ibge.gov.br/geoserver/CCAR/wms';
                            setWmsServerUrl(url);
                            handleFetchWmsCapabilities(url);
                          }}
                          className="px-2.5 py-1 rounded-md text-[11px] font-semibold bg-white hover:bg-sky-50 text-sky-700 border border-slate-300 hover:border-sky-300 transition-colors cursor-pointer"
                        >
                          IBGE (CCAR / Malhas)
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={wmsServerUrl}
                        onChange={(e) => setWmsServerUrl(e.target.value)}
                        placeholder="https://datageo.ambiente.sp.gov.br/geoserver/datageo/ows"
                        className="flex-1 px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-red-600"
                      />
                      <button
                        type="button"
                        onClick={() => handleFetchWmsCapabilities()}
                        disabled={isLoadingCapabilities}
                        className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                      >
                        {isLoadingCapabilities ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Consultando Catálogo...</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Buscar Camadas (GetCapabilities)</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Capabilities Notice */}
                  {capabilitiesNotice && (
                    <div
                      className={`p-3 rounded-lg border text-xs flex items-center gap-2 ${
                        capabilitiesNotice.type === 'success'
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                          : capabilitiesNotice.type === 'warning'
                          ? 'bg-amber-50 border-amber-200 text-amber-900'
                          : 'bg-rose-50 border-rose-200 text-rose-800'
                      }`}
                    >
                      {capabilitiesNotice.type === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span>{capabilitiesNotice.text}</span>
                    </div>
                  )}

                  {/* Interactive WMS Layer Explorer */}
                  {capabilitiesLayers.length > 0 && (
                    <div className="space-y-2 bg-white border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <Layers className="w-3.5 h-3.5 text-red-600" />
                          Explorador de Camadas do Servidor ({capabilitiesLayers.length} disponíveis)
                        </span>
                        <span className="text-[11px] text-slate-500">
                          Clique em uma camada para preencher automaticamente
                        </span>
                      </div>

                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={capabilitiesSearch}
                          onChange={(e) => setCapabilitiesSearch(e.target.value)}
                          placeholder="Filtrar por título, nome técnico (workspace:camada) ou resumo..."
                          className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                        />
                      </div>

                      <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
                        {filteredCapabilities.length === 0 ? (
                          <div className="p-4 text-center text-xs text-slate-500">
                            Nenhuma camada encontrada para "{capabilitiesSearch}".
                          </div>
                        ) : (
                          filteredCapabilities.map((cap, idx) => {
                            const isSelected = wmsLayerIdentifier === cap.name;
                            return (
                              <button
                                key={`${cap.name}_${idx}`}
                                type="button"
                                onClick={() => handleSelectCapabilityLayer(cap)}
                                className={`w-full text-left px-3 py-2 transition-colors flex flex-col gap-0.5 cursor-pointer ${
                                  isSelected
                                    ? 'bg-red-50/90 text-slate-900'
                                    : 'hover:bg-slate-50 text-slate-800'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-xs font-semibold text-slate-900 truncate">
                                    {cap.title}
                                  </span>
                                  <span className="text-[10px] font-mono text-red-700 shrink-0">
                                    {cap.name}
                                  </span>
                                </div>
                                {cap.abstract && (
                                  <p className="text-[11px] text-slate-500 line-clamp-1">
                                    {cap.abstract}
                                  </p>
                                )}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* Manual / Auto-filled Layer Parameters */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Identificador da Camada (parâmetro LAYERS) *
                      </label>
                      <input
                        type="text"
                        value={wmsLayerIdentifier}
                        onChange={(e) => setWmsLayerIdentifier(e.target.value)}
                        placeholder="Ex: datageo:LimiteUgrhiDAEE"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-red-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nome de Exibição no Painel
                      </label>
                      <input
                        type="text"
                        value={wmsDisplayName}
                        onChange={(e) => setWmsDisplayName(e.target.value)}
                        placeholder="Ex: Bacias Hidrográficas UGRHI - DAEE"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Versão OGC WMS
                      </label>
                      <select
                        value={wmsVersion}
                        onChange={(e) => setWmsVersion(e.target.value as '1.1.1' | '1.3.0')}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                      >
                        <option value="1.1.1">WMS 1.1.1 (Padrão GeoServer / DataGeo SP)</option>
                        <option value="1.3.0">WMS 1.3.0</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Formato de Imagem
                      </label>
                      <select
                        value={wmsFormat}
                        onChange={(e) => setWmsFormat(e.target.value as 'image/png' | 'image/jpeg')}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                      >
                        <option value="image/png">image/png (Fundo Transparente - Recomendado)</option>
                        <option value="image/jpeg">image/jpeg (Opaco / Ortofotos)</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {protocol === 'xyz' && (
                <div className="space-y-4 bg-slate-50/70 border border-slate-200 rounded-xl p-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      URL Template do Serviço XYZ / TMS (com {'{z}'}, {'{x}'} e {'{y}'}) *
                    </label>
                    <input
                      type="text"
                      value={xyzUrl}
                      onChange={(e) => setXyzUrl(e.target.value)}
                      placeholder="https://tile.opentopomap.org/{z}/{x}/{y}.png"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-red-600"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Nome de Exibição
                      </label>
                      <input
                        type="text"
                        value={xyzName}
                        onChange={(e) => setXyzName(e.target.value)}
                        placeholder="Ex: Carta Topográfica"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Zoom Máximo
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={22}
                        value={xyzMaxZoom}
                        onChange={(e) => setXyzMaxZoom(Number(e.target.value) || 19)}
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-red-600"
                      />
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        Atribuição / Fonte
                      </label>
                      <input
                        type="text"
                        value={xyzAttribution}
                        onChange={(e) => setXyzAttribution(e.target.value)}
                        placeholder="Ex: © IBGE / OpenTopoMap"
                        className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                      />
                    </div>
                  </div>
                </div>
              )}

              {protocol === 'geojson' && (
                <div className="space-y-4 bg-slate-50/70 border border-slate-200 rounded-xl p-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      URL Pública do Arquivo ou API GeoJSON *
                    </label>
                    <input
                      type="text"
                      value={geojsonUrl}
                      onChange={(e) => setGeojsonUrl(e.target.value)}
                      placeholder="https://exemplo.gov.br/dados/camada.geojson"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 font-mono focus:outline-none focus:border-red-600"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nome de Exibição da Camada
                    </label>
                    <input
                      type="text"
                      value={geojsonName}
                      onChange={(e) => setGeojsonName(e.target.value)}
                      placeholder="Ex: Limites de Bacias Hidrográficas"
                      className="w-full px-3 py-2 bg-white border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:border-red-600"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Status Feedback */}
          {statusMessage && (
            <div
              className={`p-3.5 rounded-xl border flex items-center gap-2.5 text-xs ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-rose-50 border-rose-200 text-rose-900'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <span className="text-[11px] text-slate-500">
            Camadas Web são adicionadas como sobreposição (isentas do filtro global).
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-200/70 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
            >
              Fechar
            </button>
            {activeTab === 'custom' && (
              <button
                type="button"
                onClick={handleAddCustomLayer}
                disabled={isLoadingGeojson}
                className="px-5 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              >
                {isLoadingGeojson ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando GeoJSON...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Adicionar Camada ao Mapa</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
