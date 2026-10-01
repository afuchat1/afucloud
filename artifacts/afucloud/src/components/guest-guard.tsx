import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { dashboardSessionQueryKey, useDashboardSessionVisibility } from '@/hooks/use-dashboard-session-visibility';

interface GuestGuardProps {
  children: React.ReactNode;
}

export function GuestGuard({ children }: GuestGuardProps) {
  const session = useDashboardSessionVisibility();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session === 'authenticated') setLocation('/dashboard');
  }, [session, setLocation]);

  if (session === 'unauthenticated') return <>{children}</>;

  const isUnavailable = session === 'unavailable';

  return (
    <div
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-background px-6 text-center"
      role="status"
      aria-live="polite"
    >
      {isUnavailable ? (
        <>
          <h1 className="text-lg font-semibold">Couldn’t verify your session</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sign-in is hidden until AfuCloud can confirm whether you’re already logged in.
          </p>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: dashboardSessionQueryKey })}
            className="text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">
            {session === 'authenticated' ? 'Opening your dashboard…' : 'Checking your session…'}
          </p>
        </>
      )}
    </div>
  );
}