export type DomainAvailabilityStatus = "available" | "taken" | "unavailable" | "unknown";

export interface ParsedDomainSearchInput {
  keyword: string;
  exactDomain: string | null;
}

export interface DomainSearchQuote {
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
}

export interface DomainSearchResult extends DomainSearchQuote {
  available: boolean;
  availabilityStatus: DomainAvailabilityStatus;
}

interface ActiveDomainOrder {
  hostname?: unknown;
}

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_SUGGESTIONS = 20;

function normalizeRootDomain(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 253) return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  const labels = normalized.split(".");
  if (
    labels.length < 2 ||
    (labels[labels.length - 1]?.length ?? 0) < 2 ||
    labels.some(label => !LABEL_PATTERN.test(label))
  ) return null;
  return normalized;
}

export function parseDomainSearchInput(input: string): ParsedDomainSearchInput | null {
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.length > 253 || /[\/@:#\s]/.test(value)) return null;

  if (value.includes(".")) {
    const exactDomain = normalizeRootDomain(value);
    if (!exactDomain) return null;
    return { keyword: exactDomain.split(".")[0], exactDomain };
  }

  if (value.length > 63 || !LABEL_PATTERN.test(value)) return null;
  return { keyword: value, exactDomain: null };
}

export function domainSearchCandidateNames(
  keyword: string,
  suggestions: unknown[],
  exactDomain: string | null,
): string[] {
  const names = new Set<string>();
  for (const suggestion of suggestions) {
    if (!suggestion || typeof suggestion !== "object") continue;
    const item = suggestion as Record<string, unknown>;
    const name = normalizeRootDomain(item.domain_name ?? item.name ?? item.domain);
    if (!name || name.split(".")[0] !== keyword) continue;
    names.add(name);
    if (names.size >= MAX_SUGGESTIONS) break;
  }
  if (exactDomain) names.add(exactDomain);
  return [...names];
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function amount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function retailPrice(cost: number | null, percent: number): number | null {
  return cost === null ? null : Math.round(cost * (1 + percent / 100) * 100) / 100;
}

function isUnsupportedReason(reason: string | null): boolean {
  return Boolean(reason && /extension_not_supported|extension_disallows|unsupported|registration.*frozen/i.test(reason));
}

function emptyResult(domainName: string, markupPercent: number): DomainSearchResult {
  return {
    domainName,
    available: false,
    availabilityStatus: "unknown",
    registrable: false,
    tier: "standard",
    reason: "Availability could not be confirmed.",
    currency: "USD",
    markupPercent,
    registrarCost: null,
    renewalRegistrarCost: null,
    retailPrice: null,
    renewalRetailPrice: null,
  };
}

function providerSuggestion(item: Record<string, unknown>, markupPercent: number): DomainSearchResult | null {
  const domainName = normalizeRootDomain(item.domain_name ?? item.name ?? item.domain);
  if (!domainName) return null;
  const pricing = item.pricing && typeof item.pricing === "object"
    ? item.pricing as Record<string, unknown>
    : {};
  const registrarCost = amount(pricing.registration_cost);
  const renewalRegistrarCost = amount(pricing.renewal_cost);
  const tier = text(item.tier, "standard").toLowerCase();
  const reason = typeof item.reason === "string" ? item.reason : null;

  return {
    domainName,
    available: false,
    availabilityStatus: "unknown",
    registrable: item.registrable === true || item.available_to_register === true || item.available === true,
    tier,
    reason,
    currency: text(pricing.currency ?? item.currency, "USD").toUpperCase(),
    markupPercent,
    registrarCost,
    renewalRegistrarCost,
    retailPrice: retailPrice(registrarCost, markupPercent),
    renewalRetailPrice: retailPrice(renewalRegistrarCost, markupPercent),
  };
}

function quoteResult(quote: DomainSearchQuote): DomainSearchResult {
  const status: DomainAvailabilityStatus = quote.tier.toLowerCase() === "premium"
    ? "unavailable"
    : quote.registrable
      ? "available"
      : isUnsupportedReason(quote.reason)
        ? "unavailable"
        : "taken";
  return {
    ...quote,
    available: status === "available",
    availabilityStatus: status,
  };
}

export function buildDomainSearchResults(options: {
  keyword: string;
  suggestions: unknown[];
  quotes: DomainSearchQuote[];
  exactDomain: string | null;
  activeOrders: ActiveDomainOrder[];
  markupPercent: number;
  availabilityCheckFailed?: boolean;
}): DomainSearchResult[] {
  const results = new Map<string, DomainSearchResult>();

  for (const suggestion of options.suggestions) {
    if (!suggestion || typeof suggestion !== "object") continue;
    const result = providerSuggestion(suggestion as Record<string, unknown>, options.markupPercent);
    if (!result || result.domainName.split(".")[0] !== options.keyword) continue;
    results.set(result.domainName, result);
  }

  for (const quote of options.quotes) {
    const domainName = normalizeRootDomain(quote.domainName);
    if (!domainName || domainName.split(".")[0] !== options.keyword) continue;
    results.set(domainName, quoteResult({ ...quote, domainName }));
  }

  if (options.exactDomain && !results.has(options.exactDomain)) {
    results.set(options.exactDomain, emptyResult(options.exactDomain, options.markupPercent));
  }

  if (options.availabilityCheckFailed) {
    for (const result of results.values()) {
      result.available = false;
      result.availabilityStatus = "unknown";
      result.reason = "Live availability could not be checked. Select a result to retry.";
    }
  }

  for (const order of options.activeOrders) {
    const hostname = normalizeRootDomain(order.hostname);
    if (!hostname || hostname.split(".")[0] !== options.keyword) continue;
    const result = results.get(hostname) ?? emptyResult(hostname, options.markupPercent);
    results.set(hostname, {
      ...result,
      available: false,
      availabilityStatus: "taken",
      registrable: false,
      reason: "Already purchased or reserved through AfuCloud.",
    });
  }

  return [...results.values()].sort((left, right) => {
    if (left.domainName === right.domainName) return 0;
    if (left.domainName === options.exactDomain) return -1;
    if (right.domainName === options.exactDomain) return 1;
    const rank: Record<DomainAvailabilityStatus, number> = {
      available: 0,
      unknown: 1,
      unavailable: 2,
      taken: 3,
    };
    return rank[left.availabilityStatus] - rank[right.availabilityStatus] ||
      left.domainName.localeCompare(right.domainName);
  });
}
