import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { CreditCard, ExternalLink, RefreshCw, User, Shield, LogOut } from 'lucide-react';
import { clearAuthTokens, dashboardSessionRequest, type DashboardUser } from '@/lib/auth-session';
import { customFetch } from '@workspace/api-client-react';

type BillingPlan = {
  key: 'free' | 'pro' | 'business';
  name: string;
  description: string;
  monthlyPriceUsd: number;
  limits: {
    projects: number;
    storageContainers: number;
    apiKeys: number;
    maxFileSizeBytes: number;
  };
};

type BillingSummary = {
  currentTier: BillingPlan['key'];
  subscription: null | {
    tierKey: Exclude<BillingPlan['key'], 'free'>;
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    manageUrl: string | null;
    checkoutPending: boolean;
  };
  checkoutConfigured: boolean;
  usage: {
    projects: number;
    storageContainers: number;
    apiKeys: number;
  };
  plans: BillingPlan[];
};

function billingLimitLabel(plan: BillingPlan): string[] {
  return [
    `${plan.limits.projects} projects`,
    `${plan.limits.storageContainers} storage containers`,
    `${plan.limits.apiKeys} API keys`,
    `${Math.round(plan.limits.maxFileSizeBytes / 1024 / 1024)} MB max file size`,
  ];
}

function displayBillingStatus(status: string): string {
  return status.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

async function changePassword(currentPassword: string, newPassword: string) {
  return dashboardSessionRequest('me/password', {
    method: 'PATCH',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export default function SettingsPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery({
    queryKey: ['dashboard-session', 'me'],
    queryFn: () => dashboardSessionRequest<DashboardUser>('me'),
  });
  const billingQuery = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => customFetch<BillingSummary>('/api/v1/billing'),
    retry: false,
    refetchOnMount: 'always',
  });
  const checkoutMutation = useMutation({
    mutationFn: (planKey: Exclude<BillingPlan['key'], 'free'>) =>
      customFetch<{ purchaseUrl: string }>('/api/v1/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ planKey }),
      }),
    onSuccess: ({ purchaseUrl }) => {
      window.location.assign(purchaseUrl);
    },
    onError: (error: Error) => toast({
      title: 'Could not start checkout',
      description: error.message,
      variant: 'destructive',
    }),
  });
  const syncBillingMutation = useMutation({
    mutationFn: () => customFetch<BillingSummary>('/api/v1/billing/sync', { method: 'POST' }),
    onSuccess: summary => {
      queryClient.setQueryData(['billing', 'subscription'], summary);
      toast({ title: 'Subscription status refreshed' });
    },
    onError: (error: Error) => toast({
      title: 'Could not refresh subscription',
      description: error.message,
      variant: 'destructive',
    }),
  });
  const updateMutation = useMutation({
    mutationFn: (data: { name: string }) => dashboardSessionRequest<DashboardUser>('me/update', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['dashboard-session', 'me'], updatedUser);
      toast({ title: 'Saved', description: 'Profile updated successfully' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });
  const logoutMutation = useMutation({
    mutationFn: () => dashboardSessionRequest('logout', { method: 'POST' }),
    onSuccess: () => {
      clearAuthTokens();
      queryClient.clear();
      setLocation('/login');
    },
    onError: (error: Error) => {
      toast({
        title: 'Could not sign out',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

  // Pre-fill when data loads
  if (user && name === '' && email === '') {
    setName(user.name || '');
    setEmail(user.email || '');
  }

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({ name });
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: 'Password too short', description: 'Must be at least 8 characters', variant: 'destructive' });
      return;
    }
    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast({ title: 'Password changed', description: 'Your password has been updated successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Manage your account and preferences" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Subscription */}
          <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <CreditCard className="h-4 w-4 text-primary" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Subscription</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">Plans are billed monthly through Whop.</p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => syncBillingMutation.mutate()}
                disabled={syncBillingMutation.isPending || billingQuery.isLoading}
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${syncBillingMutation.isPending ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>

            {billingQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading your plan…</p>
            )}
            {billingQuery.isError && (
              <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                Could not load billing details: {(billingQuery.error as Error).message}
              </p>
            )}
            {billingQuery.data && (
              <>
                <div className="rounded-md border border-border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Current plan</p>
                      <p className="mt-1 text-lg font-semibold text-foreground">
                        {billingQuery.data.plans.find(plan => plan.key === billingQuery.data?.currentTier)?.name ?? 'Free'}
                      </p>
                    </div>
                    <div className="text-right">
                      {billingQuery.data.subscription && (
                        <p className="text-xs font-medium text-muted-foreground">
                          {displayBillingStatus(billingQuery.data.subscription.status)}
                          {billingQuery.data.subscription.cancelAtPeriodEnd ? ' · cancels at period end' : ''}
                        </p>
                      )}
                      {billingQuery.data.subscription?.currentPeriodEnd && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Current period ends {new Date(billingQuery.data.subscription.currentPeriodEnd).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{billingQuery.data.usage.projects} projects</span>
                    <span>{billingQuery.data.usage.storageContainers} storage containers</span>
                    <span>{billingQuery.data.usage.apiKeys} API keys</span>
                  </div>
                  {billingQuery.data.subscription?.checkoutPending && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Waiting for Whop to confirm payment. Use Refresh after completing checkout.
                    </p>
                  )}
                  {billingQuery.data.currentTier !== 'free' && (
                    <a
                      href={billingQuery.data.subscription?.manageUrl || 'https://whop.com/billing'}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                    >
                      Manage subscription on Whop <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {billingQuery.data.currentTier !== 'free' && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      To switch plans, manage your current membership on Whop first.
                    </p>
                  )}
                </div>

                {!billingQuery.data.checkoutConfigured && (
                  <p className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    Whop checkout is not configured yet. Free plan limits remain available.
                  </p>
                )}

                <div className="grid gap-3 md:grid-cols-3">
                  {billingQuery.data.plans.map(plan => {
                    const isCurrent = plan.key === billingQuery.data?.currentTier;
                    const hasPaidPlan = billingQuery.data?.currentTier !== 'free';
                    const canStartCheckout = plan.key !== 'free'
                      && !hasPaidPlan
                      && billingQuery.data?.checkoutConfigured
                      && !checkoutMutation.isPending;

                    return (
                      <div
                        key={plan.key}
                        className={`flex flex-col rounded-lg border p-4 ${isCurrent ? 'border-primary/50 bg-primary/[0.03]' : 'border-border'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-foreground">{plan.name}</h3>
                          {isCurrent && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                          {plan.monthlyPriceUsd === 0 ? 'Free' : `$${plan.monthlyPriceUsd}`}
                          {plan.monthlyPriceUsd > 0 && <span className="text-xs font-normal text-muted-foreground"> / month</span>}
                        </p>
                        <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{plan.description}</p>
                        <ul className="my-4 flex-1 space-y-2 text-xs text-muted-foreground">
                          {billingLimitLabel(plan).map(limit => (
                            <li key={limit} className="flex items-center gap-2">
                              <span className="h-1.5 w-1.5 rounded-full bg-primary/70" aria-hidden="true" />
                              {limit}
                            </li>
                          ))}
                        </ul>
                        {plan.key === 'free' ? (
                          <Button type="button" variant="outline" disabled className="w-full">
                            {isCurrent ? 'Current plan' : 'Included'}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant={plan.key === 'pro' ? 'default' : 'outline'}
                            className="w-full"
                            disabled={!canStartCheckout}
                            onClick={() => checkoutMutation.mutate(plan.key as 'pro' | 'business')}
                          >
                            {checkoutMutation.isPending && checkoutMutation.variables === plan.key
                              ? 'Opening checkout…'
                              : isCurrent
                                ? 'Current plan'
                                : hasPaidPlan
                                  ? 'Manage current plan first'
                                  : !billingQuery.data?.checkoutConfigured
                                    ? 'Checkout unavailable'
                                    : `Choose ${plan.name}`}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </section>

          {/* Profile */}
          <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <User className="h-4 w-4 text-primary" strokeWidth={2} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Profile</h2>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Display Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isLoading}
                  placeholder="Your name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" value={email} disabled type="email" className="opacity-60 cursor-not-allowed" />
                <p className="text-xs text-muted-foreground">Email cannot be changed at this time.</p>
              </div>
              <Button type="submit" disabled={updateMutation.isPending || isLoading}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </form>
          </section>

          {/* Security */}
          <section className="rounded-lg border border-card-border bg-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Shield className="h-4 w-4 text-primary" strokeWidth={2} />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Change Password</h2>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="currentPassword">Current password</Label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={e => setCurrentPassword(e.target.value)}
                  placeholder="Your current password"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  required
                />
              </div>
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
              <Button
                type="submit"
                disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              >
                {changingPassword ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          </section>
        </div>

        {/* Account info */}
        <aside className="space-y-4">
          <div className="rounded-lg border border-card-border bg-card p-5 space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {user?.name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{user?.name || '—'}</p>
                  <p className="text-xs text-muted-foreground">{user?.email || '—'}</p>
                </div>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-card-border bg-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <LogOut className="h-4 w-4 text-primary" strokeWidth={2} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">Sign out</h3>
                <p className="text-xs text-muted-foreground">Sign out of your AfuCloud account on this device.</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleLogout}
              disabled={logoutMutation.isPending}
              className="w-full"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
                    <div className="rounded-lg border border-card-border bg-card p-5 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Security Tips</h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>• Use a strong, unique password</li>
              <li>• Never share your API keys</li>
              <li>• Rotate keys regularly</li>
              <li>• Use scoped keys per service</li>
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
