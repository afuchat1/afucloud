import { useLocation, Link } from 'wouter';
import { useGetMe, useLogout } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
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
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderOpen },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Activity', href: '/activity', icon: Activity },
  { name: 'Tokens', href: '/tokens', icon: Key },
];

const bottomNav = [
  { name: 'Docs', href: '/docs', icon: BookOpen },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const { data: user } = useGetMe({ query: { retry: false } });
  const logoutMutation = useLogout();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        localStorage.removeItem('afucloud_token');
        setLocation('/login');
      },
    });
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 border-r border-sidebar-border bg-sidebar">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Cloud className="h-4 w-4 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-sidebar-foreground">
            AfuCloud
          </span>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            Platform
          </p>
          {navigation.map((item) => {
            const isActive =
              location === item.href || location.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <item.icon
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isActive ? 'opacity-100' : 'opacity-70'
                  )}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {item.name}
              </Link>
            );
          })}

          <div className="my-3 border-t border-sidebar-border/60" />

          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
            Account
          </p>
          {bottomNav.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                )}
              >
                <item.icon
                  className={cn('h-4 w-4 shrink-0', isActive ? 'opacity-100' : 'opacity-70')}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                {item.name}
              </Link>
            );
          })}
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
              className="rounded p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
