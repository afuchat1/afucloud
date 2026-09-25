import type { AuthResponse } from '@workspace/api-client-react';

export function storeAuthTokens(auth: Pick<AuthResponse, 'accessToken' | 'refreshToken'>): void {
  localStorage.setItem('afucloud_token', auth.accessToken);
  localStorage.setItem('afucloud_refresh_token', auth.refreshToken);
}

export function clearAuthTokens(): void {
  localStorage.removeItem('afucloud_token');
  localStorage.removeItem('afucloud_refresh_token');
}