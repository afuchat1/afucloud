import LandingPage from '@/screens/landing';
import type { GetServerSideProps } from 'next';
import { getPublicSiteUrl } from '@/lib/server-site-url';

type HomePageProps = { siteUrl: string | null };

export const getServerSideProps: GetServerSideProps<HomePageProps> = async () => ({
  props: { siteUrl: getPublicSiteUrl() },
});

export default function HomePage() {
  return <LandingPage />;
}