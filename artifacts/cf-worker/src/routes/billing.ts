import { Hono } from "hono";
import type { AuthVariables, Env } from "../types";
import { createDbClient } from "../lib/db";
import {
  BILLING_TIERS,
  BillingError,
  createSubscriptionCheckout,
  getEntitlements,
  isTierKey,
  publicSubscription,
} from "../lib/billing";
import { requireAccountAuth, requireAuth } from "../middleware/auth";

const billing = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
billing.use("*", requireAuth, requireAccountAuth);

async function billingSummary(env: Env, userId: string) {
  const db = createDbClient(env);
  const entitlements = await getEntitlements(db, env, userId);
  const [projects, containers, apiKeys] = await Promise.all([
    db.getProjects(userId),
    db.getStorageContainers(userId),
    db.getApiKeyCountForUser(userId),
  ]);

  return {
    currentTier: entitlements.tierKey,
    subscription: publicSubscription(entitlements.subscription),
    checkoutConfigured: Boolean(env.WHOP_API_KEY && env.WHOP_COMPANY_ID && env.WHOP_PRODUCT_ID),
    usage: {
      projects: projects.length,
      storageContainers: containers.length,
      apiKeys,
    },
    plans: Object.values(BILLING_TIERS),
  };
}

async function handleSummary(c: any) {
  try {
    return c.json(await billingSummary(c.env, c.get("userId")));
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 502;
    return c.json({
      error: error instanceof Error ? error.message : "Could not verify the AfuCloud subscription.",
    }, status as 400);
  }
}

billing.get("/", handleSummary);
billing.post("/sync", handleSummary);

billing.post("/checkout", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { planKey?: unknown };
  if (!isTierKey(body.planKey)) return c.json({ error: "Choose a valid paid plan." }, 400);

  try {
    const db = createDbClient(c.env);
    const checkout = await createSubscriptionCheckout(db, c.env, c.get("userId"), body.planKey);
    return c.json(checkout, 201);
  } catch (error) {
    const status = error instanceof BillingError ? error.status : 502;
    return c.json({
      error: error instanceof Error ? error.message : "Could not start Whop checkout.",
    }, status as 400);
  }
});

export default billing;