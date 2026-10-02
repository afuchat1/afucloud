import { ArrowUpRight, BookOpen } from 'lucide-react';
import { Link } from '@/lib/navigation';
import { docsPathForSection } from '@/lib/docs-routes';

export function HowItWorksLink({ section }: { section: string }) {
  return (
    <Link
      href={docsPathForSection(section)}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border/70 bg-background/60 px-4 text-sm font-medium text-foreground shadow-[0_3px_10px_rgba(20,35,27,0.07),inset_0_1px_0_rgba(255,255,255,0.4)] backdrop-blur-md transition-all hover:border-primary/35 hover:bg-background/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <BookOpen className="h-4 w-4" aria-hidden="true" />
      <span>How it works</span>
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}