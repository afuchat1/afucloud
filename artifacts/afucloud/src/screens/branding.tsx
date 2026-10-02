import { PublicHeader } from '@/components/public-header';
import { CompanyFooter } from '@/components/company-footer';
import { AfuCloudLogo } from '@/components/afucloud-logo';

const brandColor = '#07965B';

export default function BrandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="max-w-3xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            Official brand assets
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            AfuCloud brand assets
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            The official AfuCloud logo and brand color, identified here as assets owned by AfuCloud.
          </p>
        </header>

        <section aria-label="AfuCloud brand assets" className="mt-10 grid gap-5 md:grid-cols-2">
          <article className="overflow-hidden rounded-2xl border border-border bg-card">
            <div
              role="img"
              aria-label="Official AfuCloud green cloud and upload logo"
              className="flex min-h-56 items-center justify-center bg-muted/40 p-10"
            >
              <AfuCloudLogo className="h-32 w-32" />
            </div>
            <div className="space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold">Official logo</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Green cloud and upload mark used across AfuCloud.
                </p>
              </div>
              <a
                href="/afucloud-logo.svg"
                download="afucloud-logo.svg"
                className="inline-flex min-h-10 items-center rounded-md border border-border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Download SVG
              </a>
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-border bg-card">
            <div
              role="img"
              aria-label={`AfuCloud brand color ${brandColor}`}
              className="flex min-h-56 items-end p-6"
              style={{ backgroundColor: brandColor }}
            >
              <span className="rounded-md bg-white/95 px-3 py-1.5 font-mono text-sm font-semibold text-[#073B28]">
                {brandColor}
              </span>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <h2 className="text-lg font-semibold">Official brand color</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  AfuCloud green
                </p>
              </div>
              <code className="inline-flex rounded-md bg-muted px-3 py-2 font-mono text-sm text-foreground">
                {brandColor}
              </code>
            </div>
          </article>
        </section>

        <section
          aria-labelledby="brand-ownership-title"
          className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-6 sm:p-8"
        >
          <h2 id="brand-ownership-title" className="text-xl font-semibold">
            Ownership
          </h2>
          <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
            AfuCloud owns the logo and brand identity shown on this page, including the official brand color
            {' '}<strong className="font-semibold text-foreground">{brandColor}</strong>.
            © AfuCloud. All rights reserved.
          </p>
        </section>
      </main>

      <CompanyFooter isSignedIn={false} canShowAccountActions={false} />
    </div>
  );
}