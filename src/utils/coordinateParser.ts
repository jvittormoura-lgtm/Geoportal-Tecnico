import proj4 from 'proj4';

// Register standard Brazilian SIRGAS 2000 UTM projections (GRS80 ellipsoid)
proj4.defs('EPSG:31983', '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:31982', '+proj=utm +zone=22 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

export type UtmZone = 22 | 23;

export interface CoordinateParseResult {
  success: true;
  lat: number;
  lng: number;
  format: 'UTM' | 'GMS' | 'DD';
  detectedType: string;
  zone: UtmZone;
  isAutoZone: boolean;
  zoneReason?: string;
  warning?: string;
  formatted: {
    dd: string;
    gms: string;
    utm: string;
    utmZone: string;
    easting: number;
    northing: number;
  };
}

export interface ParseFailure {
  success: false;
  error: string;
}

/**
 * Checks if coordinates fall within the territorial boundary envelope of the State of São Paulo
 */
export function isWithinSaoPauloBounds(lat: number, lng: number): boolean {
  // General outer bounding box of SP
  if (lat < -25.5 || lat > -19.5 || lng < -53.5 || lng > -44.0) {
    return false;
  }

  // Eastern SP (Vale do Paraíba, Serra da Mantiqueira border with Minas Gerais):
  // Longitudes east of -46.0° do not extend north of ~ -22.4° (Sul de Minas / Mantiqueira)
  if (lng > -46.0 && lat > -22.4) {
    return false;
  }

  // Far eastern tip (Bananal / Queluz border):
  if (lng > -44.6 && lat > -22.7) {
    return false;
  }

  // Atlantic ocean off Ubatuba / Ilhabela coast:
  if (lng > -45.0 && lat < -24.0) {
    return false;
  }

  return true;
}

/**
 * Checks if coordinates fall within Brazilian territory
 */
export function isWithinBrazilBounds(lat: number, lng: number): boolean {
  return lat >= -34.5 && lat <= 5.5 && lng >= -74.5 && lng <= -34.0;
}

/**
 * Converts UTM coordinates (SIRGAS 2000) to Geographic Lat/Lng (WGS84 / SIRGAS 2000)
 */
export function utmToLatLng(easting: number, northing: number, zone: UtmZone = 23): [number, number] {
  const epsg = zone === 22 ? 'EPSG:31982' : 'EPSG:31983';
  const [lng, lat] = proj4(epsg, 'EPSG:4326', [easting, northing]);
  return [lat, lng];
}

/**
 * Converts Geographic Lat/Lng to UTM coordinates (SIRGAS 2000)
 */
export function latLngToUtm(lat: number, lng: number, forceZone?: UtmZone): { easting: number; northing: number; zone: UtmZone } {
  // SP boundary between Zone 22 and 23 is at -48° Longitude (Meridiano divisor)
  const zone: UtmZone = forceZone || (lng < -48.0 ? 22 : 23);
  const epsg = zone === 22 ? 'EPSG:31982' : 'EPSG:31983';
  const [easting, northing] = proj4('EPSG:4326', epsg, [lng, lat]);
  return { easting: Math.round(easting * 100) / 100, northing: Math.round(northing * 100) / 100, zone };
}

/**
 * Automatically detects whether coordinates belong to UTM Fuso 22S (EPSG:31982) or Fuso 23S (EPSG:31983)
 * based on text markers, geometric bounds of São Paulo State, and active map viewport.
 */
export function detectUtmZoneFromContext(
  easting: number,
  northing: number,
  textContext?: string,
  mapCenterLng?: number
): { zone: UtmZone; reason: string } {
  // 1. Text explicit markers (e.g. "22S", "Fuso 22", "31982", "MC-51", etc.)
  if (textContext) {
    if (/\b(22S|FUSO\s*22|ZONA\s*22|ZONE\s*22|UTM\s*22|31982|MC\s*[-]?51)\b/i.test(textContext)) {
      return { zone: 22, reason: 'Identificado no texto (Fuso 22S)' };
    }
    if (/\b(23S|FUSO\s*23|ZONA\s*23|ZONE\s*23|UTM\s*23|31983|MC\s*[-]?45)\b/i.test(textContext)) {
      return { zone: 23, reason: 'Identificado no texto (Fuso 23S)' };
    }
  }

  // 2. Physical territorial limits for State of São Paulo:
  // Fuso 23S has Central Meridian -45°W (limits -48° to -42°). SP easternmost point is -44.2°.
  // In Fuso 23S, X = 585,000m corresponds to Longitude -44.2°.
  // Any X > 585,000m in Fuso 23 falls in Rio de Janeiro or in the Atlantic Ocean!
  // In Fuso 22S, X = 585,000m to 810,000m corresponds to Central SP (-50.2° to -48.0°).
  if (easting > 585000) {
    return { zone: 22, reason: 'Auto (X > 585.000m: Território Centro-Oeste SP - Fuso 22S)' };
  }

  // Fuso 22S has Central Meridian -51°W (limits -54° to -48°). SP westernmost point is -53.1°.
  // In Fuso 22S, X = 280,000m corresponds to Longitude -53.1°.
  // Any X < 280,000m in Fuso 22 falls in Mato Grosso do Sul or Paraná!
  // In Fuso 23S, X = 190,000m to 280,000m corresponds to RMSP, Campinas, Sorocaba (-48.0° to -47.0°).
  if (easting < 280000) {
    return { zone: 23, reason: 'Auto (X < 280.000m: Território Centro-Leste SP - Fuso 23S)' };
  }

  // 3. Test coordinate validity in both zones
  const [lat23, lng23] = utmToLatLng(easting, northing, 23);
  const [lat22, lng22] = utmToLatLng(easting, northing, 22);

  const inSp23 = isWithinSaoPauloBounds(lat23, lng23);
  const inSp22 = isWithinSaoPauloBounds(lat22, lng22);

  if (inSp23 && !inSp22) {
    return { zone: 23, reason: 'Auto (Válido exclusivamente no Fuso 23S em SP)' };
  }
  if (inSp22 && !inSp23) {
    return { zone: 22, reason: 'Auto (Válido exclusivamente no Fuso 22S em SP)' };
  }

  // 4. Map viewport context (if user is currently browsing Western vs Eastern SP)
  if (typeof mapCenterLng === 'number' && !isNaN(mapCenterLng)) {
    if (mapCenterLng < -48.0) {
      return { zone: 22, reason: 'Auto (Enquadramento ativo no Oeste de SP - Fuso 22S)' };
    } else {
      return { zone: 23, reason: 'Auto (Enquadramento ativo no Leste de SP - Fuso 23S)' };
    }
  }

  // 5. Default heuristic: Fuso 23S (Capital, RMSP, Campinas, Vale do Paraíba, Litoral)
  return { zone: 23, reason: 'Auto (Fuso 23S padrão SIRGAS 2000)' };
}

/**
 * Converts Degrees-Minutes-Seconds to Decimal Degrees
 */
export function dmsToDecimal(
  degrees: number,
  minutes: number,
  seconds: number,
  direction?: 'N' | 'S' | 'E' | 'W' | 'L' | 'O'
): number {
  let decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
  if (direction) {
    const dir = direction.toUpperCase();
    if (dir === 'S' || dir === 'W' || dir === 'O') {
      decimal = -decimal;
    }
  } else if (degrees < 0) {
    decimal = -decimal;
  }
  return decimal;
}

/**
 * Formats a Decimal value into a human-readable GMS string
 */
export function decimalToDms(val: number, isLat: boolean): string {
  const abs = Math.abs(val);
  const d = Math.floor(abs);
  const remainderMinutes = (abs - d) * 60;
  const m = Math.floor(remainderMinutes);
  const s = ((remainderMinutes - m) * 60).toFixed(2);

  let hemisphere = '';
  if (isLat) {
    hemisphere = val < 0 ? 'S' : 'N';
  } else {
    hemisphere = val < 0 ? 'W' : 'E';
  }

  return `${d}° ${m}' ${s}" ${hemisphere}`;
}

/**
 * Formats coordinates in all 3 standard representations
 */
export function formatCoordinates(lat: number, lng: number, forceZone?: UtmZone) {
  const utm = latLngToUtm(lat, lng, forceZone);
  return {
    dd: `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
    gms: `${decimalToDms(lat, true)}   ${decimalToDms(lng, false)}`,
    utm: `X: ${utm.easting.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m   Y: ${utm.northing.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`,
    utmZone: `Fuso ${utm.zone}S (SIRGAS 2000)`,
    easting: utm.easting,
    northing: utm.northing
  };
}

/**
 * Parses numeric strings supporting both Brazilian (438.263,50 or 438263,5) and International (438,263.50 or 438263.5)
 */
function parseLocalizedFloat(str: string): number {
  const clean = str.trim();
  if (!clean) return NaN;

  // Has both dot and comma
  if (clean.includes('.') && clean.includes(',')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // Brazilian: 438.263,50
      return parseFloat(clean.replace(/\./g, '').replace(',', '.'));
    } else {
      // US: 438,263.50
      return parseFloat(clean.replace(/,/g, ''));
    }
  }

  // Has only comma
  if (clean.includes(',')) {
    return parseFloat(clean.replace(',', '.'));
  }

  return parseFloat(clean);
}

/**
 * Universal Intelligent Parser for Geodetic Coordinates
 * Tolerates spaces, Brazilian commas, GMS symbols, UTM raw pairs and inverted Lat/Lng.
 * Supports full automatic UTM zone detection (22S/23S).
 */
export function parseCoordinateInput(
  rawInput: string,
  preferredZone: UtmZone | 'auto' = 'auto',
  mapCenterLng?: number
): CoordinateParseResult | ParseFailure {
  const cleanInput = rawInput.trim();
  if (!cleanInput) {
    return { success: false, error: 'Digite ou cole uma coordenada para localizar.' };
  }

  // 1. Check for Sexagesimal (GMS / DMS) pattern
  // Matches: 23° 33' 01.8" S 46° 37' 59.9" W (or with O/L/E, or space separated)
  const dmsPattern = /([0-9]{1,3})[°\s]+([0-9]{1,2})['\s]+([0-9]{1,2}(?:[.,][0-9]+)?)["]?\s*([NSns])\s*[,;/\s]+\s*([0-9]{1,3})[°\s]+([0-9]{1,2})['\s]+([0-9]{1,2}(?:[.,][0-9]+)?)["]?\s*([WwOoEeLl])/i;
  const dmsMatch = cleanInput.match(dmsPattern);
  if (dmsMatch) {
    const latD = parseInt(dmsMatch[1], 10);
    const latM = parseInt(dmsMatch[2], 10);
    const latS = parseFloat(dmsMatch[3].replace(',', '.'));
    const latDir = dmsMatch[4].toUpperCase() as any;

    const lngD = parseInt(dmsMatch[5], 10);
    const lngM = parseInt(dmsMatch[6], 10);
    const lngS = parseFloat(dmsMatch[7].replace(',', '.'));
    const lngDir = dmsMatch[8].toUpperCase() as any;

    const lat = dmsToDecimal(latD, latM, latS, latDir);
    const lng = dmsToDecimal(lngD, lngM, lngS, lngDir);

    // Auto-detect UTM zone strictly from physical longitude
    const autoZone: UtmZone = lng < -48.0 ? 22 : 23;
    const finalZone: UtmZone = preferredZone === 'auto' ? autoZone : preferredZone;
    const formatted = formatCoordinates(lat, lng, finalZone);
    const inSP = isWithinSaoPauloBounds(lat, lng);

    return {
      success: true,
      lat,
      lng,
      format: 'GMS',
      detectedType: `Graus-Minutos-Segundos (Fuso ${finalZone}S Auto)`,
      zone: finalZone,
      isAutoZone: preferredZone === 'auto',
      zoneReason: `Calculado da Longitude (${lng.toFixed(4)}°)`,
      warning: inSP ? undefined : 'Ponto fora dos limites do Estado de São Paulo.',
      formatted
    };
  }

  // 2. Check for Labeled UTM: e.g. "X: 438263.5 Y: 7447040.2" or "E: 438263 N: 7447040"
  const labeledUtmPattern = /(?:x|e|easting)\s*[:=]?\s*([0-9.,]+)\s*[,;|\s]+\s*(?:y|n|northing)\s*[:=]?\s*([0-9.,]+)/i;
  const labeledUtmMatch = cleanInput.match(labeledUtmPattern);
  if (labeledUtmMatch) {
    const easting = parseLocalizedFloat(labeledUtmMatch[1]);
    const northing = parseLocalizedFloat(labeledUtmMatch[2]);

    if (easting >= 100000 && easting <= 900000 && northing >= 6000000 && northing <= 10000000) {
      const isAuto = preferredZone === 'auto';
      const detected = isAuto 
        ? detectUtmZoneFromContext(easting, northing, cleanInput, mapCenterLng) 
        : { zone: preferredZone, reason: `Fuso ${preferredZone}S selecionado manualmente` };
      
      const zone = detected.zone;
      const [lat, lng] = utmToLatLng(easting, northing, zone);
      const formatted = formatCoordinates(lat, lng, zone);
      const inSP = isWithinSaoPauloBounds(lat, lng);

      return {
        success: true,
        lat,
        lng,
        format: 'UTM',
        detectedType: `UTM Métrico (SIRGAS 2000 - Fuso ${zone}S${isAuto ? ' Auto' : ''})`,
        zone,
        isAutoZone: isAuto,
        zoneReason: detected.reason,
        warning: inSP ? undefined : 'Ponto fora dos limites do Estado de São Paulo.',
        formatted
      };
    }
  }

  // 3. Check for Reverse Labeled UTM: e.g. "Y: 7447040.2 X: 438263.5"
  const reverseLabeledUtmPattern = /(?:y|n|northing)\s*[:=]?\s*([0-9.,]+)\s*[,;|\s]+\s*(?:x|e|easting)\s*[:=]?\s*([0-9.,]+)/i;
  const reverseMatch = cleanInput.match(reverseLabeledUtmPattern);
  if (reverseMatch) {
    const northing = parseLocalizedFloat(reverseMatch[1]);
    const easting = parseLocalizedFloat(reverseMatch[2]);

    if (easting >= 100000 && easting <= 900000 && northing >= 6000000 && northing <= 10000000) {
      const isAuto = preferredZone === 'auto';
      const detected = isAuto 
        ? detectUtmZoneFromContext(easting, northing, cleanInput, mapCenterLng) 
        : { zone: preferredZone, reason: `Fuso ${preferredZone}S selecionado manualmente` };
      
      const zone = detected.zone;
      const [lat, lng] = utmToLatLng(easting, northing, zone);
      const formatted = formatCoordinates(lat, lng, zone);
      const inSP = isWithinSaoPauloBounds(lat, lng);

      return {
        success: true,
        lat,
        lng,
        format: 'UTM',
        detectedType: `UTM Métrico (SIRGAS 2000 - Fuso ${zone}S${isAuto ? ' Auto' : ''})`,
        zone,
        isAutoZone: isAuto,
        zoneReason: detected.reason,
        warning: inSP ? undefined : 'Ponto fora dos limites do Estado de São Paulo.',
        formatted
      };
    }
  }

  // 4. Tokenize free numeric text
  // Handle Brazilian decimal comma and spaces without splitting decimal commas
  let parts: string[] = [];
  if (cleanInput.includes(';')) {
    parts = cleanInput.split(';').map(s => s.trim()).filter(Boolean);
  } else if (/\s+/.test(cleanInput)) {
    parts = cleanInput.split(/\s+/).map(s => s.replace(/[,;]+$/, '').trim()).filter(Boolean);
  } else if (cleanInput.includes(',')) {
    parts = cleanInput.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    parts = [cleanInput];
  }

  if (parts.length >= 2) {
    // Check if parts[0] and parts[1] are numbers
    const dir1 = parts[0].match(/[NSWEOL]/i)?.[0]?.toUpperCase();
    const dir2 = parts[1].match(/[NSWEOL]/i)?.[0]?.toUpperCase();

    const cleanPart1 = parts[0].replace(/[^\d.,-]/g, '');
    const cleanPart2 = parts[1].replace(/[^\d.,-]/g, '');

    let num1 = parseLocalizedFloat(cleanPart1);
    let num2 = parseLocalizedFloat(cleanPart2);

    if (dir1 && (dir1 === 'S' || dir1 === 'W' || dir1 === 'O')) num1 = -Math.abs(num1);
    if (dir2 && (dir2 === 'S' || dir2 === 'W' || dir2 === 'O')) num2 = -Math.abs(num2);

    if (!isNaN(num1) && !isNaN(num2)) {
      // 4A. Check if both are UTM Plane Coordinates (Easting ~100k-900k, Northing ~6M-10M)
      let easting = 0;
      let northing = 0;
      let isUtm = false;

      if (num1 >= 100000 && num1 <= 900000 && num2 >= 6000000 && num2 <= 10000000) {
        easting = num1;
        northing = num2;
        isUtm = true;
      } else if (num2 >= 100000 && num2 <= 900000 && num1 >= 6000000 && num1 <= 10000000) {
        // Inverted: Northing provided first
        northing = num1;
        easting = num2;
        isUtm = true;
      }

      if (isUtm) {
        const isAuto = preferredZone === 'auto';
        const detected = isAuto 
          ? detectUtmZoneFromContext(easting, northing, cleanInput, mapCenterLng) 
          : { zone: preferredZone, reason: `Fuso ${preferredZone}S selecionado manualmente` };
        
        const zone = detected.zone;
        const [lat, lng] = utmToLatLng(easting, northing, zone);
        const formatted = formatCoordinates(lat, lng, zone);
        const inSP = isWithinSaoPauloBounds(lat, lng);

        return {
          success: true,
          lat,
          lng,
          format: 'UTM',
          detectedType: `UTM Métrico (SIRGAS 2000 - Fuso ${zone}S${isAuto ? ' Auto' : ''})`,
          zone,
          isAutoZone: isAuto,
          zoneReason: detected.reason,
          warning: inSP ? undefined : 'Ponto fora dos limites do Estado de São Paulo.',
          formatted
        };
      }

      // 4B. Check Decimal Degrees (DD)
      let lat = num1;
      let lng = num2;

      // Automatic axis inversion check:
      // If num1 is between -55 and -43 (typical SP longitude) and num2 is between -26 and -19 (typical SP latitude)
      if (num1 <= -40 && num1 >= -75 && num2 >= -35 && num2 <= 10) {
        // Inverted: Longitude first
        lng = num1;
        lat = num2;
      }

      // If user typed positive latitudes/longitudes for Brazil, convert to negative
      if (lat > 10 && lat <= 35 && lng > 35 && lng <= 75) {
        lat = -lat;
        lng = -lng;
      } else if (lat > 15 && lat < 30) {
        lat = -lat;
      }

      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        // Auto-detect optimal UTM zone strictly from Longitude
        const autoZone: UtmZone = lng < -48.0 ? 22 : 23;
        const finalZone: UtmZone = preferredZone === 'auto' ? autoZone : preferredZone;
        const formatted = formatCoordinates(lat, lng, finalZone);
        const inSP = isWithinSaoPauloBounds(lat, lng);
        const inBR = isWithinBrazilBounds(lat, lng);

        return {
          success: true,
          lat,
          lng,
          format: 'DD',
          detectedType: `Graus Decimais (Fuso ${finalZone}S Auto)`,
          zone: finalZone,
          isAutoZone: preferredZone === 'auto',
          zoneReason: `Calculado da Longitude (${lng.toFixed(4)}°)`,
          warning: inSP ? undefined : (!inBR ? 'Coordenadas fora do território brasileiro.' : 'Ponto fora dos limites do Estado de São Paulo.'),
          formatted
        };
      }
    }
  }

  return {
    success: false,
    error: 'Formato não reconhecido. Use UTM (ex: 438263 7447040), GMS (ex: 23°33\'01"S 46°37\'59"W) ou Decimal (ex: -23.5505, -46.6333).'
  };
}
