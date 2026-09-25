// Keep handwritten API calls on the same target as the generated API client.
// Vite's dev server proxies /api to the local API server; production points at
// the configured remote API.
export const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || 'https://api.afuchat.com');

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  if (/^(?:https?:)?\/\//i.test(url) || /^(?:data|blob):/i.test(url)) return url;
  const base = API_BASE.replace(/\/+$/, '');
  let path = url.startsWith('/') ? url : `/${url}`;
  // Older API-server responses include the local proxy prefix. Production
  // routes go directly to the Worker, whose canonical API prefix is /v1.
  if (!base.startsWith('/') && (path === '/api/v1' || path.startsWith('/api/v1/'))) {
    path = path.slice(4);
  }
  if (base.startsWith('/') && (path === base || path.startsWith(`${base}/`))) return path;
  return `${base}${path}`;
}

export function getStorageFileUrl(storageKey: string | null | undefined): string {
  if (!storageKey) return '';
  return resolveImageUrl(`/v1/storage/${encodeURIComponent(storageKey)}`);
}