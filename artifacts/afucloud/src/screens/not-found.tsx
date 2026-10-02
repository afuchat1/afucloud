import { Card, CardContent } from '@/components/ui/card';
import { Link } from '@/lib/navigation';
import { AlertCircle, ArrowLeft, BookOpen, Home } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PublicHeader } from '@/components/public-header';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <PublicHeader />
      <main className="flex min-h-[calc(100dvh-4rem)] items-center justify-center px-4 py-8">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2">
            <AlertCircle className="h-8 w-8 text-destructive" />
            <h1 className="text-2xl font-bold text-foreground">
              404 Page Not Found
            </h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            This page does not exist or may have moved.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Link href="/">
              <Button className="gap-2">
                <Home className="h-4 w-4" />
                Home
              </Button>
            </Link>
            <Link href="/docs">
              <Button variant="outline" className="gap-2">
                <BookOpen className="h-4 w-4" />
                Docs
              </Button>
            </Link>
            <Button variant="ghost" className="gap-2" onClick={() => window.history.back()}>
              <ArrowLeft className="h-4 w-4" />
              Go back
            </Button>
          </div>
        </CardContent>
      </Card>
      </main>
    </div>
  );
}
