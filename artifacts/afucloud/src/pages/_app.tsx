import { useState } from 'react';
import type { AppProps } from 'next/app';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/toaster';
import { setBaseUrl } from '@workspace/api-client-react';
import { clearLegacyAuthTokens } from '@/lib/auth-session';
import { SeoHead } from '@/components/seo-head';
import '@/index.css';

const configuredApiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL || process.env.VITE_API_BASE_URL || 'https://api.afuchat.com';
setBaseUrl(process.env.NODE_ENV === 'production' ? configuredApiBase : null);
if (typeof window !== 'undefined') clearLegacyAuthTokens();

export default function AfuCloudApp({ Component, pageProps }: AppProps) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <TooltipProvider>
          <SeoHead siteUrl={(pageProps as { siteUrl?: string | null }).siteUrl} />
          <Component {...pageProps} />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}