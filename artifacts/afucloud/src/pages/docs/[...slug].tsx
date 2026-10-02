import type { GetServerSideProps } from 'next';
import DocsPage from '@/screens/docs';
import { docsSectionIdFromSlug, type DocsSectionId } from '@/lib/docs-routes';
import { getPublicSiteUrl } from '@/lib/server-site-url';

type DocsTopicProps = {
  sectionId: DocsSectionId;
  siteUrl: string | null;
};

export const getServerSideProps: GetServerSideProps<DocsTopicProps> = async ({ params }) => {
  const sectionId = docsSectionIdFromSlug(params?.slug as string[] | undefined);
  if (!sectionId) return { notFound: true };

  return {
    props: {
      sectionId,
      siteUrl: getPublicSiteUrl(),
    },
  };
};

export default function DocsTopicRoute({ sectionId }: DocsTopicProps) {
  return <DocsPage sectionId={sectionId} />;
}