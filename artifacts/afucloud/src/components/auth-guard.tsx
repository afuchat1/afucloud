import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { clearAuthTokens, clearLegacyAuthTokens, dashboardSessionRequest, type DashboardUser } from "@/lib/auth-session";

interface AuthGuardProps {
  children: React.ReactNode;
}

type SessionState = "checking" | "authenticated" | "unauthenticated" | "unavailable";

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "status" in error &&
      (error as { status?: unknown }).status === 401,
  );
}

export function AuthGuard({ children }: AuthGuardProps) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SessionState>("checking");

  useEffect(() => {
    let active = true;
    clearLegacyAuthTokens();

    async function restoreSession() {
      try {
        await dashboardSessionRequest<DashboardUser>("me");
        if (active) setState("authenticated");
        return;
      } catch (error) {
        if (!isUnauthorized(error)) {
          if (active) setState("unavailable");
          return;
        }
      }

      try {
        await dashboardSessionRequest<DashboardUser>("refresh", { method: "POST" });
        if (active) setState("authenticated");
      } catch (error) {
        if (isUnauthorized(error)) {
          clearAuthTokens();
          if (active) setState("unauthenticated");
        } else if (active) {
          setState("unavailable");
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      clearAuthTokens();
      queryClient.clear();
      setState("unauthenticated");
    };
    window.addEventListener("afucloud:session-expired", handleExpiredSession);
    return () => window.removeEventListener("afucloud:session-expired", handleExpiredSession);
  }, [queryClient]);

  useEffect(() => {
    if (state === "unauthenticated") setLocation("/login");
  }, [state, setLocation]);

  if (state === "checking" || state === "unauthenticated") {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (state === "unavailable") {
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