import { useQuery } from '@tanstack/react-query';
import { dashboardSessionRequest, type DashboardUser } from '@/lib/auth-session';

export const dashboardSessionQueryKey = ['dashboard-session', 'me'] as const;

export type DashboardSessionVisibility =
  | 'checking'
  | 'authenticated'
  | 'unauthenticated'
  | 'unavailable';

function isUnauthorized(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'status' in error &&
      (error as { status?: unknown }).status === 401,
  );
}

export function useDashboardSessionVisibility(): DashboardSessionVisibility {
  const sessionQuery = useQuery({
    queryKey: dashboardSessionQueryKey,
    queryFn: () => dashboardSessionRequest<DashboardUser>('me'),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });

  if (sessionQuery.isFetching) return 'checking';
  if (sessionQuery.isSuccess && sessionQuery.data) return 'authenticated';
  if (isUnauthorized(sessionQuery.error)) return 'unauthenticated';
  if (sessionQuery.isError) return 'unavailable';
  return 'checking';
}