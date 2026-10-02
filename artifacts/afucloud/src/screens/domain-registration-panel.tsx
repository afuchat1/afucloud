import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, CircleAlert, Globe2, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HowItWorksLink } from '@/components/how-it-works-link';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/api-base';
import { customFetchResponse } from '@workspace/api-client-react';

type SearchResult = { domainName: string; available: boolean; registrable: boolean; tier: string; reason: string | null };
type Quote = {
  domainName: string;
  registrable: boolean;
  tier: string;
  reason: string | null;
  currency: string;
  markupPercent: number;
  registrarCost: number | null;
  renewalRegistrarCost: number | null;
  retailPrice: number | null;
  renewalRetailPrice: number | null;
};
type DomainOrder = {
  id: string;
  domainName: string;
  status: string;
  currency: string;
  registrarCost: number;
  renewalRegistrarCost: number;
  retailPrice: number;
  renewalRetailPrice: number;
  registrationStatus: string | null;
  expiresAt: string | null;
  error: string | null;
  createdAt: string;
};
type Registrant = {
  email: string;
  phone: string;
  name: string;
  organization: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
};

const emptyRegistrant: Registrant = {
  email: '', phone: '', name: '', organization: '', street: '', city: '', state: '', postalCode: '', countryCode: '',
};

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await customFetchResponse(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body as T;
}

function money(value: number | null | undefined, currency = 'USD') {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Unavailable';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
}

function statusLabel(status: string) {
  return ({
    creating_checkout: 'Starting checkout',
    pending_payment: 'Awaiting payment',
    paid: 'Payment confirmed',
    registering: 'Submitting registration',
    processing: 'Registration processing',
    registered: 'Registered',
    registration_failed: 'Registration failed',
    checkout_failed: 'Checkout failed',
    refunded: 'Refunded',
    manual_review: 'AfuCloud review required',
  } as Record<string, string>)[status] ?? status;
}

export function DomainRegistrationPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [order, setOrder] = useState<DomainOrder | null>(null);
  const [registrant, setRegistrant] = useState<Registrant>(emptyRegistrant);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchError, setSearchError] = useState('');

  const ordersQuery = useQuery<DomainOrder[]>({
    queryKey: ['domain-registration-orders'],
    queryFn: () => jsonFetch<DomainOrder[]>('/v1/domains/registrations/orders'),
  });

  const syncOrder = (next: DomainOrder) => {
    setOrder(next);
    void queryClient.invalidateQueries({ queryKey: ['domain-registration-orders'] });
  };

  const loadOrder = async (id: string) => {
    setBusy('order');
    try {
      const current = await jsonFetch<DomainOrder>(`/v1/domains/registrations/orders/${encodeURIComponent(id)}`);
      syncOrder(current);
    } catch (error) {
      toast({ title: 'Could not load domain order', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('registrationOrder');
    if (orderId) void loadOrder(orderId);
  }, []);

  const searchDomains = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('search');
    setSearchError('');
    setResults([]);
    setQuote(null);
    try {
      const response = await jsonFetch<{ results: SearchResult[] }>(
        `/v1/domains/registrations/search?q=${encodeURIComponent(searchTerm.trim())}`,
      );
      setResults(response.results);
      if (!response.results.length) setSearchError('No matching domains were returned. Try another name.');
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search is temporarily unavailable.');
    } finally {
      setBusy(null);
    }
  };

  const getQuote = async (domainName: string) => {
    setBusy(`quote:${domainName}`);
    setSearchError('');
    setQuote(null);
    try {
      const response = await jsonFetch<Quote>('/v1/domains/registrations/quote', {
        method: 'POST',
        body: JSON.stringify({ domainName }),
      });
      setQuote(response);
      setSearchTerm(response.domainName);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not check current pricing.');
    } finally {
      setBusy(null);
    }
  };

  const startCheckout = async () => {
    if (!quote || !acceptedTerms) return;
    setBusy('checkout');
    try {
      const response = await jsonFetch<{ purchaseUrl: string; order: DomainOrder }>('/v1/domains/registrations/checkout', {
        method: 'POST',
        body: JSON.stringify({ domainName: quote.domainName }),
      });
      window.location.assign(response.purchaseUrl);
    } catch (error) {
      toast({ title: 'Could not start checkout', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
      setBusy(null);
    }
  };

  const submitRegistrant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!order) return;
    setBusy('register');
    try {
      const updated = await jsonFetch<DomainOrder>(`/v1/domains/registrations/orders/${encodeURIComponent(order.id)}/register`, {
        method: 'POST',
        body: JSON.stringify({ registrant }),
      });
      syncOrder(updated);
      setRegistrant(emptyRegistrant);
      toast({
        title: updated.status === 'registered' ? 'Domain registered' : statusLabel(updated.status),
        description: updated.error ?? undefined,
      });
    } catch (error) {
      toast({ title: 'Could not submit registration', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
      await loadOrder(order.id);
    } finally {
      setBusy(null);
    }
  };

  const setContact = (field: keyof Registrant, value: string) => {
    setRegistrant(current => ({ ...current, [field]: value }));
  };

  const canRegister = order?.status === 'paid';

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card" data-testid="domain-registration">
      <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Globe2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">AfuCloud service</p>
          <h2 className="mt-1 text-lg font-semibold">Register a domain</h2>
          <p className="mt-1 text-sm text-muted-foreground">Search domains and review the live price.</p>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.8fr)]">
        <div className="space-y-4">
          <form onSubmit={searchDomains} className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="example.com or a name to search"
              aria-label="Domain name to search"
              required
              maxLength={253}
            />
            <Button type="submit" disabled={busy === 'search'} className="shrink-0">
              {busy === 'search' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Search
            </Button>
          </form>

          {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}
          {results.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              {results.map(result => (
                <div key={result.domainName} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{result.domainName}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.available ? 'Listed as available · confirm with live quote' : result.reason || 'Availability not confirmed'}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => void getQuote(result.domainName)} disabled={busy === `quote:${result.domainName}`}>
                    {busy === `quote:${result.domainName}` ? 'Checking…' : 'Get price'}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {quote && (
            <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold">{quote.domainName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {quote.registrable && quote.tier !== 'premium' ? 'Available now · standard registration' : quote.reason || 'This domain is not available for registration.'}
                  </p>
                </div>
                {quote.registrable && quote.tier !== 'premium' && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
              </div>
              {quote.registrable && quote.tier !== 'premium' && (
                <>
                  <div className="space-y-2 border-t border-border pt-3 text-sm">
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Registration, first year</span><span>{money(quote.retailPrice, quote.currency)}</span></div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Renewal per year (manual)</span><span>{money(quote.renewalRetailPrice, quote.currency)}</span></div>
                    <p className="text-xs text-muted-foreground">Includes the live Cloudflare price plus AfuCloud’s {quote.markupPercent}% service markup. Renewal prices may change.</p>
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={acceptedTerms}
                      onChange={event => setAcceptedTerms(event.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    />
                    <span>I confirm the buyer will be the legal registrant, renewals are manual, and completed domain registrations are non-refundable.</span>
                  </label>
                  <Button type="button" className="w-full" onClick={() => void startCheckout()} disabled={!acceptedTerms || busy === 'checkout'}>
                    {busy === 'checkout' ? 'Starting checkout…' : <>Continue to Whop checkout <ArrowUpRight className="ml-2 h-4 w-4" /></>}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-3 rounded-lg bg-muted/30 p-4 text-sm">
          <h3 className="font-semibold">Domain registration</h3>
          <p className="text-sm text-muted-foreground">Choose a domain, pay, then submit registrant details.</p>
          <HowItWorksLink section="registration" />
        </aside>
      </div>

      {order && (
        <div className="border-t border-border bg-muted/10 p-5 sm:p-6" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current order</p>
              <h3 className="mt-1 font-semibold">{order.domainName}</h3>
            </div>
            <div className="flex items-center gap-2">
              {order.status === 'registered' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleAlert className="h-4 w-4 text-amber-600" />}
              <span className="text-sm font-medium">{statusLabel(order.status)}</span>
            </div>
          </div>

          {order.status === 'pending_payment' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">After paying in Whop, check here to confirm payment.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(order.id)} disabled={busy === 'order'}>Check payment</Button>
            </div>
          )}

          {canRegister && (
            <form onSubmit={submitRegistrant} className="mt-5 space-y-4">
              <div>
                <h4 className="font-semibold">Buyer’s legal registrant details</h4>
                <p className="mt-1 text-xs text-muted-foreground">Sent directly to Cloudflare to register the domain. AfuCloud does not store these contact details.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ['name', 'Full legal name', 'Jane Doe'],
                  ['organization', 'Organization (optional)', ''],
                  ['email', 'Email', 'name@example.com'],
                  ['phone', 'Phone (+country.number)', '+256.700000000'],
                  ['street', 'Street address', '123 Main Street'],
                  ['city', 'City', 'Kampala'],
                  ['state', 'State / region', 'Central Region'],
                  ['postalCode', 'Postal code', ''],
                  ['countryCode', 'Country code (2 letters)', 'UG'],
                ] as const).map(([field, title, placeholder]) => (
                  <div key={field} className="space-y-1.5">
                    <Label htmlFor={`registrant-${field}`}>{title}</Label>
                    <Input
                      id={`registrant-${field}`}
                      value={registrant[field]}
                      onChange={event => setContact(field, event.target.value)}
                      placeholder={placeholder}
                      autoComplete={field === 'email' ? 'email' : field === 'name' ? 'name' : undefined}
                      required={!['organization', 'state'].includes(field)}
                      maxLength={field === 'countryCode' ? 2 : 250}
                    />
                  </div>
                ))}
              </div>
              <Button type="submit" disabled={busy === 'register'}>
                {busy === 'register' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit registration
              </Button>
            </form>
          )}

          {order.status === 'processing' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">Cloudflare is processing the registration.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(order.id)} disabled={busy === 'order'}>
                {busy === 'order' ? 'Checking…' : 'Check registration status'}
              </Button>
            </div>
          )}
          {order.status === 'manual_review' && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Do not place another order for this domain. AfuCloud needs to review the payment or registration result.</p>}
          {order.error && <p className="mt-3 text-sm text-muted-foreground">{order.error}</p>}
        </div>
      )}

      {(ordersQuery.data?.length ?? 0) > 0 && (
        <div className="border-t border-border px-5 py-4 sm:px-6">
          <h3 className="text-sm font-semibold">Recent registration orders</h3>
          <div className="mt-2 divide-y divide-border">
            {ordersQuery.data!.slice(0, 5).map(item => (
              <button key={item.id} type="button" onClick={() => void loadOrder(item.id)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:text-primary">
                <span className="truncate text-sm font-medium">{item.domainName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{statusLabel(item.status)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}