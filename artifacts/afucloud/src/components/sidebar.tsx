import { useState } from 'react';
import { useLocation, Link } from 'wouter';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { clearAuthTokens } from '@/lib/auth-session';
import {
  LayoutDashboard,
  FolderOpen,
  BarChart3,
  Activity,
  Key,
  Settings,
  BookOpen,
  Cloud,
  LogOut,
  X,
  Map,
  Image as ImageIcon,
  Globe2,
  HardDrive,
  ChevronDown,
  type LucideIcon,
} from 'lucide-react';

type NavigationItem = { name: string; href: string; icon: LucideIcon };

const productNavigation = [
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Storage', href: '/storage', icon: HardDrive },
  { name: 'Domains', href: '/domains', icon: Globe2 },
];

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

function SidebarContent({ onClose }: { onClose?: () => void }) {
  const [location, setLocation] = useLocation();
  const isProductRoute =
    location === '/projects' ||
    location.startsWith('/projects/') ||
    location === '/storage' ||
    location.startsWith('/storage/') ||
    location === '/domains' ||
    location.startsWith('/domains/');
  const [imagesExpanded, setImagesExpanded] = useState(isProductRoute);
  const { data: user } = useGetMe({ query: { queryKey: ['/api/v1/auth/me'], retry: false } });
  const logoutMutation = useLogout();

  const handleLogout = () => {
    logoutMutation.mutate(
      { data: { refreshToken: localStorage.getItem('afucloud_refresh_token') ?? '' } },
      {
      onSettled: () => {
        clearAuthTokens();
        setLocation('/login');
      },
      },
    );
  };

  const handleNavClick = () => {
    // Close drawer on mobile after navigating
    onClose?.();
  };

  const isActive = (href: string) =>
    location === href || location.startsWith(`${href}/`);

  const renderNavItem = (item: NavigationItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.name}
        href={item.href}
        onClick={handleNavClick}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex min-h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors',
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
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Cloud className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
            AfuCloud
          </span>
        </div>
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
            Products
          </p>
          <button
            type="button"
            onClick={() => setImagesExpanded((expanded) => !expanded)}
            aria-expanded={imagesExpanded}
            aria-controls="images-product-navigation"
            className={cn(
              'flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-semibold transition-colors',
              isProductRoute
                ? 'bg-sidebar-accent/75 text-sidebar-accent-foreground'
                : 'text-sidebar-foreground hover:bg-sidebar-accent/55'
            )}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ImageIcon className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="flex-1">Images</span>
            <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary">
              Live
            </span>
            <ChevronDown
              className={cn('h-3.5 w-3.5 text-sidebar-foreground/45 transition-transform duration-200', imagesExpanded && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
          {imagesExpanded && (
            <div id="images-product-navigation" className="relative ml-[22px] mt-1 space-y-0.5 border-l border-sidebar-border pl-3">
              {productNavigation.map(renderNavItem)}
            </div>
          )}
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Platform
          </p>
          <div className="space-y-0.5">{platformNavigation.map(renderNavItem)}</div>
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Developer
          </p>
          {developerNavigation.map(renderNavItem)}
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Resources
          </p>
          <div className="space-y-0.5">{resourceNavigation.map(renderNavItem)}</div>
        </section>

        <section>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">
            Account
          </p>
          {accountNavigation.map(renderNavItem)}
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
            onClick={handleLogout}
            disabled={logoutMutation.isPending}
            className="flex items-center gap-1.5 rounded px-2 py-1.5 text-xs font-medium text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors disabled:opacity-50"
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
        <SidebarContent onClose={onClose} />
      </aside>
    </>
  );
}
