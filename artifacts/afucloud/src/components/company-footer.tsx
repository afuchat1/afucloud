import {
  ArrowUpRight,
  Clapperboard,
  Cloud,
  Mail,
  Megaphone,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { Link } from 'wouter';

type CompanyFooterProps = {
  isSignedIn: boolean;
  canShowAccountActions: boolean;
};

const ecosystemProducts: {
  name: string;
  href: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    name: 'AfuChat Ads',
    href: 'https://ads.afuchat.com/',
    description: 'Advertising tools for brands and publishers.',
    icon: Megaphone,
  },
  {
    name: 'Engagera AI',
    href: 'https://engagera.afuchat.com/',
    description: 'AI chat, live web context, and developer tools.',
    icon: Sparkles,
  },
  {
    name: 'AfuMail',
    href: 'https://email.afuchat.com/',
    description: 'Professional email and digital identity.',
    icon: Mail,
  },
  {
    name: 'AfuChat Movies',
    href: 'https://movies.afuchat.com/',
    description: 'Explore films and series; discovery, not streaming.',
    icon: Clapperboard,
  },
];

const localLinkClass =
  'text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function CompanyFooter({ isSignedIn, canShowAccountActions }: CompanyFooterProps) {
  return (
    <footer className="relative isolate overflow-hidden border-t border-border bg-muted/20">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-48 bg-gradient-to-b from-primary/5 via-primary/[0.02] to-transparent"
      />
      <div className="mx-auto max-w-6xl px-6 py-12 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.65fr)_minmax(0,0.72fr)_minmax(0,0.8fr)] lg:gap-8">
          <div className="max-w-sm">
            <Link
              href="/"
              aria-label="AfuCloud home"
              className="inline-flex items-center gap-2.5 rounded-md text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Cloud className="size-5" strokeWidth={2.4} aria-hidden="true" />
              </span>
              <span className="text-lg font-semibold tracking-tight">AfuCloud</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-6 text-muted-foreground">
              Cloud storage and media delivery for developers and teams, built by AfuChat
              Technologies Limited.
            </p>
            <p className="mt-4 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground/80">
              Built in Uganda. Made to serve anywhere.
            </p>
          </div>

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
              Explore the ecosystem
            </h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {ecosystemProducts.map(product => {
                const Icon = product.icon;
                return (
                  <a
                    key={product.name}
                    href={product.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-h-[82px] items-start gap-3 rounded-xl border border-border/70 bg-background/60 p-3 transition-colors hover:border-primary/30 hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                        {product.name}
                        <ArrowUpRight
                          className="size-3.5 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                          aria-hidden="true"
                        />
                        <span className="sr-only">(opens in a new tab)</span>
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        {product.description}
                      </span>
                    </span>
                  </a>
                );
              })}
            </div>
          </div>

          <nav aria-label="AfuCloud links">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
              AfuCloud
            </h2>
            <ul className="mt-4 space-y-3">
              <li><Link href="/docs" className={localLinkClass}>Documentation</Link></li>
              <li><Link href="/roadmap" className={localLinkClass}>Roadmap</Link></li>
              {canShowAccountActions && !isSignedIn && (
                <>
                  <li><Link href="/login" className={localLinkClass}>Sign in</Link></li>
                  <li><Link href="/register" className={localLinkClass}>Create an account</Link></li>
                </>
              )}
              {isSignedIn && (
                <li><Link href="/dashboard" className={localLinkClass}>Dashboard</Link></li>
              )}
            </ul>
          </nav>

          <nav aria-label="Company links">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
              Company
            </h2>
            <ul className="mt-4 space-y-3">
              <li>
                <a
                  href="https://www.afuchat.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={localLinkClass}
                >
                  AfuChat Technologies
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
              <li>
                <a
                  href="https://www.afuchat.com/products"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={localLinkClass}
                >
                  All products
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AfuChat Technologies Limited. All rights reserved.</p>
          <a
            href="https://www.afuchat.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-fit items-center gap-1.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Visit AfuChat.com
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </div>
      </div>
    </footer>
  );
}