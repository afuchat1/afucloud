import { Link } from '@/lib/navigation';
import { AfuCloudLogo } from '@/components/afucloud-logo';

export function AuthHeader() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Link href="/" className="flex items-center gap-2.5">
        <AfuCloudLogo className="h-8 w-8" />
        <span className="text-sm font-semibold tracking-tight">AfuCloud</span>
      </Link>
      <nav className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Account navigation">
        <Link href="/docs" className="transition-colors hover:text-foreground">Docs</Link>
        <Link href="/roadmap" className="transition-colors hover:text-foreground">Roadmap</Link>
      </nav>
    </div>
  );
}