/**
 * Utilitários de resolução de URLs estáticas, Cache-Busting determinístico
 * e sincronização direta de camadas cartográficas com o servidor Express / GitHub Pages.
 */

export function appendCacheBuster(url: string): string {
  if (!url) return url;
  const cleanUrl = url.trim();
  const separator = cleanUrl.includes('?') ? '&' : '?';
  return `${cleanUrl}${separator}_cb=${Date.now()}`;
}

export function resolvePublicAssetUrl(relativePath: string): string {
  if (!relativePath) return '';
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  const baseUrl = (import.meta as any).env?.BASE_URL || './';
  const cleanPath = relativePath.replace(/^\.?\//, '');
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${cleanPath}`;
}

export async function fetchPublicAsset(url: string, init?: RequestInit): Promise<Response> {
  const resolvedUrl = resolvePublicAssetUrl(url);
  const bustedUrl = appendCacheBuster(resolvedUrl);

  return fetch(bustedUrl, {
    ...init,
    cache: 'no-store',
    headers: {
      ...(init?.headers || {}),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

export async function fetchPublicJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchPublicAsset(url, init);
  if (!response.ok) {
    throw new Error(`Falha ao buscar recurso JSON (${response.status}): ${url}`);
  }
  const text = await response.text();
  return JSON.parse(text) as T;
}

export async function syncLayersToPublicServer(layers: any[]): Promise<boolean> {
  try {
    const response = await fetch('/api/layers/sync-public', {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
      body: JSON.stringify({ layers }),
    });
    return response.ok;
  } catch (err) {
    console.warn('Sincronização com servidor público indisponível (modo estático/offline):', err);
    return false;
  }
}
