import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { AuthHeader } from '@/components/auth-header';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { dashboardSessionRequest } from '@/lib/auth-session';

type ConfirmationState = 'checking' | 'confirmed' | 'error';

export default function ConfirmEmailPage() {
  const [, setLocation] = useLocation();
  const tokenHashRef = useRef<string | null>(null);
  const confirmationRequestRef = useRef<Promise<unknown> | null>(null);
  const [state, setState] = useState<ConfirmationState>('checking');

  useEffect(() => {
    let active = true;

    if (!confirmationRequestRef.current) {
      if (!tokenHashRef.current) {
        const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        tokenHashRef.current = params.get('token_hash');
        window.history.replaceState(
          window.history.state,
          document.title,
          `${window.location.pathname}${window.location.search}`,
        );
      }

      const tokenHash = tokenHashRef.current;
      if (!tokenHash || !/^[A-Za-z0-9._~-]{20,256}$/.test(tokenHash)) {
        setState('error');
        return () => {
          active = false;
        };
      }

      confirmationRequestRef.current = dashboardSessionRequest('confirm-email', {
        method: 'POST',
        body: JSON.stringify({ tokenHash }),
      });
    }

    setState('checking');
    confirmationRequestRef.current
      .then(() => {
        if (active) setState('confirmed');
      })
      .catch(() => {
        if (active) setState('error');
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background p-6">
      <section className="w-full max-w-sm space-y-6">
        <AuthHeader />
        <div className="space-y-3 text-center">
          {state === 'checking' && (
            <>
              <LoaderCircle className="mx-auto h-8 w-8 animate-spin text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">Confirming your email</h1>
              <p className="text-sm leading-6 text-muted-foreground">This may take a few seconds.</p>
            </>
          )}
          {state === 'confirmed' && (
            <>
              <CheckCircle2 className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">Email confirmed</h1>
              <p className="text-sm leading-6 text-muted-foreground">Your AfuCloud account is ready. Sign in to continue.</p>
              <Button className="w-full" onClick={() => setLocation('/login?confirmed=1')}>
                Continue to sign in
              </Button>
            </>
          )}
          {state === 'error' && (
            <>
              <AlertCircle className="mx-auto h-8 w-8 text-destructive" aria-hidden="true" />
              <h1 className="text-2xl font-semibold tracking-tight">Confirmation link unavailable</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                This link may be expired or already used. Return to AfuCloud and request a new confirmation email.
              </p>
              <div className="grid gap-3">
                <Button className="w-full" onClick={() => setLocation('/login')}>
                  Go to sign in
                </Button>
                <Link href="/register" className="text-sm font-medium text-primary hover:underline">
                  Return to registration
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
