import Head from 'next/head';
import { useRouter } from 'next/router';

type RouteMetadata = {
  title: string;
  description: string;
  indexable?: boolean;
};

const routeMetadata: Record<string, RouteMetadata> = {
  '/': {
    title: 'AfuCloud Image Storage API for Developers | Global CDN',
    description: 'Upload, organize, and deliver images with AfuCloud’s developer-first image storage API. Get secure project controls, flexible URLs, and fast CDN delivery.',
    indexable: true,
  },
  '/docs': {
    title: 'AfuCloud API Documentation | Image Storage Integration',
    description: 'Build with AfuCloud using guides for projects, secure image uploads, API keys, webhooks, custom domains, and CDN delivery, with practical integration examples.',
    indexable: true,
  },
  '/roadmap': {
    title: 'AfuCloud Product Roadmap for Image Storage & CDN',
    description: 'Explore upcoming AfuCloud plans for image, video, and document storage, developer tools, team collaboration, custom domains, and faster media delivery.',
    indexable: true,
  },
  '/branding': {
    title: 'AfuCloud Brand Assets: Logo, Color & Ownership',
    description: 'See AfuCloud’s official green cloud logo and brand color #07965B. This page identifies the AfuCloud brand assets and states that they are owned by AfuCloud.',
    indexable: true,
  },
  '/login': {
    title: 'Sign In to AfuCloud | Image Storage Dashboard',
    description: 'Sign in to AfuCloud to manage your image storage projects, assets, API keys, domains, and account settings.',
  },
  '/register': {
    title: 'Create an AfuCloud Account | Free Image Storage',
    description: 'Create an AfuCloud account to start organizing and delivering images with a developer-first storage API and CDN.',
  },
  '/dashboard': {
    title: 'AfuCloud Dashboard | Image Storage Projects',
    description: 'Manage AfuCloud image storage projects, assets, usage, API access, and delivery settings from your account dashboard.',
  },
  '/projects': {
    title: 'AfuCloud Projects | Image Storage and API Keys',
    description: 'View and manage your AfuCloud image storage projects, project API keys, image collections, webhooks, and usage analytics.',
  },
  '/projects/[id]': {
    title: 'AfuCloud Project Details | Image Storage',
    description: 'Manage images, upload settings, delivery URLs, and project configuration in your AfuCloud image storage workspace.',
  },
  '/projects/[id]/api-keys': {
    title: 'AfuCloud Project API Keys | Secure Image Storage',
    description: 'Create and revoke scoped API keys for secure image uploads and project operations in your AfuCloud workspace.',
  },
  '/projects/[id]/webhooks': {
    title: 'AfuCloud Webhooks | Project Event Notifications',
    description: 'Configure AfuCloud project webhooks to receive delivery and image storage event notifications in your applications.',
  },
  '/projects/[id]/analytics': {
    title: 'AfuCloud Project Analytics | Image Usage',
    description: 'Review image uploads, downloads, storage usage, and activity trends for an AfuCloud project.',
  },
  '/analytics': {
    title: 'AfuCloud Analytics | Storage Usage',
    description: 'Review image storage usage and delivery activity across your AfuCloud projects from one account view.',
  },
  '/activity': {
    title: 'AfuCloud Activity | Account and Project Events',
    description: 'Review recent account and project events related to AfuCloud image storage, uploads, and configuration.',
  },
  '/tokens': {
    title: 'AfuCloud API Tokens | Developer Access',
    description: 'Manage personal AfuCloud API tokens used to access account-level developer and image storage features.',
  },
  '/settings': {
    title: 'AfuCloud Account Settings | Billing and Security',
    description: 'Manage your AfuCloud profile, password, subscription, billing details, and account security settings.',
  },
  '/domains': {
    title: 'AfuCloud Domains | Image Delivery Configuration',
    description: 'Connect and manage custom domains for branded AfuCloud image delivery and cloud storage workflows.',
  },
  '/domains/[domainId]/dns': {
    title: 'AfuCloud DNS Setup | Custom Image Delivery Domains',
    description: 'Review and configure DNS records for custom domains connected to AfuCloud image delivery.',
  },
  '/storage': {
    title: 'AfuCloud Storage | Manage Image Containers',
    description: 'Browse and manage your AfuCloud storage containers, image files, and delivery URLs.',
  },
  '/404': {
    title: 'Page Not Found | AfuCloud',
    description: 'This AfuCloud page could not be found. Return to the image storage platform homepage or visit the developer documentation.',
  },
};

type SeoHeadProps = {
  siteUrl?: string | null;
};

const publicRoutes = new Set(['/', '/docs', '/roadmap', '/branding']);

export function SeoHead({ siteUrl }: SeoHeadProps) {
  const router = useRouter();
  const pathname = router.pathname;
  const metadata = routeMetadata[pathname] ?? {
    title: 'AfuCloud | Developer Image Storage',
    description: 'Manage image storage projects, secure uploads, API access, and CDN delivery with AfuCloud.',
  };
  const indexable = metadata.indexable === true && publicRoutes.has(pathname);
  const canonicalUrl = indexable && siteUrl
    ? new URL(pathname, siteUrl).toString()
    : undefined;
  const imageUrl = siteUrl ? new URL('/afucloud-social-card.png', siteUrl).toString() : undefined;
  const robots = indexable
    ? 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
    : 'noindex, nofollow';

  const structuredData = pathname === '/'
    ? {
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            name: 'AfuCloud',
            ...(siteUrl ? { url: siteUrl, logo: new URL('/afucloud-logo.svg', siteUrl).toString() } : {}),
          },
          {
            '@type': 'WebSite',
            name: 'AfuCloud',
            ...(siteUrl ? { url: siteUrl } : {}),
            description: metadata.description,
          },
          {
            '@type': 'WebApplication',
            name: 'AfuCloud',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Web',
            description: metadata.description,
            featureList: [
              'Image storage and management',
              'Secure image uploads',
              'CDN image delivery',
              'Developer REST API',
            ],
            ...(siteUrl ? { url: siteUrl } : {}),
          },
        ],
      }
    : null;

  return (
    <Head>
      <title key="title">{metadata.title}</title>
      <meta key="description" name="description" content={metadata.description} />
      <meta key="robots" name="robots" content={robots} />
      <meta key="googlebot" name="googlebot" content={robots} />
      <meta key="theme-color" name="theme-color" content="#07965B" />
      <meta key="og:site_name" property="og:site_name" content="AfuCloud" />
      <meta key="og:type" property="og:type" content="website" />
      <meta key="og:title" property="og:title" content={metadata.title} />
      <meta key="og:description" property="og:description" content={metadata.description} />
      {canonicalUrl && <link key="canonical" rel="canonical" href={canonicalUrl} />}
      {canonicalUrl && <meta key="og:url" property="og:url" content={canonicalUrl} />}
      {imageUrl && (
        <>
          <meta key="og:image" property="og:image" content={imageUrl} />
          <meta key="og:image:type" property="og:image:type" content="image/png" />
          <meta key="og:image:alt" property="og:image:alt" content="AfuCloud image storage API and CDN delivery" />
          <meta key="og:image:width" property="og:image:width" content="1200" />
          <meta key="og:image:height" property="og:image:height" content="630" />
          <meta key="twitter:image" name="twitter:image" content={imageUrl} />
        </>
      )}
      <meta key="twitter:card" name="twitter:card" content={imageUrl ? 'summary_large_image' : 'summary'} />
      <meta key="twitter:title" name="twitter:title" content={metadata.title} />
      <meta key="twitter:description" name="twitter:description" content={metadata.description} />
      {structuredData && (
        <script
          key="structured-data"
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
        />
      )}
    </Head>
  );
}