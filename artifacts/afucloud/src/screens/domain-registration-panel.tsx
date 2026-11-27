import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowUpRight, CheckCircle2, CircleAlert, Globe2, LoaderCircle, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { HowItWorksLink } from '@/components/how-it-works-link';
import { useToast } from '@/hooks/use-toast';
import { API_BASE } from '@/lib/api-base';
import { Link } from '@/lib/navigation';
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
    minimum: number | null;
    maximum: number | null;
    multipleOf: number | null;
    pattern: string | null;
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

type PendingRegistrantDetails = {
  savedAt: number;
  termsAccepted: true;
  registrant: Registrant;
  contactExtensions: Record<string, unknown>;
};

const PENDING_REGISTRANT_PREFIX = 'afucloud:domain-registration:';
const PENDING_REGISTRANT_TTL_MS = 30 * 60 * 1000;

function pendingRegistrantKey(orderId: string) {
  return `${PENDING_REGISTRANT_PREFIX}${orderId}`;
}

function savePendingRegistrant(orderId: string, details: Omit<PendingRegistrantDetails, 'savedAt' | 'termsAccepted'>) {
  try {
    const payload: PendingRegistrantDetails = {
      ...details,
      savedAt: Date.now(),
      termsAccepted: true,
    };
    window.sessionStorage.setItem(pendingRegistrantKey(orderId), JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function loadPendingRegistrant(orderId: string): PendingRegistrantDetails | null {
  try {
    const key = pendingRegistrantKey(orderId);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingRegistrantDetails>;
    const person = parsed.registrant;
    if (
      parsed.termsAccepted !== true ||
      typeof parsed.savedAt !== 'number' ||
      Date.now() - parsed.savedAt > PENDING_REGISTRANT_TTL_MS ||
      !person ||
      typeof person.email !== 'string' ||
      typeof person.phone !== 'string' ||
      typeof person.name !== 'string' ||
      typeof person.organization !== 'string' ||
      typeof person.street !== 'string' ||
      typeof person.city !== 'string' ||
      typeof person.state !== 'string' ||
      typeof person.postalCode !== 'string' ||
      typeof person.countryCode !== 'string' ||
      !parsed.contactExtensions ||
      typeof parsed.contactExtensions !== 'object' ||
      Array.isArray(parsed.contactExtensions)
    ) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed as PendingRegistrantDetails;
  } catch {
    return null;
  }
}

function clearPendingRegistrant(orderId: string) {
  try {
    window.sessionStorage.removeItem(pendingRegistrantKey(orderId));
  } catch {
    // Storage is best-effort cleanup; the registration result is already saved by the API.
  }
}

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

type DomainRegistrationPanelProps = {
  registrationPage?: boolean;
  initialDomainName?: string;
};

export function DomainRegistrationPanel({
  registrationPage = false,
  initialDomainName,
}: DomainRegistrationPanelProps = {}) {
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
  const [checkoutOpenInNewTab, setCheckoutOpenInNewTab] = useState(false);
  const [registrationStep, setRegistrationStep] = useState<'registrant' | 'checkout'>('registrant');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [searchError, setSearchError] = useState('');
  const [autoRegistrationError, setAutoRegistrationError] = useState('');
  const searchRequestId = useRef(0);
  const handledInitialRoute = useRef('');
  const autoSubmittedOrders = useRef(new Set<string>());

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
    setAutoRegistrationError('');
    try {
      const current = await jsonFetch<DomainOrder>(`/v1/domains/registrations/orders/${encodeURIComponent(id)}`);
      syncOrder(current);
      setPurchaseUrl(current.purchaseUrl);
      const pendingRegistrant = loadPendingRegistrant(id);
      if (pendingRegistrant) {
        setRegistrant(pendingRegistrant.registrant);
        setContactExtensions(pendingRegistrant.contactExtensions);
      }
      if (current.status === 'paid') {
        try {
          const currentRequirements = await jsonFetch<RegistrationRequirements>(
            `/v1/domains/registrations/requirements?domainName=${encodeURIComponent(current.domainName)}`,
          );
          setRequirements(currentRequirements);
          setRegistrationYears(current.registrationYears);
          if (!currentRequirements.supported) {
            setAutoRegistrationError(currentRequirements.reason || 'AfuCloud cannot safely complete this extension registration.');
          } else if (pendingRegistrant && !autoSubmittedOrders.current.has(id)) {
            autoSubmittedOrders.current.add(id);
            try {
              const updated = await jsonFetch<DomainOrder>(
                `/v1/domains/registrations/orders/${encodeURIComponent(id)}/register`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    registrant: pendingRegistrant.registrant,
                    contactExtensions: pendingRegistrant.contactExtensions,
                  }),
                },
              );
              syncOrder(updated);
              if (['registered', 'processing', 'manual_review', 'registration_failed', 'refunded'].includes(updated.status)) {
                clearPendingRegistrant(id);
              }
              setAutoRegistrationError(updated.error ?? '');
              if (updated.status === 'registered') {
                setRegistrant(emptyRegistrant);
                setContactExtensions({});
              }
            } catch (error) {
              setAutoRegistrationError(
                error instanceof Error
                  ? `Payment is confirmed, but registration did not finish: ${error.message}`
                  : 'Payment is confirmed, but registration did not finish. Retry the form below.',
              );
            }
          }
        } catch {
          setRequirements(null);
          setAutoRegistrationError('Payment is confirmed, but AfuCloud could not reload the extension requirements. Retry the order before submitting.');
        }
      } else if (['registered', 'processing', 'registering', 'manual_review', 'registration_failed', 'refunded'].includes(current.status)) {
        clearPendingRegistrant(id);
      }
    } catch (error) {
      toast({ title: 'Could not load domain order', description: error instanceof Error ? error.message : 'Please try again', variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const searchDomains = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestId = ++searchRequestId.current;
    setBusy('search');
    setSearchError('');
    setResults([]);
    setQuote(null);
    setRequirements(null);
    setPurchaseUrl(null);
    setOrder(null);
    setContactExtensions({});
    setAcceptedTerms(false);
    setRegistrationStep('registrant');
    try {
      const response = await jsonFetch<{ results: SearchResult[] }>(
        `/v1/domains/registrations/search?q=${encodeURIComponent(searchTerm.trim())}`,
      );
      if (requestId !== searchRequestId.current) return;
      const nextResults = Array.isArray(response.results) ? response.results : [];
      setResults(nextResults);
      if (!nextResults.length) setSearchError('No matching domains were returned. Try another name.');
    } catch (error) {
      if (requestId === searchRequestId.current) {
        setSearchError(error instanceof Error ? error.message : 'Search is temporarily unavailable.');
      }
    } finally {
      if (requestId === searchRequestId.current) setBusy(null);
    }
  };

  const getQuote = async (domainName: string) => {
    const requestId = ++searchRequestId.current;
    setBusy(`quote:${domainName}`);
    setSearchError('');
    setQuote(null);
    setRequirements(null);
    setPurchaseUrl(null);
    setOrder(null);
    setAcceptedTerms(false);
    setRegistrationStep('registrant');
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
      if (requestId !== searchRequestId.current) return;
      setQuote(response);
      setRequirements(currentRequirements);
      setRegistrationYears(currentRequirements.allowedYears[0] ?? 1);
      setContactExtensions({});
      setRegistrant(emptyRegistrant);
      setSearchTerm(response.domainName);
    } catch (error) {
      if (requestId === searchRequestId.current) {
        setSearchError(error instanceof Error ? error.message : 'Could not check current pricing.');
      }
    } finally {
      if (requestId === searchRequestId.current) setBusy(null);
    }
  };

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('registrationOrder');
    const domainName = initialDomainName?.trim() ?? '';
    const key = orderId ? `order:${orderId}` : registrationPage && domainName ? `domain:${domainName}` : '';
    if (!key || handledInitialRoute.current === key) return;
    handledInitialRoute.current = key;
    if (orderId) {
      void loadOrder(orderId);
    } else if (domainName) {
      setSearchTerm(domainName);
      void getQuote(domainName);
    }
  }, [registrationPage, initialDomainName]);

  const startCheckout = async () => {
    if (!quote || !requirements?.supported || !acceptedTerms || registrationStep !== 'checkout') return;
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
      const savedForReturn = savePendingRegistrant(response.order.id, {
        registrant,
        contactExtensions,
      });
      if (!savedForReturn) {
        setCheckoutOpenInNewTab(true);
        toast({
          title: 'Keep this page open during checkout',
          description: 'Your browser could not retain the form for the return journey. The order is ready; return to this tab after payment to finish registration.',
          variant: 'destructive',
        });
        setBusy(null);
        return;
      }
      setCheckoutOpenInNewTab(false);
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
        body: JSON.stringify({ registrant, contactExtensions }),
      });
      syncOrder(updated);
      if (['registered', 'processing', 'manual_review', 'registration_failed', 'refunded'].includes(updated.status)) {
        clearPendingRegistrant(order.id);
      }
      setAutoRegistrationError(updated.error ?? '');
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
    setContactExtensions(current => {
      const updated = { ...current };
      if (value === '') delete updated[name];
      else updated[name] = value;
      return updated;
    });
  };

  const canRegister = order?.status === 'paid' && requirements?.supported === true;
  const selectedTermPrice = quote ? termPrice(quote, registrationYears) : null;
  const quoteSupportsCheckout = !!quote &&
    !!requirements?.supported &&
    requirements.allowedYears.includes(registrationYears) &&
    quote.registrable &&
    quote.tier.toLowerCase() !== 'premium' &&
    quote.currency.toUpperCase() === 'USD' &&
    typeof quote.retailPrice === 'number' &&
    typeof quote.renewalRetailPrice === 'number';
  const continueRegistrantDetails = (event: React.FormEvent) => {
    event.preventDefault();
    if (!quoteSupportsCheckout || (order && order.domainName === quote?.domainName)) return;
    setAcceptedTerms(false);
    setRegistrationStep('checkout');
  };
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
          AfuCloud does not store these details. They stay temporarily in this browser session so registration can continue after payment, then are sent to Cloudflare.
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
              data-testid={`input-registrant-${field}`}
              type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
              value={registrant[field]}
              onChange={event => setContact(field, event.target.value)}
              placeholder={placeholder}
              autoComplete={
                field === 'email' ? 'email'
                  : field === 'name' ? 'name'
                    : field === 'phone' ? 'tel'
                      : field === 'street' ? 'street-address'
                        : field === 'city' ? 'address-level2'
                          : field === 'state' ? 'address-level1'
                            : field === 'postalCode' ? 'postal-code'
                              : field === 'countryCode' ? 'country-name'
                                : undefined
              }
              pattern={field === 'phone' ? '[+][1-9][0-9]{0,2}[.][0-9]{4,14}' : field === 'countryCode' ? '[A-Za-z]{2}' : undefined}
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
                    data-testid={`select-extension-${field.name}`}
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
                    data-testid={`select-extension-${field.name}`}
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
                    data-testid={`input-extension-${field.name}`}
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
                    min={field.minimum ?? undefined}
                    max={field.maximum ?? undefined}
                    step={field.type === 'integer' || field.type === 'number'
                      ? field.multipleOf ?? (field.type === 'integer' ? 1 : 'any')
                      : undefined}
                    pattern={field.pattern ?? undefined}
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
          <h2 className="mt-1 text-lg font-semibold">{registrationPage ? 'Complete your domain registration' : 'Find your domain'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {registrationPage
              ? 'Review live availability and pricing, then enter the legal registrant details.'
              : 'Search exact names and available extensions. Select an available domain to continue on its registration page.'}
          </p>
          {registrationPage && (
            <Link href="/domains" className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              <ArrowLeft className="h-4 w-4" />
              Back to available extensions
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(250px,0.8fr)]">
        <div className="space-y-4">
          {!registrationPage && (
            <form onSubmit={searchDomains} className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={searchTerm}
                onChange={event => setSearchTerm(event.target.value)}
                placeholder="example.com or a name to search"
                aria-label="Domain name to search"
                data-testid="input-domain-search"
                required
                maxLength={253}
              />
              <Button type="submit" disabled={busy === 'search'} className="shrink-0" data-testid="button-search-domains">
                {busy === 'search' ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Search
              </Button>
            </form>
          )}

          {searchError && <p role="alert" className="text-sm text-destructive">{searchError}</p>}
          {!registrationPage && results.length > 0 && (
            <div className="divide-y divide-border rounded-lg border border-border">
              <div className="p-3">
                <h3 className="text-sm font-semibold">Available extensions</h3>
                <p className="mt-1 text-xs text-muted-foreground">Names keep your search keyword unchanged. Taken domains are listed but cannot be selected.</p>
              </div>
              {results.map(result => (
                (() => {
                  const canSelect = result.availabilityStatus === 'available' &&
                    result.registrable &&
                    result.tier.toLowerCase() !== 'premium' &&
                    result.currency.toUpperCase() === 'USD' &&
                    typeof result.retailPrice === 'number' &&
                    typeof result.renewalRetailPrice === 'number';
                  const canRetryAvailability = result.availabilityStatus === 'unknown' && result.registrable;
                  const label = result.availabilityStatus === 'taken'
                    ? 'Taken'
                    : result.availabilityStatus === 'unavailable'
                      ? 'Unavailable'
                      : result.availabilityStatus === 'unknown'
                        ? canRetryAvailability ? 'Check availability' : 'Could not verify'
                        : result.currency.toUpperCase() !== 'USD'
                          ? 'USD checkout unavailable'
                          : result.tier.toLowerCase() === 'premium'
                            ? 'Premium registration unavailable'
                            : !canSelect
                              ? 'Pricing unavailable'
                              : 'Available';
                  const detail = result.availabilityStatus === 'unknown'
                    ? 'Check again from the registration page.'
                    : result.availabilityStatus === 'unavailable'
                      ? result.reason || 'This extension cannot be registered through AfuCloud.'
                      : result.availabilityStatus === 'taken'
                        ? 'This domain is already registered or reserved.'
                        : canSelect
                          ? `${money(result.retailPrice, result.currency)} first year · ${money(result.renewalRetailPrice, result.currency)} renewal`
                          : 'This domain cannot be purchased through AfuCloud checkout right now.';

                  return canSelect || canRetryAvailability ? (
                    <Link
                      key={result.domainName}
                      href={`/domains/register?domainName=${encodeURIComponent(result.domainName)}`}
                      data-testid={`link-register-domain-${result.domainName}`}
                      className="flex items-center justify-between gap-3 p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{result.domainName}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        canSelect
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                      }`}>
                        {label}
                      </span>
                    </Link>
                  ) : (
                    <div key={result.domainName} className="flex items-center justify-between gap-3 p-3">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{result.domainName}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{detail}</span>
                      </span>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        result.availabilityStatus === 'taken'
                          ? 'bg-muted text-muted-foreground'
                          : result.availabilityStatus === 'unknown'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {label}
                      </span>
                    </div>
                  );
                })()
              ))}
            </div>
          )}
          {!registrationPage && results.length > 0 && <p className="text-xs text-muted-foreground">Availability is checked live before a domain can be selected. Pricing is confirmed again on the registration page.</p>}

          {registrationPage && !initialDomainName && !order && !new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('registrationOrder') && (
            <p className="text-sm text-muted-foreground">Choose an available domain from the search results to begin registration.</p>
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
                          data-testid="select-registration-years"
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
                    registrationStep === 'registrant' ? (
                      <form onSubmit={continueRegistrantDetails} className="space-y-4" data-testid="form-domain-registrant">
                        {renderRegistrantFields()}
                        <Button type="submit" className="w-full" data-testid="button-continue-to-domain-checkout">
                          Continue to checkout
                        </Button>
                      </form>
                    ) : (
                      <div className="space-y-4 rounded-lg border border-border bg-background/60 p-4" data-testid="panel-domain-checkout-review">
                        <div>
                          <h4 className="font-semibold">Review checkout</h4>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {registrant.name} · {registrant.email} · {registrant.countryCode}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {registrationYears} year{registrationYears === 1 ? '' : 's'} · {money(selectedTermPrice?.retailPrice ?? quote.retailPrice, quote.currency)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            setAcceptedTerms(false);
                            setRegistrationStep('registrant');
                          }}
                          data-testid="button-edit-domain-registrant"
                        >
                          Edit registrant details
                        </Button>
                        <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={acceptedTerms}
                            onChange={event => setAcceptedTerms(event.target.checked)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                            data-testid="checkbox-accept-domain-terms"
                          />
                          <span>I am the legal registrant and understand completed registrations are non-refundable. AfuCloud renewal checkout is not available yet.</span>
                        </label>
                        <Button
                          type="button"
                          className="w-full"
                          onClick={() => void startCheckout()}
                          disabled={!acceptedTerms || busy === 'checkout'}
                          data-testid="button-create-domain-checkout"
                        >
                          {busy === 'checkout' ? 'Preparing checkout…' : <>Create secure checkout <ArrowUpRight className="ml-2 h-4 w-4" /></>}
                        </Button>
                      </div>
                    )
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {!requirements?.supported
                        ? requirements?.reason || 'AfuCloud could not confirm the requirements for this extension.'
                        : quote.currency.toUpperCase() !== 'USD'
                          ? 'AfuCloud checkout currently supports USD pricing only.'
                          : order?.domainName === quote.domainName
                            ? 'Checkout details are shown with your current order below.'
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
          <p className="text-sm text-muted-foreground">Choose a domain, complete the legal registrant form, then review and continue to checkout.</p>
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
              <p className="text-sm text-muted-foreground">Continue payment in Whop. Your registrant form stays in this browser session for the return.</p>
              {purchaseUrl && (
                <a
                  href={purchaseUrl}
                  target={checkoutOpenInNewTab ? '_blank' : undefined}
                  rel={checkoutOpenInNewTab ? 'noopener noreferrer' : undefined}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Open secure checkout <ArrowUpRight className="h-4 w-4" />
                </a>
              )}
              <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(order.id)} disabled={busy === 'order'}>
                {busy === 'order' ? 'Checking…' : 'Check payment'}
              </Button>
            </div>
          )}

          {autoRegistrationError && (
            <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{autoRegistrationError}</p>
          )}
          {order.status === 'paid' && !requirements && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">Payment is confirmed. AfuCloud must reload the registry form before registration can continue.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(order.id)} disabled={busy === 'order'}>
                {busy === 'order' ? 'Loading…' : 'Retry'}
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

      {!registrationPage && (ordersQuery.data?.length ?? 0) > 0 && (
        <div className="border-t border-border p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="font-semibold">Your domain orders</h3>
              <p className="mt-1 text-xs text-muted-foreground">AfuCloud purchases appear here; connected DNS domains are listed separately. Registration dates are shown only when confirmed by Cloudflare.</p>
            </div>
            {ordersQuery.isFetching && <span className="text-xs text-muted-foreground">Refreshing…</span>}
          </div>
          <div className="space-y-3">
            {ordersQuery.data?.map(item => (
              <article key={item.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="break-all font-medium">{item.domainName}</h4>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{statusLabel(item.status)}</span>
                    </div>
                    <div className="mt-2 grid gap-x-5 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <p>Term: <strong className="text-foreground">{item.registrationYears} year{item.registrationYears === 1 ? '' : 's'}</strong></p>
                      <p>Order amount: <strong className="text-foreground">{money(item.retailPrice, item.currency)}</strong></p>
                      <p>Registered: <strong className="text-foreground">{displayDate(item.registeredAt)}</strong></p>
                      <p>Expires: <strong className="text-foreground">{displayDate(item.expiresAt)}</strong></p>
                      <p>Registrar status: <strong className="text-foreground">{item.registrationStatus || 'Not submitted'}</strong></p>
                    </div>
                    {item.status === 'registered' && (
                      <p className="mt-2 text-xs text-muted-foreground">Automatic renewal is off; renewal checkout is not currently available.</p>
                    )}
                    {item.error && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{item.error}</p>}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {item.status === 'pending_payment' && item.purchaseUrl && (
                      <a href={item.purchaseUrl} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                        Open checkout <ArrowUpRight className="h-4 w-4" />
                      </a>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => void loadOrder(item.id)} disabled={busy === 'order'}>
                      {busy === 'order' && order?.id === item.id ? 'Checking…' : item.status === 'paid' ? 'Continue' : 'Refresh status'}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {!registrationPage && ordersQuery.isError && (
        <p role="alert" className="border-t border-border px-5 py-4 text-sm text-destructive sm:px-6">
          Could not load your previous domain orders. Refresh the page to try again.
        </p>
      )}

      {!registrationPage && expiryNotices.length > 0 && (
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

    </section>
  );
}