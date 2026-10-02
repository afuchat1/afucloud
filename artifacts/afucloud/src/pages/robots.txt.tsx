import type { GetServerSideProps } from 'next';
import { getPublicSiteUrl } from '@/lib/server-site-url';

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const siteUrl = getPublicSiteUrl();
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /dashboard',
    'Disallow: /projects/',
    'Disallow: /analytics',
    'Disallow: /activity',
    'Disallow: /tokens',
    'Disallow: /domains/',
    'Disallow: /settings',
    'Disallow: /storage',
    ...(siteUrl ? [`Sitemap: ${siteUrl}/sitemap.xml`] : []),
  ];

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600');
  res.write(`${lines.join('\n')}\n`);
  res.end();

  return { props: {} };
};

export default function RobotsTxt() {
  return null;
}