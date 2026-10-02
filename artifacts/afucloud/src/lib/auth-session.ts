import { clearCsrfToken, customFetch } from "@workspace/api-client-react";

export interface DashboardUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  emailVerified: boolean;
  createdAt: string;
}

const AUTH_RETURN_TO_KEY = "afucloud_auth_return_to";

function safeReturnTo(value: string | null | undefined): string | null {
  if (
    typeof window === "undefined" ||
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return null;
  }

  try {
    const url = new URL(value, window.location.origin);
    if (
      url.origin !== window.location.origin ||
      url.pathname === "/login" ||
      url.pathname === "/register"
    ) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function rememberAuthReturnTo(path: string): void {
  if (typeof window === "undefined") return;
  const returnTo = safeReturnTo(path);
  if (!returnTo) return;
  try {
    window.sessionStorage.setItem(AUTH_RETURN_TO_KEY, returnTo);
  } catch {
    // Navigation still falls back to the dashboard if storage is unavailable.
  }
}

export function consumeAuthReturnTo(): string {
  if (typeof window === "undefined") return "/dashboard";
  try {
    const returnTo = safeReturnTo(window.sessionStorage.getItem(AUTH_RETURN_TO_KEY));
    window.sessionStorage.removeItem(AUTH_RETURN_TO_KEY);
    return returnTo ?? "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export function clearAuthTokens(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("afucloud_token");
    localStorage.removeItem("afucloud_refresh_token");
  }
  clearCsrfToken();
}

export function clearLegacyAuthTokens(): void {
  clearAuthTokens();
}

export function dashboardSessionRequest<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  return customFetch<T>(`/api/v1/dashboard/session/${endpoint.replace(/^\/+/, "")}`, {
    ...options,
    responseType: "json",
  });
}