export const DOCS_SECTIONS = [
  {
    id: 'quickstart',
    slug: 'getting-started/quickstart',
    title: 'Quick Start',
    category: 'Getting started',
    summary: 'Create a project, choose a credential, and make your first API request.',
  },
  {
    id: 'upload',
    slug: 'image-delivery/uploading-images',
    title: 'Uploading Images',
    category: 'Image delivery',
    summary: 'Upload an image and use its returned URL for delivery.',
  },
  {
    id: 'images',
    slug: 'image-delivery/managing-images',
    title: 'Managing Images',
    category: 'Image delivery',
    summary: 'Search, update, favorite, restore, and delete project images.',
  },
  {
    id: 'storage',
    slug: 'storage/object-storage',
    title: 'Object Storage',
    category: 'Storage',
    summary: 'Organize files in containers and deliver them from your chosen domain.',
  },
  {
    id: 'apikeys',
    slug: 'developer-tools/api-keys',
    title: 'API Keys',
    category: 'Developer tools',
    summary: 'Create scoped project credentials for development and production.',
  },
  {
    id: 'tokens',
    slug: 'developer-tools/personal-access-tokens',
    title: 'Personal Access Tokens',
    category: 'Developer tools',
    summary: 'Use account-level tokens to automate work across projects.',
  },
  {
    id: 'webhooks',
    slug: 'developer-tools/webhooks',
    title: 'Webhooks',
    category: 'Developer tools',
    summary: 'Subscribe to project events and verify signed delivery requests.',
  },
  {
    id: 'reference',
    slug: 'api/reference',
    title: 'API Reference',
    category: 'Developer tools',
    summary: 'Browse AfuCloud endpoints, methods, and authentication requirements.',
  },
  {
    id: 'analytics',
    slug: 'account/analytics',
    title: 'Analytics',
    category: 'Account and domains',
    summary: 'Review image totals, storage use, and upload activity.',
  },
  {
    id: 'domains',
    slug: 'domains/custom-domains',
    title: 'Custom Domains',
    category: 'Account and domains',
    summary: 'Verify a domain and manage DNS records for AfuCloud services.',
  },
  {
    id: 'registration',
    slug: 'domains/domain-registration',
    title: 'Domain Registration',
    category: 'Account and domains',
    summary: 'Check live availability, review the final price, and register a domain.',
  },
] as const;

export type DocsSectionId = (typeof DOCS_SECTIONS)[number]['id'];

export function docsPathForSection(sectionId: string): string {
  const section = DOCS_SECTIONS.find((item) => item.id === sectionId);
  return section ? `/docs/${section.slug}` : '/docs';
}

export function docsSectionIdFromSlug(
  slug: string | string[] | undefined,
): DocsSectionId | null {
  const normalizedSlug = Array.isArray(slug) ? slug.join('/') : slug;
  if (!normalizedSlug) return null;

  return DOCS_SECTIONS.find((item) => item.slug === normalizedSlug)?.id ?? null;
}