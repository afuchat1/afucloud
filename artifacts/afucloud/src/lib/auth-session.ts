import { clearCsrfToken, customFetch } from "@workspace/api-client-react";

export interface DashboardUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  emailVerified: boolean;
  createdAt: string;
}

export type PaidPlanKey = "pro" | "business";

export function paidPlanKey(value: string | null | undefined): PaidPlanKey | null {
  return value === "pro" || value === "business" ? value : null;
}

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
    let normalizedPath = url.pathname;
    try {
      normalizedPath = decodeURIComponent(normalizedPath);
    } catch {
      return null;
    }
    normalizedPath = normalizedPath.replace(/\/+$/, '').toLowerCase() || '/';
    if (
      normalizedPath.startsWith('//') ||
      normalizedPath.includes('\\') ||
      url.origin !== window.location.origin ||
      normalizedPath === '/' ||
      normalizedPath === '/login' ||
      normalizedPath.startsWith('/login/') ||
      normalizedPath === '/register' ||
      normalizedPath.startsWith('/register/')
    ) {
      return null;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

export function postAuthDestination(search?: string): string {
  if (typeof window === "undefined") return "/dashboard";
  const params = new URLSearchParams(search ?? window.location.search);
  const plan = paidPlanKey(params.get("plan"));
  if (plan) return `/settings?plan=${plan}`;
  return safeReturnTo(params.get("returnTo")) ?? "/dashboard";
}

export function loginHrefForReturnTo(path: string): string {
  const returnTo = safeReturnTo(path);
  return returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login";
}

export function authHrefWithCurrentIntent(path: "/login" | "/register"): string {
  if (typeof window === "undefined") return path;
  const current = new URLSearchParams(window.location.search);
  const intent = new URLSearchParams();
  const plan = paidPlanKey(current.get("plan"));
  const returnTo = safeReturnTo(current.get("returnTo"));
  if (plan) intent.set("plan", plan);
  if (returnTo) intent.set("returnTo", returnTo);
  const query = intent.toString();
  return query ? `${path}?${query}` : path;
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