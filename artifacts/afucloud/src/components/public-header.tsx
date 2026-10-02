import { Link } from '@/lib/navigation';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import { Button } from '@/components/ui/button';
import { useDashboardSessionVisibility } from '@/hooks/use-dashboard-session-visibility';

export function PublicHeader() {
  const session = useDashboardSessionVisibility();

  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" data-testid="link-home" className="flex shrink-0 items-center gap-2.5">
          <AfuCloudLogo className="h-8 w-8" />
          <span className="text-[15px] font-semibold tracking-tight">AfuCloud</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Public navigation">
          <Link href="/#features" data-testid="link-features" className="transition-colors hover:text-foreground">Features</Link>
          <Link href="/#pricing" data-testid="link-pricing" className="transition-colors hover:text-foreground">Pricing</Link>
          <Link href="/docs" data-testid="link-docs" className="transition-colors hover:text-foreground">Docs</Link>
          <Link href="/roadmap" data-testid="link-roadmap" className="transition-colors hover:text-foreground">Roadmap</Link>
        </nav>

        <div className="flex items-center gap-2">
          {session === 'unauthenticated' && (
            <>
              <Button asChild variant="ghost" size="sm" data-testid="button-sign-in"><Link href="/login">Sign in</Link></Button>
              <Button asChild size="sm" data-testid="button-get-started"><Link href="/register">Get started</Link></Button>
            </>
          )}
          {session === 'authenticated' && (
            <Button asChild size="sm" data-testid="button-dashboard"><Link href="/dashboard">Dashboard</Link></Button>
          )}
        </div>
      </div>
    </header>
  );
}