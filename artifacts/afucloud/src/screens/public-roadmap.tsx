import { Link } from '@/lib/navigation';
import {
  ArrowRight,
  CheckCircle2,
  Globe2,
  Link2,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyFooter } from '@/components/company-footer';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import { useDashboardSessionVisibility } from '@/hooks/use-dashboard-session-visibility';

const domainRoadmap = [
  {
    icon: Globe2,
    title: 'Domain registration',
    description: 'Find available domain names, see supported registration terms and current pricing, then register through AfuCloud.',
    status: 'In focus',
  },
  {
    icon: Network,
    title: 'Domain management and DNS',
    description: 'Manage domain settings and DNS records from one clear, unified workspace.',
    status: 'In focus',
  },
  {
    icon: Link2,
    title: 'Connect a domain you already own',
    description: 'Bring domains from other registrars and connect them to AfuCloud for DNS management.',
    status: 'Planned',
  },
  {
    icon: ShieldCheck,
    title: 'Domain security and reliability',
    description: 'Improve domain protection, DNS reliability, and visibility into domain status.',
    status: 'Planned',
  },
];

const futureRoadmap = [
  {
    icon: Server,
    title: 'Application hosting and deployments',
    description: 'Build, deploy, and manage applications with AfuCloud.',
  },
  {
    icon: LockKeyhole,
    title: 'Automated SSL for hosted applications',
    description: 'Secure hosted applications with automatically managed HTTPS certificates.',
  },
];

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
        <section className="mx-auto max-w-5xl px-6 pb-12 pt-16 md:pt-20">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            Product direction
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight md:text-5xl">AfuCloud roadmap</h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
            See what we are focused on now and what we plan to build next. Our immediate focus is making domain registration and management work seamlessly in AfuCloud.
          </p>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-10">
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

        <section className="mx-auto max-w-5xl px-6 pb-16">
          <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-primary">Current priority</p>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Domain infrastructure</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                One place to register, manage, connect, and configure domains.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Current focus
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {domainRoadmap.map((item) => (
              <article key={item.title} className="rounded-xl border border-border bg-card p-5 md:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <item.icon className="h-5 w-5 text-primary" strokeWidth={1.8} />
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    item.status === 'In focus'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}>
                    {item.status}
                  </span>
                </div>
                <h3 className="text-base font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border bg-card/60">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Future direction</p>
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">More infrastructure, later</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Once the domain experience is established, we plan to expand AfuCloud with application hosting capabilities.
            </p>
            <div className="mt-7 grid gap-4 md:grid-cols-2">
              {futureRoadmap.map((item) => (
                <article key={item.title} className="rounded-xl border border-border bg-background p-5 md:p-6">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <item.icon className="h-5 w-5 text-muted-foreground" strokeWidth={1.8} />
                  </div>
                  <div className="mb-2 inline-flex rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Planned
                  </div>
                  <h3 className="text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-primary">
          <div className="mx-auto max-w-5xl px-6 py-14 text-center">
            <h2 className="mb-3 text-2xl font-bold tracking-tight text-white">
              Build with AfuCloud
            </h2>
            <p className="mx-auto mb-7 max-w-md text-sm leading-relaxed text-white/75">
              Get started with the AfuCloud platform and follow what is coming next.
            </p>
            <div className="flex items-center justify-center gap-4">
              {canShowAccountActions && (
                <Link href={isSignedIn ? '/dashboard' : '/register'}>
                  <Button size="lg" variant="secondary" className="h-10 gap-2 px-5 text-sm">
                    {isSignedIn ? 'Open dashboard' : 'Get started'}
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
