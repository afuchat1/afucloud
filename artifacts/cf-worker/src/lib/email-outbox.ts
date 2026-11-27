import type { DbClient } from "./db";
import type { EmailOutboxMessage, EmailTemplateKey } from "./transactional-email";
import type { Env } from "../types";

const DAILY_EXPIRY_CRON = "0 6 * * *";
const EMAIL_BATCH_SIZE = 20;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const EXPIRY_LOOKAHEAD_DAYS = 31;
const EXPIRY_LOOKBEHIND_MS = 24 * 60 * 60 * 1000;
type SendEmail = (env: Env, message: EmailOutboxMessage) => Promise<Response>;

interface EmailEvent {
  eventKey: string;
  userId: string;
  template: EmailTemplateKey;
  payload?: Record<string, unknown>;
}

export async function enqueueEmailForUser(db: DbClient, event: EmailEvent): Promise<boolean> {
  const profile = await db.getUserById(event.userId);
  if (
    !profile ||
    profile.email_verified !== true ||
    typeof profile.email !== "string" ||
    !profile.email.trim()
  ) {
    return false;
  }

  await db.enqueueEmailOutbox({
    event_key: event.eventKey,
    user_id: event.userId,
    recipient_email: profile.email.trim(),
    recipient_name: typeof profile.name === "string" ? profile.name : profile.full_name ?? null,
    template_key: event.template,
    payload: event.payload ?? {},
    status: "pending",
  });
  return true;
}

export async function enqueueDomainEmail(
  db: DbClient,
  userId: string,
  domain: string,
  template: Extract<EmailTemplateKey, `domain_${string}`>,
  eventKey: string,
  extraPayload: Record<string, unknown> = {},
): Promise<boolean> {
  return enqueueEmailForUser(db, {
    eventKey,
    userId,
    template,
    payload: { domain, ...extraPayload },
  });
}

function daysUntilExpiration(expiresAt: string, now: number): number | null {
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) return null;
  return Math.ceil((expiration - now) / (24 * 60 * 60 * 1000));
}

export async function enqueueDomainExpirationEmails(
  db: DbClient,
  now = new Date(),
): Promise<number> {
  const lowerBound = new Date(now.getTime() - EXPIRY_LOOKBEHIND_MS).toISOString();
  const upperBound = new Date(now.getTime() + EXPIRY_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const orders = await db.listRegisteredOrdersExpiringBetween(lowerBound, upperBound);
  let queued = 0;

  for (const order of orders) {
    if (typeof order.registration_expires_at !== "string" || typeof order.user_id !== "string") continue;
    const days = daysUntilExpiration(order.registration_expires_at, now.getTime());
    if (days === null || ![30, 7, 1, 0].includes(days)) continue;
    const isExpired = days === 0;
    try {
      const wasQueued = await enqueueDomainEmail(
        db,
        order.user_id,
        order.hostname,
        isExpired ? "domain_expired" : "domain_expiry_reminder",
        `domain-expiration:${order.id}:${days}`,
        { daysUntilExpiry: days, expiresAt: order.registration_expires_at },
      );
      if (wasQueued) queued += 1;
    } catch {
      console.warn("[AfuCloud Email] could not queue an expiration notice", { orderId: order.id });
    }
  }
  return queued;
}

function retryDelayMinutes(attempts: number): number {
  return Math.min(6 * 60, 2 ** Math.min(Math.max(attempts, 0), 9));
}

async function dispatchDueEmails(db: DbClient, env: Env, sendEmail: SendEmail, now = new Date()): Promise<void> {
  const currentTime = now.toISOString();
  const staleBefore = new Date(now.getTime() - STALE_CLAIM_MS).toISOString();
  try {
    const recovered = await db.recoverStaleEmailOutbox(staleBefore, currentTime);
    if (recovered > 0) console.warn("[AfuCloud Email] recovered stale queue claims", { count: recovered });
  } catch {
    console.error("[AfuCloud Email] could not recover stale queue claims");
  }

  const dueMessages = await db.listDueEmailOutbox(currentTime, EMAIL_BATCH_SIZE);
  for (const message of dueMessages) {
    let claimed: EmailOutboxMessage | null;
    try {
      claimed = await db.claimEmailOutbox(message.id, Number(message.attempts) || 0, currentTime);
    } catch {
      console.error("[AfuCloud Email] could not claim a queued message", { messageId: message.id });
      continue;
    }
    if (!claimed) continue;

    try {
      const response = await sendEmail(env, claimed);
      if (response.ok) {
        await db.markEmailOutboxSent(claimed.id, new Date().toISOString());
        continue;
      }

      const nowAfterSend = new Date();
      const status = response.status;
      if (status === 408 || status === 401 || status === 403 || status === 429 || status >= 500) {
        const nextAttempt = new Date(nowAfterSend.getTime() + retryDelayMinutes(claimed.attempts) * 60 * 1000);
        await db.retryEmailOutbox(
          claimed.id,
          nextAttempt.toISOString(),
          `email_http_${status}`,
          nowAfterSend.toISOString(),
        );
        console.warn("[AfuCloud Email] delivery will be retried", { messageId: claimed.id, status });
      } else {
        await db.failEmailOutbox(claimed.id, `email_http_${status}`, nowAfterSend.toISOString());
        console.error("[AfuCloud Email] message was rejected", { messageId: claimed.id, status });
      }
    } catch {
      const retryAt = new Date(Date.now() + retryDelayMinutes(claimed.attempts) * 60 * 1000);
      await db.retryEmailOutbox(
        claimed.id,
        retryAt.toISOString(),
        "email_delivery_failed",
        new Date().toISOString(),
      ).catch(() => {
        console.error("[AfuCloud Email] could not save the delivery retry", { messageId: claimed.id });
      });
      console.warn("[AfuCloud Email] delivery failed and will be retried", { messageId: claimed.id });
    }
  }
}

export async function runScheduledEmailJobs(
  cron: string,
  env: Env,
  db: DbClient,
  sendEmail: SendEmail,
): Promise<void> {
  if (cron === DAILY_EXPIRY_CRON) {
    try {
      const queued = await enqueueDomainExpirationEmails(db);
      console.info("[AfuCloud Email] queued domain expiration notices", { count: queued });
    } catch {
      console.error("[AfuCloud Email] expiration notice scan failed");
    }
  }

  if (!env.RESEND_API_KEY) {
    console.warn("[AfuCloud Email] delivery is paused because the sender is not configured");
    return;
  }
  await dispatchDueEmails(db, env, sendEmail);
}
