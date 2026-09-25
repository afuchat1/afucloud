import type { QueryKey } from '@tanstack/react-query';

export function liveQueryOptions(queryKey: QueryKey) {
  return {
    queryKey,
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
    refetchOnMount: 'always' as const,
    refetchOnWindowFocus: true,
  };
}