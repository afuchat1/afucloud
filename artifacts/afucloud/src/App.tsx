import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';
import { AuthGuard } from '@/components/auth-guard';
import { Sidebar } from '@/components/sidebar';
import LoginPage from '@/pages/login';
import RegisterPage from '@/pages/register';
import DashboardPage from '@/pages/dashboard';
import ProjectsPage from '@/pages/projects';
import ProjectDetailPage from '@/pages/project-detail';
import AnalyticsPage from '@/pages/analytics';
import ActivityPage from '@/pages/activity';
import TokensPage from '@/pages/tokens';
import SettingsPage from '@/pages/settings';
import DocsPage from '@/pages/docs';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] bg-background">
      <Sidebar />
      <main className="flex-1 pl-64 min-h-[100dvh]">
        <div className="mx-auto max-w-[1200px] px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <AppLayout>{children}</AppLayout>
    </AuthGuard>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      {/* Protected */}
      <Route path="/dashboard">
        <Protected><DashboardPage /></Protected>
      </Route>
      <Route path="/projects">
        <Protected><ProjectsPage /></Protected>
      </Route>
      <Route path="/projects/:id">
        <Protected><ProjectDetailPage /></Protected>
      </Route>
      <Route path="/analytics">
        <Protected><AnalyticsPage /></Protected>
      </Route>
      <Route path="/activity">
        <Protected><ActivityPage /></Protected>
      </Route>
      <Route path="/tokens">
        <Protected><TokensPage /></Protected>
      </Route>
      <Route path="/settings">
        <Protected><SettingsPage /></Protected>
      </Route>
      <Route path="/docs">
        <Protected><DocsPage /></Protected>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
