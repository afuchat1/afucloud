import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { dashboardSessionRequest } from "@/lib/auth-session";

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
      theme: "auto";
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

type TurnstileWidgetProps = {
  action: "afu_login" | "afu_register" | "afu_resend";
  onToken: (token: string | null) => void;
  resetSignal: number;
};

export function TurnstileWidget({ action, onToken, resetSignal }: TurnstileWidgetProps) {
  const [siteKey, setSiteKey] = useState<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    dashboardSessionRequest<{ turnstileSiteKey?: string }>("csrf")
      .then((result) => {
        if (cancelled) return;
        const key = result.turnstileSiteKey?.trim();
        if (!key) {
          setError("Cloudflare verification is not configured. Please try again later.");
          return;
        }
        setSiteKey(key);
      })
      .catch(() => {
        if (!cancelled) setError("Cloudflare verification could not be loaded. Refresh and try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const renderWidget = useCallback(() => {
    if (!siteKey || !scriptReady || !containerRef.current) return;
    const turnstile = window.turnstile;
    if (!turnstile) {
      setError("Cloudflare verification could not be loaded. Refresh and try again.");
      return;
    }

    if (widgetIdRef.current) turnstile.remove(widgetIdRef.current);
    setError(null);
    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme: "auto",
      callback: (token) => {
        setError(null);
        onToken(token);
      },
      "expired-callback": () => {
        onToken(null);
        setError("Verification expired. Complete the check again.");
      },
      "error-callback": () => {
        onToken(null);
        setError("Cloudflare verification failed. Refresh and try again.");
      },
    });
  }, [action, onToken, scriptReady, siteKey]);

  useEffect(() => {
    renderWidget();
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [renderWidget]);

  useEffect(() => {
    if (resetSignal === 0) return;
    onToken(null);
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [onToken, resetSignal]);

  return (
    <div className="space-y-1" data-testid={`turnstile-widget-${action}`}>
      {siteKey && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onReady={() => setScriptReady(true)}
          onError={() => setError("Cloudflare verification could not be loaded. Refresh and try again.")}
        />
      )}
      <span className="sr-only">Complete Cloudflare human verification</span>
      <div ref={containerRef} className="flex min-h-[65px] justify-center" />
      {isLoading && (
        <p className="text-center text-xs text-muted-foreground" role="status">
          Loading security check…
        </p>
      )}
      {error && (
        <p className="text-center text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
