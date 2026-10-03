import RoadmapPage from '@/screens/public-roadmap';
import type { GetServerSideProps } from 'next';
import { getPublicSiteUrl } from '@/lib/server-site-url';

type RoadmapPageProps = { siteUrl: string | null };

export const getServerSideProps: GetServerSideProps<RoadmapPageProps> = async () => ({
  props: { siteUrl: getPublicSiteUrl() },
});

export default function RoadmapRoute() {
  return <RoadmapPage />;
}