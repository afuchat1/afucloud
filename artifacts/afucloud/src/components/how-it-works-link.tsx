import { ArrowUpRight, BookOpen } from 'lucide-react';
import { Link } from '@/lib/navigation';

export function HowItWorksLink({ section }: { section: string }) {
  return (
    <Link
      href={`/docs#docs-${section}`}
      className="inline-flex min-h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      <span>How it works</span>
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}