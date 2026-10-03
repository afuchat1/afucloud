import { Link } from '@/lib/navigation';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyFooter } from '@/components/company-footer';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import { useDashboardSessionVisibility } from '@/hooks/use-dashboard-session-visibility';

export default function PublicRoadmapPage() {
  const session = useDashboardSessionVisibility();
  const isSignedIn = session === 'authenticated';
  const canShowAccountActions = isSignedIn || session === 'unauthenticated';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/">
            <div className="flex cursor-pointer items-center gap-2.5">
              <AfuCloudLogo className="h-8 w-8" />
              <span className="text-[15px] font-semibold tracking-tight">AfuCloud</span>
            </div>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <Link href="/#features" className="hover:text-foreground transition-colors">Features</Link>
            <Link href="/#pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link href="/roadmap" className="font-medium text-foreground">Roadmap</Link>
          </nav>
          {session === 'unauthenticated' && (
            <div className="flex items-center gap-3">
              <Link href="/login">
                <Button variant="ghost" size="sm">Sign in</Button>
              </Link>
              <Link href="/register">
                <Button size="sm">Get started</Button>
              </Link>
            </div>
          )}
          {isSignedIn && (
            <Link href="/dashboard">
              <Button size="sm">Dashboard</Button>
            </Link>
          )}
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-5xl px-6 pb-10 pt-16">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Current product
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">AfuCloud roadmap</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            AfuCloud helps you store, organize, and deliver images. New customer-facing capabilities will be shared here when they are ready.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-20">
          <article className="max-w-2xl rounded-xl border border-primary/30 bg-primary/5 p-6">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
              Available now
            </div>
            <h2 className="text-xl font-semibold">Image storage and delivery</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Upload and organize project images, then use their URLs in your applications.
            </p>
          </article>
        </section>

        <section className="bg-primary">
          <div className="mx-auto max-w-5xl px-6 py-14 text-center">
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-white">
              Start with AfuCloud
            </h2>
            <p className="mx-auto mb-7 max-w-md text-sm leading-relaxed text-white/75">
              Upload, manage, and deliver images through AfuCloud.
            </p>
            <div className="flex items-center justify-center gap-4">
              {canShowAccountActions && (
                <Link href={isSignedIn ? '/dashboard' : '/register'}>
                  <Button size="lg" variant="secondary" className="h-10 gap-2 px-5 text-sm">
                    {isSignedIn ? 'Open dashboard' : 'Create free account'}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Link href="/docs">
                <Button size="lg" variant="outline" className="h-10 gap-2 border-white/30 px-5 text-sm text-white hover:bg-white/10 hover:text-white">
                  View docs
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>

      <CompanyFooter isSignedIn={isSignedIn} canShowAccountActions={canShowAccountActions} />
    </div>
  );
}