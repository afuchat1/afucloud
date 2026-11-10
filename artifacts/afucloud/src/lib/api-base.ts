// In development, the shared Replit proxy routes /api to the Express API.
// Production calls the Cloudflare Worker API directly.
const isDevelopment = process.env.NODE_ENV !== 'production';

export const API_BASE = isDevelopment
  ? '/api'
  : (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL || 'https://api.afuchat.com/afucloud');

const PUBLIC_CDN_BASE_URL = 'https://cdn.afuchat.com/cloud';
const PUBLIC_CDN_SOURCE_HOSTS = new Set([
  'api.afuchat.com',
  'cdn.afuchat.com',
  'img.afuchat.com',
  'vid.afuchat.com',
]);

function parseUrlPath(url: string): { pathname: string; hostname: string | null } {
  if (/^(?:https?:)?\/\//i.test(url)) {
    try {
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
      return { pathname: parsed.pathname, hostname: parsed.hostname.toLowerCase() };
    } catch {
      return { pathname: '', hostname: null };
    }
  }

  return { pathname: url.split(/[?#]/, 1)[0], hostname: null };
}

function encodePathSegments(path: string): string {
  return path.split('/').map((segment) => {
    try {
      return encodeURIComponent(decodeURIComponent(segment));
    } catch {
      return encodeURIComponent(segment);
    }
  }).join('/');
}

function publicUrlForCdnPath(url: string): string | null {
  const { pathname, hostname } = parseUrlPath(url);
  if (!pathname || (hostname && !PUBLIC_CDN_SOURCE_HOSTS.has(hostname))) return null;

  const normalizedPath = pathname.replace(/^\/(?:api\/)?(?:afucloud\/)?(?=cloud\/)/, '/');
  const match = normalizedPath.match(/^\/cloud\/(images|object|storage)\/(.+)$/);
  if (!match) return null;

  const route = match[1] === 'images' ? 'images' : 'object';
  let publicKey = match[2].split('/').map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  }).join('/');
  if (route === 'object' && publicKey.startsWith('containers/')) {
    publicKey = publicKey.slice('containers/'.length);
  }

  return `${PUBLIC_CDN_BASE_URL}/${route}/${encodePathSegments(publicKey)}`;
}

function publicUrlForStorageEndpoint(url: string): string | null {
  const { pathname } = parseUrlPath(url);
  const normalizedPath = pathname.replace(/^\/(?:api\/)?(?:afucloud\/)?(?=v1\/storage\/)/, '/');
  const match = normalizedPath.match(/^\/v1\/storage\/(.+)$/);
  if (!match) return null;

  let key = match[1];
  try {
    key = decodeURIComponent(key);
  } catch {
    // Keep the original path if a legacy URL contains malformed escaping.
  }
  const isContainerObject = key.startsWith('containers/');
  const route = isContainerObject ? 'object' : 'images';
  const publicKey = isContainerObject ? key.slice('containers/'.length) : key;
  return `${PUBLIC_CDN_BASE_URL}/${route}/${encodePathSegments(publicKey)}`;
}

export function resolveImageUrl(url: string | null | undefined): string {
  if (!url) return '';
  const publicCdnUrl = publicUrlForCdnPath(url);
  if (publicCdnUrl) return publicCdnUrl;
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

export function resolveStorageObjectUrl(url: string | null | undefined): string {
  if (!url) return '';
  return publicUrlForCdnPath(url) ?? publicUrlForStorageEndpoint(url) ?? resolveImageUrl(url);
}

export function getStorageFileUrl(storageKey: string | null | undefined): string {
  if (!storageKey) return '';
  return resolveImageUrl(`/v1/storage/${encodeURIComponent(storageKey)}`);
}