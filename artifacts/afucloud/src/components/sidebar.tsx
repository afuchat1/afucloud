import { useEffect, useState } from 'react';
import { Link, useLocation } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clearAuthTokens, dashboardSessionRequest, type DashboardUser } from '@/lib/auth-session';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { AfuCloudLogo } from '@/components/afucloud-logo';
import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Activity,
  Key,
  Webhook,
  Settings,
  BookOpen,
  X,
  Map,
  Image as ImageIcon,
  Globe2,
  HardDrive,
  Database,
  ChevronDown,
  LogOut,
  type LucideIcon,
} from 'lucide-react';

type NavigationItem = { name: string; href: string; icon: LucideIcon };

const platformNavigation = [
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Activity', href: '/activity', icon: Activity },
];

const developerNavigation = [
  { name: 'API tokens', href: '/tokens', icon: Key },
];

const resourceNavigation = [
  { name: 'Roadmap', href: '/roadmap', icon: Map },
  { name: 'Docs', href: '/docs', icon: BookOpen },
];

const accountNavigation = [
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  /** Mobile only — whether the drawer is open */
  open?: boolean;
  /** Mobile only — called when the user closes the drawer */
  onClose?: () => void;
}

function SidebarContent({ onClose, showLogo = true }: { onClose?: () => void; showLogo?: boolean }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const projectMatch = location.match(/^\/projects\/([^/]+)(?:\/(api-keys|webhooks|analytics))?$/);
  const projectId = projectMatch?.[1];
  const [expandedProducts, setExpandedProducts] = useState({
    images: location === '/projects' || location.startsWith('/projects/'),
    storage: location === '/storage' || location.startsWith('/storage/'),
    domains: location === '/domains' || location.startsWith('/domains/'),
  });
  useEffect(() => {
    if (location === '/projects' || location.startsWith('/projects/')) {
      setExpandedProducts((expanded) => ({ ...expanded, images: true }));
    } else if (location === '/storage' || location.startsWith('/storage/')) {
      setExpandedProducts((expanded) => ({ ...expanded, storage: true }));
    } else if (location === '/domains' || location.startsWith('/domains/')) {
      setExpandedProducts((expanded) => ({ ...expanded, domains: true }));
    }
  }, [location]);
  const { data: user } = useQuery({
    queryKey: ['dashboard-session', 'me'],
    queryFn: () => dashboardSessionRequest<DashboardUser>('me'),
    retry: false,
  });
  const logoutMutation = useMutation({
    mutationFn: () => dashboardSessionRequest('logout', { method: 'POST' }),
    onSuccess: () => {
      clearAuthTokens();
      queryClient.clear();
      setLocation('/login');
      onClose?.();
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not sign out',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleNavClick = () => {
    // Close drawer on mobile after navigating
    onClose?.();
  };

  const isActive = (href: string) => location === href || location.startsWith(`${href}/`);
  const isGroupActive = (href: string) => isActive(href);

  const renderNavItem = (item: NavigationItem, nested = false, exact = false) => {
    const active = exact ? location === item.href : isActive(item.href);
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={handleNavClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex min-h-9 min-w-0 items-center gap-3 rounded-lg text-[13px] font-medium transition-colors',
          nested ? 'rounded-md px-2.5' : 'rounded-lg px-3',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
            : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground'
        )}
      >
        <item.icon
          className={cn('h-4 w-4 shrink-0', active ? 'opacity-100' : 'opacity-65 group-hover:opacity-100')}
          strokeWidth={active ? 2.2 : 1.9}
        />
        <span className="truncate">{item.name}</span>
        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
      </Link>
    );
  };

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className={cn('flex h-16 items-center border-b border-sidebar-border px-6', showLogo ? 'justify-between' : 'justify-end')}>
        {showLogo && (
          <div className="flex items-center gap-2.5">
            <AfuCloudLogo className="h-8 w-8" />
            <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
              AfuCloud
            </span>
          </div>
        )}
        {/* Close button — only visible on mobile */}
        {onClose && (
          <button
            onClick={onClose}
            className="lg:hidden rounded-md p-1 text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Main Navigation */}
      <nav aria-label="Main navigation" className="flex-1 space-y-5 overflow-y-auto px-3 py-5">
        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Overview
          </p>
          {renderNavItem({ name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard })}
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            AfuCloud products
          </p>
          <div className="space-y-1">
            <div>
              <button
                type="button"
                onClick={() => setExpandedProducts((expanded) => ({ ...expanded, images: !expanded.images }))}
                aria-expanded={expandedProducts.images}
                aria-controls="image-product-navigation"
                className={cn(
                  'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-semibold transition-colors',
                  isGroupActive('/projects')
                    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/55'
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <ImageIcon className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate">Image delivery</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-sidebar-foreground/45 transition-transform duration-200', expandedProducts.images && 'rotate-180')} aria-hidden="true" />
              </button>
              {expandedProducts.images && (
                <div id="image-product-navigation" className="ml-[22px] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                  {renderNavItem({ name: 'Projects', href: '/projects', icon: FolderOpen }, true, true)}
                  {projectId && (
                    <div className="ml-2 mt-1 border-l border-sidebar-border/70 pl-2">
                      <p className="mb-1 px-2 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">Current project</p>
                      <div className="space-y-0.5">
                        {renderNavItem({ name: 'Image library', href: `/projects/${projectId}`, icon: ImageIcon }, true, true)}
                        {renderNavItem({ name: 'API keys', href: `/projects/${projectId}/api-keys`, icon: Key }, true)}
                        {renderNavItem({ name: 'Webhooks', href: `/projects/${projectId}/webhooks`, icon: Webhook }, true)}
                        {renderNavItem({ name: 'Analytics', href: `/projects/${projectId}/analytics`, icon: BarChart3 }, true)}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setExpandedProducts((expanded) => ({ ...expanded, storage: !expanded.storage }))}
                aria-expanded={expandedProducts.storage}
                aria-controls="storage-product-navigation"
                className={cn(
                  'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-semibold transition-colors',
                  isGroupActive('/storage')
                    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/55'
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Database className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate">Object storage</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-sidebar-foreground/45 transition-transform duration-200', expandedProducts.storage && 'rotate-180')} aria-hidden="true" />
              </button>
              {expandedProducts.storage && (
                <div id="storage-product-navigation" className="ml-[22px] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                  {renderNavItem({ name: 'Containers & files', href: '/storage', icon: HardDrive }, true)}
                </div>
              )}
            </div>

            <div>
              <button
                type="button"
                onClick={() => setExpandedProducts((expanded) => ({ ...expanded, domains: !expanded.domains }))}
                aria-expanded={expandedProducts.domains}
                aria-controls="domains-product-navigation"
                className={cn(
                  'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-semibold transition-colors',
                  isGroupActive('/domains')
                    ? 'bg-sidebar-accent/70 text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/55'
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Globe2 className="h-4 w-4" strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1 truncate">Custom domains</span>
                <ChevronDown className={cn('h-3.5 w-3.5 text-sidebar-foreground/45 transition-transform duration-200', expandedProducts.domains && 'rotate-180')} aria-hidden="true" />
              </button>
              {expandedProducts.domains && (
                <div id="domains-product-navigation" className="ml-[22px] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
                  {renderNavItem({ name: 'Domain manager', href: '/domains', icon: Globe2 }, true)}
                </div>
              )}
            </div>
          </div>
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Platform
          </p>
          <div className="space-y-0.5">{platformNavigation.map((item) => renderNavItem(item))}</div>
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Developer
          </p>
          {developerNavigation.map((item) => renderNavItem(item))}
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Resources
          </p>
          <div className="space-y-0.5">{resourceNavigation.map((item) => renderNavItem(item))}</div>
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Account
          </p>
          {accountNavigation.map((item) => renderNavItem(item))}
        </section>
      </nav>

      {/* User section */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-md px-2 py-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {user?.name?.[0]?.toUpperCase() ?? 'U'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-sidebar-foreground truncate">
              {user?.name ?? 'Loading…'}
            </p>
            <p className="text-[11px] text-sidebar-foreground/55 truncate">
              {user?.email ?? ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors disabled:opacity-50"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{logoutMutation.isPending ? 'Signing out…' : 'Sign out'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  return (
    <>
      {/* ── Desktop sidebar (always visible ≥ lg) ── */}
      <aside className="hidden lg:flex fixed left-0 top-0 z-40 h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
        <SidebarContent />
      </aside>

      {/* ── Mobile drawer overlay ── */}
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 lg:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer panel */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 h-screen w-72 border-r border-sidebar-border bg-sidebar transition-transform duration-250 ease-in-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <SidebarContent onClose={onClose} showLogo={false} />
      </aside>
    </>
  );
}
