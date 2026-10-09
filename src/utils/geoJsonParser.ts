import { AttributeFilter, FilterOperator, GeometryType, PropertySchema } from '../types/gis';
import proj4 from 'proj4';

const PROJ_UTM23S = '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const PROJ_UTM22S = '+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

/**
 * Validates, cleans and normalizes features to ensure valid GeoJSON geometries for Leaflet
 */
export function sanitizeAndCleanGeoJsonFeatures(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  if (!features || !Array.isArray(features)) return [];
  const valid: GeoJSON.Feature[] = [];

  for (const f of features) {
    if (!f || !f.geometry) continue;
    const geom = f.geometry as any;
    if (!geom.type) continue;

    try {
      if (geom.type === 'Point') {
        const coords = geom.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const x = Number(coords[0]);
        const y = Number(coords[1]);
        if (!isFinite(x) || !isFinite(y)) continue;
        valid.push({
          ...f,
          geometry: { type: 'Point', coordinates: [x, y] }
        });
      } else if (geom.type === 'MultiPoint') {
        const pts = (geom.coordinates || [])
          .map((c: any) => [Number(c[0]), Number(c[1])])
          .filter((c: any) => isFinite(c[0]) && isFinite(c[1]));
        if (pts.length === 0) continue;
        valid.push({ ...f, geometry: { type: 'MultiPoint', coordinates: pts } });
      } else if (geom.type === 'LineString') {
        const pts = (geom.coordinates || [])
          .map((c: any) => [Number(c[0]), Number(c[1])])
          .filter((c: any) => isFinite(c[0]) && isFinite(c[1]));
        if (pts.length < 2) continue;
        valid.push({ ...f, geometry: { type: 'LineString', coordinates: pts } });
      } else if (geom.type === 'MultiLineString') {
        const lines = (geom.coordinates || []).map((line: any) => 
          (line || []).map((c: any) => [Number(c[0]), Number(c[1])]).filter((c: any) => isFinite(c[0]) && isFinite(c[1]))
        ).filter((line: any[]) => line.length >= 2);
        if (lines.length === 0) continue;
        valid.push({ ...f, geometry: { type: 'MultiLineString', coordinates: lines } });
      } else if (geom.type === 'Polygon') {
        let rings = geom.coordinates;
        if (!Array.isArray(rings) || rings.length === 0) continue;
        // Fix depth if rings was depth 2 (missing outer array)
        if (typeof rings[0]?.[0] === 'number') {
          rings = [rings];
        }
        const cleanRings: [number, number][][] = [];
        for (const ring of rings) {
          if (!Array.isArray(ring) || ring.length < 3) continue;
          const cleanPts: [number, number][] = [];
          for (const c of ring) {
            if (!Array.isArray(c) || c.length < 2) continue;
            const x = Number(c[0]);
            const y = Number(c[1]);
            if (!isFinite(x) || !isFinite(y)) continue;
            cleanPts.push([x, y]);
          }
          if (cleanPts.length < 3) continue;
          // Close ring if not closed
          const first = cleanPts[0];
          const last = cleanPts[cleanPts.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            cleanPts.push([first[0], first[1]]);
          }
          if (cleanPts.length >= 4) {
            cleanRings.push(cleanPts);
          }
        }
        if (cleanRings.length === 0) continue;
        valid.push({ ...f, geometry: { type: 'Polygon', coordinates: cleanRings } });
      } else if (geom.type === 'MultiPolygon') {
        let polys = geom.coordinates;
        if (!Array.isArray(polys) || polys.length === 0) continue;
        // Fix depth if depth 3
        if (Array.isArray(polys[0]) && typeof polys[0][0]?.[0] === 'number') {
          polys = [polys];
        }
        const cleanPolys: [number, number][][][] = [];
        for (const poly of polys) {
          if (!Array.isArray(poly) || poly.length === 0) continue;
          const cleanRings: [number, number][][] = [];
          for (const ring of poly) {
            if (!Array.isArray(ring) || ring.length < 3) continue;
            const cleanPts: [number, number][] = [];
            for (const c of ring) {
              if (!Array.isArray(c) || c.length < 2) continue;
              const x = Number(c[0]);
              const y = Number(c[1]);
              if (!isFinite(x) || !isFinite(y)) continue;
              cleanPts.push([x, y]);
            }
            if (cleanPts.length < 3) continue;
            const first = cleanPts[0];
            const last = cleanPts[cleanPts.length - 1];
            if (first[0] !== last[0] || first[1] !== last[1]) {
              cleanPts.push([first[0], first[1]]);
            }
            if (cleanPts.length >= 4) {
              cleanRings.push(cleanPts);
            }
          }
          if (cleanRings.length > 0) {
            cleanPolys.push(cleanRings);
          }
        }
        if (cleanPolys.length === 0) continue;
        valid.push({ ...f, geometry: { type: 'MultiPolygon', coordinates: cleanPolys } });
      } else {
        // Fallback for GeometryCollection or other types
        valid.push(f);
      }
    } catch {
      // Ignore malformed individual feature
    }
  }

  return valid;
}

/**
 * Validates and filters features to ensure valid GeoJSON geometries for Leaflet
 */
export function filterValidGeoJsonFeatures(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return sanitizeAndCleanGeoJsonFeatures(features);
}

/**
 * Robustly inspects and reprojects any GeoJSON FeatureCollection to standard WGS84 (EPSG:4326).
 * Automatically detects:
 * 1. UTM Zone 23S (SIRGAS 2000 / EPSG:31983) - standard for SP State
 * 2. UTM Zone 22S (SIRGAS 2000 / EPSG:31982) - Western SP
 * 3. Web Mercator (EPSG:3857)
 * 4. Inverted coordinates [latitude, longitude] -> [longitude, latitude]
 * 5. Sanitizes invalid/NaN coordinates and closes unclosed polygon rings
 */
export function normalizeAndReprojectGeoJson(
  geojson: GeoJSON.FeatureCollection
): {
  geojson: GeoJSON.FeatureCollection;
  reprojected: boolean;
  detectedCrs: string;
} {
  if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
    return { geojson, reprojected: false, detectedCrs: 'WGS84 (EPSG:4326)' };
  }

  // 1. Collect sample points to identify coordinate domain
  const samplePts: [number, number][] = [];
  function collectPoints(coords: any, limit = 30): void {
    if (!Array.isArray(coords) || samplePts.length >= limit) return;
    if (
      typeof coords[0] === 'number' && 
      typeof coords[1] === 'number' && 
      !isNaN(coords[0]) && 
      !isNaN(coords[1]) && 
      isFinite(coords[0]) && 
      isFinite(coords[1])
    ) {
      samplePts.push([coords[0], coords[1]]);
      return;
    }
    for (const item of coords) {
      collectPoints(item, limit);
      if (samplePts.length >= limit) break;
    }
  }

  for (const f of geojson.features) {
    if (f && f.geometry && 'coordinates' in f.geometry) {
      collectPoints((f.geometry as any).coordinates);
      if (samplePts.length >= 30) break;
    }
  }

  if (samplePts.length === 0) {
    return { geojson, reprojected: false, detectedCrs: 'WGS84 (EPSG:4326)' };
  }

  const avgX = samplePts.reduce((acc, p) => acc + p[0], 0) / samplePts.length;
  const avgY = samplePts.reduce((acc, p) => acc + p[1], 0) / samplePts.length;

  let reprojected = false;
  let detectedCrs = 'WGS84 (EPSG:4326)';
  let transformPt: ((pt: [number, number]) => [number, number]) | null = null;

  // Case A: Coordinates are Inverted Lat/Lng for Brazil/SP
  // In Brazil: Latitude is -35 to 5 (SP is -26 to -19), Longitude is -75 to -34 (SP is -54 to -44)
  if (avgX >= -35 && avgX <= 5 && avgY >= -75 && avgY <= -34) {
    reprojected = true;
    detectedCrs = 'Lat/Long Invertido ➔ WGS84';
    transformPt = ([lat, lng]) => [lng, lat];
  }
  // Case B: UTM Zone 23S or Zone 22S (Easting ~ 100k-900k, Northing ~ 6.0M-8.5M)
  else if (avgX >= 100000 && avgX <= 900000 && avgY >= 6000000 && avgY <= 8500000) {
    reprojected = true;
    // Check if Zone 22S (Western SP) or Zone 23S (Central/Eastern SP)
    const testWgs = proj4(PROJ_UTM23S, 'EPSG:4326', [avgX, avgY]);
    if (testWgs[0] < -54.5) {
      detectedCrs = 'SIRGAS 2000 / UTM 22S (EPSG:31982) ➔ WGS84';
      transformPt = ([x, y]) => {
        try {
          const res = proj4(PROJ_UTM22S, 'EPSG:4326', [x, y]);
          return [Number(res[0].toFixed(6)), Number(res[1].toFixed(6))];
        } catch {
          return [x, y];
        }
      };
    } else {
      detectedCrs = 'SIRGAS 2000 / UTM 23S (EPSG:31983) ➔ WGS84';
      transformPt = ([x, y]) => {
        try {
          const res = proj4(PROJ_UTM23S, 'EPSG:4326', [x, y]);
          return [Number(res[0].toFixed(6)), Number(res[1].toFixed(6))];
        } catch {
          return [x, y];
        }
      };
    }
  }
  // Case C: UTM with Northing first, Easting second (e.g. CAD export [7395000, 333000])
  else if (avgX >= 6000000 && avgX <= 8500000 && avgY >= 100000 && avgY <= 900000) {
    reprojected = true;
    detectedCrs = 'SIRGAS 2000 / UTM Invertido (N/E) ➔ WGS84';
    transformPt = ([y, x]) => {
      try {
        const res = proj4(PROJ_UTM23S, 'EPSG:4326', [x, y]);
        return [Number(res[0].toFixed(6)), Number(res[1].toFixed(6))];
      } catch {
        return [y, x];
      }
    };
  }
  // Case D: Web Mercator (EPSG:3857)
  else if (
    (avgX < -3000000 && avgX > -9000000 && avgY < 1000000 && avgY > -4500000) ||
    (Math.abs(avgX) > 180 || Math.abs(avgY) > 90)
  ) {
    reprojected = true;
    detectedCrs = 'Web Mercator (EPSG:3857) ➔ WGS84';
    transformPt = ([x, y]) => {
      try {
        const res = proj4('EPSG:3857', 'EPSG:4326', [x, y]);
        return [Number(res[0].toFixed(6)), Number(res[1].toFixed(6))];
      } catch {
        return [x, y];
      }
    };
  }

  if (!reprojected || !transformPt) {
    return { geojson, reprojected: false, detectedCrs: 'WGS84 (EPSG:4326)' };
  }

  // Recursive transformer
  function transformCoordinates(coords: any, depth = 0): any {
    if (!Array.isArray(coords)) return coords;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      if (isNaN(coords[0]) || isNaN(coords[1])) return [0, 0];
      return transformPt!([coords[0], coords[1]]);
    }
    return coords.map(c => transformCoordinates(c, depth + 1));
  }

  function transformGeometry(geom: any): any {
    if (!geom || !geom.type) return geom;
    if (geom.type === 'GeometryCollection' && Array.isArray(geom.geometries)) {
      return {
        ...geom,
        geometries: geom.geometries.map(transformGeometry)
      };
    }
    if ('coordinates' in geom) {
      let newCoords = transformCoordinates(geom.coordinates);
      // Ensure polygon rings are closed
      if (geom.type === 'Polygon' && Array.isArray(newCoords)) {
        newCoords = newCoords.map((ring: any[]) => {
          if (!Array.isArray(ring) || ring.length < 3) return ring;
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
            return [...ring, [first[0], first[1]]];
          }
          return ring;
        });
      } else if (geom.type === 'MultiPolygon' && Array.isArray(newCoords)) {
        newCoords = newCoords.map((poly: any[]) => {
          if (!Array.isArray(poly)) return poly;
          return poly.map((ring: any[]) => {
            if (!Array.isArray(ring) || ring.length < 3) return ring;
            const first = ring[0];
            const last = ring[ring.length - 1];
            if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
              return [...ring, [first[0], first[1]]];
            }
            return ring;
          });
        });
      }
      return {
        ...geom,
        coordinates: newCoords
      };
    }
    return geom;
  }

  const updatedFeatures: GeoJSON.Feature[] = geojson.features.map(f => {
    if (!f || !f.geometry) return f;
    return {
      ...f,
      geometry: transformGeometry(f.geometry)
    };
  });

  return {
    geojson: {
      ...geojson,
      features: updatedFeatures
    },
    reprojected: true,
    detectedCrs
  };
}

export interface Wgs84ValidationResult {
  isWgs84: boolean;
  detectedCrs: string;
  warningMessage?: string;
  sampleCoords?: [number, number];
}

/**
 * Checks if a GeoJSON FeatureCollection conforms to the official WGS84 (EPSG:4326) standard
 * (decimal degrees: Longitude [-180..180], Latitude [-90..90]).
 * Emits warnings when coordinates are in UTM (meters), Web Mercator, or inverted.
 */
export function validateGeoJsonWgs84(geojson: GeoJSON.FeatureCollection): Wgs84ValidationResult {
  if (!geojson || !Array.isArray(geojson.features) || geojson.features.length === 0) {
    return { isWgs84: true, detectedCrs: 'WGS84 (EPSG:4326)' };
  }

  const samplePts: [number, number][] = [];
  function collectPoints(coords: any, limit = 30): void {
    if (!Array.isArray(coords) || samplePts.length >= limit) return;
    if (
      typeof coords[0] === 'number' && 
      typeof coords[1] === 'number' && 
      !isNaN(coords[0]) && 
      !isNaN(coords[1]) && 
      isFinite(coords[0]) && 
      isFinite(coords[1])
    ) {
      samplePts.push([coords[0], coords[1]]);
      return;
    }
    for (const item of coords) {
      collectPoints(item, limit);
      if (samplePts.length >= limit) break;
    }
  }

  for (const f of geojson.features) {
    if (f && f.geometry && 'coordinates' in f.geometry) {
      collectPoints((f.geometry as any).coordinates);
      if (samplePts.length >= 30) break;
    }
  }

  if (samplePts.length === 0) {
    return { isWgs84: true, detectedCrs: 'WGS84 (EPSG:4326)' };
  }

  const avgX = samplePts.reduce((acc, p) => acc + p[0], 0) / samplePts.length;
  const avgY = samplePts.reduce((acc, p) => acc + p[1], 0) / samplePts.length;
  const firstPt: [number, number] = [Number(samplePts[0][0].toFixed(2)), Number(samplePts[0][1].toFixed(2))];

  // Inverted Lat/Lng (Latitude is first [-35..5], Longitude is second [-75..-34])
  if (avgX >= -35 && avgX <= 5 && avgY >= -75 && avgY <= -34) {
    return {
      isWgs84: false,
      detectedCrs: 'Lat/Long Invertido [Latitude, Longitude]',
      warningMessage: `O arquivo está com coordenadas invertidas [Lat: ${firstPt[0]}, Lng: ${firstPt[1]}]. O padrão GeoJSON WGS84 exige [Longitude, Latitude].`,
      sampleCoords: firstPt
    };
  }

  // UTM coordinates (Easting ~ 100k-900k, Northing ~ 6.0M-8.5M)
  if (
    (avgX >= 100000 && avgX <= 900000 && avgY >= 6000000 && avgY <= 8500000) ||
    (avgX >= 6000000 && avgX <= 8500000 && avgY >= 100000 && avgY <= 900000)
  ) {
    return {
      isWgs84: false,
      detectedCrs: 'SIRGAS 2000 / UTM (Metros)',
      warningMessage: `O arquivo contém coordenadas métricas em UTM (X: ${firstPt[0].toLocaleString('pt-BR')}m, Y: ${firstPt[1].toLocaleString('pt-BR')}m) fora do padrão WGS84 em graus decimais.`,
      sampleCoords: firstPt
    };
  }

  // Web Mercator / Out of bounds
  if (Math.abs(avgX) > 180 || Math.abs(avgY) > 90) {
    return {
      isWgs84: false,
      detectedCrs: 'Coordenadas Projetadas em Metros (Fora de WGS84)',
      warningMessage: `As coordenadas (X: ${firstPt[0].toLocaleString('pt-BR')}, Y: ${firstPt[1].toLocaleString('pt-BR')}) ultrapassam os limites de graus decimais WGS84 [-180..180, -90..90].`,
      sampleCoords: firstPt
    };
  }

  return {
    isWgs84: true,
    detectedCrs: 'WGS84 (EPSG:4326)'
  };
}

/**
 * Normalizes text for search and filtering:
 * - Strips diacritics / accents (e.g., 'São Paulo' -> 'sao paulo', 'SÃO JOSÉ' -> 'sao jose')
 * - Converts to lowercase
 * - Collapses whitespace
 * - Handles null / undefined safely
 */
export function normalizeSearchText(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Intelligent fuzzy / multi-term search matcher:
 * Checks if target string matches query (supports word-by-word matching)
 */
export function matchSmartSearch(target: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  const normQuery = normalizeSearchText(query);
  const normTarget = normalizeSearchText(target);
  
  if (!normTarget) return false;
  if (normTarget.includes(normQuery)) return true;

  // Multi-term support: all words in search query must appear in target
  const terms = normQuery.split(' ').filter(t => t.length > 0);
  if (terms?.length > 1) {
    return terms.every(t => normTarget.includes(t));
  }

  return false;
}

const yearCache = new WeakMap<object, number | null>();
const areaCache = new WeakMap<object, number>();

/**
 * Normalizes property keys to extract Município robustly across various shapefile conventions
 */
export function getFeatureMunicipio(props: any): string {
  if (!props || typeof props !== 'object') return '';
  const direct = props.MUNICIPIO ?? props.municipio ?? props['MUNICÍPIO'] ?? props['Município'] ?? 
                 props.cidade ?? props.CIDADE ?? props.Cidade ?? 
                 props.NM_MUNICIP ?? props.nm_municip ?? props.NOME_MUNICIPIO ?? props.nome_municipio ?? 
                 props.localidade ?? props.LOCALIDADE ?? '';
  if (direct && typeof direct === 'string') return direct.trim();
  
  // Fuzzy fallback
  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (lk.includes('municip') || lk.includes('cidade')) {
      const v = props[k];
      if (v && typeof v === 'string') return v.trim();
    }
  }
  return '';
}

/**
 * Normalizes property keys to extract Proprietário / Interessado / Empreendedor
 */
export function getFeatureProprietario(props: any): string {
  if (!props || typeof props !== 'object') return '';
  const direct = props.PROPRIETARIO ?? props.proprietario ?? props.Proprietario ?? 
                 props['PROPRIETÁRIO'] ?? props['Proprietário'] ?? 
                 props.interessado ?? props.INTERESSADO ?? props.Interessado ?? 
                 props.empreendedor ?? props.EMPREENDEDOR ?? props.Empreendedor ?? 
                 props.interessado_empreendedor ?? '';
  if (direct && typeof direct === 'string') return direct.trim();

  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (lk.includes('proprietar') || lk.includes('interessad') || lk.includes('empreendedor')) {
      const v = props[k];
      if (v && typeof v === 'string') return v.trim();
    }
  }
  return '';
}

/**
 * Normalizes property keys to extract Protocolo / Processo
 * Ignores date, time, and auxiliary keys so that 'data_protocolo' is never confused with the protocol number.
 */
export function getFeatureProtocolo(props: any): string {
  if (!props || typeof props !== 'object') return '';
  
  // 1. Direct explicit lookups
  const direct = props.PROTOCOLO ?? props.protocolo ?? props.Protocolo ?? 
                 props.processo_graprohab ?? props.PROCESSO_GRAPROHAB ?? props['Processo GRAPROHAB'] ?? props['PROCESSO GRAPROHAB'] ??
                 props['Nº PROTOCOLO'] ?? props['NO PROTOCOLO'] ?? props['N_PROTOCOLO'] ?? props['Nº_PROTOCOLO'] ??
                 props.nu_protocolo ?? props.NU_PROTOCOLO ?? props.num_protocolo ?? props.NUM_PROTOCOLO ?? 
                 props.numero_protocolo ?? props.NUMERO_PROTOCOLO ?? props.nr_protocolo ?? props.NR_PROTOCOLO ??
                 props.processo ?? props.PROCESSO ?? props.Processo ??
                 props.nu_processo ?? props.NU_PROCESSO ?? props.num_processo ?? props.NUM_PROCESSO ??
                 props.numero_processo ?? props.NUMERO_PROCESSO ?? props.nr_processo ?? props.NR_PROCESSO ??
                 props.pa_graprohab ?? props.PA_GRAPROHAB ?? props.pa ?? props.PA ?? props.num_pa ?? props.NUM_PA ??
                 props.cod_protocolo ?? props.COD_PROTOCOLO ?? props.id_protocolo ?? props.ID_PROTOCOLO ??
                 props.expediente ?? props.EXPEDIENTE ?? '';

  if (direct !== undefined && direct !== null && String(direct).trim()) {
    const trimmed = String(direct).trim();
    if (!['null', 'none', 'nan', 'undefined', 'n/a', '-'].includes(trimmed.toLowerCase())) {
      return trimmed;
    }
  }

  // 2. Fuzzy fallback: iterate keys, strictly skipping date, time, book, sheet and auxiliary fields
  const ignorePatterns = ['data', 'dt_', '_dt', 'date', 'hora', 'time', 'livro', 'folha', 'fls', 'fl_', 'tipo', 'situac', 'status', 'certif'];

  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (ignorePatterns.some(pattern => lk.includes(pattern))) {
      continue;
    }
    if (lk.includes('protocolo') || lk.includes('processo') || lk === 'pa' || lk.startsWith('pa_')) {
      const v = props[k];
      if (v !== undefined && v !== null && String(v).trim()) {
        const trimmed = String(v).trim();
        if (!['null', 'none', 'nan', 'undefined', 'n/a', '-'].includes(trimmed.toLowerCase())) {
          return trimmed;
        }
      }
    }
  }
  return '';
}

/**
 * Returns formatted protocol for UI display (sequential number without year).
 * Protocol numbers in GRAPROHAB are strictly sequential since inception.
 */
export function getFeatureDisplayProtocolo(props: any): string {
  const raw = getFeatureProtocolo(props);
  if (!raw) return '';
  // Se houver qualquer /ano residual em bases externas legadas, remove para manter apenas o sequencial puro
  const clean = String(raw).split('/')[0].trim();
  return clean || String(raw).trim();
}

/**
 * Normalizes query string for protocol search:
 * Strips prefixes like 'protocolo', 'prot.', 'processo', 'proc.', 'nº', 'no', 'pa'
 */
export function normalizeProtocoloQuery(q: any): string {
  if (q === null || q === undefined) return '';
  let clean = String(q).trim();
  clean = clean.replace(/^(protocolo|prot\.?|processo|proc\.?|n[ºo°\.]?|pa|expediente)\s*[:#-]?\s*/i, '');
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Robust Protocol Search Matcher:
 * Protocols in GRAPROHAB are strictly sequential numbers since inception.
 * Does NOT require or check /ano.
 * Handles:
 * - Bare sequential number: "17197"
 * - Formatted with punctuation: "17.197", "Prot. 17197"
 * - Leading zeros: "017197"
 * - Partial typeahead / substring: "171"
 * - If user types slash by habit ("17197/2020"), ignores the slash and matches the sequential number "17197"
 */
export function matchProtocoloSearch(props: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!props || typeof props !== 'object') return false;

  const rawProt = getFeatureProtocolo(props);
  if (!rawProt) return false;

  const qClean = normalizeProtocoloQuery(query);
  if (!qClean) return false;

  // Extrai o número sequencial da feição (remove qualquer barra/ano residual)
  const protStr = String(rawProt).trim();
  const protSeq = protStr.split('/')[0].trim();
  const protSeqUpper = protSeq.toUpperCase();

  // Se o usuário digitou com barra por engano (ex: 17197/2024), extrai apenas o sequencial
  const qSeq = qClean.split('/')[0].trim();
  const qUpper = qSeq.toUpperCase();
  if (!qUpper) return false;

  // 1. Casamento direto case-insensitive (exato ou prefixo/substring)
  if (protSeqUpper === qUpper || protSeqUpper.includes(qUpper)) {
    return true;
  }

  // 2. Pontuação removida (ex: "17.197" casa com "17197")
  const qNoDots = qUpper.replace(/\./g, '').trim();
  const protNoDots = protSeqUpper.replace(/\./g, '').trim();
  if (protNoDots === qNoDots || protNoDots.includes(qNoDots)) {
    return true;
  }

  // 3. Normalização de zeros à esquerda (ex: "017197" casa com "17197")
  const qNumOnly = qNoDots.replace(/^0+/, '');
  const protNumOnly = protNoDots.replace(/^0+/, '');
  if (qNumOnly && protNumOnly) {
    if (protNumOnly === qNumOnly || protNumOnly.includes(qNumOnly)) {
      return true;
    }
  }

  // 4. Fallback smart search apenas no número sequencial
  return matchSmartSearch(protSeq, qSeq);
}

/**
 * Normalizes property keys to extract Dispensa
 */
export function getFeatureDispensa(props: any): string {
  if (!props || typeof props !== 'object') return '';
  const direct = props['EXPEDIENTE DISPENSA'] ?? props['Expediente Dispensa'] ?? 
                 props.expediente_dispensa ?? props.dispensa ?? props.DISPENSA ?? props.Dispensa ?? 
                 props.EXPEDIENTE_DISPENSA ?? props.num_dispensa ?? '';
  if (direct !== undefined && direct !== null && String(direct).trim()) return String(direct).trim();

  for (const k of Object.keys(props)) {
    const lk = k.toLowerCase();
    if (lk.includes('data') || lk.includes('date')) continue;
    if (lk.includes('dispensa')) {
      const v = props[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
  }
  return '';
}

/**
 * Normalizes query string for dispensa search
 */
export function normalizeDispensaQuery(q: any): string {
  if (q === null || q === undefined) return '';
  let clean = String(q).trim();
  clean = clean.replace(/^(dispensa|expediente|exp\.?|n[ºo°\.]?)\s*[:#-]?\s*/i, '');
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Robust Dispensa Search Matcher
 */
export function matchDispensaSearch(props: any, query: string): boolean {
  if (!query || !query.trim()) return true;
  if (!props || typeof props !== 'object') return false;

  const rawDisp = getFeatureDispensa(props);
  if (!rawDisp) return false;

  const qClean = normalizeDispensaQuery(query);
  if (!qClean) return false;

  const dispStr = String(rawDisp).trim();
  const qUpper = qClean.toUpperCase();
  const dispUpper = dispStr.toUpperCase();

  if (dispUpper.includes(qUpper)) return true;

  // Dots / spaces removed
  const qCleanStripped = qUpper.replace(/[\.\s]/g, '');
  const dispStripped = dispUpper.replace(/[\.\s]/g, '');
  if (dispStripped.includes(qCleanStripped)) return true;

  // Number only match
  const qNum = qCleanStripped.split('/')[0].replace(/^0+/, '');
  const dispNum = dispStripped.split('/')[0].replace(/^0+/, '');
  if (qNum && dispNum && (dispNum === qNum || dispNum.includes(qNum))) {
    if (qCleanStripped.includes('/')) {
      const qYr = qCleanStripped.split('/')[1]?.replace(/[^0-9]/g, '');
      const dispYr = dispStripped.split('/')[1]?.replace(/[^0-9]/g, '');
      if (qYr && dispYr) {
        return dispYr === qYr || dispYr.endsWith(qYr) || qYr.endsWith(dispYr);
      }
    }
    return true;
  }

  return matchSmartSearch(dispStr, qClean);
}

/**
 * Normalizes property keys to extract Situação / Status do Processo.
 * Conforme regra de negócio GRAPROHAB: processos com campo de situação vazio,
 * nulo ou não informado são considerados "Em Análise", a menos que possuam expediente de dispensa.
 */
export function getFeatureSituacao(props: any): string {
  if (!props || typeof props !== 'object') return 'Em Análise';
  const direct = props['SITUAÇÃO'] ?? props['SITUACAO'] ?? props.situacao ?? props['situação'] ?? 
                 props['Situação'] ?? props.Situacao ?? props['SITUAÇÃO ATUAL'] ?? props['SITUACAO ATUAL'] ?? 
                 props['SITUAÇÃO DO PROCESSO'] ?? props['SITUACAO DO PROCESSO'] ?? 
                 props.status_graprohab ?? props.status ?? props.STATUS ?? props.Status ?? 
                 props.STATUS_GRAPROHAB ?? props.fase ?? props.FASE ?? props.Fase ?? '';
  if (direct !== undefined && direct !== null && String(direct).trim()) {
    const trimmed = String(direct).trim();
    const lower = trimmed.toLowerCase();
    if (lower === 'null' || lower === 'none' || lower === 'nan' || lower === 'vazio' || lower === 'n/a' || lower === '-' || lower === 'nao informado' || lower === 'não informado') {
      if (getFeatureDispensa(props)) return 'DISPENSADO';
      return 'Em Análise';
    }
    return trimmed;
  }

  for (const k of Object.keys(props)) {
    const lk = normalizeSearchText(k);
    if (lk.includes('SITUAC') || lk.includes('STATUS')) {
      const v = props[k];
      if (v !== undefined && v !== null && String(v).trim()) {
        const trimmed = String(v).trim();
        const lower = trimmed.toLowerCase();
        if (lower === 'null' || lower === 'none' || lower === 'nan' || lower === 'vazio' || lower === 'n/a' || lower === '-' || lower === 'nao informado' || lower === 'não informado') {
          if (getFeatureDispensa(props)) return 'DISPENSADO';
          return 'Em Análise';
        }
        return trimmed;
      }
    }
  }

  // Regra de negócio: se tiver expediente de dispensa cadastrado, a situação intrínseca é Dispensado
  if (getFeatureDispensa(props)) {
    return 'DISPENSADO';
  }

  // Regra de negócio: campo vazio, nulo ou não preenchido é classificado como "Em Análise"
  return 'Em Análise';
}

/**
 * Normalizes a Situacao / Status key:
 * - Strips diacritics
 * - Normalizes slashes and hyphens (removes surrounding whitespace)
 * - Converts to uppercase
 */
export function normalizeSituacaoKey(str: any): string {
  if (str === null || str === undefined) return '';
  return normalizeSearchText(str)
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

/**
 * Verifies if an attribute property name corresponds to Situation or Status
 */
export function isSituacaoProperty(propName: string): boolean {
  if (!propName) return false;
  const norm = normalizeSearchText(propName);
  return (
    norm.includes('SITUAC') || 
    norm.includes('STATUS') || 
    norm === 'FASE' || 
    norm.includes('SITUACAO_DO_PROCESSO') || 
    norm.includes('SITUACAO ATUAL') ||
    norm.includes('SITUACAO_ATUAL')
  );
}

/**
 * Helper to determine if a normalized feature situation belongs to the same category as the filter query
 */
function matchesSituacaoCategory(normFeat: string, normFilter: string, hasDisp: boolean): boolean {
  // 1. Strict Cancelled / Revoked / Indeferido separation
  // "CERTIFICADO/CANCELADO" or "CANCELADO" is a unique and specific administrative status.
  // It must NEVER be matched by regular "CERTIFICADO", "APROVADO" or "DISPENSADO", nor vice-versa.
  const filterIsCancelled = normFilter.includes('CANCELAD') || normFilter.includes('REVOGAD') || normFilter.includes('CASSAD') || normFilter.includes('INDEFER');
  const featIsCancelled = normFeat.includes('CANCELAD') || normFeat.includes('REVOGAD') || normFeat.includes('CASSAD') || normFeat.includes('INDEFER');

  if (filterIsCancelled !== featIsCancelled) {
    return false;
  }

  // If both are cancelled statuses:
  if (filterIsCancelled && featIsCancelled) {
    // If the filter specifically requested a sub-type (e.g. CERTIFICADO/CANCELADO), verify the sub-type
    if (normFilter.includes('CERTIFICAD') && !normFeat.includes('CERTIFICAD')) return false;
    if (normFilter.includes('DISPENSAD') && !normFeat.includes('DISPENSAD')) return false;
    // Otherwise, generic 'Cancelado' / 'Cancelados' matches any cancelled/indeferido status
    return true;
  }

  // 2. Direct exact match
  if (normFeat === normFilter) {
    return true;
  }

  // 3. Dispensado category (matches DISPENSADO, DISPENSADOS, DISPENSADO DE ANALISE, DISPENSA)
  if (normFilter.includes('DISPENS')) {
    return normFeat.includes('DISPENS') || hasDisp;
  }

  // 4. Certificado / Aprovado category
  if (normFilter.includes('CERTIFICAD') || normFilter.includes('APROVAD')) {
    return normFeat.includes('CERTIFICAD') || normFeat.includes('APROVAD');
  }

  // 5. Em Análise / Exigências Técnicas category
  if (normFilter.includes('ANALIS') || normFilter.includes('EXIGENC') || normFilter.includes('TRAMIT')) {
    return normFeat.includes('ANALIS') || normFeat.includes('EXIGENC') || normFeat.includes('TRAMIT');
  }

  // 6. Indeferido
  if (normFilter.includes('INDEFER')) {
    return normFeat.includes('INDEFER');
  }

  return normFeat.includes(normFilter) || normFilter.includes(normFeat);
}

/**
 * Robust matcher for Situação / Status across quick and advanced filters:
 * Handles:
 * - Direct matches ("DISPENSADO" === "DISPENSADO")
 * - Category synonyms ("Dispensado de Análise", "Dispensados", "Dispensa" -> "DISPENSADO")
 * - Distinguishes Cancelled/Revoked from active states
 * - Recognizes implicit dispensas via getFeatureDispensa
 * - Normalizes accents, casing, slashes
 * - Respects operator semantics (=, !=, contains, startsWith, in)
 */
export function matchSituacaoFilter(props: any, filterValue: string, operator: FilterOperator = 'contains'): boolean {
  if (!filterValue || !String(filterValue).trim()) return true;
  if (!props || typeof props !== 'object') return false;

  const rawSit = getFeatureSituacao(props);
  const normFilter = normalizeSituacaoKey(filterValue);
  let normFeat = normalizeSituacaoKey(rawSit);

  const hasDisp = Boolean(getFeatureDispensa(props));
  if (!normFeat && hasDisp) {
    normFeat = 'DISPENSADO';
  }
  if (!normFeat) return false;

  const isMatched = matchesSituacaoCategory(normFeat, normFilter, hasDisp);

  if (operator === '=') {
    return isMatched;
  }
  if (operator === '!=') {
    return !isMatched;
  }
  if (operator === 'startsWith') {
    return normFeat.startsWith(normFilter) || isMatched;
  }
  if (operator === 'in') {
    const list = normFilter.split(',').map(s => normalizeSituacaoKey(s).trim()).filter(Boolean);
    return list.some(item => matchesSituacaoCategory(normFeat, item, hasDisp));
  }

  // Default: contains
  return isMatched;
}

/**
 * Extrai um ano razoável de diversas variações de atributos do GeoJSON com altíssimo desempenho e cache
 */
export function extractYearFromProperties(props: any): number | null {
  if (!props || typeof props !== 'object') return null;
  
  if (yearCache.has(props)) {
    return yearCache.get(props) ?? null;
  }

  // 1. Checagem direta rápida dos campos explícitos de ano
  const directFields = [
    'ANO ENTRADA', 'ANO', 'ano', 'Ano', 'ano_entrada', 'ANO_ENTRADA', 'ANO_PROCESSO',
    'DATA DE ENTRADA', 'DATA DO CERTIFICADO', 'data', 'DATA', 'Data',
    'DATA_ENTRADA', 'DATA_CERTIFICADO'
  ];

  for (const field of directFields) {
    const val = props[field];
    if (val !== undefined && val !== null && val !== '') {
      if (typeof val === 'number' && val >= 1990 && val <= 2035) {
        yearCache.set(props, val);
        return val;
      }
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (/^(19\d{2}|20\d{2})$/.test(trimmed)) {
          const parsed = parseInt(trimmed, 10);
          if (parsed >= 1990 && parsed <= 2035) {
            yearCache.set(props, parsed);
            return parsed;
          }
        }
        const match = trimmed.match(/(?:^|[^\d])(19\d{2}|20\d{2})(?:[^\d]|$)/);
        if (match) {
          const parsed = parseInt(match[1], 10);
          if (parsed >= 1990 && parsed <= 2035) {
            yearCache.set(props, parsed);
            return parsed;
          }
        }
        const match2d = trimmed.match(/\/([0-2]\d)(?:[^\d]|$)/);
        if (match2d) {
          const parsed = 2000 + parseInt(match2d[1], 10);
          if (parsed >= 1990 && parsed <= 2035) {
            yearCache.set(props, parsed);
            return parsed;
          }
        }
      }
    }
  }

  // 2. Extração a partir do expediente de dispensa se o campo de ano não existir (Protocolo é puramente sequencial)
  const secondaryFields = ['EXPEDIENTE DISPENSA', 'expediente_dispensa'];
  for (const sf of secondaryFields) {
    const val = props[sf];
    if (val !== undefined && val !== null && val !== '') {
      const trimmed = String(val).trim();
      const match = trimmed.match(/(?:^|[^\d])(19\d{2}|20\d{2})(?:[^\d]|$)/);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed >= 1990 && parsed <= 2035) {
          yearCache.set(props, parsed);
          return parsed;
        }
      }
      const match2d = trimmed.match(/\/([0-2]\d)(?:[^\d]|$)/);
      if (match2d) {
        const parsed = 2000 + parseInt(match2d[1], 10);
        if (parsed >= 1990 && parsed <= 2035) {
          yearCache.set(props, parsed);
          return parsed;
        }
      }
    }
  }
  
  // 3. Procurar nas demais chaves como fallback
  for (const key of Object.keys(props)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes('ano') || lowerKey.includes('data') || lowerKey.includes('entrada')) {
       const val = props[key];
       if (val !== undefined && val !== null && val !== '') {
         if (typeof val === 'number' && val >= 1990 && val <= 2035) {
           yearCache.set(props, val);
           return val;
         }
         const str = String(val).trim();
         if (/^(19\d{2}|20\d{2})$/.test(str)) {
           const parsed = parseInt(str, 10);
           if (parsed >= 1990 && parsed <= 2035) {
             yearCache.set(props, parsed);
             return parsed;
           }
         }
         const match = str.match(/(?:^|[^\d])(19\d{2}|20\d{2})(?:[^\d]|$)/);
         if (match) {
           const parsed = parseInt(match[1], 10);
           if (parsed >= 1990 && parsed <= 2035) {
             yearCache.set(props, parsed);
             return parsed;
           }
         }
       }
    }
  }

  yearCache.set(props, null);
  return null;
}

/**
 * Safe numeric parser supporting Brazilian (1.234,56) and standard (1234.56) notation
 */
export function parseNumericValue(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;

  let str = String(val).trim();
  if (!str) return 0;

  // Strip non-numeric suffixes like m², ha, UH, lotes, etc.
  str = str.replace(/[^\d.,-]/g, '').trim();
  if (!str) return 0;

  // Check if Brazilian format like '1.250,50' or '12.450'
  if (str.includes(',') && str.includes('.')) {
    // 1.250,50 -> 1250.50
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    // 1250,50 -> 1250.50
    str = str.replace(',', '.');
  } else if (str.includes('.') && (str.match(/\./g) || []).length > 1) {
    // 1.250.000 -> 1250000
    str = str.replace(/\./g, '');
  }

  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Extracts "Nº DE LOTES UNIDADES HABITACIONAIS" with high resilience to naming variations
 */
export function extractUhFromProperties(props: any): number {
  if (!props || typeof props !== 'object') return 0;

  // 1. Direct key matches
  const directKeys = [
    'Nº DE UNIDADES HABITACIONAIS',
    'NO DE UNIDADES HABITACIONAIS',
    'N DE UNIDADES HABITACIONAIS',
    'Nº DE LOTES UNIDADES HABITACIONAIS',
    'NO DE LOTES UNIDADES HABITACIONAIS',
    'N DE LOTES UNIDADES HABITACIONAIS',
    'N_DE_LOTES_UNIDADES_HABITACIONAIS',
    'NO_DE_LOTES_UNIDADES_HABITACIONAIS',
    'NUMERO_LOTES_UNIDADES_HABITACIONAIS',
    'NUMERO DE LOTES UNIDADES HABITACIONAIS',
    'quantidade_lotes_uh',
    'QUANTIDADE_LOTES_UH',
    'LOTES_UH',
    'lotes_uh',
    'UH',
    'uh',
    'LOTES',
    'lotes',
    'UNIDADES',
    'unidades',
    'UNIDADES_HABITACIONAIS',
    'unidades_habitacionais',
    'N_LOTES',
    'NO_LOTES',
    'NUM_LOTES',
    'TOTAL_UH'
  ];

  for (const k of directKeys) {
    if (props[k] !== undefined && props[k] !== null && props[k] !== '') {
      const val = parseNumericValue(props[k]);
      if (val > 0) return val;
    }
  }

  // 2. Fuzzy normalized key scan
  const entries = Object.entries(props);
  for (const [key, val] of entries) {
    if (val === null || val === undefined || val === '') continue;
    const normKey = normalizeSearchText(key);

    const hasLoteOrUh = normKey.includes('lote') || normKey.includes('unidade') || normKey.includes('uh') || normKey.includes('habitacion');
    const isCountKey = normKey.includes('no') || normKey.includes('num') || normKey.includes('qtd') || normKey.includes('quant') || normKey.includes('total') || normKey.includes('de');

    if (hasLoteOrUh && (isCountKey || normKey === 'uh' || normKey === 'lotes' || normKey === 'unidades')) {
      const parsed = parseNumericValue(val);
      if (parsed > 0) return parsed;
    }
  }

  return 0;
}

/**
 * Extracts "ÁREA TOTAL DA GLEBA/M²" with resilience to naming variations, with geometric fallback
 */
export function extractAreaM2FromProperties(props: any, feature?: GeoJSON.Feature): number {
  if (props && typeof props === 'object') {
    // 1. Direct key matches
    const directKeys = [
      'ÁREA TOTAL DA GLEBA/M²',
      'AREA TOTAL DA GLEBA/M²',
      'ÁREA TOTAL DA GLEBA / M²',
      'AREA TOTAL DA GLEBA / M²',
      'AREA_TOTAL_DA_GLEBA_M2',
      'AREA_TOTAL_GLEBA_M2',
      'AREA_GLEBA_M2',
      'area_gleba_m2',
      'AREA_TOTAL_M2',
      'area_total_m2',
      'AREA_TOTAL',
      'area_total',
      'AREA_GLEBA',
      'area_gleba',
      'AREA_M2',
      'area_m2',
      'Área (m²)',
      'AREA (M2)',
      'AREA',
      'area'
    ];

    for (const k of directKeys) {
      if (props[k] !== undefined && props[k] !== null && props[k] !== '') {
        const val = parseNumericValue(props[k]);
        if (val > 0) return val;
      }
    }

    // 2. Fuzzy normalized key scan
    const entries = Object.entries(props);
    for (const [key, val] of entries) {
      if (val === null || val === undefined || val === '') continue;
      const normKey = normalizeSearchText(key);

      const hasAreaOrGleba = normKey.includes('area') || normKey.includes('gleba');
      const isTotalOrM2 = normKey.includes('total') || normKey.includes('m2') || normKey.includes('gleba');

      if (hasAreaOrGleba && isTotalOrM2) {
        const parsed = parseNumericValue(val);
        if (parsed > 0) return parsed;
      }
    }
  }

  // 3. Fallback: compute geodesic polygonal area from geometry if available
  if (feature && feature.geometry) {
    if (areaCache.has(feature)) {
      return areaCache.get(feature)!;
    }
    const geoArea = calculateFeatureArea(feature);
    areaCache.set(feature, geoArea);
    if (geoArea > 0) return geoArea;
  }

  return 0;
}

/**
 * Computes aggregate summary metrics from a set of features
 */
export function extractFeaturesMetrics(features: GeoJSON.Feature[]) {
  if (!features) return { totalProjects: 0, totalUh: 0, totalAreaM2: 0, totalAreaHa: 0, distinctMunicipalities: 0, analysisCount: 0 };
  let totalUh = 0;
  let totalAreaM2 = 0;
  let approvedCount = 0;
  let analysisCount = 0;

  features.forEach(f => {
    const p = f.properties || {};
    totalUh += extractUhFromProperties(p);
    const area = extractAreaM2FromProperties(p, f);
    if (typeof area === 'number' && !isNaN(area) && area > 0) {
      totalAreaM2 += area;
    }

    const rawSit = getFeatureSituacao(p) || p.status_graprohab || p.status || p.STATUS || '';
    const statusNorm = normalizeSituacaoKey(rawSit);
    const isCancelled = statusNorm.includes('CANCELAD') || statusNorm.includes('INDEFER') || statusNorm.includes('REVOGAD');

    if (!isCancelled && (statusNorm.includes('APROVAD') || statusNorm.includes('CERTIFICAD'))) {
      approvedCount++;
    } else if (statusNorm.includes('ANALIS') || statusNorm.includes('EXIGENC') || statusNorm.includes('TRAMIT')) {
      analysisCount++;
    }
  });

  return {
    totalProjects: features?.length,
    totalUh,
    totalAreaM2,
    totalHectares: (totalAreaM2 / 10000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 }),
    approvedCount,
    analysisCount
  };
}

export function parseGeoJson(rawContent: string | object): GeoJSON.FeatureCollection {
  let parsed: any;
  if (typeof rawContent === 'string') {
    try {
      parsed = JSON.parse(rawContent);
    } catch (e: any) {
      throw new Error(`Arquivo GeoJSON inválido: formato JSON corrompido (${e.message})`);
    }
  } else {
    parsed = rawContent;
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Conteúdo GeoJSON inválido.');
  }

  if (parsed.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    return parsed as GeoJSON.FeatureCollection;
  }

  if (parsed.type === 'Feature') {
    return {
      type: 'FeatureCollection',
      features: [parsed]
    };
  }

  if (parsed.type && ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'].includes(parsed.type)) {
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: parsed,
          properties: {}
        }
      ]
    };
  }

  throw new Error('O arquivo não contém uma estrutura GeoJSON válida (FeatureCollection, Feature ou Geometry).');
}

export function detectGeometryType(features: GeoJSON.Feature[]): GeometryType {
  if (!features || features?.length === 0) return 'Polygon';
  
  const types = new Set<string>();
  features.forEach(f => {
    if (f && f.geometry && f.geometry.type) {
      types.add(f.geometry.type);
    }
  });

  if (types.size === 0) return 'Polygon';
  
  const typeArr = Array.from(types);

  // Single type
  if (typeArr?.length === 1) {
    const single = typeArr[0];
    if (single === 'MultiPolygon' || single === 'Polygon') return 'Polygon';
    if (single === 'MultiLineString' || single === 'LineString') return 'LineString';
    if (single === 'MultiPoint' || single === 'Point') return 'Point';
    return single as GeometryType;
  }

  // Polygons (Polygon or MultiPolygon)
  const allPolys = typeArr.every(t => t === 'Polygon' || t === 'MultiPolygon');
  if (allPolys) return 'Polygon';

  // Lines
  const allLines = typeArr.every(t => t === 'LineString' || t === 'MultiLineString');
  if (allLines) return 'LineString';

  // Points
  const allPoints = typeArr.every(t => t === 'Point' || t === 'MultiPoint');
  if (allPoints) return 'Point';

  return 'Mixed';
}

export function calculateBoundingBox(features: GeoJSON.Feature[]): [number, number, number, number] {
  if (!features || !features.length) return [0, 0, 0, 0];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function traverse(coords: any) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      const lng = coords[0];
      const lat = coords[1];
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (let i = 0; i < coords?.length; i++) {
      traverse(coords[i]);
    }
  }

  features.forEach(f => {
    if (f.geometry && 'coordinates' in f.geometry) {
      traverse((f.geometry as any).coordinates);
    }
  });

  if (minLng === Infinity || minLat === Infinity) {
    return [-180, -90, 180, 90];
  }

  // Add small padding if single point
  if (minLng === maxLng) {
    minLng -= 0.05;
    maxLng += 0.05;
  }
  if (minLat === maxLat) {
    minLat -= 0.05;
    maxLat += 0.05;
  }

  return [minLng, minLat, maxLng, maxLat];
}

export function extractPropertySchemas(features: GeoJSON.Feature[]): PropertySchema[] {
  if (!features || !features.length) return [];
  const map = new Map<string, {
    values: any[];
    types: Set<string>;
    min?: number;
    max?: number;
  }>();

  features.forEach(f => {
    const props = f.properties || {};
    Object.entries(props).forEach(([key, val]) => {
      if (!map.has(key)) {
        map.set(key, { values: [], types: new Set() });
      }
      const entry = map.get(key)!;
      if (val !== null && val !== undefined) {
        entry.values.push(val);
        const t = typeof val;
        if (t === 'number') {
          entry.types.add('number');
          if (entry.min === undefined || val < entry.min) entry.min = val;
          if (entry.max === undefined || val > entry.max) entry.max = val;
        } else if (t === 'boolean') {
          entry.types.add('boolean');
        } else if (t === 'string') {
          entry.types.add('string');
        } else if (t === 'object') {
          entry.types.add('object');
        }
      }
    });
  });

  const schemas: PropertySchema[] = [];
  map.forEach((data, key) => {
    let mainType: PropertySchema['type'] = 'string';
    if (data.types.has('number') && data.types.size === 1) {
      mainType = 'number';
    } else if (data.types.has('boolean') && data.types.size === 1) {
      mainType = 'boolean';
    } else if (data.types.has('object')) {
      mainType = 'object';
    }

    const uniqueSet = new Set(data.values);
    const sampleValues = Array.from(uniqueSet).slice(0, 10);

    schemas.push({
      key,
      type: mainType,
      uniqueValuesCount: uniqueSet.size,
      sampleValues,
      min: data.min,
      max: data.max
    });
  });

  return schemas.sort((a, b) => a.key.localeCompare(b.key));
}

export function filterFeatures(
  features: GeoJSON.Feature[],
  filters: AttributeFilter[]
): GeoJSON.Feature[] {
  if (!filters || filters?.length === 0) {
    return features;
  }

  const activeFilters = (filters || []).filter(f => f.active);

  return features.filter(f => {
    const props = f.properties || {};

    // 1. Attribute filtering
    for (const filter of activeFilters) {
      if (filter.operator === 'global_search') {
        const propValues = Object.values(props).filter(v => v !== null && v !== undefined).map(String);
        const matches = propValues.some(v => matchSmartSearch(v, String(filter.value)));
        if (!matches) return false;
        continue;
      }

      if (filter.operator === 'match_municipio') {
        const featMun = getFeatureMunicipio(props);
        const normFeat = normalizeSearchText(featMun);
        const normFilter = normalizeSearchText(String(filter.value));
        if (!normFeat || !normFilter) return false;
        if (normFeat !== normFilter && !normFeat.startsWith(normFilter) && !normFilter.startsWith(normFeat)) {
          return false;
        }
        continue;
      }

      if (filter.operator === 'match_empreendedor') {
        const featEmp = getFeatureProprietario(props);
        const featNomeEmp = props['NOME DO EMPREENDIMENTO'] ?? props['nome do empreendimento'] ?? props.empreendimento ?? props.EMPREENDIMENTO ?? props['NOME EMPREENDIMENTO'] ?? '';
        const combined = `${featEmp} ${featNomeEmp}`.trim();
        if (!matchSmartSearch(combined, String(filter.value))) return false;
        continue;
      }

      if (filter.operator === 'match_protocolo') {
        if (!matchProtocoloSearch(props, String(filter.value))) return false;
        continue;
      }

      if (filter.operator === 'match_dispensa') {
        if (!matchDispensaSearch(props, String(filter.value))) return false;
        continue;
      }

      if (filter.operator === 'match_ano_entrada') {
        const numAno = extractYearFromProperties(props);
        if (!filter.value || !Array.isArray(filter.value)) continue;
        const [min, max] = filter.value as [number, number];
        if (numAno === null) return false;
        if (numAno < min || numAno > max) return false;
        continue;
      }

      if (filter.operator === 'match_situacao' || filter.operator === 'match_status') {
        if (!matchSituacaoFilter(props, String(filter.value), '=')) return false;
        continue;
      }

      // 1. Situation / Status property match
      if (isSituacaoProperty(filter.property)) {
        if (filter.operator === 'isNull') {
          const rawSit = getFeatureSituacao(props);
          if (rawSit && rawSit !== 'Em Análise') return false;
          continue;
        }
        if (filter.operator === 'isNotNull') {
          continue;
        }
        if (!matchSituacaoFilter(props, String(filter.value), filter.operator)) {
          return false;
        }
        continue;
      }

      let val = props[filter.property];
      
      // Fallback for inconsistent casing and accents across shapefiles (e.g. SITUACAO vs SITUAÇÃO)
      if (val === undefined) {
        const normFilterProp = normalizeSearchText(filter.property);
        const foundKey = Object.keys(props).find(k => normalizeSearchText(k) === normFilterProp);
        if (foundKey) {
          val = props[foundKey];
        }
      }

      if (filter.operator === 'isNull') {
        if (val !== null && val !== undefined && val !== '') return false;
        continue;
      }
      if (filter.operator === 'isNotNull') {
        if (val === null || val === undefined || val === '') return false;
        continue;
      }

      if (val === null || val === undefined) {
        return false;
      }

      if (filter.type === 'number') {
        const numVal = Number(val);
        const filterVal = Number(filter.value);
        if (isNaN(numVal)) return false;

        switch (filter.operator) {
          case '=': if (numVal !== filterVal) return false; break;
          case '!=': if (numVal === filterVal) return false; break;
          case '>': if (numVal <= filterVal) return false; break;
          case '>=': if (numVal < filterVal) return false; break;
          case '<': if (numVal >= filterVal) return false; break;
          case '<=': if (numVal > filterVal) return false; break;
          case 'between': {
            const secVal = Number(filter.secondaryValue);
            if (numVal < filterVal || numVal > secVal) return false;
            break;
          }
        }
      } else if (filter.type === 'string') {
        const normVal = normalizeSearchText(val);
        const normFilterVal = normalizeSearchText(filter.value);

        switch (filter.operator) {
          case '=': if (normVal !== normFilterVal) return false; break;
          case '!=': if (normVal === normFilterVal) return false; break;
          case 'contains': {
            const propNorm = normalizeSearchText(filter.property);
            if (propNorm.includes('PROTOCOLO') || propNorm.includes('PROCESSO')) {
              if (!matchProtocoloSearch(props, String(filter.value))) return false;
            } else if (propNorm.includes('DISPENSA')) {
              if (!matchDispensaSearch(props, String(filter.value))) return false;
            } else if (propNorm.includes('SITUAC') || propNorm.includes('STATUS')) {
              if (!matchSituacaoFilter(props, String(filter.value), 'contains')) return false;
            } else {
              if (!matchSmartSearch(val, String(filter.value))) return false;
            }
            break;
          }
          case 'startsWith': if (!normVal.startsWith(normFilterVal)) return false; break;
          case 'in': {
            const list = Array.isArray(filter.value) 
              ? filter.value.map(v => normalizeSearchText(v)) 
              : normFilterVal.split(',').map(s => s.trim());
            if (!list.includes(normVal)) return false;
            break;
          }
        }
      } else if (filter.type === 'boolean') {
        const bVal = Boolean(val);
        const bFilter = filter.value === true || filter.value === 'true';
        if (bVal !== bFilter) return false;
      }
    }

    return true;
  });
}

export function calculateFeatureArea(input: GeoJSON.Geometry | GeoJSON.Feature | null | undefined): number {
  if (!input) return 0;
  const geom: GeoJSON.Geometry = (input as any).type === 'Feature' ? (input as GeoJSON.Feature).geometry : (input as GeoJSON.Geometry);
  if (!geom) return 0;
  // Approximate geodesic area in sq meters
  if (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') return 0;

  const R = 6378137; // WGS84 major radius
  function ringArea(coords: number[][]): number {
    if (coords?.length < 3) return 0;
    let total = 0;
    for (let i = 0; i < coords?.length; i++) {
      const p1 = coords[i];
      const p2 = coords[(i + 1) % coords?.length];
      
      // Safety check: if coordinates are not WGS84, the spherical formula produces garbage
      if (typeof p1[0] !== 'number' || typeof p1[1] !== 'number' || Math.abs(p1[0]) > 180 || Math.abs(p1[1]) > 90 || isNaN(p1[0]) || isNaN(p1[1])) return 0;
      
      const lon1 = (p1[0] * Math.PI) / 180;
      const lat1 = (p1[1] * Math.PI) / 180;
      const lon2 = (p2[0] * Math.PI) / 180;
      const lat2 = (p2[1] * Math.PI) / 180;
      total += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs((total * R * R) / 2);
  }

  if (geom.type === 'Polygon') {
    let area = ringArea(geom.coordinates[0]);
    for (let i = 1; i < geom.coordinates?.length; i++) {
      area -= ringArea(geom.coordinates[i]);
    }
    return Math.max(0, area);
  } else if (geom.type === 'MultiPolygon') {
    return geom.coordinates.reduce((sum, poly) => {
      let area = ringArea(poly[0]);
      for (let i = 1; i < poly?.length; i++) {
        area -= ringArea(poly[i]);
      }
      return sum + Math.max(0, area);
    }, 0);
  }

  return 0;
}
