import { Hono } from "hono";
import type { AuthVariables, Env } from "../types";
import { createDbClient } from "../lib/db";
import { requireAccountAuth, requireAuth } from "../middleware/auth";

const registrations = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const WHOP_API = "https://api.whop.com/api/v1";
const DEFAULT_MARKUP_PERCENT = 20;
const CHECKOUT_RETURN_URL = "https://cloud.afuchat.com/domains";

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

async function checkDomain(env: Env, hostname: string) {
  const { result } = await cloudflareRequest(env, "/domain-check", "POST", { domains: [hostname] });
  const item = Array.isArray(result) ? result[0] : result?.domains?.[0] ?? result;
  if (!item || typeof item !== "object") throw new ProviderError("Cloudflare returned no availability result.");

  const pricing = item.pricing ?? {};
  const registrationCost = Number(pricing.registration_cost);
  const renewalCost = Number(pricing.renewal_cost);
  const currency = String(pricing.currency ?? "USD").toUpperCase();
  const tier = String(item.tier ?? "standard").toLowerCase();
  const registrable = item.registrable === true;
  const percent = markupPercent(env);

  return {
    domainName: String(item.domain_name ?? item.name ?? hostname),
    registrable,
    tier,
    reason: item.reason ? String(item.reason) : null,
    currency,
    markupPercent: percent,
    registrarCost: Number.isFinite(registrationCost) ? registrationCost : null,
    renewalRegistrarCost: Number.isFinite(renewalCost) ? renewalCost : null,
    retailPrice: Number.isFinite(registrationCost) ? retailPrice(registrationCost, percent) : null,
    renewalRetailPrice: Number.isFinite(renewalCost) ? retailPrice(renewalCost, percent) : null,
  };
}

function providerData(payload: any): any {
  return payload?.data ?? payload?.result ?? payload;
}

async function whopRequest(env: Env, path: string, method: "GET" | "POST", body?: unknown) {
  if (!env.WHOP_API_KEY || !env.WHOP_COMPANY_ID || !env.WHOP_PRODUCT_ID) {
    throw new ProviderError("AfuCloud checkout is not configured yet.", 503);
  }
  const response = await fetch(`${WHOP_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.WHOP_API_KEY}`,
      "Content-Type": "application/json",
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
    currency: order.currency,
    registrarCost: Number(order.registrar_cost),
    renewalRegistrarCost: Number(order.renewal_registrar_cost),
    retailPrice: Number(order.retail_price),
    renewalRetailPrice: Number(order.renewal_retail_price),
    registrationStatus: order.cloudflare_registration_status ?? null,
    expiresAt: order.registration_expires_at ?? null,
    error: order.error_message ?? null,
    createdAt: order.created_at,
  };
}

async function findPaidPayment(env: Env, order: any) {
  if (!order.whop_checkout_configuration_id || !order.whop_plan_id) {
    throw new ProviderError("This order is missing checkout details.", 409);
  }
  const query = new URLSearchParams({
    company_id: env.WHOP_COMPANY_ID!,
    "checkout_configuration_ids[]": order.whop_checkout_configuration_id,
  });
  const payload = await whopRequest(env, `/payments?${query.toString()}`, "GET");
  const payments = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const payment = payments.find((item: any) =>
    item.checkout_configuration_id === order.whop_checkout_configuration_id ||
    item.checkout_configuration?.id === order.whop_checkout_configuration_id,
  );
  if (!payment) return null;

  const planId = payment.plan?.id ?? payment.plan_id;
  if (planId && planId !== order.whop_plan_id) {
    throw new ProviderError("The payment does not match this domain order.", 409);
  }
  const status = String(payment.status ?? payment.state ?? "").toLowerCase();
  if (!["paid", "succeeded", "complete", "completed"].includes(status)) return null;
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
    return await db.updateDomainRegistrationOrder(order.id, userId, {
      status: "registered",
      cloudflare_registration_status: registrationStatus ?? "active",
      registration_expires_at: expiresAt,
      error_message: null,
    }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
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
    return await db.updateDomainRegistrationOrder(order.id, userId, {
      status,
      cloudflare_registration_status: registrationStatus ?? "failed",
      error_message: errorMessage,
    }, "manual_review") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? claimed;
  }

  if (state === "action_required" || state === "blocked") {
    const detail = typeof result?.error?.message === "string" ? ` ${result.error.message}` : "";
    const errorMessage = `Cloudflare requires additional action before registration can finish.${detail}`;
    return await db.updateDomainRegistrationOrder(order.id, userId, {
      status: "manual_review",
      cloudflare_registration_status: registrationStatus ?? state,
      error_message: errorMessage,
    }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
  }

  if (registrationStatus === order.cloudflare_registration_status && !expiresAt) return order;
  return await db.updateDomainRegistrationOrder(order.id, userId, {
    cloudflare_registration_status: registrationStatus ?? "processing",
    registration_expires_at: expiresAt,
  }, "processing") ?? await db.getDomainRegistrationOrder(order.id, userId) ?? order;
}

function validRegistrant(raw: any) {
  if (!raw || typeof raw !== "object") return null;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
  const registrant = {
    email: text(raw.email, 254),
    phone: text(raw.phone, 32),
    name: text(raw.name, 200),
    organization: text(raw.organization, 200),
    street: text(raw.street, 250),
    city: text(raw.city, 120),
    state: text(raw.state, 120),
    postalCode: text(raw.postalCode, 32),
    countryCode: text(raw.countryCode, 2).toUpperCase(),
  };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(registrant.email)) return null;
  if (!/^\+[1-9]\.\d{4,14}$/.test(registrant.phone)) return null;
  if (!registrant.name || !registrant.street || !registrant.city || !registrant.postalCode) return null;
  if (!/^[A-Z]{2}$/.test(registrant.countryCode)) return null;
  return registrant;
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
  if (!query || query.length > 63 || !/^[a-z0-9-]+$/.test(query)) {
    return c.json({ error: "Enter a name using letters, numbers, or hyphens." }, 400);
  }
  try {
    const { result } = await cloudflareRequest(
      c.env,
      `/domain-search?q=${encodeURIComponent(query)}`,
      "GET",
    );
    const results = Array.isArray(result) ? result : result?.domains ?? result?.matches ?? result?.results ?? [];
    return c.json({
      results: results.map((item: any) => ({
        domainName: String(item.domain_name ?? item.name ?? item.domain ?? ""),
        available: item.available === true || item.registrable === true,
        registrable: item.registrable === true,
        tier: item.tier ?? "standard",
        reason: item.reason ?? null,
      })).filter((item: any) => item.domainName),
    });
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Domain search is temporarily unavailable." }, status as 400);
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
  const body = await c.req.json().catch(() => ({})) as { domainName?: unknown };
  const hostname = normalizeDomain(body.domainName);
  if (!hostname) return c.json({ error: "Enter a valid root domain, such as example.com." }, 400);

  const db = createDbClient(c.env);
  try {
    const quote = await checkDomain(c.env, hostname);
    if (!quote.registrable || quote.tier === "premium") {
      return c.json({ error: quote.reason || "This domain cannot be registered through AfuCloud." }, 409);
    }
    if (quote.currency !== "USD" || quote.registrarCost === null || quote.renewalRegistrarCost === null ||
      quote.retailPrice === null || quote.renewalRetailPrice === null) {
      return c.json({ error: "AfuCloud checkout currently supports domains priced in USD only." }, 422);
    }

    const order = await db.createDomainRegistrationOrder({
      user_id: c.get("userId"),
      hostname,
      status: "creating_checkout",
      currency: quote.currency,
      registrar_cost: quote.registrarCost,
      renewal_registrar_cost: quote.renewalRegistrarCost,
      retail_price: quote.retailPrice,
      renewal_retail_price: quote.renewalRetailPrice,
    });
    if (!order?.id) throw new ProviderError("Could not create the domain order.", 500);

    try {
      const plan = await whopRequest(c.env, "/plans", "POST", {
        company_id: c.env.WHOP_COMPANY_ID,
        product_id: c.env.WHOP_PRODUCT_ID,
        initial_price: quote.retailPrice,
        currency: quote.currency.toLowerCase(),
        billing_period: null,
        plan_type: "one_time",
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
  const registrant = validRegistrant(await c.req.json().catch(() => ({})).then((body: any) => body?.registrant));
  if (!registrant) {
    return c.json({ error: "Enter valid legal contact details, including an email, phone, and postal address." }, 400);
  }

  const db = createDbClient(c.env);
  try {
    let order = await db.getDomainRegistrationOrder(c.req.param("orderId"), c.get("userId"));
    if (!order) return c.json({ error: "Domain order not found." }, 404);
    if (order.status === "registered" || order.status === "processing") return c.json(apiOrder(order));

    order = await refreshOrderPayment(c.env, db, order, c.get("userId"));
    if (order.status !== "paid") return c.json({ error: "Payment has not been confirmed by Whop yet." }, 402);

    const claimed = await db.updateDomainRegistrationOrder(
      order.id,
      c.get("userId"),
      { status: "registering", error_message: null },
      "paid",
    );
    if (!claimed) return c.json({ error: "This domain order is already being processed." }, 409);

    const latestQuote = await checkDomain(c.env, order.hostname);
    if (!latestQuote.registrable || latestQuote.tier === "premium") {
      const paymentId = order.whop_payment_id;
      const refunded = paymentId ? await refundWhopPayment(c.env, paymentId) : false;
      const status = refunded ? "refunded" : "manual_review";
      const failed = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
        status,
        error_message: refunded
          ? "The domain became unavailable after payment. Whop confirmed a refund."
          : "The domain became unavailable after payment. AfuCloud must review this order.",
      });
      return c.json(apiOrder(failed ?? { ...order, status }), 409);
    }

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
        years: 1,
        auto_renew: false,
        privacy_mode: "redaction",
        contacts: { registrant: cloudflareContact },
      });
    } catch (error) {
      const definiteFailure = error instanceof ProviderError && error.status < 500 && error.status !== 503;
      if (!definiteFailure) {
        const manual = await db.updateDomainRegistrationOrder(order.id, c.get("userId"), {
          status: "manual_review",
          error_message: "Cloudflare’s registration result could not be confirmed. Do not submit another order; AfuCloud will review it.",
        });
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
      return c.json(apiOrder(failed ?? { ...order, status }), 409);
    }

    const result = registration.result ?? {};
    const registrationInfo = result?.context?.registration ?? result?.registration ?? {};
    const state = String(result?.state ?? result?.status ?? "").toLowerCase();
    const registrarStatus = registrationInfo.status ?? state ?? null;
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
        error_message: errorMessage,
      });
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
      registration_expires_at: expiresAt,
      error_message: nextStatus === "manual_review"
        ? "Cloudflare requires additional action or returned an unrecognized registration state. AfuCloud will review this order."
        : null,
    });
    return c.json(apiOrder(updated ?? { ...order, status: nextStatus }), registration.status === 202 ? 202 : 200);
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : 502;
    return c.json({ error: error instanceof Error ? error.message : "Could not complete domain registration." }, status as 400);
  }
});

export default registrations;