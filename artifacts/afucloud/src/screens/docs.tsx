import { useState } from 'react';
import { BookOpen, Code, Zap, Upload, Image, Webhook, Key, KeyRound, Globe2, HardDrive, BarChart3, ArrowRight, Copy, Check, Menu, X, Search, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PublicHeader } from '@/components/public-header';
import { Link } from '@/lib/navigation';
import { DOCS_SECTIONS, type DocsSectionId, docsPathForSection } from '@/lib/docs-routes';

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const handleCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) throw new Error('Clipboard copy was rejected');
      }
      setCopyFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 2500);
    }
  };
  return (
    <div className="relative min-w-0 max-w-full overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 bg-[#1C1C1C] px-3 py-2 sm:px-4 border-b border-white/10">
        <span className="text-[11px] font-mono text-white/40">{language}</span>
        <Button
          type="button"
          onClick={handleCopy}
          aria-label={copyFailed ? 'Could not copy code' : copied ? 'Code copied' : 'Copy code to clipboard'}
          data-testid="button-copy-code"
          className="no-default-hover-elevate no-default-active-elevate h-7 min-h-7 shrink-0 rounded-md border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-md hover:border-white/20 hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          <span aria-live="polite">{copied ? 'Copied' : copyFailed ? 'Copy failed' : 'Copy'}</span>
        </Button>
      </div>
      <pre className="max-w-full overflow-x-auto bg-[#1C1C1C] px-3 py-3 text-[11px] leading-relaxed font-mono text-green-300/90 whitespace-pre sm:px-4 sm:text-[12px]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const sectionIcons = {
  quickstart: Zap,
  upload: Upload,
  images: Image,
  storage: HardDrive,
  apikeys: Key,
  tokens: KeyRound,
  webhooks: Webhook,
  reference: Code,
  analytics: BarChart3,
  domains: Globe2,
  registration: Globe2,
} satisfies Record<DocsSectionId, typeof Zap>;

const sections = DOCS_SECTIONS.map((section) => ({
  ...section,
  icon: sectionIcons[section.id],
}));

const BASE = 'https://api.afuchat.com';

export default function DocsPage({ sectionId = null }: { sectionId?: DocsSectionId | null }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const activeSection = sectionId;
  const filteredSections = sections.filter((section) =>
    `${section.title} ${section.category} ${section.summary}`.toLowerCase().includes(searchQuery.trim().toLowerCase()),
  );
  const categories = [...new Set(filteredSections.map((section) => section.category))];
  const currentIndex = sectionId ? DOCS_SECTIONS.findIndex((section) => section.id === sectionId) : -1;
  const previousSection = currentIndex > 0 ? DOCS_SECTIONS[currentIndex - 1] : null;
  const nextSection = currentIndex >= 0 && currentIndex < DOCS_SECTIONS.length - 1
    ? DOCS_SECTIONS[currentIndex + 1]
    : null;
  const currentSection = DOCS_SECTIONS.find((section) => section.id === sectionId);

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(ellipse_at_4%_0%,rgba(15,145,91,0.055),transparent_34rem)]">
      <PublicHeader />
      <main className="mx-auto max-w-[1440px] px-4 pb-20 pt-5 sm:px-6 lg:px-8 lg:pt-8">
        <div className="min-w-0 lg:grid lg:grid-cols-[258px_minmax(0,1fr)] lg:gap-12">
          <aside className="mb-5 min-w-0 lg:mb-0">
            <div className="lg:sticky lg:top-24">
              <label className={cn('relative mb-3 block', !sectionId && 'hidden')}>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search documentation"
                  aria-label="Search documentation"
                  data-testid="input-docs-search"
                  className="h-10 w-full rounded-xl border border-border/80 bg-card/80 pl-9 pr-3 text-sm text-foreground shadow-[0_5px_18px_rgba(35,47,38,0.05)] backdrop-blur-xl placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mb-3 flex w-full items-center justify-between lg:hidden"
                aria-expanded={mobileNavOpen}
                aria-controls="docs-sections"
                data-testid="button-docs-mobile-nav"
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                <span className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Browse documentation
                </span>
                {mobileNavOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </Button>

              <nav
                id="docs-sections"
                aria-label="Documentation sections"
                className={cn(
                  'max-h-[min(65vh,620px)] overflow-y-auto rounded-2xl border border-border/70 bg-card/70 p-3 shadow-[0_14px_38px_rgba(35,47,38,0.06)] backdrop-blur-xl lg:max-h-[calc(100dvh-10rem)] lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none',
                  mobileNavOpen ? 'block' : 'hidden lg:block',
                )}
              >
                <Link
                  href="/docs"
                  onClick={() => setMobileNavOpen(false)}
                  aria-current={!sectionId ? 'page' : undefined}
                  data-testid="link-docs-overview"
                  className={cn(
                    'flex min-h-10 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                    !sectionId
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  Overview
                </Link>
                {categories.map((category) => (
                  <div key={category} className="space-y-1">
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground/70">
                      {category}
                    </p>
                    {filteredSections
                      .filter((section) => section.category === category)
                      .map((section) => {
                        const Icon = section.icon;
                        return (
                          <Link
                            key={section.id}
                            href={docsPathForSection(section.id)}
                            onClick={() => setMobileNavOpen(false)}
                            aria-current={activeSection === section.id ? 'page' : undefined}
                            data-testid={`link-docs-section-${section.id}`}
                            className={cn(
                              'flex min-h-9 items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] transition-colors',
                              activeSection === section.id
                                ? 'bg-primary/10 font-medium text-primary'
                                : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground',
                            )}
                          >
                            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                            <span className="min-w-0 truncate">{section.title}</span>
                          </Link>
                        );
                      })}
                  </div>
                ))}
                {filteredSections.length === 0 && (
                  <p data-testid="text-docs-search-empty" className="px-3 py-2 text-sm text-muted-foreground">No guides match that search.</p>
                )}
              </nav>
            </div>
          </aside>

          <div className="min-w-0">
            {!sectionId ? (
              <section className="mx-auto max-w-5xl space-y-10">
                <div className="relative overflow-hidden rounded-[1.75rem] border border-border/80 bg-card/80 p-6 shadow-[0_20px_60px_rgba(35,47,38,0.07)] backdrop-blur-xl sm:p-10">
                  <div className="pointer-events-none absolute -right-10 -top-24 h-64 w-64 rounded-full border border-primary/10 bg-primary/[0.035] sm:right-6 sm:top-[-8rem]" />
                  <div className="relative">
                  <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.17em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> AfuCloud developer guide</p>
                  <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">Documentation</h1>
                  <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base sm:leading-7">
                    Find setup guides, product documentation, and API references for building with AfuCloud.
                  </p>
                  <label className="relative mt-6 block max-w-2xl">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search guides and API topics"
                      aria-label="Search guides and API topics"
                      data-testid="input-docs-overview-search"
                      className="h-12 w-full rounded-xl border border-border/80 bg-background/90 pl-11 pr-4 text-sm shadow-[0_5px_18px_rgba(35,47,38,0.06)] backdrop-blur-xl placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>
                  </div>
                </div>

                {categories.map((category) => (
                  <section key={category} className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h2 className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{category}</h2>
                      <span className="h-px flex-1 bg-border/70" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {filteredSections
                        .filter((section) => section.category === category)
                        .map((section) => {
                          const Icon = section.icon;
                          return (
                            <Link
                              key={section.id}
                              href={docsPathForSection(section.id)}
                              className="group rounded-2xl border border-border/75 bg-card/75 p-5 shadow-[0_6px_20px_rgba(35,47,38,0.035)] backdrop-blur-xl transition-[transform,border-color,background-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-card hover:shadow-[0_14px_30px_rgba(35,47,38,0.08)]"
                              data-testid={`docs-guide-${section.id}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-primary/15 bg-primary/10 text-primary">
                                  <Icon className="h-4 w-4" />
                                </span>
                                <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                              </div>
                              <h3 className="mt-5 text-[15px] font-semibold">{section.title}</h3>
                              <p className="mt-2 text-sm leading-6 text-muted-foreground">{section.summary}</p>
                            </Link>
                          );
                        })}
                    </div>
                  </section>
                ))}

                {filteredSections.length === 0 && (
                  <div className="rounded-2xl border border-border/80 bg-card/70 p-8 text-center">
                    <Search className="mx-auto h-5 w-5 text-muted-foreground" />
                    <p className="mt-3 text-sm font-semibold">No guides found</p>
                    <p data-testid="text-docs-overview-empty" className="mt-1 text-sm text-muted-foreground">Try a product name or API topic.</p>
                  </div>
                )}
              </section>
            ) : (
              <>
                <nav aria-label="Breadcrumb" className="mb-7 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Link href="/docs" data-testid="link-docs-breadcrumb-overview" className="transition-colors hover:text-foreground">Documentation</Link>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{currentSection?.category}</span>
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-current="page" className="font-medium text-foreground">{currentSection?.title}</span>
                </nav>

                <div className="min-w-0 max-w-5xl space-y-8">
                  <header className="rounded-[1.6rem] border border-border/80 bg-card/75 px-5 py-6 shadow-[0_12px_35px_rgba(35,47,38,0.045)] backdrop-blur-xl sm:px-8 sm:py-8">
                    <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-primary">{currentSection?.category}</p>
                    <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-[2.5rem]">{currentSection?.title}</h1>
                    <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">{currentSection?.summary}</p>
                  </header>

          {/* Quick Start */}
          <article
            id="docs-quickstart"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'quickstart' ? 'block' : 'hidden')}
          >
              <div className="space-y-4 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">Quick Start</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Get your first image uploaded to AfuCloud in under 5 minutes.
                </p>
                <ol className="space-y-4 text-sm text-muted-foreground">
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">1</span><span>Create an AfuCloud project from the dashboard.</span></li>
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">2</span><span>Create a project API key under <strong>Project → API Keys</strong>, or create an account access token for automation.</span></li>
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">3</span><span>Use that credential on AfuCloud API requests.</span></li>
                </ol>
              </div>
              <CodeBlock language="bash" code={`# Use a project API key created in the dashboard
curl -X GET ${BASE}/v1/projects/{projectId}/images \\
  -H "Authorization: Bearer afu_prod_..."

# Account access tokens can manage all projects and account resources
curl -X POST ${BASE}/v1/projects \\
  -H "Authorization: Bearer afu_pat_..." \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My App"}'`} />
          </article>

          {/* Upload */}
          <article
            id="docs-upload"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'upload' ? 'block' : 'hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">Uploading Images</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Request a temporary upload URL, send the file to that URL, then confirm the upload. AfuCloud returns the image URL for delivery.
                </p>
                <p className="text-sm text-muted-foreground">Supported formats: PNG · JPEG · WebP · GIF · AVIF · SVG · HEIC</p>
              </div>
              <CodeBlock language="typescript" code={`// Step 1: Request a temporary upload URL
const { uploadUrl, imageId, key } = await fetch(
  '${BASE}/v1/projects/{projectId}/images/upload-url',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer {token}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      name: 'My Photo',
    }),
  }
).then(r => r.json());

// Step 2: Send the file to the returned URL
await fetch(uploadUrl, {
  method: 'PUT',
  body: fileBlob,
  headers: { 'Content-Type': 'image/jpeg' },
});

// Step 3: Confirm the upload
const image = await fetch(
  '${BASE}/v1/projects/{projectId}/images/confirm-upload',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer {token}',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ imageId, key, size: fileBlob.size }),
  }
).then(r => r.json());

console.log(image.url); // https://img.afuchat.com/...`} />
          </article>

          {/* Images */}
          <article
            id="docs-images"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'images' ? 'block' : 'hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">Managing Images</h2>
                <p className="text-sm text-muted-foreground">List, update, delete, restore, favorite, search, and filter images within a project.</p>
              </div>
              <div className="max-w-full overflow-x-auto rounded-lg border border-card-border bg-card">
                <table className="w-full min-w-[600px] text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Method</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Endpoint</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {[
                      ['GET', '/v1/projects/{id}/images', 'List images (search, tag, album, format, favorite filters)'],
                      ['GET', '/v1/projects/{id}/images/{imageId}', 'Get a single image'],
                      ['PATCH', '/v1/projects/{id}/images/{imageId}', 'Update name, tags, or album'],
                      ['DELETE', '/v1/projects/{id}/images/{imageId}', 'Soft delete (moves to trash)'],
                      ['PATCH', '/v1/projects/{id}/images/{imageId}/favorite', 'Toggle favorite'],
                      ['POST', '/v1/projects/{id}/images/{imageId}/restore', 'Restore from trash'],
                    ].map(([method, path, desc]) => (
                      <tr key={method + path} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5">
                          <span className={cn(
                            'rounded px-1.5 py-0.5 font-mono font-semibold',
                            method === 'GET' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200' :
                            method === 'POST' ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-200' :
                            method === 'PATCH' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-200' :
                            'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200'
                          )}>{method}</span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-foreground">{path}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CodeBlock language="bash" code={`# List images with search
GET ${BASE}/v1/projects/{projectId}/images?search=logo&format=png&page=1&limit=50

# Update image
PATCH ${BASE}/v1/projects/{projectId}/images/{imageId}
{ "name": "New name", "tags": ["logo", "brand"], "album": "brand-assets" }

# Favorite
PATCH ${BASE}/v1/projects/{projectId}/images/{imageId}/favorite`} />
          </article>

          {/* Object Storage */}
          <article
            id="docs-storage"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'storage' ? 'block' : 'hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Object Storage</h2>
              <p className="text-sm text-muted-foreground">
                Create a container, upload files, and organize folders from Containers &amp; files.
                Use each file’s URL for delivery or connect a domain for a custom hostname.
              </p>
            </div>
          </article>

          {/* API Keys */}
          <article
            id="docs-apikeys"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'apikeys' ? 'block' : 'hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">API Keys</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Create per-project API keys for development, production, and testing environments.
                  Each key supports fine-grained permission scopes. The raw key is shown only once at creation.
                </p>
              </div>
              <CodeBlock language="bash" code={`# Create an API key
POST ${BASE}/v1/projects/{projectId}/api-keys
Authorization: Bearer <token>
{
  "name": "Production server",
  "environment": "production",
  "scopes": ["images:read", "images:write"]
}

# Response (secret shown once)
{
  "id": "...",
  "name": "Production server",
  "environment": "production",
  "prefix": "afu_prod_abc",
  "scopes": ["images:read", "images:write"],
  "secret": "afu_prod_abc123...FULL_KEY_SHOWN_ONCE",
  "createdAt": "2026-07-30T..."
}

# List API keys
GET ${BASE}/v1/projects/{projectId}/api-keys

# Revoke
DELETE ${BASE}/v1/projects/{projectId}/api-keys/{keyId}

# Using an API key (instead of JWT)
Authorization: Bearer afu_prod_abc123...`} />
          </article>

          {/* Personal Access Tokens */}
          <article
            id="docs-tokens"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'tokens' ? 'block' : 'hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Personal Access Tokens</h2>
              <p className="text-sm text-muted-foreground">
                Create a token in the dashboard and send it as a bearer token with API requests.
                Copy it when created; it is shown only once.
              </p>
              <CodeBlock language="http" code={`Authorization: Bearer <personal-access-token>`} />
            </div>
          </article>

          {/* Webhooks */}
          <article
            id="docs-webhooks"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'webhooks' ? 'block' : 'hidden')}
          >
              <div className="rounded-lg border border-card-border bg-card p-6 space-y-3">
                <h2 className="text-base font-semibold">Webhooks</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Subscribe to project events and receive signed POST requests to your endpoint.
                  Deliveries are retried up to 3 times with exponential backoff on failure.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-card-border bg-card p-4 sm:p-5">
                <p className="text-xs font-semibold text-foreground">Available Events</p>
                <div className="flex flex-wrap gap-1.5">
                  {['image.uploaded','image.updated','image.deleted','project.created','token.created','token.revoked'].map(e => (
                    <code key={e} className="rounded bg-muted px-2 py-0.5 text-[11px] font-mono">{e}</code>
                  ))}
                </div>
              </div>
              <CodeBlock language="bash" code={`# Create a webhook
POST ${BASE}/v1/projects/{projectId}/webhooks
{
  "url": "https://your-server.com/webhooks",
  "events": ["image.uploaded", "image.deleted"],
  "secret": "your-signing-secret"
}

# Webhook payload
{
  "event": "image.uploaded",
  "projectId": "...",
  "data": { /* image object */ },
  "timestamp": "2026-07-30T..."
}

# Verify signature (Node.js)
const signature = req.headers['x-afucloud-signature'];
const expected = crypto.createHmac('sha256', secret)
  .update(JSON.stringify(req.body)).digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(signature), Buffer.from('sha256=' + expected)
);`} />
          </article>

          {/* Analytics */}
          <article
            id="docs-analytics"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'analytics' ? 'block' : 'hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Analytics</h2>
              <p className="text-sm text-muted-foreground">
                Review image totals, storage use, and upload activity by project or across your account.
              </p>
            </div>
          </article>

          {/* Custom Domains */}
          <article
            id="docs-domains"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'domains' ? 'block' : 'hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Custom Domains</h2>
              <p className="text-sm text-muted-foreground">
                Connect Cloudflare, verify a domain you control, and manage its DNS records from the domain page.
              </p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
                <li>Connect your Cloudflare account.</li>
                <li>Add a domain and complete ownership verification.</li>
                <li>Manage records and check public DNS status.</li>
              </ol>
            </div>
          </article>

          {/* Domain registration */}
          <article
            id="docs-registration"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'registration' ? 'block' : 'hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Domain Registration</h2>
              <p className="text-sm text-muted-foreground">
                Search for an available domain, review the current registration and renewal price, then complete the purchase through hosted checkout.
              </p>
              <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
                <li>You are the legal registrant. Contact details you provide are shared with the registrar to complete registration.</li>
                <li>The current registration and renewal prices are shown before checkout.</li>
                <li>Registration is for one year with automatic renewal disabled. Renewal checkout is not yet available in the dashboard; contact AfuCloud before expiry.</li>
                <li>Completed registrations are non-refundable. If a registration cannot be completed after checkout, contact AfuCloud support.</li>
                <li>Premium domains and non-USD quotes are not supported.</li>
              </ul>
            </div>
            <div className="space-y-4 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h3 className="text-sm font-semibold">API flow</h3>
              <p className="text-sm text-muted-foreground">
                Use an AfuCloud bearer token to search, check current pricing, and create hosted checkout. After purchase, check the order and submit the required registrant details.
              </p>
              <CodeBlock language="bash" code={`# Search names or a full domain
curl -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  "${BASE}/v1/domains/registrations/search?q=example.com"

# Get current availability and retail price
curl -X POST "${BASE}/v1/domains/registrations/quote" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domainName":"example.com"}'

# Create hosted checkout, then redirect the buyer to purchaseUrl
curl -X POST "${BASE}/v1/domains/registrations/checkout" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domainName":"example.com"}'

# Check registration status after checkout
curl -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  "${BASE}/v1/domains/registrations/orders/ORDER_ID"

# Submit the required registrant details to complete registration
curl -X POST "${BASE}/v1/domains/registrations/orders/ORDER_ID/register" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"registrant":{"email":"buyer@example.com","phone":"+1.202.555.0100","name":"Alex Example","street":"555 Example Street","city":"Example City","state":"CA","postalCode":"00000","countryCode":"US"}}'`} />
            </div>
          </article>

          {/* API Reference */}
          <article
            id="docs-reference"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'reference' ? 'block' : 'hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">API Reference</h2>
                <p className="text-sm text-muted-foreground">
                  All endpoints are versioned under <code className="rounded bg-muted px-1.5 font-mono text-xs">/v1/</code>.
                  Use the documented paths and methods to access public AfuCloud features.
                </p>
              </div>
              <div className="max-w-full overflow-x-auto rounded-lg border border-card-border bg-card">
                <div className="px-5 py-3 border-b border-card-border bg-muted/20">
                  <p className="text-xs font-semibold">All Endpoints</p>
                </div>
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="bg-muted/10">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Method</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Path</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Auth</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-foreground">Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-card-border">
                    {[
                      ['GET', '/v1/projects', '✓', 'List projects'],
                      ['POST', '/v1/projects', '✓', 'Create project'],
                      ['GET', '/v1/projects/:id', '✓', 'Get project'],
                      ['PATCH', '/v1/projects/:id', '✓', 'Update project'],
                      ['DELETE', '/v1/projects/:id', '✓', 'Delete project'],
                      ['GET', '/v1/projects/:id/stats', '✓', 'Project storage stats'],
                      ['GET', '/v1/projects/:id/images', '✓', 'List images'],
                      ['POST', '/v1/projects/:id/images/upload-url', '✓', 'Request temporary upload URL'],
                      ['POST', '/v1/projects/:id/images/confirm-upload', '✓', 'Confirm upload'],
                      ['GET', '/v1/projects/:id/images/:imgId', '✓', 'Get image'],
                      ['PATCH', '/v1/projects/:id/images/:imgId', '✓', 'Update image'],
                      ['DELETE', '/v1/projects/:id/images/:imgId', '✓', 'Soft delete image'],
                      ['PATCH', '/v1/projects/:id/images/:imgId/favorite', '✓', 'Toggle favorite'],
                      ['POST', '/v1/projects/:id/images/:imgId/restore', '✓', 'Restore from trash'],
                      ['GET', '/v1/projects/:id/api-keys', '✓', 'List API keys'],
                      ['POST', '/v1/projects/:id/api-keys', '✓', 'Create API key'],
                      ['DELETE', '/v1/projects/:id/api-keys/:keyId', '✓', 'Revoke API key'],
                      ['GET', '/v1/projects/:id/webhooks', '✓', 'List webhooks'],
                      ['POST', '/v1/projects/:id/webhooks', '✓', 'Create webhook'],
                      ['PATCH', '/v1/projects/:id/webhooks/:whId', '✓', 'Update webhook'],
                      ['DELETE', '/v1/projects/:id/webhooks/:whId', '✓', 'Delete webhook'],
                      ['GET', '/v1/tokens', '✓', 'List personal tokens'],
                      ['POST', '/v1/tokens', '✓', 'Create personal token'],
                      ['DELETE', '/v1/tokens/:id', '✓', 'Revoke personal token'],
                      ['GET', '/v1/activity', '✓', 'Activity log'],
                      ['GET', '/v1/domains/registrations/search', '✓', 'Search available domains'],
                      ['POST', '/v1/domains/registrations/quote', '✓', 'Get live availability and price'],
                      ['POST', '/v1/domains/registrations/checkout', '✓', 'Create hosted checkout'],
                      ['GET', '/v1/domains/registrations/orders', '✓', 'List registration orders'],
                      ['GET', '/v1/domains/registrations/orders/:orderId', '✓', 'Check registration status'],
                      ['POST', '/v1/domains/registrations/orders/:orderId/register', '✓', 'Submit legal registrant details'],
                    ].map(([method, path, auth, desc]) => (
                      <tr key={path + method} className="hover:bg-muted/20">
                        <td className="px-4 py-2">
                          <span className={cn(
                            'rounded px-1.5 py-0.5 font-mono font-semibold text-[10px]',
                            method === 'GET' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200' :
                            method === 'POST' ? 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-200' :
                            method === 'PATCH' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-200' :
                            'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200'
                          )}>{method}</span>
                        </td>
                        <td className="px-4 py-2 font-mono text-foreground text-[11px]">{path}</td>
                        <td className="px-4 py-2 text-center text-muted-foreground">{auth}</td>
                        <td className="px-4 py-2 text-muted-foreground">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          </article>
                <nav aria-label="Documentation page navigation" className="mt-10 grid gap-3 border-t border-border/70 pt-6 sm:grid-cols-2">
                  {previousSection ? (
                    <Link href={docsPathForSection(previousSection.id)} data-testid="link-docs-previous" className="group rounded-2xl border border-border/80 bg-card/65 p-4 transition-colors hover:border-primary/30 hover:bg-card">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Previous</span>
                      <span className="mt-1 flex items-center gap-2 text-sm font-semibold text-foreground"><ChevronRight className="h-4 w-4 rotate-180 text-primary transition-transform group-hover:-translate-x-0.5" />{previousSection.title}</span>
                    </Link>
                  ) : <span />}
                  {nextSection && (
                    <Link href={docsPathForSection(nextSection.id)} data-testid="link-docs-next" className="group rounded-2xl border border-border/80 bg-card/65 p-4 text-right transition-colors hover:border-primary/30 hover:bg-card">
                      <span className="block text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Next</span>
                      <span className="mt-1 flex items-center justify-end gap-2 text-sm font-semibold text-foreground">{nextSection.title}<ChevronRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" /></span>
                    </Link>
                  )}
                </nav>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
