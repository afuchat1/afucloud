import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/lib/navigation';
import { AfuCloudLogo } from '@/components/afucloud-logo';

type CompanyFooterProps = {
  isSignedIn: boolean;
  canShowAccountActions: boolean;
};

type FooterLinkData = {
  label: string;
  href: string;
  external?: boolean;
};

const ecosystemLinks: FooterLinkData[] = [
  { label: 'AfuChat Ads', href: 'https://ads.afuchat.com/', external: true },
  { label: 'Engagera AI', href: 'https://engagera.afuchat.com/', external: true },
  { label: 'AfuMail', href: 'https://email.afuchat.com/', external: true },
  { label: 'AfuChat Movies', href: 'https://movies.afuchat.com/', external: true },
];

const companyLinks: FooterLinkData[] = [
  { label: 'AfuChat Technologies Limited', href: 'https://www.afuchat.com/', external: true },
  { label: 'All products', href: 'https://www.afuchat.com/products', external: true },
  { label: 'Contact', href: 'https://www.afuchat.com/contact', external: true },
];

const legalLinks: FooterLinkData[] = [
  { label: 'Privacy policy', href: 'https://www.afuchat.com/legal/privacy', external: true },
  { label: 'Terms of service', href: 'https://www.afuchat.com/legal/terms', external: true },
  { label: 'Cookie policy', href: 'https://www.afuchat.com/legal/cookies', external: true },
];

const footerLinkClass =
  'inline-flex rounded-sm text-sm text-white/60 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950';

function FooterNavigationLink({ label, href, external = false }: FooterLinkData) {
  const content = (
    <>
      {label}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={footerLinkClass}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={footerLinkClass}>
      {content}
    </Link>
  );
}

function FooterLinkGroup({ title, links }: { title: string; links: FooterLinkData[] }) {
  return (
    <nav aria-label={`${title} links`}>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <ul className="mt-5 space-y-3.5">
        {links.map(link => (
          <li key={link.label}>
            <FooterNavigationLink {...link} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function CompanyFooter({ isSignedIn, canShowAccountActions }: CompanyFooterProps) {
  const accountHref = isSignedIn ? '/dashboard' : canShowAccountActions ? '/register' : '/docs';
  const accountLabel = isSignedIn
    ? 'Open dashboard'
    : canShowAccountActions
      ? 'Create a free account'
      : 'Explore the documentation';

  const afuCloudLinks: FooterLinkData[] = [
    { label: 'Overview', href: '/' },
    { label: 'Documentation', href: '/docs' },
    { label: 'Roadmap', href: '/roadmap' },
    { label: 'Brand assets', href: '/branding' },
    ...(canShowAccountActions && !isSignedIn
      ? [{ label: 'Sign in', href: '/login' }]
      : isSignedIn
        ? [{ label: 'Dashboard', href: '/dashboard' }]
        : []),
  ];

  return (
    <footer className="border-t border-white/10 bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-14 sm:px-8 sm:py-16">
        <div className="grid gap-14 lg:grid-cols-[minmax(14rem,0.9fr)_minmax(0,2.1fr)] lg:gap-16">
          <div className="max-w-sm">
            <Link
              href="/"
              aria-label="AfuCloud home"
              className="inline-flex items-center gap-3 rounded-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950"
            >
              <AfuCloudLogo className="size-10" />
              <span className="text-xl font-semibold tracking-tight">AfuCloud</span>
            </Link>

            <p className="mt-6 text-base leading-7 text-white/65">
              Image storage and CDN delivery for the products you build.
            </p>
            <p className="mt-3 text-sm leading-6 text-white/45">
              A product of AfuChat Technologies Limited. Built in Uganda.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link
                href={accountHref}
                className="inline-flex items-center gap-2 rounded-md bg-white px-4 py-2.5 text-sm font-semibold text-neutral-950 transition-colors hover:bg-white/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950"
              >
                {accountLabel}
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-neutral-950"
              >
                Read the docs
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4 sm:gap-x-8">
            <FooterLinkGroup title="AfuCloud" links={afuCloudLinks} />
            <FooterLinkGroup title="Ecosystem" links={ecosystemLinks} />
            <FooterLinkGroup title="Company" links={companyLinks} />
            <FooterLinkGroup title="Legal" links={legalLinks} />
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AfuChat Technologies Limited. All rights reserved.</p>
          <p>Built in Uganda. Made to serve anywhere.</p>
        </div>
      </div>
    </footer>
  );
}