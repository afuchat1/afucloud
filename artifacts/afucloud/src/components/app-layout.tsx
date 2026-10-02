import { useState, type ReactNode } from 'react';
import { Menu } from 'lucide-react';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import { Sidebar } from '@/components/sidebar';

export function AppLayout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-w-0 flex-1 overflow-x-hidden lg:pl-64 min-h-[100dvh]">
        <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <AfuCloudLogo className="h-6 w-6" />
            <span className="text-sm font-semibold tracking-tight">AfuCloud</span>
          </div>
        </header>
        <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {children}
        </div>
      </main>
    </div>
  );
}