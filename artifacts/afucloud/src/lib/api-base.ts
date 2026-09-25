// Keep handwritten API calls on the same target as the generated API client.
// Vite's dev server proxies /api to the local API server; production points at
// the configured remote API.
export const API_BASE = import.meta.env.DEV
  ? '/api'
  : (import.meta.env.VITE_API_BASE_URL || 'https://api.afuchat.com');

const PUBLIC_IMAGE_BASE_URL = 'https://img.afuchat.com';

function publicUrlForStorageEndpoint(url: string): string | null {
  let pathname: string;
  if (/^(?:https?:)?\/\//i.test(url)) {
    try {
      pathname = new URL(url.startsWith('//') ? `https:${url}` : url).pathname;
    } catch {
      return null;
    }
  } else {
    pathname = url.split(/[?#]/, 1)[0];
  }

  const match = pathname.match(/^\/(?:api\/)?v1\/storage\/(.+)$/);
  if (!match) return null;

  let key = match[1];
  try {
    key = decodeURIComponent(key);
  } catch {
    // Keep the original path if a legacy URL contains malformed escaping.
  }
  return `${PUBLIC_IMAGE_BASE_URL}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  const isAbsoluteUrl = /^(?:https?:)?\/\//i.test(url);
  const publicStorageUrl = (!import.meta.env.DEV || isAbsoluteUrl)
    ? publicUrlForStorageEndpoint(url)
    : null;
  if (publicStorageUrl) return publicStorageUrl;
  if (isAbsoluteUrl || /^(?:data|blob):/i.test(url)) return url;
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