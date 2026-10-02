function httpsOrigin(value: string | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

export function getPublicSiteUrl(): string | null {
  const configured = httpsOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return configured;

  // This is the verified public AfuCloud origin; NEXT_PUBLIC_SITE_URL can override it.
  return 'https://cloud.afuchat.com';
}