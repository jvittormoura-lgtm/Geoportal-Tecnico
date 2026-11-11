import express from 'express';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

function sanitizeLayerFileName(name: string, index: number): string {
  const safe = (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return safe || `camada_${index + 1}`;
}

const WMS_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const wmsCapabilitiesCache = new Map<
  string,
  {
    timestamp: number;
    layers: Array<{
      name: string;
      title: string;
      abstract: string;
      bbox?: [number, number, number, number];
    }>;
  }
>();

function decodeXmlEntities(str: string): string {
  if (!str) return '';
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function parseWmsCapabilitiesXml(xmlText: string): Array<{
  name: string;
  title: string;
  abstract: string;
  bbox?: [number, number, number, number];
}> {
  // 1. Remove <Style>...</Style> and <KeywordList>...</KeywordList> blocks so SLD style names/titles do not collide with Layer names/titles
  const cleanedXml = xmlText
    .replace(/<(?:[\w-]+:)?Style\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?Style>/gi, '')
    .replace(/<(?:[\w-]+:)?KeywordList\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?KeywordList>/gi, '')
    .replace(/<(?:[\w-]+:)?Attribution\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?Attribution>/gi, '')
    .replace(/<(?:[\w-]+:)?MetadataURL\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?MetadataURL>/gi, '');

  const results: Array<{
    name: string;
    title: string;
    abstract: string;
    bbox?: [number, number, number, number];
  }> = [];
  const seenNames = new Set<string>();

  // Split by opening <Layer...> tags to inspect each layer's own direct header properties before nested child <Layer> tags
  const layerSegments = cleanedXml.split(/<(?:[\w-]+:)?Layer\b[^>]*>/i);

  for (let i = 1; i < layerSegments.length; i++) {
    // Only inspect up to the closing </Layer> if present in this segment
    const segment = layerSegments[i].split(/<\/(?:[\w-]+:)?Layer>/i)[0] || '';

    const nameMatch = segment.match(/<(?:[\w-]+:)?Name\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Name>/i);
    if (!nameMatch) continue;

    const rawName = decodeXmlEntities(nameMatch[1]);
    if (!rawName || seenNames.has(rawName)) continue;

    const titleMatch = segment.match(/<(?:[\w-]+:)?Title\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Title>/i);
    const abstractMatch = segment.match(/<(?:[\w-]+:)?Abstract\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?Abstract>/i);

    const title = titleMatch ? decodeXmlEntities(titleMatch[1]) : rawName;
    const abstract = abstractMatch ? decodeXmlEntities(abstractMatch[1]) : '';

    let bbox: [number, number, number, number] | undefined = undefined;

    // WMS 1.1.1: <LatLonBoundingBox minx="..." miny="..." maxx="..." maxy="..." />
    const latLonMatch = segment.match(/<(?:[\w-]+:)?LatLonBoundingBox\b([^>]*)\/?>/i);
    if (latLonMatch) {
      const attrs = latLonMatch[1];
      const minx = parseFloat(attrs.match(/minx\s*=\s*["']([^"']+)["']/i)?.[1] || '');
      const miny = parseFloat(attrs.match(/miny\s*=\s*["']([^"']+)["']/i)?.[1] || '');
      const maxx = parseFloat(attrs.match(/maxx\s*=\s*["']([^"']+)["']/i)?.[1] || '');
      const maxy = parseFloat(attrs.match(/maxy\s*=\s*["']([^"']+)["']/i)?.[1] || '');
      if (!isNaN(minx) && !isNaN(miny) && !isNaN(maxx) && !isNaN(maxy)) {
        bbox = [minx, miny, maxx, maxy];
      }
    }

    // WMS 1.3.0: <EX_GeographicBoundingBox>
    if (!bbox) {
      const exGeoMatch = segment.match(
        /<(?:[\w-]+:)?EX_GeographicBoundingBox\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?EX_GeographicBoundingBox>/i
      );
      if (exGeoMatch) {
        const inner = exGeoMatch[1];
        const west = parseFloat(
          inner.match(/<(?:[\w-]+:)?westBoundLongitude\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?westBoundLongitude>/i)?.[1] || ''
        );
        const south = parseFloat(
          inner.match(/<(?:[\w-]+:)?southBoundLatitude\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?southBoundLatitude>/i)?.[1] || ''
        );
        const east = parseFloat(
          inner.match(/<(?:[\w-]+:)?eastBoundLongitude\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?eastBoundLongitude>/i)?.[1] || ''
        );
        const north = parseFloat(
          inner.match(/<(?:[\w-]+:)?northBoundLatitude\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?northBoundLatitude>/i)?.[1] || ''
        );
        if (!isNaN(west) && !isNaN(south) && !isNaN(east) && !isNaN(north)) {
          bbox = [west, south, east, north];
        }
      }
    }

    seenNames.add(rawName);
    results.push({
      name: rawName,
      title: title || rawName,
      abstract,
      ...(bbox ? { bbox } : {}),
    });
  }

  return results;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // Anti-Cache middleware for cartographic assets (.geojson, mapas-config.json, /data/*)
  app.use((req, res, next) => {
    const reqPath = req.path || '';
    if (
      reqPath.endsWith('.geojson') ||
      reqPath.endsWith('mapas-config.json') ||
      reqPath.startsWith('/data/') ||
      reqPath.includes('/data/')
    ) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  });

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Backend proxy for OGC WMS GetCapabilities (avoids CORS & parses large 1.2MB+ XML catalogs like DataGeo SP)
  app.get('/api/wms/capabilities', async (req, res) => {
    try {
      const rawUrl = String(req.query.url || '').trim();
      const version = String(req.query.version || '1.1.1').trim();

      if (!rawUrl) {
        res.status(400).json({ error: 'Parâmetro "url" é obrigatório.' });
        return;
      }

      const baseUrl = rawUrl.split('?')[0].trim();
      const cacheKey = `${baseUrl}__${version}`;
      const cachedEntry = wmsCapabilitiesCache.get(cacheKey);

      if (cachedEntry && Date.now() - cachedEntry.timestamp < WMS_CACHE_TTL_MS) {
        res.json({
          status: 'ok',
          cached: true,
          count: cachedEntry.layers.length,
          layers: cachedEntry.layers,
        });
        return;
      }

      const capabilitiesUrl = `${baseUrl}?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=${encodeURIComponent(version)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      let response: Response;
      try {
        response = await fetch(capabilitiesUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'application/vnd.ogc.wms_xml, application/xml, text/xml, */*',
            'User-Agent': 'GRAPROHAB-GeoPortal-WMS-Client/1.0',
          },
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        throw new Error(`Servidor WMS retornou status HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const layers = parseWmsCapabilitiesXml(xmlText);

      if (layers.length > 0) {
        wmsCapabilitiesCache.set(cacheKey, {
          timestamp: Date.now(),
          layers,
        });
      }

      res.json({
        status: 'ok',
        cached: false,
        count: layers.length,
        layers,
      });
    } catch (err: any) {
      console.error('Erro no proxy GET /api/wms/capabilities:', err);
      res.status(502).json({
        error: 'Não foi possível obter o catálogo GetCapabilities do servidor WMS.',
        details: err.name === 'AbortError' ? 'Tempo limite de 25s excedido no servidor WMS.' : err.message,
      });
    }
  });

  // Direct synchronization endpoint: writes .geojson files to public/data/ and updates public/mapas-config.json
  app.post('/api/layers/sync-public', async (req, res) => {
    try {
      const { layers } = req.body;
      if (!Array.isArray(layers)) {
        res.status(400).json({ error: 'Formato inválido: "layers" deve ser um array.' });
        return;
      }

      const publicDir = path.join(process.cwd(), 'public');
      const dataDir = path.join(publicDir, 'data');
      await fs.promises.mkdir(dataDir, { recursive: true });

      const nameCounts: Record<string, number> = {};
      const camadasFixas: any[] = [];

      for (let i = 0; i < layers.length; i++) {
        const lyr = layers[i];
        if (!lyr) continue;

        const isRasterServiceLayer = Boolean(
          lyr.serviceType === 'wms' ||
          lyr.serviceType === 'xyz' ||
          lyr.wmsConfig ||
          lyr.xyzConfig ||
          (lyr.isRealtime && lyr.realtimeUrl)
        );

        let arquivoPath: string | undefined = undefined;

        if (!isRasterServiceLayer && lyr.data && Array.isArray(lyr.data.features)) {
          let fileName = '';
          if (typeof lyr.url === 'string' && lyr.url.startsWith('data/') && lyr.url.endsWith('.geojson')) {
            fileName = path.basename(lyr.url);
          } else {
            let safeName = sanitizeLayerFileName(lyr.name, i);
            if (nameCounts[safeName]) {
              nameCounts[safeName]++;
              safeName = `${safeName}_${nameCounts[safeName]}`;
            } else {
              nameCounts[safeName] = 1;
            }
            fileName = `${safeName}.geojson`;
          }

          const fullFilePath = path.join(dataDir, fileName);
          const geojsonPayload = {
            type: 'FeatureCollection',
            features: lyr.data.features,
          };

          await fs.promises.writeFile(fullFilePath, JSON.stringify(geojsonPayload, null, 2), 'utf-8');
          arquivoPath = `data/${fileName}`;
        }

        const configEntry: Record<string, any> = {
          id: lyr.id,
          nome: lyr.name || `Camada ${i + 1}`,
          ...(arquivoPath ? { arquivo: arquivoPath } : {}),
          visivel: lyr.visible !== undefined ? Boolean(lyr.visible) : true,
          opacity: lyr.opacity !== undefined ? Number(lyr.opacity) : 1,
          ignoreGlobalFilter: Boolean(lyr.ignoreGlobalFilter),
          popupTitleField: lyr.popupTitleField || undefined,
          popupVisibleFields: Array.isArray(lyr.popupVisibleFields) ? lyr.popupVisibleFields : [],
          popupFieldOrder: Array.isArray(lyr.popupFieldOrder) ? lyr.popupFieldOrder : [],
          estilo: lyr.style || {},
        };

        if (lyr.description) configEntry.description = lyr.description;
        if (lyr.bbox) configEntry.bbox = lyr.bbox;
        if (lyr.thematic) configEntry.thematic = lyr.thematic;
        if (lyr.isHeatmap !== undefined) configEntry.isHeatmap = lyr.isHeatmap;
        if (lyr.isRealtime) {
          configEntry.isRealtime = lyr.isRealtime;
          configEntry.realtimeUrl = lyr.realtimeUrl;
          configEntry.refreshIntervalSeconds = lyr.refreshIntervalSeconds;
        }
        if (lyr.serviceType) configEntry.serviceType = lyr.serviceType;
        if (lyr.isServiceLayer !== undefined) configEntry.isServiceLayer = lyr.isServiceLayer;
        if (lyr.url) configEntry.url = lyr.url;
        if (lyr.wmsConfig) configEntry.wmsConfig = lyr.wmsConfig;
        if (lyr.xyzConfig) configEntry.xyzConfig = lyr.xyzConfig;

        camadasFixas.push(configEntry);
      }

      const mapasConfig = {
        updatedAt: Date.now(),
        camadas_fixas: camadasFixas,
      };

      const configFilePath = path.join(publicDir, 'mapas-config.json');
      await fs.promises.writeFile(configFilePath, JSON.stringify(mapasConfig, null, 2), 'utf-8');

      res.json({
        status: 'ok',
        updatedAt: mapasConfig.updatedAt,
        layersCount: camadasFixas.length,
      });
    } catch (err: any) {
      console.error('Erro ao sincronizar camadas em public/:', err);
      res.status(500).json({
        error: 'Falha ao sincronizar camadas com a pasta public/',
        details: err.message,
      });
    }
  });

  // Proxy for live real-time USGS earthquakes feed (avoids CORS issues)
  app.get('/api/realtime/earthquakes', async (req, res) => {
    try {
      const response = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
      if (!response.ok) {
        throw new Error(`USGS HTTP Error: ${response.status}`);
      }
      const data = await response.json();
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: 'Falha ao buscar feed sísmico em tempo real', details: err.message });
    }
  });

  // Vite middleware for development vs static build for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
        watch: {
          ignored: ['**/public/data/**', '**/public/mapas-config.json'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use('/GEOPORTAL-GRAPROHAB', express.static(distPath));
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`WebMap GIS Studio rodando em http://0.0.0.0:${PORT}`);
  });
}

startServer();

