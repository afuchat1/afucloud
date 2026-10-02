import NextLink from 'next/link';
import { useRouter } from 'next/router';

export const Link = NextLink;

export function useLocation(): [string, (path: string) => void] {
  const router = useRouter();
  const pathname = router.asPath.split(/[?#]/, 1)[0] || '/';
  const navigate = (path: string) => {
    void router.push(path);
  };
  return [pathname, navigate];
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  const router = useRouter();
  const params = { ...router.query } as Record<string, string | string[]>;
  const routeParts = router.pathname.split('/').filter(Boolean);
  const pathParts = router.asPath.split(/[?#]/, 1)[0].split('/').filter(Boolean);

  routeParts.forEach((part, index) => {
    const match = part.match(/^\[\[?\.{3}(.+?)\]?\]$|^\[(.+?)\]$/);
    const key = match?.[1] ?? match?.[2];
    if (key && params[key] === undefined && pathParts[index]) {
      try {
        params[key] = decodeURIComponent(pathParts[index]);
      } catch {
        params[key] = pathParts[index];
      }
    }
  });

  return params as T;
}