import type { GetServerSideProps } from 'next';
import BrandingPage from '@/screens/branding';
import { getPublicSiteUrl } from '@/lib/server-site-url';

type BrandingPageProps = { siteUrl: string | null };

export const getServerSideProps: GetServerSideProps<BrandingPageProps> = async () => ({
  props: { siteUrl: getPublicSiteUrl() },
});

export default function BrandingRoute() {
  return <BrandingPage />;
}