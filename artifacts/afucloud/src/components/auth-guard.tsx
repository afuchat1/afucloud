import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { refreshToken, useGetMe } from '@workspace/api-client-react';
import { clearAuthTokens, storeAuthTokens } from '@/lib/auth-session';

interface AuthGuardProps {
  children: React.ReactNode;
}

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: unknown }).status === 401,
  );
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [, setLocation] = useLocation();
  const [token, setToken] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const accessToken = localStorage.getItem('afucloud_token');
      const refresh = localStorage.getItem('afucloud_refresh_token');

      if (!refresh) {
        if (active) setToken(accessToken);
        setSessionReady(true);
        return;
      }

      try {
        const auth = await refreshToken({ refreshToken: refresh });
        storeAuthTokens(auth);
        if (active) setToken(auth.accessToken);
      } catch (error) {
        if (isUnauthorized(error)) {
          clearAuthTokens();
          if (active) setToken(null);
        } else if (active) {
          // Keep the saved session on network/server errors; /me below can
          // still validate the current access token if the API is available.
          setToken(accessToken);
        }
      } finally {
        if (active) setSessionReady(true);
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const { data: user, isLoading, error } = useGetMe({
    query: {
      queryKey: ['/api/v1/auth/me'],
      enabled: sessionReady && !!token,
      retry: false,
    },
  });

  useEffect(() => {
    if (!sessionReady) return;

    if (!token) {
      setLocation('/login');
      return;
    }

    if (!isLoading) {
      if (isUnauthorized(error)) {
        clearAuthTokens();
        setToken(null);
        setLocation('/login');
      }
    }
  }, [sessionReady, token, isLoading, error, setLocation]);

  if (!sessionReady || (!!token && isLoading)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (token && (error || !user)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background p-6">
        <div className="max-w-sm space-y-3 text-center">
          <h1 className="text-lg font-semibold">Couldn’t verify your session</h1>
          <p className="text-sm text-muted-foreground">
            Your saved login has been kept. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm font-medium text-primary hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
