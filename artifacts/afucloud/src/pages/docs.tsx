import DocsPage from '@/screens/docs';
import type { GetServerSideProps } from 'next';
import { getPublicSiteUrl } from '@/lib/server-site-url';

type DocsPageProps = { siteUrl: string | null };

export const getServerSideProps: GetServerSideProps<DocsPageProps> = async () => ({
  props: { siteUrl: getPublicSiteUrl() },
});

export default function DocsRoute() {
  return <DocsPage />;
}