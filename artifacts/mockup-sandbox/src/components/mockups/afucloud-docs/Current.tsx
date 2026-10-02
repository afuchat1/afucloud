import './_group.css';
import { useEffect, useState } from 'react';
import { CurrentPageHeader as PageHeader } from './_shared/CurrentPageHeader';
import { BookOpen, Code, Zap, Upload, Image, Webhook, Key, KeyRound, Globe2, HardDrive, BarChart3, ArrowRight, Copy, Check, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CurrentPublicHeader as PublicHeader } from './_shared/CurrentPublicHeader';

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative min-w-0 max-w-full overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between gap-3 bg-[#1C1C1C] px-3 py-2 sm:px-4 border-b border-white/10">
        <span className="text-[11px] font-mono text-white/40">{language}</span>
        <button
          onClick={handleCopy}
          className="flex shrink-0 items-center gap-1.5 text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          {copied ? <Check className="h-3 w-3 text-green-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto bg-[#1C1C1C] px-3 py-3 text-[11px] leading-relaxed font-mono text-green-300/90 whitespace-pre sm:px-4 sm:text-[12px]">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const sections = [
  { id: 'quickstart', icon: Zap, title: 'Quick Start', badge: 'Start here' },
  { id: 'upload', icon: Upload, title: 'Uploading Images' },
  { id: 'images', icon: Image, title: 'Managing Images' },
  { id: 'storage', icon: HardDrive, title: 'Object Storage' },
  { id: 'apikeys', icon: Key, title: 'API Keys' },
  { id: 'tokens', icon: KeyRound, title: 'Personal Access Tokens' },
  { id: 'webhooks', icon: Webhook, title: 'Webhooks' },
  { id: 'analytics', icon: BarChart3, title: 'Analytics' },
  { id: 'domains', icon: Globe2, title: 'Custom Domains' },
  { id: 'registration', icon: Globe2, title: 'Domain Registration' },
  { id: 'reference', icon: Code, title: 'API Reference' },
];

const BASE = 'https://api.afuchat.com';

export function Current() {
  const [activeSection, setActiveSection] = useState('quickstart');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  useEffect(() => {
    const sectionId = window.location.hash.replace(/^#docs-/, '');
    if (sections.some((section) => section.id === sectionId)) {
      setActiveSection(sectionId);
    }
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#docs-${activeSection}`) return;
    requestAnimationFrame(() => {
      document.getElementById(`docs-${activeSection}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [activeSection]);

  const handleSectionSelect = (sectionId: string) => {
    setActiveSection(sectionId);
    setMobileNavOpen(false);

    if (window.innerWidth < 1024) {
      document.getElementById(`docs-${sectionId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  };

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:space-y-6 sm:px-6 lg:py-8">
        <PageHeader
          title="Developer Documentation"
          description="Guides for images, storage, APIs, analytics, and domains."
          className="[&_h1]:text-xl sm:[&_h1]:text-2xl [&_p]:max-w-xl"
        />

        <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:gap-6">
        {/* Documentation sidebar */}
        <aside className="w-full shrink-0 lg:sticky lg:top-6 lg:w-48 lg:self-start">
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-expanded={mobileNavOpen}
            aria-controls="docs-sections"
            className="flex w-full items-center justify-between rounded-md border border-border bg-card px-3 py-2.5 text-sm font-medium text-foreground lg:hidden"
          >
            <span className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              Documentation sections
            </span>
            {mobileNavOpen ? <X className="h-4 w-4 text-muted-foreground" /> : <Menu className="h-4 w-4 text-muted-foreground" />}
          </button>

          <nav
            id="docs-sections"
            aria-label="Documentation sections"
            className={cn(
              'mt-2 space-y-1 rounded-md border border-border bg-card p-2 lg:mt-0 lg:block lg:space-y-1 lg:border-0 lg:bg-transparent lg:p-0',
              mobileNavOpen ? 'block' : 'hidden lg:block'
            )}
          >
            {sections.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSectionSelect(s.id)}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors',
                  activeSection === s.id
                    ? 'bg-primary/8 text-primary'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <s.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {s.title}
                {s.badge && (
                  <span className="ml-auto rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
                    {s.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-6 sm:space-y-8">

          {/* Quick Start */}
          <article
            id="docs-quickstart"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'quickstart' ? 'block' : 'block lg:hidden')}
          >
              <div className="space-y-4 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">Quick Start</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Get your first image uploaded to AfuCloud in under 5 minutes.
                </p>
                <ol className="space-y-4 text-sm text-muted-foreground">
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">1</span><span>Create an AfuCloud project from the dashboard.</span></li>
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">2</span><span>Create a project API key under <strong>Project → API Keys</strong>, or create an account access token for automation.</span></li>
                  <li className="flex gap-3"><span className="shrink-0 h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-bold flex items-center justify-center">3</span><span>Use that credential on project-data requests. Login and account credential endpoints are not part of the developer API.</span></li>
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'upload' ? 'block' : 'block lg:hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">Uploading Images</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Uploads use a 2-step pre-signed URL flow: request an upload URL, PUT the file directly to storage,
                  then confirm the upload to register the image in your project.
                </p>
                <p className="text-sm text-muted-foreground">Supported formats: PNG · JPEG · WebP · GIF · AVIF · SVG · HEIC</p>
              </div>
              <CodeBlock language="typescript" code={`// Step 1: Get pre-signed upload URL
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

// Step 2: PUT the file directly to the pre-signed URL
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'images' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'storage' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'apikeys' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'tokens' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'webhooks' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'analytics' ? 'block' : 'block lg:hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Analytics</h2>
              <p className="text-sm text-muted-foreground">
                Review image totals, storage use, and upload activity by project or across your account.
                API request metrics appear when tracking is enabled.
              </p>
            </div>
          </article>

          {/* Custom Domains */}
          <article
            id="docs-domains"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'domains' ? 'block' : 'block lg:hidden')}
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
            className={cn('scroll-mt-20 space-y-6', activeSection === 'registration' ? 'block' : 'block lg:hidden')}
          >
            <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h2 className="text-base font-semibold">Domain Registration</h2>
              <p className="text-sm text-muted-foreground">
                Search for a domain, confirm its live availability and price, then pay AfuCloud through a one-time Whop checkout.
                A completed payment is verified server-side before AfuCloud submits the registration to Cloudflare.
              </p>
              <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground">
                <li>The buyer is the legal registrant. Registrant contact details are sent to Cloudflare and are not stored in AfuCloud’s order table.</li>
                <li>Retail pricing adds a 20% AfuCloud service markup to Cloudflare’s live registration and renewal prices. The final quote is shown before checkout.</li>
                <li>Registration is for one year with automatic renewal disabled. Renewal checkout is not yet available in the dashboard; contact AfuCloud before expiry.</li>
                <li>Cloudflare does not refund completed domain registrations. If a domain becomes unavailable before registration, AfuCloud requests a Whop refund; unclear outcomes are sent for manual review.</li>
                <li>Premium domains and non-USD quotes are not available through this checkout. DNS management and transfer-out requests are handled separately from these registration orders.</li>
              </ul>
            </div>
            <div className="space-y-4 rounded-lg border border-card-border bg-card p-4 sm:p-6">
              <h3 className="text-sm font-semibold">API flow</h3>
              <p className="text-sm text-muted-foreground">
                All endpoints require an AfuCloud bearer token. Search and quote first; create checkout only after showing the current price and renewal rate to the buyer.
              </p>
              <CodeBlock language="bash" code={`# Search names or a full domain
curl -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  "${BASE}/v1/domains/registrations/search?q=example.com"

# Get current availability and retail price
curl -X POST "${BASE}/v1/domains/registrations/quote" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domainName":"example.com"}'

# Create a one-time hosted checkout, then redirect to purchaseUrl
curl -X POST "${BASE}/v1/domains/registrations/checkout" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"domainName":"example.com"}'

# Refresh payment status after Whop returns the buyer
curl -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  "${BASE}/v1/domains/registrations/orders/ORDER_ID"

# Submit the buyer's legal registrant details after payment is confirmed
curl -X POST "${BASE}/v1/domains/registrations/orders/ORDER_ID/register" \\
  -H "Authorization: Bearer $AFUCLOUD_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"registrant":{"email":"buyer@example.com","phone":"+256.700000000","name":"Jane Doe","street":"1 Main Street","city":"Kampala","state":"Central","postalCode":"00000","countryCode":"UG"}}'`} />
            </div>
          </article>

          {/* API Reference */}
          <article
            id="docs-reference"
            className={cn('scroll-mt-20 space-y-6', activeSection === 'reference' ? 'block' : 'block lg:hidden')}
          >
              <div className="space-y-3 rounded-lg border border-card-border bg-card p-4 sm:p-6">
                <h2 className="text-base font-semibold">API Reference</h2>
                <p className="text-sm text-muted-foreground">
                  All endpoints are versioned under <code className="rounded bg-muted px-1.5 font-mono text-xs">/v1/</code>.
                  Every response includes standard fields.
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
                      ['GET', '/healthz', '—', 'Health check'],
                      ['GET', '/v1/projects', '✓', 'List projects'],
                      ['POST', '/v1/projects', '✓', 'Create project'],
                      ['GET', '/v1/projects/:id', '✓', 'Get project'],
                      ['PATCH', '/v1/projects/:id', '✓', 'Update project'],
                      ['DELETE', '/v1/projects/:id', '✓', 'Delete project'],
                      ['GET', '/v1/projects/:id/stats', '✓', 'Project storage stats'],
                      ['GET', '/v1/projects/:id/images', '✓', 'List images'],
                      ['POST', '/v1/projects/:id/images/upload-url', '✓', 'Get pre-signed upload URL'],
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
                      ['GET', '/v1/domains/registrations/search', '✓', 'Search registrar domains'],
                      ['POST', '/v1/domains/registrations/quote', '✓', 'Get live availability and price'],
                      ['POST', '/v1/domains/registrations/checkout', '✓', 'Create one-time Whop checkout'],
                      ['GET', '/v1/domains/registrations/orders', '✓', 'List registration orders'],
                      ['GET', '/v1/domains/registrations/orders/:orderId', '✓', 'Refresh payment and order status'],
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
        </div>
        </div>
      </main>
    </div>
  );
}
