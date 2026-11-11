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

        const isServiceLayer = Boolean(
          lyr.serviceType ||
          lyr.wmsUrl ||
          lyr.xyzUrl ||
          (lyr.isRealtime && lyr.realtimeUrl)
        );

        let arquivoPath: string | undefined = undefined;

        if (!isServiceLayer && lyr.data && Array.isArray(lyr.data.features)) {
          let safeName = sanitizeLayerFileName(lyr.name, i);
          if (nameCounts[safeName]) {
            nameCounts[safeName]++;
            safeName = `${safeName}_${nameCounts[safeName]}`;
          } else {
            nameCounts[safeName] = 1;
          }

          const fileName = `${safeName}.geojson`;
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
        if (lyr.thematic) configEntry.thematic = lyr.thematic;
        if (lyr.isHeatmap !== undefined) configEntry.isHeatmap = lyr.isHeatmap;
        if (lyr.isRealtime) {
          configEntry.isRealtime = lyr.isRealtime;
          configEntry.realtimeUrl = lyr.realtimeUrl;
          configEntry.refreshIntervalSeconds = lyr.refreshIntervalSeconds;
        }
        if (lyr.serviceType) configEntry.serviceType = lyr.serviceType;
        if (lyr.wmsUrl) configEntry.wmsUrl = lyr.wmsUrl;
        if (lyr.wmsLayers) configEntry.wmsLayers = lyr.wmsLayers;
        if (lyr.xyzUrl) configEntry.xyzUrl = lyr.xyzUrl;

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
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
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

