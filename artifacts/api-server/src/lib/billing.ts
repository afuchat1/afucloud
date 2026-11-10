import { count, eq } from "drizzle-orm";
import {
  apiKeysTable,
  billingSubscriptionsTable,
  db,
  projectsTable,
  storageContainersTable,
} from "@workspace/db";

type PaidTierKey = "pro" | "business";
type BillingEnvironment = Record<string, string | undefined>;
type SubscriptionRow = typeof billingSubscriptionsTable.$inferSelect;

const WHOP_API = "https://api.whop.com/api/v1";
const WHOP_PAYMENT_LIST_API_VERSION = "2026-08-31";
const PAID_ACCESS_STATUSES = new Set(["active", "trialing", "past_due", "canceling"]);

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

export class BillingError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "BillingError";
  }
}

export function isTierKey(value: unknown): value is PaidTierKey {
  return value === "pro" || value === "business";
}

function hasPaidAccess(status: unknown): boolean {
  return typeof status === "string" && PAID_ACCESS_STATUSES.has(status.toLowerCase());
}

function billingConfigured(env: BillingEnvironment): boolean {
  return Boolean(
    env.WHOP_API_KEY &&
    env.WHOP_COMPANY_ID &&
    env.WHOP_PRODUCT_ID &&
    env.WHOP_PRO_PLAN_ID &&
    env.WHOP_BUSINESS_PLAN_ID,
  );
}

async function whopRequest(
  env: BillingEnvironment,
  path: string,
  method: "GET" | "POST",
  body?: unknown,
  apiVersionDate?: string,
  keepEnvelope = false,
): Promise<any> {
  if (!billingConfigured(env)) {
    throw new BillingError("AfuCloud billing is not configured yet.", 503);
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
    const message = payload?.error?.message ?? payload?.message;
    const status = response.status >= 400 && response.status < 500 ? response.status : 502;
    throw new BillingError(
      typeof message === "string" ? message : "Whop could not verify the AfuCloud subscription.",
      status,
    );
  }
  if (keepEnvelope) return payload;
  return payload?.data ?? payload?.result ?? payload;
}

function paymentPlanId(payment: any): string | null {
  const planId = payment?.plan?.id ?? payment?.plan_id ?? payment?.line_items?.[0]?.plan_id;
  return typeof planId === "string" ? planId : null;
}

function membershipAccountId(membership: any): string | null {
  const id = membership?.account?.id
    ?? membership?.company?.id
    ?? membership?.account_id
    ?? membership?.company_id;
  return typeof id === "string" ? id : null;
}

function membershipProductId(membership: any): string | null {
  const id = membership?.product?.id ?? membership?.product_id;
  return typeof id === "string" ? id : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

async function getSubscription(userId: string): Promise<SubscriptionRow | null> {
  const [subscription] = await db
    .select()
    .from(billingSubscriptionsTable)
    .where(eq(billingSubscriptionsTable.userId, userId))
    .limit(1);
  return subscription ?? null;
}

async function saveSubscription(input: {
  userId: string;
  tierKey: PaidTierKey;
  status: string;
  whopPlanId: string | null;
  whopCheckoutConfigurationId: string | null;
  whopMembershipId: string | null;
  whopPaymentId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  manageUrl: string | null;
}): Promise<SubscriptionRow | null> {
  const updatedAt = new Date();
  const { userId, ...values } = input;
  const [subscription] = await db
    .insert(billingSubscriptionsTable)
    .values({ userId, ...values, updatedAt })
    .onConflictDoUpdate({
      target: billingSubscriptionsTable.userId,
      set: { ...values, updatedAt },
    })
    .returning();
  return subscription ?? null;
}

async function findPaidPayment(env: BillingEnvironment, subscription: SubscriptionRow): Promise<any | null> {
  if (!subscription.whopCheckoutConfigurationId || !subscription.whopPlanId) return null;

  const query = new URLSearchParams({
    company_id: env.WHOP_COMPANY_ID!,
    "checkout_configuration_ids[]": subscription.whopCheckoutConfigurationId,
  });
  const payload = await whopRequest(
    env,
    `/payments?${query.toString()}`,
    "GET",
    undefined,
    WHOP_PAYMENT_LIST_API_VERSION,
  );
  const payments = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  const matchingPayments = payments.filter((item: any) =>
    item.checkout_configuration_id === subscription.whopCheckoutConfigurationId ||
    item.checkout_configuration?.id === subscription.whopCheckoutConfigurationId,
  );
  const payment = matchingPayments.find((item: any) =>
    ["paid", "succeeded", "complete", "completed"].includes(
      String(item.status ?? item.state ?? "").toLowerCase(),
    ),
  );
  if (!payment) return null;

  const paymentAccountId = payment.company?.id
    ?? payment.account?.id
    ?? payment.account_id
    ?? payment.company_id;
  if (paymentAccountId && paymentAccountId !== env.WHOP_COMPANY_ID) {
    throw new BillingError("The Whop payment belongs to a different account.", 409);
  }
  if (paymentPlanId(payment) !== subscription.whopPlanId) {
    throw new BillingError("The Whop payment does not match this AfuCloud subscription.", 409);
  }
  return payment;
}

async function findAccessMembership(
  env: BillingEnvironment,
  userId: string,
  subscription: SubscriptionRow,
): Promise<{
  id: string;
  planId: string;
  tierKey: PaidTierKey;
  checkoutConfigurationId: string | null;
} | null> {
  const plans = [
    { tierKey: "business" as const, planId: env.WHOP_BUSINESS_PLAN_ID },
    { tierKey: "pro" as const, planId: env.WHOP_PRO_PLAN_ID },
  ].filter((plan): plan is { tierKey: PaidTierKey; planId: string } =>
    typeof plan.planId === "string" && plan.planId.length > 0,
  );

  for (const plan of plans) {
    let after: string | undefined;
    let pageCount = 0;

    while (pageCount < 25) {
      const query = new URLSearchParams({
        account_id: env.WHOP_COMPANY_ID!,
        first: "100",
        order: "created_at",
        direction: "desc",
      });
      query.append("product_ids[]", env.WHOP_PRODUCT_ID!);
      query.append("plan_ids[]", plan.planId);
      for (const status of PAID_ACCESS_STATUSES) query.append("statuses[]", status);
      if (after) query.set("after", after);

      const payload = await whopRequest(
        env,
        `/memberships?${query.toString()}`,
        "GET",
        undefined,
        undefined,
        true,
      );
      const memberships = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      const membership = memberships.find((item: any) =>
        (() => {
          const metadataUserId = item.metadata?.afucloud_user_id;
          const checkoutMatches = typeof subscription.whopCheckoutConfigurationId === "string" &&
            item.checkout_configuration_id === subscription.whopCheckoutConfigurationId;
          return metadataUserId === userId || (metadataUserId == null && checkoutMatches);
        })() &&
        typeof item.id === "string" &&
        item.id.startsWith("mem_") &&
        hasPaidAccess(item.status) &&
        paymentPlanId(item) === plan.planId &&
        membershipProductId(item) === env.WHOP_PRODUCT_ID &&
        membershipAccountId(item) === env.WHOP_COMPANY_ID,
      );

      if (membership) {
        const checkoutId = membership.checkout_configuration_id
          ?? membership.checkout_configuration?.id
          ?? null;
        return {
          id: membership.id,
          planId: plan.planId,
          tierKey: plan.tierKey,
          checkoutConfigurationId: typeof checkoutId === "string" ? checkoutId : null,
        };
      }

      const pageInfo = payload?.page_info;
      if (!pageInfo?.has_next_page) {
        after = undefined;
        break;
      }
      if (typeof pageInfo.end_cursor !== "string" || !pageInfo.end_cursor) {
        throw new BillingError("Whop returned an incomplete membership page.", 502);
      }
      after = pageInfo.end_cursor;
      pageCount += 1;
    }

    if (after) {
      throw new BillingError("Could not finish checking Whop memberships. Refresh and try again.", 503);
    }
  }
  return null;
}

async function verifyMembership(
  env: BillingEnvironment,
  membershipId: string,
  subscription: Pick<SubscriptionRow, "userId" | "tierKey" | "whopPlanId" | "whopCheckoutConfigurationId">,
): Promise<{
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  manageUrl: string | null;
}> {
  if (!membershipId.startsWith("mem_")) {
    throw new BillingError("Whop returned an invalid membership reference.", 409);
  }
  const membership = await whopRequest(env, `/memberships/${encodeURIComponent(membershipId)}`, "GET");
  const accountId = membershipAccountId(membership);
  const productId = membershipProductId(membership);
  const planId = paymentPlanId(membership);

  if (accountId && accountId !== env.WHOP_COMPANY_ID) {
    throw new BillingError("The membership belongs to a different Whop account.", 409);
  }
  if (productId && productId !== env.WHOP_PRODUCT_ID) {
    throw new BillingError("The membership does not belong to AfuCloud.", 409);
  }
  if (planId && planId !== subscription.whopPlanId) {
    throw new BillingError("The membership does not match the selected AfuCloud plan.", 409);
  }
  const linkedUserId = membership?.metadata?.afucloud_user_id;
  if (typeof linkedUserId === "string" && linkedUserId !== subscription.userId) {
    throw new BillingError("The Whop membership is linked to a different AfuCloud account.", 409);
  }
  if (
    membership?.checkout_configuration_id &&
    subscription.whopCheckoutConfigurationId &&
    membership.checkout_configuration_id !== subscription.whopCheckoutConfigurationId
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
    currentPeriodEnd: asDate(membership?.current_period_end ?? membership?.renewal_period_end),
    cancelAtPeriodEnd: Boolean(membership?.cancel_at_period_end),
    manageUrl: typeof membership?.manage_url === "string" ? membership.manage_url : null,
  };
}

async function persistVerifiedMembership(
  env: BillingEnvironment,
  userId: string,
  subscription: SubscriptionRow,
  membershipId: string,
  paymentId?: string | null,
): Promise<SubscriptionRow | null> {
  const verified = await verifyMembership(env, membershipId, subscription);
  if (!isTierKey(subscription.tierKey)) {
    throw new BillingError("The stored AfuCloud plan is invalid.", 409);
  }
  return saveSubscription({
    userId,
    tierKey: subscription.tierKey,
    status: verified.status,
    whopPlanId: subscription.whopPlanId,
    whopCheckoutConfigurationId: subscription.whopCheckoutConfigurationId,
    whopMembershipId: membershipId,
    whopPaymentId: paymentId === undefined ? subscription.whopPaymentId : paymentId,
    currentPeriodEnd: verified.currentPeriodEnd,
    cancelAtPeriodEnd: verified.cancelAtPeriodEnd,
    manageUrl: verified.manageUrl,
  });
}

async function resolveSubscription(env: BillingEnvironment, userId: string): Promise<SubscriptionRow | null> {
  const subscription = await getSubscription(userId);
  if (!subscription) return null;

  if (subscription.whopMembershipId) {
    const verified = await verifyMembership(env, subscription.whopMembershipId, subscription);
    if (!isTierKey(subscription.tierKey)) {
      throw new BillingError("The stored AfuCloud plan is invalid.", 409);
    }
    return saveSubscription({
      userId,
      tierKey: subscription.tierKey,
      status: verified.status,
      whopPlanId: subscription.whopPlanId,
      whopCheckoutConfigurationId: subscription.whopCheckoutConfigurationId,
      whopMembershipId: subscription.whopMembershipId,
      whopPaymentId: subscription.whopPaymentId,
      currentPeriodEnd: verified.currentPeriodEnd,
      cancelAtPeriodEnd: verified.cancelAtPeriodEnd,
      manageUrl: verified.manageUrl,
    });
  }

  const payment = await findPaidPayment(env, subscription);
  const paymentMembershipId = payment?.membership_id ?? payment?.membership?.id;
  if (typeof paymentMembershipId === "string") {
    return persistVerifiedMembership(env, userId, subscription, paymentMembershipId, payment.id ?? null);
  }

  const accessMembership = await findAccessMembership(env, userId, subscription);
  if (!accessMembership) return subscription;
  const candidate = {
    ...subscription,
    tierKey: accessMembership.tierKey,
    whopPlanId: accessMembership.planId,
    whopCheckoutConfigurationId: accessMembership.checkoutConfigurationId,
  };
  const verified = await verifyMembership(env, accessMembership.id, candidate);
  return saveSubscription({
    userId,
    tierKey: accessMembership.tierKey,
    status: verified.status,
    whopPlanId: accessMembership.planId,
    whopCheckoutConfigurationId: accessMembership.checkoutConfigurationId,
    whopMembershipId: accessMembership.id,
    whopPaymentId: subscription.whopPaymentId,
    currentPeriodEnd: verified.currentPeriodEnd,
    cancelAtPeriodEnd: verified.cancelAtPeriodEnd,
    manageUrl: verified.manageUrl,
  });
}

function publicSubscription(subscription: SubscriptionRow | null) {
  if (!subscription) return null;
  return {
    tierKey: subscription.tierKey,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    manageUrl: subscription.manageUrl ?? null,
    checkoutPending: subscription.status === "pending_payment" || subscription.status === "creating_checkout",
  };
}

export async function getBillingSummary(userId: string) {
  const subscription = await resolveSubscription(process.env, userId);
  const currentTier = hasPaidAccess(subscription?.status) && isTierKey(subscription?.tierKey)
    ? subscription.tierKey
    : "free";
  const [projects, containers, keyCounts] = await Promise.all([
    db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.userId, userId)),
    db.select({ id: storageContainersTable.id }).from(storageContainersTable)
      .where(eq(storageContainersTable.userId, userId)),
    db.select({ value: count() }).from(apiKeysTable)
      .innerJoin(projectsTable, eq(apiKeysTable.projectId, projectsTable.id))
      .where(eq(projectsTable.userId, userId)),
  ]);

  return {
    currentTier,
    subscription: publicSubscription(subscription),
    checkoutConfigured: billingConfigured(process.env),
    usage: {
      projects: projects.length,
      storageContainers: containers.length,
      apiKeys: Number(keyCounts[0]?.value ?? 0),
    },
    plans: Object.values(BILLING_TIERS),
  };
}

export async function createSubscriptionCheckout(
  userId: string,
  tierKey: PaidTierKey,
): Promise<{ purchaseUrl: string }> {
  const env = process.env;
  if (!billingConfigured(env)) {
    throw new BillingError("AfuCloud checkout is not configured yet.", 503);
  }

  const existing = await resolveSubscription(env, userId);
  if (hasPaidAccess(existing?.status)) {
    throw new BillingError("Manage or cancel your current Whop subscription before starting another plan.", 409);
  }

  if (existing?.status === "pending_payment" && existing.whopCheckoutConfigurationId) {
    if (existing.tierKey !== tierKey) {
      throw new BillingError("Finish or refresh your pending checkout before choosing a different plan.", 409);
    }
    const checkout = await whopRequest(
      env,
      `/checkout_configurations/${encodeURIComponent(existing.whopCheckoutConfigurationId)}`,
      "GET",
    );
    const checkoutPlanId = checkout?.plan?.id ?? checkout?.plan_id;
    if (
      checkout?.id === existing.whopCheckoutConfigurationId &&
      checkoutPlanId === existing.whopPlanId &&
      typeof checkout?.purchase_url === "string"
    ) {
      return { purchaseUrl: checkout.purchase_url };
    }
    throw new BillingError("Your existing Whop checkout is still pending. Refresh your subscription before retrying.", 409);
  }

  if (existing?.status === "creating_checkout") {
    const updatedAt = existing.updatedAt?.getTime() ?? Number.NaN;
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt < 2 * 60 * 1000) {
      throw new BillingError("Your checkout is still being prepared. Wait a moment, then refresh.", 409);
    }
  }

  const planId = tierKey === "pro" ? env.WHOP_PRO_PLAN_ID! : env.WHOP_BUSINESS_PLAN_ID!;
  const reset = {
    userId,
    tierKey,
    status: "creating_checkout",
    whopPlanId: null,
    whopCheckoutConfigurationId: null,
    whopMembershipId: null,
    whopPaymentId: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    manageUrl: null,
  } satisfies Parameters<typeof saveSubscription>[0];
  await saveSubscription(reset);

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

    await saveSubscription({
      ...reset,
      status: "pending_payment",
      whopPlanId: planId,
      whopCheckoutConfigurationId: checkout.id,
    });
    return { purchaseUrl: checkout.purchase_url };
  } catch (error) {
    await saveSubscription({
      ...reset,
      status: "checkout_failed",
      whopPlanId: planId,
    }).catch(() => null);
    throw error;
  }
}
