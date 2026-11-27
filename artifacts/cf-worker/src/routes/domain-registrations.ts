import { Hono } from "hono";
import type { AuthVariables, Env } from "../types";
import { createDbClient } from "../lib/db";
import { enqueueDomainEmail } from "../lib/email-outbox";
import {
  normalizeRegistrant,
  quoteForRegistrationYears,
  registrationRequirements,
  validateContactExtensions,
} from "../lib/domain-registrar";
import {
  buildDomainSearchResults,
  domainSearchCandidateNames,
  parseDomainSearchInput,
  type DomainSearchQuote,
} from "../lib/domain-search";
import { requireAccountAuth, requireAuth } from "../middleware/auth";

const registrations = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const WHOP_API = "https://api.whop.com/api/v1";
// The native payments API removed checkout-configuration filters in 2026-09-02-1.
const WHOP_PAYMENT_LIST_API_VERSION = "2026-08-31";
const DEFAULT_MARKUP_PERCENT = 20;
const CHECKOUT_RETURN_URL = "https://cloud.afuchat.com/domains/register";

registrations.use("*", requireAuth, requireAccountAuth);

class ProviderError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

function normalizeDomain(input: unknown): string {
  if (typeof input !== "string" || input.length > 253) return "";
  const value = input.trim().toLowerCase().replace(/\.$/, "");
  if (!value || value.includes("/") || value.includes("@") || value.includes(":")) return "";
  const labels = value.split(".");
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return "";
  if ((labels.at(-1)?.length ?? 0) < 2) return "";
  return value;
}

function markupPercent(env: Env): number {
  const configured = Number(env.DOMAIN_REGISTRATION_MARKUP_PERCENT ?? DEFAULT_MARKUP_PERCENT);
  return Number.isFinite(configured) && configured >= 0 && configured <= 100
    ? configured
    : DEFAULT_MARKUP_PERCENT;
}

function retailPrice(cost: number, percent: number): number {
  return Math.round(cost * (1 + percent / 100) * 100) / 100;
}

function priceAmount(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

async function cloudflareRequest(env: Env, path: string, method: "GET" | "POST", body?: unknown) {
  if (!env.CLOUDFLARE_REGISTRAR_API_TOKEN) {
    throw new ProviderError("Domain registration is not configured yet.", 503);
  }
  const response = await fetch(`${CLOUDFLARE_API}/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/registrar${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_REGISTRAR_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    result?: any;
  };
  if (!response.ok || payload.success === false) {
    const providerMessage = payload.errors?.map(error => error.message).filter(Boolean).join("; ");
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new ProviderError(providerMessage || "Cloudflare could not complete the domain request.", status);
  }
  return { result: payload.result, status: response.status };
}

async function checkDomains(env: Env, hostnames: string[]): Promise<Array<DomainSearchQuote | null>> {
  const uniqueHostnames = [...new Set(hostnames)];
  if (uniqueHostnames.length === 0) return [];
  const { result } = await cloudflareRequest(env, "/domain-check", "POST", { domains: uniqueHostnames });
  const items = Array.isArray(result)
    ? result
    : Array.isArray(result?.domains)
      ? result.domains
      : Array.isArray(result?.results)
        ? result.results
        : result && typeof result === "object"
          ? [result]
          : [];
  const percent = markupPercent(env);

  return uniqueHostnames.map((hostname, index) => {
    const matchingItem = items.find((candidate: any) =>
      String(candidate?.domain_name ?? candidate?.name ?? "").toLowerCase() === hostname,
    );
    const item = matchingItem ??
      (items.length === uniqueHostnames.length || uniqueHostnames.length === 1 ? items[index] : undefined);
    if (!item || typeof item !== "object") return null;
    const pricing = item.pricing && typeof item.pricing === "object" ? item.pricing : {};
    const registrationCost = priceAmount(pricing.registration_cost);
    const renewalCost = priceAmount(pricing.renewal_cost);
    return {
      domainName: String(item.domain_name ?? item.name ?? hostname),
      registrable: item.registrable === true,
      tier: String(item.tier ?? "standard").toLowerCase(),
      reason: item.reason ? String(item.reason) : null,
      currency: String(pricing.currency ?? "USD").toUpperCase(),
      markupPercent: percent,
      registrarCost: registrationCost,
      renewalRegistrarCost: renewalCost,
      retailPrice: registrationCost === null ? null : retailPrice(registrationCost, percent),
      renewalRetailPrice: renewalCost === null ? null : retailPrice(renewalCost, percent),
    };
  });
}

async function checkDomain(env: Env, hostname: string) {
  const result = (await checkDomains(env, [hostname]))[0];
  if (!result) throw new ProviderError("Cloudflare returned no availability result.");
  return result;
}

function providerData(payload: any): any {
  return payload?.data ?? payload?.result ?? payload;
}

async function whopRequest(
  env: Env,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  apiVersionDate?: string,
) {
  if (!env.WHOP_API_KEY || !env.WHOP_COMPANY_ID || !env.WHOP_PRODUCT_ID) {
    throw new ProviderError("AfuCloud checkout is not configured yet.", 503);
  }
  const response = await fetch(`${WHOP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.WHOP_API_KEY}`,
      "Content-Type": "application/json",
      ...(apiVersionDate ? { "Api-Version-Date": apiVersionDate } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new ProviderError(
      typeof payload?.message === "string" ? payload.message : "AfuCloud checkout could not be completed.",
    );
  }
  return providerData(payload);
}

function apiOrder(order: any) {
  return {
    id: order.id,
    domainName: order.hostname,
    status: order.status,
    registrationYears: Number(order.registration_years ?? 1),
    purchaseUrl: order.whop_purchase_url ?? null,
    currency: order.currency,
    registrarCost: Number(order.registrar_cost),
    renewalRegistrarCost: Number(order.renewal_registrar_cost),
    retailPrice: Number(order.retail_price),
    renewalRetailPrice: Number(order.renewal_retail_price),
    registrationStatus: order.cloudflare_registration_status ?? null,
    registeredAt: order.registration_created_at ?? null,
    expiresAt: order.registration_expires_at ?? null,
    error: order.error_message ?? null,
    createdAt: order.created_at,
  };
}

async function queueRegistrationEmail(
  db: ReturnType<typeof createDbClient>,
  userId: string,
  order: any,
): Promise<void> {
  const template = order?.status === "registered"
    ? "domain_registered"
    : order?.status === "manual_review"
      ? "domain_registration_review"
      : order?.status === "refunded"
        ? "domain_registration_refunded"
        : null;
  if (!template || typeof order?.id !== "string" || typeof order?.hostname !== "string") return;

  try {
    await enqueueDomainEmail(
      db,
      userId,
      order.hostname,
      template,
      `domain-registration:${order.id}:${order.status}`,
      {
        registrationYears: Number(order.registration_years ?? 1),
        expiresAt: order.registration_expires_at ?? null,
      },
    );
  } catch {
    console.error("[AfuCloud Email] domain registration message could not be queued", {
      orderId: order.id,
      status: order.status,
    });
  }
}

async function getExtensionRequirements(env: Env, hostname: string) {
  const labels = hostname.split(".");
  const candidates = [...new Set([labels.slice(-2).join("."), labels.at(-1)].filter(
    (candidate): candidate is string => Boolean(candidate),
  ))];
  let extensionResult: any = null;
  let extensionName = "";

  for (const candidate of candidates) {
    try {
      const response = await cloudflareRequest(
        env,
        `/extensions/${encodeURIComponent(candidate)}`,
        "GET",
      );
      extensionResult = response.result;
      extensionName = String(extensionResult?.metadata?.name ?? candidate).toLowerCase();
      break;
    } catch (error) {
      if (!(error instanceof ProviderError) || error.status !== 404) throw error;
    }
  }

  if (!extensionResult) {
    throw new ProviderError("Cloudflare did not publish registration requirements for this domain extension.", 422);
  }
  const requirements = registrationRequirements(extensionName, extensionResult.registration_schema);
  return {
    supported: requirements.supported,
    reason: requirements.reason,
    extension: requirements.extension,
    allowedYears: requirements.allowedYears,
    fields: requirements.fields,
    contactExtensionsSchema: requirements.contactExtensionsSchema,
  };
}

async function getActiveOrRegisteredOrder(db: ReturnType<typeof createDbClient>, hostname: string) {
  const orders = await db.getActiveDomainRegistrationOrdersByHostname(hostname);
  return orders[0] ?? null;
}

async function findPaidPayment(env: Env, order: any) {
  if (!order.whop_checkout_configuration_id || !order.whop_plan_id) {
    throw new ProviderError("This order is missing checkout details.", 409);
  }
  const query = new URLSearchParams({
    company_id: env.WHOP_COMPANY_ID!,
    "checkout_configuration_ids[]": order.whop_checkout_configuration_id,
  });
  const payload = await whopRequest(
    env,
    `/payments?${query.toString()}`,
    "GET",
    undefined,
    WHOP_PAYMENT_LIST_API_VERSION,
  );
  const payments = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const payment = payments.find((item: any) =>
    item.checkout_configuration_id === order.whop_checkout_configuration_id ||
    item.checkout_configuration?.id === order.whop_checkout_configuration_id,
  );
  if (!payment) return null;

  const accountId = payment.company?.id
    ?? payment.account?.id
    ?? payment.account_id
    ?? payment.company_id;
  if (accountId && accountId !== env.WHOP_COMPANY_ID) {
    throw new ProviderError("The Whop payment belongs to a different account.", 409);
  }
  const planId = payment.plan?.id ?? payment.plan_id;
  if (planId !== order.whop_plan_id) {
    throw new ProviderError("The payment does not match this domain order.", 409);
  }
  const status = String(payment.status ?? payment.state ?? "").toLowerCase();
  const substatus = String(payment.substatus ?? "").toLowerCase();
  if (!["paid", "succeeded", "complete", "completed"].includes(status) &&
    substatus !== "succeeded" && !payment.paid_at) return null;
  return payment;
}

async function refreshOrderPayment(env: Env, db: ReturnType<typeof createDbClient>, order: any, userId: string) {
  if (order.status !== "pending_payment" && order.status !== "creating_checkout") return order;
  const payment = await findPaidPayment(env, order);
  if (!payment) return order;
  return await db.updateDomainRegistrationOrder(order.id, userId, {
    status: "paid",
    whop_payment_id: payment.id ?? null,
    error_message: null,
  }) ?? { ...order, status: "paid", whop_payment_id: payment.id ?? null };
}

async function refreshRegistrationStatus(env: Env, db: ReturnType<typeof createDbClient>, order: any, userId: string) {
  if (order.status !== "processing") return order;

  const { result } = await cloudflareRequest(
    env,
    `/registrations/${encodeURIComponent(order.hostname)}/registration-status`,
    "GET",
  );
  const registration = result?.context?.registration ?? result?.registration ?? {};
  const state = String(result?.state ?? result?.status ?? "").toLowerCase();
  const registrationStatus = registration.status ?? state ?? order.cloudflare_registration_status;
  const expiresAt = registration.expires_at ?? result?.expires_at ?? result?.expiration_date ?? null;

  if (state === "succeeded" || String(registration.status ?? "").toLowerCase() === "active") {
    const updated = await db.updateDomainRegistrationOrder(order.id, userId, {
      status: "registered",
      cloudflare_registration_status: registrationStatus ?? "active",
      registration_created_at: registration.created_at ?? result?.created_at ?? null,
      registration_expires_at: expiresAt,
      error_message: null,
    }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
    await queueRegistrationEmail(db, userId, updated);
    return updated;
  }

  if (state === "failed") {
    const claimed = await db.updateDomainRegistrationOrder(order.id, userId, {
      status: "manual_review",
      cloudflare_registration_status: registrationStatus ?? "failed",
      error_message: "Cloudflare reported that registration failed. AfuCloud is checking the payment refund.",
    }, "processing");
    if (!claimed) return await db.getDomainRegistrationOrder(order.id, userId) ?? order;

    const paymentId = order.whop_payment_id;
    const refunded = paymentId ? await refundWhopPayment(env, paymentId) : false;
    const status = refunded ? "refunded" : "manual_review";
    const errorMessage = refunded
      ? "Cloudflare could not complete the registration. Whop confirmed a refund."
      : "Cloudflare could not complete the registration and AfuCloud could not confirm a refund. Support review is required.";
    const updated = await db.updateDomainRegistrationOrder(order.id, userId, {
      status,
      cloudflare_registration_status: registrationStatus ?? "failed",
      error_message: errorMessage,
    }, "manual_review") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? claimed;
    await queueRegistrationEmail(db, userId, updated);
    return updated;
  }

  if (state === "action_required" || state === "blocked") {
    const detail = typeof result?.error?.message === "string" ? ` ${result.error.message}` : "";
    const errorMessage = `Cloudflare requires additional action before registration can finish.${detail}`;
    const updated = await db.updateDomainRegistrationOrder(order.id, userId, {
      status: "manual_review",
      cloudflare_registration_status: registrationStatus ?? state,
      error_message: errorMessage,
    }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
    await queueRegistrationEmail(db, userId, updated);
    return updated;
  }

  if (registrationStatus === order.cloudflare_registration_status && !expiresAt) return order;
  return await db.updateDomainRegistrationOrder(order.id, userId, {
    cloudflare_registration_status: registrationStatus ?? "processing",
    registration_created_at: registration.created_at ?? result?.created_at ?? null,
    registration_expires_at: expiresAt,
  }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
}

async function refundWhopPayment(env: Env, paymentId: string): Promise<boolean> {
  try {
    await whopRequest(env, `/payments/${encodeURIComponent(paymentId)}/refund`, "POST", {});
    return true;
  } catch {
    return false;
  }
}

registrations.get("/search", async (c) => {
  const query = (c.req.query("q") ?? "").trim().toLowerCase();
  const parsed = parseDomainSearchInput(query);
  if (!parsed) {
    return c.json({ error: "Enter a name using letters, numbers, or hyphens." }, 400);
  }
  try {
    let suggestions: unknown[] = [];
    let searchError: unknown = null;
    try {
      const response = await cloudflareRequest(
        c.env,
        `/domain-search?q=${encodeURIComponent(parsed.keyword)}`,
        "GET",
      );
      const result = response.result;
      const candidates = Array.isArray(result)
        ? result
        : result?.domains ?? result?.matches ?? result?.results ?? [];
      suggestions = Array.isArray(candidates) ? candidates : [];
    } catch (error) {
      searchError = error;
    }

    const candidateNames = domainSearchCandidateNames(parsed.keyword, suggestions, parsed.exactDomain);
    let quotes: DomainSearchQuote[] = [];
    let availabilityCheckFailed = false;
    if (candidateNames.length > 0) {
      try {
        quotes = (await checkDomains(c.env, candidateNames))
          .filter((quote): quote is DomainSearchQuote => quote !== null);
      } catch {
        availabilityCheckFailed = true;
      }
    }
    const db = createDbClient(c.env);
    const [prefixOrders, exactOrders] = await Promise.all([
      db.getActiveDomainRegistrationOrdersByPrefix(parsed.keyword),
      parsed.exactDomain
        ? db.getActiveDomainRegistrationOrdersByHostname(parsed.exactDomain)
        : Promise.resolve([]),
    ]);
    const activeOrders = [...prefixOrders, ...exactOrders];

    if (searchError && suggestions.length === 0 && !parsed.exactDomain && activeOrders.length === 0) {
      throw searchError;
    }
    if (searchError && candidateNames.length === 0 && activeOrders.length === 0) {
      throw searchError;
    }

    return c.json({
      results: buildDomainSearchResults({
        keyword: parsed.keyword,
        suggestions,
        quotes,
        exactDomain: parsed.exactDomain,
        activeOrders,
        markupPercent: markupPercent(c.env),
        availabilityCheckFailed,
      }),
    });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Domain search is temporarily unavailable." }, status as 400);
  }
});

registrations.get("/requirements", async (c) => {
  const hostname = normalizeDomain(c.req.query("domainName"));
  if (!hostname) return c.json({ error: "Enter a valid root domain, such as example.com." }, 400);
  try {
    const requirements = await getExtensionRequirements(c.env, hostname);
    return c.json({
      supported: requirements.supported,
      reason: requirements.reason,
      extension: requirements.extension,
      allowedYears: requirements.allowedYears,
      fields: requirements.fields,
    });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not load extension requirements." }, status as 400);
  }
});

registrations.post("/quote", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { domainName?: unknown };
  const hostname = normalizeDomain(body.domainName);
  if (!hostname) return c.json({ error: "Enter a valid root domain, such as example.com." }, 400);
  try {
    return c.json(await checkDomain(c.env, hostname));
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not check domain pricing." }, status as 400);
  }
});

registrations.post("/checkout", async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    domainName?: unknown;
    registrationYears?: unknown;
    registrant?: unknown;
    contactExtensions?: unknown;
  };
  const hostname = normalizeDomain(body.domainName);
  if (!hostname) return c.json({ error: "Enter a valid root domain, such as example.com." }, 400);
  const registrant = normalizeRegistrant(body.registrant);
  if (!registrant) {
    return c.json({ error: "Complete valid legal registrant details before checkout." }, 400);
  }

  const db = createDbClient(c.env);
  try {
    const existingOrder = await getActiveOrRegisteredOrder(db, hostname);
    if (existingOrder) {
      if (existingOrder.user_id === c.get("userId") &&
        existingOrder.status === "pending_payment" &&
        existingOrder.whop_purchase_url) {
        return c.json({ order: apiOrder(existingOrder), purchaseUrl: existingOrder.whop_purchase_url });
      }
      const message = existingOrder.user_id === c.get("userId") && existingOrder.status === "registered"
        ? "This domain is already registered on this AfuCloud account."
        : "A registration order for this domain is already active. Try again after it is resolved.";
      return c.json({
        error: message,
        ...(existingOrder.user_id === c.get("userId") ? { order: apiOrder(existingOrder) } : {}),
      }, 409);
    }

    const requirements = await getExtensionRequirements(c.env, hostname);
    if (!requirements.supported) {
      return c.json({ error: requirements.reason || "AfuCloud cannot safely register this extension yet." }, 422);
    }
    const years = Number(body.registrationYears);
    if (!Number.isInteger(years) || !requirements.allowedYears.includes(years)) {
      return c.json({ error: "Choose a registration term supported for this extension." }, 400);
    }
    const contactExtensions = validateContactExtensions(
      requirements.contactExtensionsSchema,
      body.contactExtensions,
    );
    if (!contactExtensions.valid) return c.json({ error: contactExtensions.error }, 400);

    const quote = await checkDomain(c.env, hostname);
    if (!quote.registrable || quote.tier === "premium") {
      return c.json({ error: quote.reason || "This domain cannot be registered through AfuCloud." }, 409);
    }
    if (quote.currency !== "USD" || quote.registrarCost === null || quote.renewalRegistrarCost === null ||
      quote.retailPrice === null || quote.renewalRetailPrice === null) {
      return c.json({ error: "AfuCloud checkout currently supports domains priced in USD only." }, 422);
    }
    const termPrice = quoteForRegistrationYears(
      quote.registrarCost,
      quote.renewalRegistrarCost,
      years,
      quote.markupPercent,
    );

    let order: any;
    try {
      order = await db.createDomainRegistrationOrder({
        user_id: c.get("userId"),
        hostname,
        status: "creating_checkout",
        registration_years: years,
        currency: quote.currency,
        registrar_cost: termPrice.registrarCost,
        renewal_registrar_cost: termPrice.renewalRegistrarCost,
        retail_price: termPrice.retailPrice,
        renewal_retail_price: termPrice.renewalRetailPrice,
      });
    } catch (error) {
      const concurrentOrder = await getActiveOrRegisteredOrder(db, hostname).catch(() => null);
      if (concurrentOrder?.user_id === c.get("userId") &&
        concurrentOrder.status === "pending_payment" &&
        concurrentOrder.whop_purchase_url) {
        return c.json({ order: apiOrder(concurrentOrder), purchaseUrl: concurrentOrder.whop_purchase_url });
      }
      if (concurrentOrder) {
        return c.json({ error: "A registration order for this domain is already active. Try again after it is resolved." }, 409);
      }
      throw error;
    }
    if (!order?.id) throw new ProviderError("Could not create the domain order.", 500);

    try {
      const plan = await whopRequest(c.env, "/plans", "POST", {
        account_id: c.env.WHOP_COMPANY_ID,
        product_id: c.env.WHOP_PRODUCT_ID,
        initial_price: termPrice.retailPrice,
        currency: quote.currency.toLowerCase(),
        plan_type: "one_time",
        title: `Domain registration: ${hostname} (${years} year${years === 1 ? "" : "s"})`,
        description: `One-time purchase for registering ${hostname} for ${years} year${years === 1 ? "" : "s"} through AfuCloud.`,
      });
      const planId = plan?.id;
      if (!planId) throw new ProviderError("Whop did not return a payment plan.");

      const redirect = new URL(CHECKOUT_RETURN_URL);
      redirect.searchParams.set("registrationOrder", order.id);
      const checkout = await whopRequest(c.env, "/checkout_configurations", "POST", {
        plan_id: planId,
        redirect_url: redirect.toString(),
        metadata: { afucloud_domain_order_id: order.id },
      });
      if (!checkout?.id || !checkout?.purchase_url) {
        throw new ProviderError("Whop did not return a hosted checkout link.");
      }

      const updated = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status: "pending_payment",
        whop_plan_id: planId,
        whop_checkout_configuration_id: checkout.id,
        whop_purchase_url: checkout.purchase_url,
      });
      if (!updated) throw new ProviderError("Could not save the checkout link.", 500);

      return c.json({
        order: apiOrder(updated),
        purchaseUrl: checkout.purchase_url,
      }, 201);
    } catch (error) {
      await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status: "checkout_failed",
        error_message: "Checkout could not be started. No domain registration was submitted.",
      });
      throw error;
    }
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not start checkout." }, status as 400);
  }
});

registrations.get("/orders", async (c) => {
  try {
    const db = createDbClient(c.env);
    const orders = await db.getDomainRegistrationOrders(c.get("userId"));
    return c.json(orders.map(apiOrder));
  } catch {
    return c.json({ error: "Could not load domain registrations." }, 502);
  }
});

registrations.get("/orders/:orderId", async (c) => {
  const db = createDbClient(c.env);
  try {
    const order = await db.getDomainRegistrationOrder(c.req.param("orderId"), c.get("userId"));
    if (!order) return c.json({ error: "Domain order not found." }, 404);
    let current = await refreshOrderPayment(c.env, db, order, c.get("userId"));
    current = await refreshRegistrationStatus(c.env, db, current, c.get("userId"));
    return c.json(apiOrder(current));
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not retrieve domain order." }, status as 400);
  }
});

registrations.post("/orders/:orderId/register", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { registrant?: unknown; contactExtensions?: unknown };
  const registrant = normalizeRegistrant(body.registrant);
  if (!registrant) {
    return c.json({ error: "Enter valid legal contact details, including an email, phone, and postal address." }, 400);
  }

  const db = createDbClient(c.env);
  let claimedOrderId: string | null = null;
  try {
    let order = await db.getDomainRegistrationOrder(c.req.param("orderId"), c.get("userId"));
    if (!order) return c.json({ error: "Domain order not found." }, 404);
    if (order.status === "registered" || order.status === "processing") {
      await queueRegistrationEmail(db, c.get("userId"), order);
      return c.json(apiOrder(order));
    }

    order = await refreshOrderPayment(c.env, db, order, c.get("userId"));
    if (order.status !== "paid") return c.json({ error: "Payment has not been confirmed by Whop yet." }, 402);

    const requirements = await getExtensionRequirements(c.env, order.hostname);
    if (!requirements.supported || !requirements.allowedYears.includes(Number(order.registration_years ?? 1))) {
      return c.json({ error: requirements.reason || "AfuCloud could not confirm this registration term." }, 422);
    }
    const contactExtensions = validateContactExtensions(
      requirements.contactExtensionsSchema,
      body.contactExtensions,
    );
    if (!contactExtensions.valid) return c.json({ error: contactExtensions.error }, 400);

    const claimed = await db.updateDomainRegistrationOrder(
      order.id,
      c.get("userId"),
      { status: "registering", error_message: null },
      "paid",
    );
    if (!claimed) return c.json({ error: "This domain order is already being processed." }, 409);
    claimedOrderId = order.id;

    const latestQuote = await checkDomain(c.env, order.hostname);
    const termYears = Number(order.registration_years ?? 1);
    const currentTermPrice = latestQuote.registrarCost !== null && latestQuote.renewalRegistrarCost !== null
      ? quoteForRegistrationYears(latestQuote.registrarCost, latestQuote.renewalRegistrarCost, termYears, latestQuote.markupPercent)
      : null;
    const quoteChanged = !latestQuote.registrable ||
      latestQuote.tier === "premium" ||
      latestQuote.currency !== order.currency ||
      !currentTermPrice ||
      Math.round(currentTermPrice.registrarCost * 100) !== Math.round(Number(order.registrar_cost) * 100) ||
      Math.round(currentTermPrice.retailPrice * 100) !== Math.round(Number(order.retail_price) * 100);
    if (quoteChanged) {
      const paymentId = order.whop_payment_id;
      const refunded = paymentId ? await refundWhopPayment(c.env, paymentId) : false;
      const status = refunded ? "refunded" : "manual_review";
      const failed = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status,
        error_message: refunded
          ? "The domain became unavailable or its registration price changed after payment. Whop confirmed a refund."
          : "The domain became unavailable or its registration price changed after payment. AfuCloud must review this order.",
      });
      await queueRegistrationEmail(db, c.get("userId"), failed ?? { ...order, status });
      return c.json(apiOrder(failed ?? { ...order, status }), 409);
    }

    await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
      renewal_registrar_cost: currentTermPrice!.renewalRegistrarCost,
      renewal_retail_price: currentTermPrice!.renewalRetailPrice,
    }, "registering");

    const cloudflareContact = {
      email: registrant.email,
      phone: registrant.phone,
      postal_info: {
        name: registrant.name,
        ...(registrant.organization ? { organization: registrant.organization } : {}),
        address: {
          street: registrant.street,
          city: registrant.city,
          state: registrant.state,
          postal_code: registrant.postalCode,
          country_code: registrant.countryCode,
        },
      },
    };

    let registration: { result: any; status: number };
    try {
      registration = await cloudflareRequest(c.env, "/registrations", "POST", {
        domain_name: order.hostname,
        years: termYears,
        auto_renew: false,
        privacy_mode: "redaction",
        contacts: { registrant: cloudflareContact },
        ...(requirements.contactExtensionsSchema ? { contact_extensions: contactExtensions.values } : {}),
      });
    } catch (error) {
      const definiteFailure = error instanceof ProviderError && error.status < 500 && error.status !== 503;
      if (!definiteFailure) {
        const manual = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
          status: "manual_review",
          error_message: "Cloudflare’s registration result could not be confirmed. Do not submit another order; AfuCloud will review it.",
        });
        await queueRegistrationEmail(db, c.get("userId"), manual ?? { ...order, status: "manual_review" });
        return c.json(apiOrder(manual ?? { ...order, status: "manual_review" }), 202);
      }
      const paymentId = order.whop_payment_id;
      const refunded = paymentId ? await refundWhopPayment(c.env, paymentId) : false;
      const status = refunded ? "refunded" : "manual_review";
      const failed = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status,
        error_message: refunded
          ? "Cloudflare rejected the registration. Whop confirmed a refund."
          : "Cloudflare rejected the registration and AfuCloud could not confirm a refund. Support review is required.",
      });
      await queueRegistrationEmail(db, c.get("userId"), failed ?? { ...order, status });
      return c.json(apiOrder(failed ?? { ...order, status }), 409);
    }

    const result = registration.result ?? {};
    const registrationInfo = result?.context?.registration ?? result?.registration ?? {};
    const state = String(result?.state ?? result?.status ?? "").toLowerCase();
    const registrarStatus = registrationInfo.status ?? state ?? null;
    const registeredAt = registrationInfo.created_at ?? result.created_at ?? null;
    const expiresAt = registrationInfo.expires_at ?? result.expires_at ?? result.expiration_date ?? null;

    if (state === "failed") {
      const paymentId = order.whop_payment_id;
      const refunded = paymentId ? await refundWhopPayment(c.env, paymentId) : false;
      const status = refunded ? "refunded" : "manual_review";
      const errorMessage = refunded
        ? "Cloudflare could not complete the registration. Whop confirmed a refund."
        : "Cloudflare could not complete the registration and AfuCloud could not confirm a refund. Support review is required.";
      const failed = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status,
        cloudflare_registration_status: registrarStatus ?? "failed",
        registration_created_at: registeredAt,
        error_message: errorMessage,
      });
      await queueRegistrationEmail(db, c.get("userId"), failed ?? { ...order, status });
      return c.json(apiOrder(failed ?? { ...order, status, error_message: errorMessage }), 409);
    }

    const nextStatus = state === "succeeded" || String(registrationInfo.status ?? "").toLowerCase() === "active"
      ? "registered"
      : state === "action_required" || state === "blocked"
        ? "manual_review"
        : registration.status === 202 || state === "in_progress"
          ? "processing"
          : "manual_review";
    const updated = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
      status: nextStatus,
      cloudflare_registration_id: result.id ?? result.domain_name ?? order.hostname,
      cloudflare_registration_status: registrarStatus ?? nextStatus,
      registration_created_at: registeredAt,
      registration_expires_at: expiresAt,
      error_message: nextStatus === "manual_review"
        ? "Cloudflare requires additional action or returned an unrecognized registration state. AfuCloud will review this order."
        : null,
    });
    await queueRegistrationEmail(db, c.get("userId"), updated ?? { ...order, status: nextStatus });
    return c.json(apiOrder(updated ?? { ...order, status: nextStatus }), registration.status === 202 ? 202 : 200);
  } catch (error) {
    if (claimedOrderId) {
      const reviewed = await db.updateDomainRegistrationOrder(
        claimedOrderId,
        c.get("userId"),
        {
          status: "manual_review",
          error_message: "The registration result could not be confirmed. Do not place another order; AfuCloud will review it.",
        },
        "registering",
      ).catch(() => null);
      await queueRegistrationEmail(db, c.get("userId"), reviewed);
    }
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not complete domain registration." }, status as 400);
  }
});

export default registrations;