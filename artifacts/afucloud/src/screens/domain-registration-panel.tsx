import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, CircleAlert, Globe2, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HowItWorksLink } from '@/components/how-it-works-link';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/api-base';
import { customFetchResponse, type DomainRegistrationSearchResponse } from '@workspace/api-client-react';

type SearchResult = DomainRegistrationSearchResponse['results'][number];
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
  registrationYears: number;
  purchaseUrl: string | null;
  currency: string;
  registrarCost: number;
  renewalRegistrarCost: number;
  retailPrice: number;
  renewalRetailPrice: number;
  registrationStatus: string | null;
  registeredAt: string | null;
  expiresAt: string | null;
  error: string | null;
  createdAt: string;
};
type RegistrationRequirements = {
  supported: boolean;
  reason: string | null;
  extension: string;
  allowedYears: number[];
  fields: Array<{
    name: string;
    label: string;
    description: string | null;
    type: 'string' | 'number' | 'integer' | 'boolean';
    required: boolean;
    options: Array<string | number | boolean> | null;
    format: string | null;
    minLength: number | null;
    maxLength: number | null;
  }>;
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
  if (!/^[A-Z]{3}$/.test(currency)) return 'Unavailable';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return 'Unavailable';
  }
}

function termPrice(quote: Quote, years: number) {
  if (quote.registrarCost === null || quote.renewalRegistrarCost === null) return null;
  const registrarCost = Math.round((quote.registrarCost + quote.renewalRegistrarCost * (years - 1)) * 100) / 100;
  return {
    registrarCost,
    retailPrice: Math.round(registrarCost * (1 + quote.markupPercent / 100) * 100) / 100,
  };
}

function displayDate(value: string | null) {
  if (!value) return 'Not provided by registrar';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Not provided by registrar' : parsed.toLocaleDateString();
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
  const [requirements, setRequirements] = useState<RegistrationRequirements | null>(null);
  const [registrationYears, setRegistrationYears] = useState(1);
  const [contactExtensions, setContactExtensions] = useState<Record<string, unknown>>({});
  const [purchaseUrl, setPurchaseUrl] = useState<string | null>(null);
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
      setPurchaseUrl(current.purchaseUrl);
      if (current.status === 'paid') {
        try {
          const currentRequirements = await jsonFetch<RegistrationRequirements>(
            `/v1/domains/registrations/requirements?domainName=${encodeURIComponent(current.domainName)}`,
          );
          setRequirements(currentRequirements);
          setRegistrationYears(current.registrationYears);
        } catch {
          setRequirements(null);
        }
      }
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
    setRequirements(null);
    setPurchaseUrl(null);
    setOrder(null);
    setContactExtensions({});
    setAcceptedTerms(false);
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
    setRequirements(null);
    setPurchaseUrl(null);
    setOrder(null);
    setAcceptedTerms(false);
    try {
      const [response, currentRequirements] = await Promise.all([
        jsonFetch<Quote>('/v1/domains/registrations/quote', {
          method: 'POST',
          body: JSON.stringify({ domainName }),
        }),
        jsonFetch<RegistrationRequirements>(
          `/v1/domains/registrations/requirements?domainName=${encodeURIComponent(domainName)}`,
        ),
      ]);
      setQuote(response);
      setRequirements(currentRequirements);
      setRegistrationYears(currentRequirements.allowedYears[0] ?? 1);
      setContactExtensions({});
      setRegistrant(emptyRegistrant);
      setSearchTerm(response.domainName);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Could not check current pricing.');
    } finally {
      setBusy(null);
    }
  };

  const startCheckout = async () => {
    if (!quote || !requirements?.supported || !acceptedTerms) return;
    setBusy('checkout');
    try {
      const response = await jsonFetch<{ purchaseUrl: string; order: DomainOrder }>('/v1/domains/registrations/checkout', {
        method: 'POST',
        body: JSON.stringify({
          domainName: quote.domainName,
          registrationYears,
          registrant,
          contactExtensions,
        }),
      });
      setPurchaseUrl(response.purchaseUrl);
      syncOrder(response.order);
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
        body: JSON.stringify({ registrant, contactExtensions }),
      });
      syncOrder(updated);
      if (updated.status === 'registered') {
        setRegistrant(emptyRegistrant);
        setContactExtensions({});
      }
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
    setRegistrant(current => ({
      ...current,
      [field]: field === 'countryCode' ? value.toUpperCase() : value,
    }));
  };
  const setExtensionContact = (name: string, value: unknown) => {
    setContactExtensions(current => ({ ...current, [name]: value }));
  };

  const canRegister = order?.status === 'paid';
  const selectedTermPrice = quote ? termPrice(quote, registrationYears) : null;
  const quoteSupportsCheckout = !!quote &&
    !!requirements?.supported &&
    requirements.allowedYears.includes(registrationYears) &&
    quote.registrable &&
    quote.tier.toLowerCase() !== 'premium' &&
    quote.currency.toUpperCase() === 'USD' &&
    typeof quote.retailPrice === 'number' &&
    typeof quote.renewalRetailPrice === 'number';
  const expiryNotices = (ordersQuery.data ?? []).filter(item => {
    if (item.status !== 'registered' || !item.expiresAt) return false;
    const expiresAt = new Date(item.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt - Date.now() <= 90 * 24 * 60 * 60 * 1000;
  });
  const renderRegistrantFields = () => (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold">Legal registrant details</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          AfuCloud checks these details before checkout but does not save them. They are sent to Cloudflare only when you submit the paid registration.
        </p>
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
      {(requirements?.fields.length ?? 0) > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-background/60 p-3">
          <div>
            <h5 className="text-sm font-medium">Additional {requirements?.extension} registration details</h5>
            <p className="mt-1 text-xs text-muted-foreground">These fields are required by the domain extension’s registry.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {requirements?.fields.map(field => (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={`extension-${field.name}`}>{field.label}{field.required ? ' *' : ''}</Label>
                {field.options?.length ? (
                  <select
                    id={`extension-${field.name}`}
                    value={contactExtensions[field.name] === undefined ? '' : String(contactExtensions[field.name])}
                    onChange={event => {
                      const selected = field.options?.find(option => String(option) === event.target.value);
                      setExtensionContact(field.name, selected ?? '');
                    }}
                    required={field.required}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Choose an option</option>
                    {field.options.map(option => <option key={String(option)} value={String(option)}>{String(option)}</option>)}
                  </select>
                ) : field.type === 'boolean' ? (
                  <select
                      id={`extension-${field.name}`}
                    value={contactExtensions[field.name] === undefined ? '' : String(contactExtensions[field.name])}
                    onChange={event => setExtensionContact(field.name, event.target.value === 'true')}
                    required={field.required}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Choose an option</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                ) : (
                  <Input
                    id={`extension-${field.name}`}
                    type={field.format === 'email' ? 'email' : field.type === 'number' || field.type === 'integer' ? 'number' : 'text'}
                    value={contactExtensions[field.name] === undefined ? '' : String(contactExtensions[field.name])}
                    onChange={event => {
                      const raw = event.target.value;
                      const value = raw === '' ? '' : field.type === 'number' || field.type === 'integer' ? Number(raw) : raw;
                      setExtensionContact(field.name, value);
                    }}
                    required={field.required}
                    minLength={field.minLength ?? undefined}
                    maxLength={field.maxLength ?? undefined}
                    step={field.type === 'integer' ? 1 : undefined}
                  />
                )}
                {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <section className="overflow-hidden rounded-xl border border-card-border bg-card" data-testid="domain-registration">
      <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Globe2 className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">AfuCloud service</p>
          <h2 className="mt-1 text-lg font-semibold">Register a domain</h2>
          <p className="mt-1 text-sm text-muted-foreground">Check a fresh quote for availability, annual prices, supported terms, and registry-required contact details.</p>
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
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{result.domainName}</p>
                    <p className="text-xs text-muted-foreground">
                      {result.available ? 'Search suggestion · confirm live availability before checkout' : result.reason || 'Unavailable for registration'}
                    </p>
                    {result.available && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="text-muted-foreground">First year <strong className="ml-1 text-foreground">{money(result.retailPrice, result.currency)}</strong></span>
                        <span className="text-muted-foreground">Renewal / year <strong className="ml-1 text-foreground">{money(result.renewalRetailPrice, result.currency)}</strong></span>
                      </div>
                    )}
                  </div>
                  {result.available && result.registrable && result.tier.toLowerCase() !== 'premium' && result.currency.toUpperCase() === 'USD' ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void getQuote(result.domainName)} disabled={busy === `quote:${result.domainName}`}>
                      {busy === `quote:${result.domainName}` ? 'Checking…' : result.retailPrice !== null ? 'Review & buy' : 'Check price'}
                    </Button>
                  ) : result.available && result.currency.toUpperCase() !== 'USD' ? (
                    <span className="text-xs text-muted-foreground">Checkout currently supports USD only</span>
                  ) : result.available && result.tier.toLowerCase() === 'premium' ? (
                    <span className="text-xs text-muted-foreground">Premium domains are not available through checkout</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {results.length > 0 && <p className="text-xs text-muted-foreground">Search availability and prices may be cached. The quote step checks current registry availability and prices.</p>}

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
              {quote.registrable && quote.tier.toLowerCase() !== 'premium' && (
                <>
                  <div className="space-y-2 border-t border-border pt-3 text-sm">
                    {requirements?.allowedYears.length === 1 ? (
                      <div className="flex justify-between gap-4">
                        <span className="text-muted-foreground">Registration term</span>
                        <span>{requirements.allowedYears[0]} year{requirements.allowedYears[0] === 1 ? '' : 's'}</span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-4">
                        <Label htmlFor="registration-years" className="text-muted-foreground">Registration term</Label>
                        <select
                          id="registration-years"
                          value={registrationYears}
                          onChange={event => setRegistrationYears(Number(event.target.value))}
                          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {requirements?.allowedYears.map(years => (
                            <option key={years} value={years}>{years} year{years === 1 ? '' : 's'}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Registration for {registrationYears} year{registrationYears === 1 ? '' : 's'}</span>
                      <span>{money(selectedTermPrice?.retailPrice ?? quote.retailPrice, quote.currency)}</span>
                    </div>
                    <div className="flex justify-between gap-4"><span className="text-muted-foreground">Renewal per year</span><span>{money(quote.renewalRetailPrice, quote.currency)}</span></div>
                    <p className="text-xs text-muted-foreground">
                      Prices are based on Cloudflare’s current annual registration and renewal rates plus AfuCloud’s {quote.markupPercent}% service markup. Availability and registration price are checked again after payment; renewal prices can change.
                    </p>
                  </div>
                  {!requirements?.supported && (
                    <p role="status" className="text-sm text-amber-700 dark:text-amber-300">
                      {requirements?.reason || 'AfuCloud could not confirm the registration requirements for this extension.'}
                    </p>
                  )}
                  {quoteSupportsCheckout && (!order || order.domainName !== quote.domainName) ? (
                    <>
                      {renderRegistrantFields()}
                      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={acceptedTerms}
                          onChange={event => setAcceptedTerms(event.target.checked)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                        />
                        <span>I am the legal registrant and understand completed registrations are non-refundable. AfuCloud renewal checkout is not available yet.</span>
                      </label>
                      <Button type="button" className="w-full" onClick={() => void startCheckout()} disabled={!acceptedTerms || busy === 'checkout'}>
                        {busy === 'checkout' ? 'Preparing checkout…' : <>Create secure checkout <ArrowUpRight className="ml-2 h-4 w-4" /></>}
                      </Button>
                    </>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {!requirements?.supported
                        ? requirements?.reason || 'AfuCloud could not confirm the requirements for this extension.'
                        : quote.currency.toUpperCase() !== 'USD'
                          ? 'AfuCloud checkout currently supports USD pricing only.'
                          : 'AfuCloud needs a complete live registration and renewal quote before checkout.'}
                    </p>
                  )}
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

          <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <p>Registration term: <strong className="text-foreground">{order.registrationYears} year{order.registrationYears === 1 ? '' : 's'}</strong></p>
            <p>Registered: <strong className="text-foreground">{displayDate(order.registeredAt)}</strong></p>
            <p>Expires: <strong className="text-foreground">{displayDate(order.expiresAt)}</strong></p>
          </div>

          {order.status === 'pending_payment' && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">Complete payment in Whop, then return here to continue registration.</p>
              {purchaseUrl && (
                <a href={purchaseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  Open secure checkout <ArrowUpRight className="h-4 w-4" />
                </a>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(order.id)} disabled={busy === 'order'}>
                {busy === 'order' ? 'Checking…' : 'Check payment'}
              </Button>
            </div>
          )}

          {canRegister && (
            <form onSubmit={submitRegistrant} className="mt-5 space-y-4">
              {renderRegistrantFields()}
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
          {order.status === 'registered' && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Automatic renewal is off. AfuCloud’s registrar does not currently expose a manual renewal API, so renewal checkout is not available here. Contact AfuCloud before the registrar-confirmed expiry date.
            </p>
          )}
          {order.status === 'manual_review' && <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">Do not place another order for this domain. AfuCloud needs to review the payment or registration result.</p>}
          {order.error && <p className="mt-3 text-sm text-muted-foreground">{order.error}</p>}
        </div>
      )}

      {expiryNotices.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50/70 px-5 py-4 dark:border-amber-900 dark:bg-amber-950/30 sm:px-6" role="status">
          <h3 className="text-sm font-semibold text-amber-950 dark:text-amber-100">Domain expiry reminders</h3>
          <ul className="mt-2 space-y-1 text-xs text-amber-900 dark:text-amber-200">
            {expiryNotices.map(item => {
              const expiry = new Date(item.expiresAt!).getTime();
              const days = Math.ceil((expiry - Date.now()) / (24 * 60 * 60 * 1000));
              return (
                <li key={item.id}>
                  <strong>{item.domainName}</strong> — {days < 0 ? 'expired' : `expires in ${days} day${days === 1 ? '' : 's'}`} ({displayDate(item.expiresAt)}). AfuCloud renewal checkout is not available yet.
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(ordersQuery.data?.length ?? 0) > 0 && (
        <div className="border-t border-border px-5 py-4 sm:px-6">
          <h3 className="text-sm font-semibold">AfuCloud registrations and orders</h3>
          <p className="mt-1 text-xs text-muted-foreground">These are domains purchased through AfuCloud. Connected DNS domains are listed separately above.</p>
          <div className="mt-2 divide-y divide-border">
            {ordersQuery.data!.slice(0, 5).map(item => (
              <div key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.domainName}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.registrationYears} year{item.registrationYears === 1 ? '' : 's'}
                    {item.status === 'registered' ? ` · expires ${displayDate(item.expiresAt)}` : ''}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(item.id)}>
                  {statusLabel(item.status)}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}