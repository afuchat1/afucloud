import { clearCsrfToken, customFetch } from "@workspace/api-client-react";

export interface DashboardUser {
  id: string;
  email: string;
  name: string;
  avatar?: string | null;
  emailVerified: boolean;
  createdAt: string;
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