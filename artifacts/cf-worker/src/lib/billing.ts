import type { Env } from "../types";
import type { createDbClient } from "./db";

type Db = ReturnType<typeof createDbClient>;
export type TierKey = "free" | "pro" | "business";

export const BILLING_TIERS = {
  free: {
    key: "free" as const,
    name: "Free",
    description: "For trying AfuCloud and small projects.",
    monthlyPriceUsd: 0,
    limits: {
      projects: 2,
      storageContainers: 2,
      apiKeys: 3,
      maxFileSizeBytes: 10 * 1024 * 1024,
    },
  },
  pro: {
    key: "pro" as const,
    name: "Pro",
    description: "For individual developers running production projects.",
    monthlyPriceUsd: 12,
    limits: {
      projects: 10,
      storageContainers: 25,
      apiKeys: 50,
      maxFileSizeBytes: 100 * 1024 * 1024,
    },
  },
  business: {
    key: "business" as const,
    name: "Business",
    description: "For teams managing multiple production projects.",
    monthlyPriceUsd: 39,
    limits: {
      projects: 50,
      storageContainers: 100,
      apiKeys: 250,
      maxFileSizeBytes: 250 * 1024 * 1024,
    },
  },
} as const;

const PAID_ACCESS_STATUSES = new Set(["active", "trialing", "past_due", "canceling"]);
const WHOP_API = "https://api.whop.com/api/v1";

export class BillingError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export function isTierKey(value: unknown): value is Exclude<TierKey, "free"> {
  return value === "pro" || value === "business";
}

export function tierForKey(value: unknown) {
  if (value === "pro" || value === "business") return BILLING_TIERS[value];
  return BILLING_TIERS.free;
}

export function hasPaidAccess(status: unknown): boolean {
  return typeof status === "string" && PAID_ACCESS_STATUSES.has(status.toLowerCase());
}

function whopConfigured(env: Env): boolean {
  return Boolean(
    env.WHOP_API_KEY &&
    env.WHOP_COMPANY_ID &&
    env.WHOP_PRODUCT_ID &&
    env.WHOP_PRO_PLAN_ID &&
    env.WHOP_BUSINESS_PLAN_ID,
  );
}

async function whopRequest(env: Env, path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
  if (!whopConfigured(env)) {
    throw new BillingError("AfuCloud billing is not configured yet.", 503);
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
    const message = payload?.error?.message ?? payload?.message;
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new BillingError(
      typeof message === "string" ? message : "Whop could not verify the AfuCloud subscription.",
      status,
    );
  }
  return payload?.data ?? payload?.result ?? payload;
}

function paymentPlanId(payment: any): string | null {
  const planId = payment?.plan?.id ?? payment?.plan_id ?? payment?.line_items?.[0]?.plan_id;
  return typeof planId === "string" ? planId : null;
}

async function findPaidPayment(env: Env, subscription: any): Promise<any | null> {
  if (!subscription.whop_checkout_configuration_id || !subscription.whop_plan_id) return null;

  const query = new URLSearchParams({
    company_id: env.WHOP_COMPANY_ID!,
    "checkout_configuration_ids[]": subscription.whop_checkout_configuration_id,
  });
  const payload = await whopRequest(env, `/payments?${query.toString()}`, "GET");
  const payments = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const payment = payments.find((item: any) =>
    item.checkout_configuration_id === subscription.whop_checkout_configuration_id ||
    item.checkout_configuration?.id === subscription.whop_checkout_configuration_id,
  );
  if (!payment) return null;

  if (payment.company_id && payment.company_id !== env.WHOP_COMPANY_ID) {
    throw new BillingError("The Whop payment belongs to a different account.", 409);
  }
  if (paymentPlanId(payment) !== subscription.whop_plan_id) {
    throw new BillingError("The Whop payment does not match this AfuCloud subscription.", 409);
  }
  const status = String(payment.status ?? payment.state ?? "").toLowerCase();
  if (!["paid", "succeeded", "complete", "completed"].includes(status)) return null;
  return payment;
}

async function verifyMembership(env: Env, membershipId: string, subscription: any): Promise<any> {
  if (!membershipId.startsWith("mem_")) {
    throw new BillingError("Whop returned an invalid membership reference.", 409);
  }
  const membership = await whopRequest(env, `/memberships/${encodeURIComponent(membershipId)}`, "GET");
  const accountId = membership?.account?.id ?? membership?.company?.id;

  if (accountId && accountId !== env.WHOP_COMPANY_ID) {
    throw new BillingError("The membership belongs to a different Whop account.", 409);
  }
  if (membership?.product_id && membership.product_id !== env.WHOP_PRODUCT_ID) {
    throw new BillingError("The membership does not belong to AfuCloud.", 409);
  }
  if (membership?.plan_id && membership.plan_id !== subscription.whop_plan_id) {
    throw new BillingError("The membership does not match the selected AfuCloud plan.", 409);
  }
  if (
    membership?.checkout_configuration_id &&
    subscription.whop_checkout_configuration_id &&
    membership.checkout_configuration_id !== subscription.whop_checkout_configuration_id
  ) {
    throw new BillingError("The membership does not match this AfuCloud checkout.", 409);
  }

  const status = String(membership?.status ?? "unresolved").toLowerCase();
  const allowedStatuses = new Set([
    "active", "trialing", "past_due", "canceling", "paused", "completed",
    "canceled", "expired", "unresolved",
  ]);
  return {
    status: allowedStatuses.has(status) ? status : "unresolved",
    current_period_end: membership?.current_period_end ?? membership?.renewal_period_end ?? null,
    cancel_at_period_end: Boolean(membership?.cancel_at_period_end),
    manage_url: typeof membership?.manage_url === "string" ? membership.manage_url : null,
  };
}

async function persistVerifiedMembership(
  db: Db,
  env: Env,
  userId: string,
  subscription: any,
  membershipId: string,
  paymentId?: string | null,
) {
  const verified = await verifyMembership(env, membershipId, subscription);
  return db.upsertBillingSubscription({
    user_id: userId,
    tier_key: subscription.tier_key,
    status: verified.status,
    whop_plan_id: subscription.whop_plan_id,
    whop_checkout_configuration_id: subscription.whop_checkout_configuration_id,
    whop_membership_id: membershipId,
    whop_payment_id: paymentId ?? subscription.whop_payment_id ?? null,
    current_period_end: verified.current_period_end,
    cancel_at_period_end: verified.cancel_at_period_end,
    manage_url: verified.manage_url,
    updated_at: new Date().toISOString(),
  });
}

/**
 * Whop remains the access authority. Pending checkout records are linked only
 * after Whop reports a paid payment and its membership verifies against the
 * exact account, plan, product, and checkout saved for this AfuCloud user.
 */
export async function resolveSubscription(db: Db, env: Env, userId: string): Promise<any | null> {
  const subscription = await db.getBillingSubscription(userId);
  if (!subscription) return null;

  if (subscription.whop_membership_id) {
    const verified = await verifyMembership(env, subscription.whop_membership_id, subscription);
    return await db.upsertBillingSubscription({
      ...subscription,
      status: verified.status,
      current_period_end: verified.current_period_end,
      cancel_at_period_end: verified.cancel_at_period_end,
      manage_url: verified.manage_url,
      updated_at: new Date().toISOString(),
    });
  }

  const payment = await findPaidPayment(env, subscription);
  if (!payment) return subscription;

  const membershipId = payment.membership_id ?? payment.membership?.id;
  if (typeof membershipId !== "string") return subscription;
  return await persistVerifiedMembership(db, env, userId, subscription, membershipId, payment.id ?? null);
}

export async function getEntitlements(db: Db, env: Env, userId: string) {
  const subscription = await resolveSubscription(db, env, userId);
  const tierKey = hasPaidAccess(subscription?.status) ? subscription.tier_key : "free";
  return { subscription, tier: tierForKey(tierKey), tierKey };
}

export function publicSubscription(subscription: any | null) {
  if (!subscription) return null;
  return {
    tierKey: subscription.tier_key,
    status: subscription.status,
    currentPeriodEnd: subscription.current_period_end ?? null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    manageUrl: subscription.manage_url ?? null,
    checkoutPending: subscription.status === "pending_payment" || subscription.status === "creating_checkout",
  };
}

export async function createSubscriptionCheckout(
  db: Db,
  env: Env,
  userId: string,
  tierKey: Exclude<TierKey, "free">,
): Promise<{ purchaseUrl: string }> {
  if (!whopConfigured(env)) {
    throw new BillingError("AfuCloud checkout is not configured yet.", 503);
  }

  const existing = await resolveSubscription(db, env, userId);
  if (hasPaidAccess(existing?.status)) {
    throw new BillingError("Manage or cancel your current Whop subscription before starting another plan.", 409);
  }

  const planId = tierKey === "pro" ? env.WHOP_PRO_PLAN_ID! : env.WHOP_BUSINESS_PLAN_ID!;
  await db.upsertBillingSubscription({
    user_id: userId,
    tier_key: tierKey,
    status: "creating_checkout",
    whop_plan_id: null,
    whop_checkout_configuration_id: null,
    whop_membership_id: null,
    whop_payment_id: null,
    current_period_end: null,
    cancel_at_period_end: false,
    manage_url: null,
    updated_at: new Date().toISOString(),
  });

  try {
    const redirect = new URL("https://cloud.afuchat.com/settings");
    redirect.searchParams.set("billing", "return");
    const checkout = await whopRequest(env, "/checkout_configurations", "POST", {
      plan_id: planId,
      redirect_url: redirect.toString(),
      metadata: {
        afucloud_user_id: userId,
        afucloud_tier: tierKey,
      },
    });
    if (typeof checkout?.id !== "string" || typeof checkout?.purchase_url !== "string") {
      throw new BillingError("Whop did not return a hosted checkout link.", 502);
    }

    await db.upsertBillingSubscription({
      user_id: userId,
      tier_key: tierKey,
      status: "pending_payment",
      whop_plan_id: planId,
      whop_checkout_configuration_id: checkout.id,
      whop_membership_id: null,
      whop_payment_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      manage_url: null,
      updated_at: new Date().toISOString(),
    });
    return { purchaseUrl: checkout.purchase_url };
  } catch (error) {
    await db.upsertBillingSubscription({
      user_id: userId,
      tier_key: tierKey,
      status: "checkout_failed",
      whop_plan_id: planId,
      whop_checkout_configuration_id: null,
      whop_membership_id: null,
      whop_payment_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
      manage_url: null,
      updated_at: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
}