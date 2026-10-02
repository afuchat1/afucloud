import { Link } from '@/lib/navigation';
import { Image, Database, Globe2, Code2, ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import { CompanyFooter } from '@/components/company-footer';
import { useDashboardSessionVisibility } from '@/hooks/use-dashboard-session-visibility';
import { docsPathForSection } from '@/lib/docs-routes';

const products = [
  {
    icon: Image,
    title: 'Image delivery',
    description: 'Upload, manage, and deliver images through one API.',
    docs: 'images',
  },
  {
    icon: Database,
    title: 'Object storage',
    description: 'Store and deliver files from organized containers.',
    docs: 'storage',
  },
  {
    icon: Globe2,
    title: 'Custom domains',
    description: 'Verify domains and manage DNS in one place.',
    docs: 'domains',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For trying AfuCloud and small projects.',
    features: ['2 projects', '2 storage containers', '3 API keys', '10 MB max file size'],
    cta: 'Get started',
  },
  {
    name: 'Pro',
    price: '$12',
    period: '/month',
    description: 'For individual developers running production projects.',
    features: ['10 projects', '25 storage containers', '50 API keys', '100 MB max file size'],
    cta: 'Get started',
    highlight: true,
  },
  {
    name: 'Business',
    price: '$39',
    period: '/month',
    description: 'For teams managing multiple production projects.',
    features: ['50 projects', '100 storage containers', '250 API keys', '250 MB max file size'],
    cta: 'Get started',
  },
];

export default function LandingPage() {
  const session = useDashboardSessionVisibility();
  const isSignedIn = session === 'authenticated';
  const canShowAccountActions = isSignedIn || session === 'unauthenticated';

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Nav */}
      <header className="border-b border-border/50 bg-background/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <AfuCloudLogo className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight">AfuCloud</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#api" className="hover:text-foreground transition-colors">API</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
            <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
            <Link href="/roadmap" className="hover:text-foreground transition-colors">Roadmap</Link>
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

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Phase 1 — Images Platform
        </div>
        <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground mb-6 leading-[1.1]">
          Image storage API<br />
          <span className="text-primary">for developers</span>
        </h1>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          Upload, manage, and deliver images through one API.
        </p>
        <div className="flex items-center justify-center gap-4">
          {canShowAccountActions && (
            <Link href={isSignedIn ? '/dashboard' : '/register'}>
              <Button size="lg" className="gap-2 h-11 px-6">
                {isSignedIn ? 'Open dashboard' : 'Start for free'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          )}
          <Link href="/docs">
            <Button variant="outline" size="lg" className="gap-2 h-11 px-6">
              <Code2 className="h-4 w-4" />
              View docs
            </Button>
          </Link>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">Free plan available · 2 projects and 2 storage containers</p>
      </section>

      {/* Feature grid */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">AfuCloud products</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Image delivery, object storage, and custom domains.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {products.map((product) => (
            <div key={product.title} className="rounded-xl border border-border bg-card p-6 space-y-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <product.icon className="h-4.5 w-4.5 text-primary" strokeWidth={2} />
              </div>
              <h3 className="font-semibold text-sm text-foreground">{product.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description}</p>
              <Link
                href={docsPathForSection(product.docs)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                How it works
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* API docs entry point */}
      <section id="api" className="border-y border-border bg-card py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-primary">API</p>
          <h2 className="mb-3 text-3xl font-bold tracking-tight">Need implementation details?</h2>
          <p className="mb-6 text-muted-foreground">Find upload steps, authentication, and endpoints in the docs.</p>
          <Link href={docsPathForSection('quickstart')}>
            <Button variant="outline" className="gap-2">
              <Code2 className="h-4 w-4" />
              How it works
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold tracking-tight mb-3">Simple, transparent pricing</h2>
          <p className="text-muted-foreground">Start free. Upgrade whenever you need more resources.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl mx-auto">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-xl border p-6 space-y-5 ${
                plan.highlight
                  ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                  : 'border-border bg-card'
              }`}
            >
              {plan.highlight && (
                <div className="inline-flex rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground uppercase tracking-wide">
                  Most popular
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-muted-foreground">{plan.name}</p>
                <p className="text-3xl font-bold tracking-tight mt-1">
                  {plan.price}
                  <span className="ml-1 text-sm font-normal text-muted-foreground">{plan.period}</span>
                </p>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              {canShowAccountActions && (
                <Link href={isSignedIn ? '/dashboard' : '/register'}>
                  <Button
                    className="w-full"
                    variant={plan.highlight ? 'default' : 'outline'}
                    size="sm"
                  >
                    {isSignedIn ? 'Open dashboard' : plan.cta}
                  </Button>
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
       <section className="bg-primary">
        <div className="max-w-6xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4 tracking-tight">Ready to start building?</h2>
          <p className="text-primary-foreground/75 mb-8 max-w-md mx-auto">
            Create an account to start storing and delivering images.
          </p>
          <div className="flex items-center justify-center gap-4">
            {canShowAccountActions && (
              <Link href={isSignedIn ? '/dashboard' : '/register'}>
                <Button size="lg" variant="secondary" className="gap-2 h-11 px-6">
                  {isSignedIn ? 'Open dashboard' : 'Create free account'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <Link href="/docs">
              <Button size="lg" variant="outline" className="gap-2 h-11 px-6 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground">
                Read the docs
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <CompanyFooter isSignedIn={isSignedIn} canShowAccountActions={canShowAccountActions} />
    </div>
  );
}
