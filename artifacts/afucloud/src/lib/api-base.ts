// In development, the shared Replit proxy routes /api to the Express API.
// Production calls the Cloudflare Worker API directly.
const isDevelopment = process.env.NODE_ENV !== 'production';

export const API_BASE = isDevelopment
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL || 'https://api.afuchat.com/afucloud');

const PUBLIC_CDN_BASE_URL = 'https://cdn.afuchat.com/cloud';

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
  const isContainerObject = key.startsWith('containers/');
  const route = isContainerObject ? 'storage' : 'images';
  const publicKey = isContainerObject ? key.slice('containers/'.length) : key;
  return `${PUBLIC_CDN_BASE_URL}/${route}/${publicKey.split('/').map(encodeURIComponent).join('/')}`;
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  const isAbsoluteUrl = /^(?:https?:)?\/\//i.test(url);
  const publicStorageUrl = (!isDevelopment || isAbsoluteUrl)
    ? publicUrlForStorageEndpoint(url)
    : null;
  if (publicStorageUrl) return publicStorageUrl;
  if (isAbsoluteUrl || /^(?:data|blob):/i.test(url)) return url;
  const base = API_BASE.replace(/\/+$/, '');
  let path = url.startsWith('/') ? url : `/${url}`;
  // Older API-server responses include the local proxy prefix. Production
  // requests use the product-scoped /afucloud/v1 path.
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