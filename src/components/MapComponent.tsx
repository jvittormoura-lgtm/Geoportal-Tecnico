import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import proj4 from 'proj4';
import { BasemapOption, GisLayer } from '../types/gis';
import { 
  filterFeatures, 
  filterValidGeoJsonFeatures,
  getFeatureSituacao,
  normalizeSituacaoKey,
  calculateFeatureArea,
  extractUhFromProperties,
  extractAreaM2FromProperties,
  extractFeaturesMetrics,
  calculateBoundingBox
} from '../utils/geoJsonParser';
import { 
  Ruler, Trash2, X, ChevronDown 
} from 'lucide-react';
import * as turf from '@turf/turf';

import { MapToolbar } from './MapToolbar';


interface MapComponentProps {
  layers: GisLayer[];
  activeBasemap: BasemapOption;
  onSelectBasemap: (basemap: BasemapOption) => void;
  selectedFeature: GeoJSON.Feature | null;
  fitBoundsTrigger?: number;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  onFeatureClick?: (feature: GeoJSON.Feature, layerId: string, featureIndex?: number) => void;
  onOpenFeatureInspector?: (feature: GeoJSON.Feature, layerId: string, featureIndex: number) => void;
  onDrawingCreated?: (geojson: GeoJSON.Feature) => void;
  onOpenDetailModal?: (feature: GeoJSON.Feature) => void;
  onOpenFieldManager?: (layerId: string) => void;
  onOpenAttributeTable?: (layerId: string) => void;
}

// Custom scale rounding: include 75 km between 100 km and 50 km
if (typeof window !== 'undefined' && L?.Control && (L.Control as any).Scale) {
  (L.Control as any).Scale.prototype._getRoundNum = function (num: number) {
    if (num >= 75000 && num < 100000) {
      return 75000;
    }
    const pow10 = Math.pow(10, (Math.floor(num) + '').length - 1);
    let d = num / pow10;

    d = d >= 10 ? 10 :
        d >= 7.5 ? 7.5 :
        d >= 5 ? 5 :
        d >= 3 ? 3 :
        d >= 2 ? 2 : 1;

    return pow10 * d;
  };
}

// High-performance isolated Coordinate & Zoom HUD (throttled to display refresh rate)
const CoordinatesHud: React.FC<{ map: L.Map | null }> = ({ map }) => {
  const [mouseCoords, setMouseCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [currentZoom, setCurrentZoom] = useState<number>(map ? map.getZoom() : 7);
  const [coordFormat, setCoordFormat] = useState<'geo' | 'utm'>('utm');

  useEffect(() => {
    if (!map) return;

    let rafId: number | null = null;
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        setMouseCoords({
          lat: parseFloat(e.latlng.lat.toFixed(5)),
          lng: parseFloat(e.latlng.lng.toFixed(5))
        });
        rafId = null;
      });
    };

    const handleZoomEnd = () => {
      setCurrentZoom(map.getZoom());
    };

    map.on('mousemove', handleMouseMove);
    map.on('zoomend', handleZoomEnd);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      map.off('mousemove', handleMouseMove);
      map.off('zoomend', handleZoomEnd);
    };
  }, [map]);

  const utmData = useMemo(() => {
    if (!mouseCoords || coordFormat !== 'utm') return null;
    const zone = Math.floor((mouseCoords.lng + 180) / 6) + 1;
    const isNorth = mouseCoords.lat >= 0;
    // Define SIRGAS 2000 (GRS80 ellipsoid)
    const utmProj = `+proj=utm +zone=${zone} ${isNorth ? '+north' : '+south'} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    const [x, y] = proj4('EPSG:4326', utmProj, [mouseCoords.lng, mouseCoords.lat]);
    const epsgCode = isNorth ? 31950 + zone : 31960 + zone;
    return { zone, isNorth, x, y, epsgCode };
  }, [mouseCoords, coordFormat]);

  return (
    <div className="absolute bottom-3 left-3 z-[1000] hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50/80 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-500 backdrop-blur-xs shadow-lg pointer-events-auto select-none">
      {mouseCoords ? (
        coordFormat === 'geo' ? (
          <div className="flex items-center cursor-pointer hover:bg-slate-200/50 px-2 py-0.5 rounded transition-colors" onClick={() => setCoordFormat('utm')} title="Alternar para UTM (X/Y)">
            <span className="text-slate-500 mr-1">Lat:</span>
            <strong className="text-slate-800 mr-2">{mouseCoords.lat > 0 ? `+${mouseCoords.lat}` : mouseCoords.lat}°</strong>
            <span className="text-slate-500 mr-1">Lng:</span>
            <strong className="text-slate-800">{mouseCoords.lng > 0 ? `+${mouseCoords.lng}` : mouseCoords.lng}°</strong>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
          </div>
        ) : utmData ? (
          <div className="flex items-center cursor-pointer hover:bg-slate-200/50 px-2 py-0.5 rounded transition-colors" onClick={() => setCoordFormat('geo')} title="Alternar para Geográfica (Lat/Lng)">
            <span className="text-slate-500 mr-2 font-medium">
              EPSG:{utmData.epsgCode} (UTM {utmData.zone}{utmData.isNorth ? 'N' : 'S'})
            </span>
            <span className="text-slate-500 mr-1">X:</span>
            <strong className="text-slate-800 mr-2">{utmData.x.toFixed(2)}</strong>
            <span className="text-slate-500 mr-1">Y:</span>
            <strong className="text-slate-800">{utmData.y.toFixed(2)}</strong>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 ml-1" />
          </div>
        ) : null
      ) : (
        <span className="px-2">Mova o cursor sobre o mapa</span>
      )}
      <span>•</span>
      <div>
        <span className="text-slate-500">Zoom:</span> <strong className="text-red-600">{Number(currentZoom).toFixed(currentZoom % 1 === 0 ? 0 : 1)}</strong>
      </div>
      <span>•</span>
      <div className="flex items-center text-slate-500 font-semibold">
        SIRGAS 2000
      </div>
    </div>
  );
};

const MapComponentBase: React.FC<MapComponentProps> = ({
  layers,
  activeBasemap,
  onSelectBasemap,
  selectedFeature,
  fitBoundsTrigger,
  isSidebarOpen,
  onFeatureClick,
  onOpenFeatureInspector,
  onDrawingCreated,
  onOpenDetailModal,
  onOpenFieldManager,
  onOpenAttributeTable
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const vectorLayersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const layerSignaturesRef = useRef<Map<string, string>>(new Map());
  const prevLayerOrderRef = useRef<string>('');
  const canvasRendererRef = useRef<L.Canvas | null>(null);
  const highlightLayerRef = useRef<L.GeoJSON | null>(null);
  const clickedFromMapRef = useRef<number>(0);
  const scaleControlRef = useRef<L.Control.Scale | null>(null);
  const zoomControlRef = useRef<L.Control.Zoom | null>(null);

  // Measurement state
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurePoints, setMeasurePoints] = useState<L.LatLng[]>([]);
  const [measureMouse, setMeasureMouse] = useState<L.LatLng | null>(null);
  const [measurementResult, setMeasurementResult] = useState<{distance: number, area: number | null}>({distance: 0, area: null});
  const measureGroupRef = useRef<L.FeatureGroup | null>(null);

  const layersRef = useRef(layers);
  layersRef.current = layers;

  const callbacksRef = useRef({
    onOpenDetailModal,
    onOpenFeatureInspector,
    onOpenFieldManager,
    onOpenAttributeTable,
    onFeatureClick
  });
  callbacksRef.current = {
    onOpenDetailModal,
    onOpenFeatureInspector,
    onOpenFieldManager,
    onOpenAttributeTable,
    onFeatureClick
  };

  // Initialize Map with Hardware-Accelerated Canvas
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (mapInstanceRef.current) {
      try {
        mapInstanceRef.current.remove();
      } catch (e) {
        console.warn('Map instance remove error:', e);
      }
      mapInstanceRef.current = null;
      setMapInstance(null);
    }

    // Clean any orphaned DOM controls or elements inside container
    mapContainerRef.current.innerHTML = '';

    const map = L.map(mapContainerRef.current, {
      center: [-22.3, -49.0], // Estado de São Paulo center
      zoom: 7,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 80,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true // GPU-accelerated canvas for vector layers
    });

    map.attributionControl.setPrefix('<b style="color: #3b82f6;">GRAPROHAB</b> | <a href="https://leafletjs.com" target="_blank">Leaflet</a>');

    // Shared canvas renderer with padding to prevent edge re-draws during pan
    canvasRendererRef.current = L.canvas({ padding: 0.5, tolerance: 6 });

    // Custom zoom control in bottom-right
    zoomControlRef.current = L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Single scale control in bottom-left (metric only, max 100px)
    scaleControlRef.current = L.control.scale({ 
      position: 'bottomleft', 
      metric: true, 
      imperial: false, 
      maxWidth: 100 
    }).addTo(map);

    // Initial tile layer with buffer to prevent grey tiles during pan
    const tileLayer = L.tileLayer(activeBasemap.url, {
      attribution: activeBasemap.attribution,
      maxZoom: activeBasemap.maxZoom,
      subdomains: activeBasemap.subdomains || ['a', 'b', 'c'],
      keepBuffer: 4,
      updateWhenZooming: false,
      updateWhenIdle: false
    }).addTo(map);

    tileLayerRef.current = tileLayer;
    mapInstanceRef.current = map;
    setMapInstance(map);

    return () => {
      if (scaleControlRef.current) {
        try {
          scaleControlRef.current.remove();
        } catch (e) {}
        scaleControlRef.current = null;
      }
      if (zoomControlRef.current) {
        try {
          zoomControlRef.current.remove();
        } catch (e) {}
        zoomControlRef.current = null;
      }
      try {
        map.remove();
      } catch (e) {}
      if (mapContainerRef.current) {
        mapContainerRef.current.innerHTML = '';
      }
      mapInstanceRef.current = null;
      setMapInstance(null);
      canvasRendererRef.current = null;
    };
  }, []);

  // Smooth resize handling when sidebar toggles
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const timer = setTimeout(() => {
      map.invalidateSize({ animate: false });
    }, 280);
    return () => clearTimeout(timer);
  }, [isSidebarOpen]);

  // Update Basemap Tiles
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const newTileLayer = L.tileLayer(activeBasemap.url, {
      attribution: activeBasemap.attribution,
      maxZoom: activeBasemap.maxZoom,
      subdomains: activeBasemap.subdomains || ['a', 'b', 'c'],
      keepBuffer: 4,
      updateWhenZooming: false,
      updateWhenIdle: false
    }).addTo(map);

    // Send tile layer to back so vector layers stay on top
    newTileLayer.bringToBack();
    tileLayerRef.current = newTileLayer;
  }, [activeBasemap]);

  // Style calculator for features
  const getFeatureStyle = useCallback((feature: GeoJSON.Feature, layer: GisLayer): L.PathOptions => {
    const defaultFill = layer.style?.fillColor || '#ef4444';
    const defaultStroke = layer.style?.strokeColor || '#ef4444';
    let fill = defaultFill;
    let stroke = defaultStroke;

    // Check thematic classification
    if (layer.thematic && layer.thematic.enabled && layer.thematic.classes?.length > 0) {
      const propKey = layer.thematic.property;
      const rawVal = feature.properties ? feature.properties[propKey] : null;

      if (rawVal !== null && rawVal !== undefined) {
        if (layer.thematic.mode === 'graduated' && typeof rawVal === 'number') {
          for (const cls of layer.thematic.classes) {
            if (cls.min !== undefined && cls.max !== undefined) {
              if (rawVal >= cls.min && rawVal <= cls.max) {
                fill = cls.color;
                break;
              }
            }
          }
        } else {
          // Categorical
          const strVal = String(rawVal);
          const found = layer.thematic.classes.find(c => c.value === strVal);
          if (found) fill = found.color;
        }
      }
    }

    const strokeOpacity = typeof layer.style?.strokeOpacity === 'number' ? layer.style.strokeOpacity : 0.9;
    const fillOpacity = typeof layer.style?.fillOpacity === 'number' ? layer.style.fillOpacity : 0.45;
    const layerOpacity = typeof layer.opacity === 'number' && layer.opacity > 0 ? layer.opacity : 1;

    return {
      fillColor: fill,
      color: stroke,
      weight: layer.style?.strokeWidth ?? 2,
      opacity: Math.max(0.05, Math.min(1, isNaN(strokeOpacity * layerOpacity) ? 0.9 : strokeOpacity * layerOpacity)),
      fillOpacity: Math.max(0.05, Math.min(1, isNaN(fillOpacity * layerOpacity) ? 0.45 : fillOpacity * layerOpacity))
    };
  }, []);

  // Register global window helper functions for interactive popup buttons
  useEffect(() => {
    (window as any).__gis_open_detail = (layerId: string, featureIndex: number) => {
      const targetLayer = layersRef.current.find(l => l.id === layerId);
      if (targetLayer && callbacksRef.current.onOpenDetailModal) {
        const feat = targetLayer.data.features[featureIndex] || targetLayer.data.features[0];
        if (feat) {
          callbacksRef.current.onOpenDetailModal(feat);
        }
      }
    };

    (window as any).__gis_open_feature_inspector = (layerId: string, featureIndex: number) => {
      const targetLayer = layersRef.current.find(l => l.id === layerId);
      if (targetLayer && callbacksRef.current.onOpenFeatureInspector) {
        const feat = targetLayer.data.features[featureIndex] || targetLayer.data.features[0];
        if (feat) {
          callbacksRef.current.onOpenFeatureInspector(feat, layerId, featureIndex);
        }
      }
    };

    (window as any).__gis_open_field_manager = (layerId: string) => {
      callbacksRef.current.onOpenFieldManager?.(layerId);
    };

    (window as any).__gis_open_attr_table = (layerId: string) => {
      callbacksRef.current.onOpenAttributeTable?.(layerId);
    };

    (window as any).__gis_copy_props = (layerId: string, featureIndex: number) => {
      try {
        const targetLayer = layersRef.current.find(l => l.id === layerId);
        if (targetLayer) {
          const feat = targetLayer.data.features[featureIndex] || targetLayer.data.features[0];
          if (feat && feat.properties) {
            navigator.clipboard.writeText(JSON.stringify(feat.properties, null, 2));
            // Show brief visual notice
            const notice = document.createElement('div');
            notice.innerText = '✓ Atributos copiados!';
            notice.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0284c7;color:#fff;padding:8px 16px;border-radius:9999px;font-size:12px;font-weight:600;z-index:99999;box-shadow:0 10px 25px rgba(0,0,0,0.5);';
            document.body.appendChild(notice);
            setTimeout(() => notice.remove(), 2000);
          }
        }
      } catch (e) {
        console.error('Error copying props:', e);
      }
    };

    return () => {
      delete (window as any).__gis_open_detail;
      delete (window as any).__gis_open_feature_inspector;
      delete (window as any).__gis_open_field_manager;
      delete (window as any).__gis_open_attr_table;
      delete (window as any).__gis_copy_props;
    };
  }, []);

  // Format popup table HTML
  const createPopupContent = useCallback((feature: GeoJSON.Feature, layer: GisLayer, featureIndex: number): string => {
    const props = feature.properties || {};
    const geomType = feature.geometry?.type || 'Geometria';

    const isGraprohab = !!(props.processo_graprohab || props.nome_empreendimento);
    
    // Determine custom popup title if configured or fallback
    let title = '';
    if (layer.popupTitleField && props[layer.popupTitleField] !== undefined && props[layer.popupTitleField] !== null) {
      title = String(props[layer.popupTitleField]);
    } else {
      const candidates = ['nome_empreendimento', 'nome', 'Nome', 'NOME', 'titulo', 'name', 'processo_graprohab', 'processo'];
      let foundTitle = '';
      for (const c of candidates) {
        if (props[c] !== undefined && props[c] !== null) {
          foundTitle = String(props[c]);
          break;
        }
      }
      if (!foundTitle && layer.propertiesSchema && layer.propertiesSchema?.length > 0) {
        const firstKey = layer.propertiesSchema[0].key;
        if (props[firstKey] !== undefined && props[firstKey] !== null) {
          foundTitle = String(props[firstKey]);
        }
      }
      title = foundTitle || `Feição #${featureIndex + 1}`;
    }

    // Determine field display order and visibility
    let orderedKeys: string[] = [];
    if (layer.popupFieldOrder && layer.popupFieldOrder?.length > 0) {
      orderedKeys = [...layer.popupFieldOrder];
    } else if (layer.propertiesSchema && layer.propertiesSchema?.length > 0) {
      orderedKeys = layer.propertiesSchema.map(p => p.key);
    } else {
      orderedKeys = Object.keys(props);
    }

    // Filter by visibility if defined
    if (layer.popupVisibleFields && layer.popupVisibleFields?.length > 0) {
      orderedKeys = orderedKeys.filter(k => layer.popupVisibleFields!.includes(k));
    }
    
    let rowsHtml = '';
    orderedKeys.forEach((key) => {
      if (!(key in props)) return;
      const val = props[key];
      const displayVal = val !== null && val !== undefined ? String(val) : '-';
      rowsHtml += `
        <tr style="border-bottom: 1px solid #f1f5f9;">
          <td style="padding: 10px 8px 10px 0; font-weight: 600; color: #64748b; font-size: 11px; white-space: nowrap; vertical-align: top; width: 35%; text-transform: uppercase;">${key}:</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 11px; font-weight: 600; word-break: break-word;">${displayVal}</td>
        </tr>
      `;
    });

    // Status badge if available
    let statusBadge = '';
    const sitValue = getFeatureSituacao(props) || props.status_graprohab || '';
    if (sitValue) {
      const normSit = normalizeSituacaoKey(sitValue);
      let color = '#38bdf8';
      let bg = 'rgba(56, 189, 248, 0.12)';
      if (normSit.includes('CANCELAD') || normSit.includes('INDEFER') || normSit.includes('REVOGAD')) {
        color = '#ef4444';
        bg = 'rgba(239, 68, 68, 0.12)';
      } else if (normSit.includes('APROVAD') || normSit.includes('CERTIFICAD')) {
        color = '#10b981';
        bg = 'rgba(16, 185, 129, 0.12)';
      } else if (normSit.includes('ANALIS') || normSit.includes('EXIGENC') || normSit.includes('TRAMIT')) {
        color = '#f59e0b';
        bg = 'rgba(245, 158, 11, 0.12)';
      } else if (normSit.includes('DISPENS')) {
        color = '#f97316';
        bg = 'rgba(249, 115, 22, 0.12)';
      }
      statusBadge = `
        <span style="font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 9999px; background: ${bg}; color: ${color}; border: 1px solid ${color}40;">
          ${sitValue}
        </span>
      `;
    }

    return `
      <div style="font-family: 'Plus Jakarta Sans', system-ui, sans-serif; width: 100%; min-width: min(380px, calc(100vw - 48px)); max-width: min(460px, calc(100vw - 32px)); color: #1e293b; background: #ffffff; border-radius: 6px; overflow: hidden;">
        
        <!-- Header -->
        <div style="padding: 16px 16px 8px 16px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; gap: 6px;">
            <div style="font-size: 10px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.3;">
              ${layer.name}
            </div>
            ${statusBadge ? `<div>${statusBadge}</div>` : ''}
          </div>
          <div style="font-size: 15px; font-weight: 800; color: #0f172a; line-height: 1.2;">
            ${title}
          </div>
          ${props.municipio ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">📍 ${props.municipio}</div>` : ''}
        </div>
        
        <!-- Red Line -->
        <div style="height: 2px; background-color: #ef4444; margin: 0 16px 8px 16px;"></div>

        <!-- Attributes Table List -->
        <div class="custom-gis-popup-scroll" style="max-height: 240px; overflow-y: auto; padding: 0 16px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tbody>
              ${rowsHtml || '<tr><td style="padding: 16px; color: #94a3b8; font-size: 12px; text-align: center;">Sem atributos</td></tr>'}
            </tbody>
          </table>
        </div>
        
        <!-- Footer / Action Buttons -->
        <div style="padding: 10px 14px; background: #f8fafc; border-top: 1px solid #f1f5f9; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;">
            ${isGraprohab ? `
              <button onclick="window.__gis_open_detail('${layer.id}', ${featureIndex})" style="flex: 1; min-width: 65px; padding: 5px 6px; background: #ffffff; color: #0284c7; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                📄 Ficha
              </button>
            ` : ''}
            <button onclick="window.__gis_open_feature_inspector('${layer.id}', ${featureIndex})" style="flex: 1; min-width: 65px; padding: 5px 6px; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
              ✏️ Detalhes
            </button>
            <button onclick="window.__gis_open_field_manager('${layer.id}')" style="flex: 1; min-width: 65px; padding: 5px 6px; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
              ⚙️ Colunas
            </button>
            <button onclick="window.__gis_copy_props('${layer.id}', ${featureIndex})" style="flex: 1; min-width: 65px; padding: 5px 6px; background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
              📋 Copiar
            </button>
          </div>
        </div>

      </div>
    `;
  }, []);

  // Compute unique signature of layer state to avoid unnecessary layer destruction
  const getLayerSignature = useCallback((l: GisLayer): string => {
    return [
      l.id,
      l.visible ? '1' : '0',
      l.opacity ?? 1,
      l.data?.features?.length || 0,
      JSON.stringify(l.filters || []),
      JSON.stringify(l.style || {}),
      JSON.stringify(l.thematic || {}),
      JSON.stringify(l.popupFieldOrder || []),
      JSON.stringify(l.popupVisibleFields || []),
      l.popupTitleField || ''
    ].join('|');
  }, []);

  // Update Vector Layers on Map with incremental caching and hardware-accelerated Canvas
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    // Remove layers no longer in props
    const currentLayerIds = new Set(layers.map(l => l.id));
    vectorLayersRef.current.forEach((leafletGeoJson, layerId) => {
      if (!currentLayerIds.has(layerId)) {
        map.removeLayer(leafletGeoJson);
        vectorLayersRef.current.delete(layerId);
        layerSignaturesRef.current.delete(layerId);
      }
    });

    // Check if layer order sequence changed
    const currentOrderKey = layers.map(l => l.id).join(',');
    const orderChanged = prevLayerOrderRef.current !== currentOrderKey;
    prevLayerOrderRef.current = currentOrderKey;

    // Add or update layers (reverse to match Photoshop/QGIS top-to-bottom visual order)
    const reversedLayers = [...layers].reverse();

    reversedLayers.forEach((layer) => {
      const existing = vectorLayersRef.current.get(layer.id);
      const signature = getLayerSignature(layer);
      const prevSignature = layerSignaturesRef.current.get(layer.id);

      if (!layer.visible) {
        if (existing) {
          map.removeLayer(existing);
          vectorLayersRef.current.delete(layer.id);
          layerSignaturesRef.current.delete(layer.id);
        }
        return;
      }

      // If layer already rendered and its configuration hasn't changed and order hasn't changed, KEEP IT!
      if (existing && prevSignature === signature && !orderChanged) {
        return;
      }

      // Clean up previous layer instance if needing recreation
      if (existing) {
        map.removeLayer(existing);
        vectorLayersRef.current.delete(layer.id);
      }

      // Filter features
      const filtered = filterFeatures(layer.data.features, layer.filters);
      if (filtered?.length === 0) {
        layerSignaturesRef.current.set(layer.id, signature);
        return;
      }

      // Filter out invalid geometries so Leaflet does not crash
      const validFeatures = filterValidGeoJsonFeatures(filtered);
      if (validFeatures?.length === 0) {
        layerSignaturesRef.current.set(layer.id, signature);
        return;
      }

      const filteredCollection: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: validFeatures
      };

      const geoJsonOptions: any = {
        renderer: canvasRendererRef.current || undefined,
        smoothFactor: Math.min(layer.style?.smoothFactor !== undefined ? layer.style.smoothFactor : 1.0, 1.5),
        style: (feature: GeoJSON.Feature) => {
          if (!feature) return {};
          return getFeatureStyle(feature, layer);
        },
        pointToLayer: (feature: any, latlng: any) => {
          const style = getFeatureStyle(feature, layer);
          const radius = typeof layer.style?.pointRadius === 'number' && layer.style.pointRadius > 0 ? layer.style.pointRadius : 7;
          return L.circleMarker(latlng, {
            renderer: canvasRendererRef.current || undefined,
            radius,
            fillColor: style.fillColor,
            color: style.color,
            weight: style.weight,
            opacity: style.opacity,
            fillOpacity: style.fillOpacity
          });
        },
        onEachFeature: (feature: any, leafletLayer: any) => {
          const featureIndex = Math.max(0, layer.data.features.indexOf(feature));

          // Bind popup lazily to avoid generating heavy HTML tables upfront
          leafletLayer.bindPopup(() => {
            return createPopupContent(feature, layer, featureIndex);
          }, { 
            minWidth: 360,
            maxWidth: 460, 
            className: 'custom-gis-popup',
            autoPan: true,
            autoPanPadding: [40, 40]
          });

          // Forward feature click callback
          leafletLayer.on('click', (e: L.LeafletMouseEvent) => {
            // Timestamp that click originated on the map to prevent flyToBounds from dismissing the popup
            clickedFromMapRef.current = Date.now();

            // Explicitly trigger openPopup at click latlng if not already open
            if (e && e.latlng && leafletLayer.openPopup && !leafletLayer.isPopupOpen()) {
              leafletLayer.openPopup(e.latlng);
            }

            if (callbacksRef.current.onFeatureClick) {
              callbacksRef.current.onFeatureClick(feature, layer.id, featureIndex);
            }
          });

          // Hover tooltips for quick preview
          const props = feature.properties || {};
          const tooltipText = props.nome_empreendimento || props.name || props.nome || props.cidade || props.municipio || props.local || props.bioma || props.uf || '';
          if (tooltipText) {
            leafletLayer.bindTooltip(String(tooltipText), {
              sticky: true,
              className: 'bg-white text-slate-900 text-xs border border-slate-300 px-2 py-1 rounded-md shadow-lg'
            });
          }
        }
      };

      try {
        const geoJsonLayer = L.geoJSON(filteredCollection, geoJsonOptions);
        geoJsonLayer.addTo(map);
        vectorLayersRef.current.set(layer.id, geoJsonLayer);
        layerSignaturesRef.current.set(layer.id, signature);
      } catch (layerErr) {
        console.warn(`Tentando adicionar feições individualmente para ${layer.name}:`, layerErr);
        try {
          const group = L.featureGroup();
          for (const singleFeat of validFeatures) {
            try {
              const singleLayer = L.geoJSON(singleFeat, geoJsonOptions);
              singleLayer.addTo(group);
            } catch {
              // Ignore single malformed feature
            }
          }
          group.addTo(map);
          vectorLayersRef.current.set(layer.id, group as any);
          layerSignaturesRef.current.set(layer.id, signature);
        } catch (groupErr) {
          console.error(`Falha ao instanciar camada ${layer.name} no Leaflet:`, groupErr);
        }
      }
    });
  }, [layers, getFeatureStyle, createPopupContent, getLayerSignature]);

  // Handle Feature Selection & Highlighting (non-interactive to avoid blocking clicks)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (highlightLayerRef.current) {
      map.removeLayer(highlightLayerRef.current);
      highlightLayerRef.current = null;
    }

    if (selectedFeature) {
      const hlOptions: any = {
        interactive: false,
        renderer: canvasRendererRef.current || undefined,
        style: {
          color: '#38bdf8',
          weight: 4,
          fillColor: '#38bdf8',
          fillOpacity: 0.35,
          dashArray: '4, 4'
        },
        pointToLayer: (f: any, latlng: any) => {
          return L.circleMarker(latlng, {
            renderer: canvasRendererRef.current || undefined,
            interactive: false,
            radius: 12,
            fillColor: '#38bdf8',
            color: '#ffffff',
            weight: 3,
            fillOpacity: 0.9
          });
        }
      };
      const hlLayer = L.geoJSON(selectedFeature, hlOptions).addTo(map);

      highlightLayerRef.current = hlLayer;
      
      // Only flyToBounds if NOT clicked directly from the map, to avoid closing the open popup
      const clickedRecently = (Date.now() - clickedFromMapRef.current) < 800;
      if (!clickedRecently) {
        try {
          const bounds = hlLayer.getBounds();
          if (bounds.isValid()) {
            map.flyToBounds(bounds, { padding: [50, 50], maxZoom: 16, duration: 1.5 });
          }
        } catch (e) {
          console.warn('Could not fit bounds to selected feature', e);
        }
      }
    }
  }, [selectedFeature]);

  const handleLocateMe = () => {
    if (!navigator.geolocation || !mapInstanceRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        mapInstanceRef.current?.flyTo([latitude, longitude], 13, { duration: 1.5 });
        L.circleMarker([latitude, longitude], {
          radius: 10,
          fillColor: '#38bdf8',
          color: '#ffffff',
          weight: 3,
          fillOpacity: 0.9
        }).addTo(mapInstanceRef.current!).bindPopup('<b>Sua localização atual</b>').openPopup();
      },
      (err) => {
        console.warn('Geolocation failed:', err.message);
      }
    );
  };

  const handleResetExtent = () => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (layers?.length > 0) {
      const validLayers = layers.filter(l => l.visible && l.data?.features?.length > 0);
      if (validLayers?.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        validLayers.forEach(l => {
          const bbox = (Array.isArray(l.bbox) && l.bbox.length === 4) ? l.bbox : ((l as any).boundingBox || calculateBoundingBox(l.data.features));
          if (Array.isArray(bbox) && bbox.length === 4) {
            minX = Math.min(minX, bbox[0]);
            minY = Math.min(minY, bbox[1]);
            maxX = Math.max(maxX, bbox[2]);
            maxY = Math.max(maxY, bbox[3]);
          }
        });
        if (minX !== Infinity) {
          if (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90) {
            try {
              map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [40, 40] });
            } catch(e) {
              console.warn('Leaflet fitBounds falhou:', e);
            }
          }
          return;
        }
      }
    }
    map.flyTo([-22.3, -49.0], 7);
  };

  useEffect(() => {
    if (fitBoundsTrigger && fitBoundsTrigger > 0) {
      const map = mapInstanceRef.current;
      if (!map) return;

      const currentLayers = layersRef.current;
      const validLayers = currentLayers.filter(l => l.visible && l.data?.features?.length > 0);
      if (validLayers?.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        validLayers.forEach(l => {
          const filtered = filterFeatures(l.data.features, l.filters);
          if (filtered?.length > 0) {
            const bbox = calculateBoundingBox(filtered);
            minX = Math.min(minX, bbox[0]);
            minY = Math.min(minY, bbox[1]);
            maxX = Math.max(maxX, bbox[2]);
            maxY = Math.max(maxY, bbox[3]);
          }
        });

        if (minX !== Infinity) {
          // Safety check to prevent Leaflet from crashing on UTM coordinates
          if (minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90) {
            try {
              map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [40, 40], maxZoom: 16 });
            } catch(e) {
              console.warn('Leaflet fitBounds falhou:', e);
            }
          }
        }
      }
    }
  }, [fitBoundsTrigger]);

  // Measurement Interaction with RAF throttling
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const onMapClick = (e: L.LeafletMouseEvent) => {
      if (!isMeasuring) return;
      setMeasurePoints(prev => [...prev, e.latlng]);
    };
    
    let measureRafId: number | null = null;
    const onMouseMove = (e: L.LeafletMouseEvent) => {
      if (!isMeasuring) return;
      if (measureRafId !== null) return;
      measureRafId = requestAnimationFrame(() => {
        setMeasureMouse(e.latlng);
        measureRafId = null;
      });
    };

    if (isMeasuring) {
      document.getElementById('map-container')?.classList.add('cursor-crosshair');
      map.on('click', onMapClick);
      map.on('mousemove', onMouseMove);
    } else {
      document.getElementById('map-container')?.classList.remove('cursor-crosshair');
      map.off('click', onMapClick);
      map.off('mousemove', onMouseMove);
      setMeasurePoints([]);
      setMeasureMouse(null);
    }

    return () => {
      if (measureRafId !== null) cancelAnimationFrame(measureRafId);
      map.off('click', onMapClick);
      map.off('mousemove', onMouseMove);
      document.getElementById('map-container')?.classList.remove('cursor-crosshair');
    };
  }, [isMeasuring]);

  // Measurement Rendering and Calculation
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    if (!measureGroupRef.current) {
      measureGroupRef.current = L.featureGroup().addTo(map);
    }
    const group = measureGroupRef.current;
    group.clearLayers();
    
    if (!isMeasuring) {
       setMeasurementResult({ distance: 0, area: null });
       return;
    }
    
    const currentPoints = [...measurePoints];
    if (measureMouse) {
      currentPoints.push(measureMouse);
    }
    
    if (currentPoints?.length > 0) {
      if (currentPoints?.length > 1) {
        L.polyline(currentPoints, { color: '#f43f5e', weight: 3, dashArray: '5, 5' }).addTo(group);
      }
      
      const polyPts = measureMouse ? [...measurePoints, measureMouse] : [...measurePoints];
      if (polyPts?.length > 2) {
        L.polygon(polyPts, { color: '#f43f5e', weight: 0, fillColor: '#f43f5e', fillOpacity: 0.2 }).addTo(group);
      }
      
      measurePoints.forEach(pt => {
        L.circleMarker(pt, { radius: 5, color: '#f43f5e', fillColor: '#fff', weight: 2, fillOpacity: 1 }).addTo(group);
      });
      
      let dist = 0;
      let ar: number | null = null;
      if (currentPoints?.length > 1) {
        const coords = currentPoints.map(p => [p.lng, p.lat]);
        const line = turf.lineString(coords);
        dist = turf.length(line, { units: 'kilometers' });
      }
      
      if (polyPts?.length > 2) {
        const polyCoords = [...polyPts.map(p => [p.lng, p.lat]), [polyPts[0].lng, polyPts[0].lat]];
        const poly = turf.polygon([polyCoords]);
        ar = turf.area(poly);
      }
      setMeasurementResult({ distance: dist, area: ar });
    }
  }, [measurePoints, measureMouse, isMeasuring]);

  const handleAddressFlyTo = (lat: number, lon: number, bbox?: [number, number, number, number]) => {
    const map = mapInstanceRef.current;
    if (!map) return;
    
    if (bbox) {
      map.flyToBounds([
        [bbox[0], bbox[2]],
        [bbox[1], bbox[3]]
      ], { duration: 1.5, maxZoom: 16 });
    } else {
      map.flyTo([lat, lon], 16, { duration: 1.5 });
    }
    
    // Add a temporary marker
    const marker = L.circleMarker([lat, lon], {
      radius: 8,
      fillColor: '#f43f5e',
      color: '#ffffff',
      weight: 2,
      fillOpacity: 1
    }).addTo(map);
    
    setTimeout(() => {
      if (mapInstanceRef.current && mapInstanceRef.current.hasLayer(marker)) {
        mapInstanceRef.current.removeLayer(marker);
      }
    }, 5000);
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-slate-50">
      {/* Leaflet DOM container */}
      <div id="map-container" ref={mapContainerRef} className="w-full h-full z-0" />

      <MapToolbar 
        onFlyTo={handleAddressFlyTo}
        activeBasemap={activeBasemap}
        onSelectBasemap={onSelectBasemap}
        onLocateMe={handleLocateMe}
        onResetExtent={handleResetExtent}
        isMeasuring={isMeasuring}
        onToggleMeasure={() => setIsMeasuring(!isMeasuring)}
      />

      {isMeasuring && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1000] bg-white/95 backdrop-blur-sm px-4 py-2.5 rounded-xl border border-slate-200/80 shadow-lg flex items-center gap-4">
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Distância Total</span>
            <span className="text-sm font-bold text-slate-800">
              {measurementResult.distance < 1 
                ? `${(measurementResult.distance * 1000).toFixed(0)} m` 
                : `${measurementResult.distance.toFixed(2)} km`}
            </span>
          </div>
          
          <div className="w-px h-8 bg-slate-200"></div>
          
          <div className="flex flex-col">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Área</span>
            <span className="text-sm font-bold text-slate-800">
              {measurementResult.area === null 
                ? '--' 
                : measurementResult.area > 10000 
                  ? `${(measurementResult.area / 10000).toFixed(2)} ha` 
                  : `${measurementResult.area.toFixed(0)} m²`}
            </span>
          </div>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setMeasurePoints([]);
              setMeasurementResult({ distance: 0, area: null });
            }}
            className="ml-2 p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Limpar Medição"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              setIsMeasuring(false);
            }}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Bottom Floating Coordinate / Zoom HUD (Decoupled to keep parent render count zero during pan/zoom) */}
      <CoordinatesHud map={mapInstance} />
    </div>
  );
};

export const MapComponent = React.memo(MapComponentBase);
