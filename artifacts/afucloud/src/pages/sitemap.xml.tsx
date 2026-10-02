import type { GetServerSideProps } from 'next';
import { getPublicSiteUrl } from '@/lib/server-site-url';

const publicPaths = ['/', '/docs', '/roadmap', '/branding'];

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const siteUrl = getPublicSiteUrl();
  const urls = siteUrl
    ? publicPaths.map((path) => `<url><loc>${new URL(path, siteUrl).toString()}</loc></url>`).join('')
    : '';
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  res.write(xml);
  res.end();

  return { props: {} };
};

export default function SitemapXml() {
  return null;
}