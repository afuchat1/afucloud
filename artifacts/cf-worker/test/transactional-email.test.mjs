import assert from "node:assert/strict";
import test from "node:test";
import { enqueueDomainExpirationEmails, enqueueEmailForUser, runScheduledEmailJobs } from "../src/lib/email-outbox.ts";
import { createDbClient } from "../src/lib/db.ts";
import { renderTransactionalEmail, sendTransactionalEmail } from "../src/lib/transactional-email.ts";

async function withMockFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("domain lifecycle emails use AfuCloud branding and first-party links", () => {
  const email = renderTransactionalEmail(
    "domain_registered",
    { domain: "<img src=x onerror=alert(1)>", expiresAt: "2027-11-27T00:00:00.000Z" },
    "Alex <Admin>",
  );

  assert.match(email.html, /https:\/\/cloud\.afuchat\.com\/afucloud-email-logo\.png/);
  assert.match(email.html, /https:\/\/cloud\.afuchat\.com\/domains/);
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(email.html, /<img src=x onerror=alert\(1\)>/);
  assert.doesNotMatch(`${email.subject}\n${email.html}\n${email.text}`, /supabase|resend|cloudflare|whop/i);
});

test("the text alternative is readable and includes an AfuCloud action link", () => {
  const email = renderTransactionalEmail("welcome", {}, "Alex");
  assert.match(email.text, /Welcome, Alex/);
  assert.match(email.text, /Open AfuCloud: https:\/\/cloud\.afuchat\.com\/dashboard/);
  assert.doesNotMatch(email.text, /&lt;|&gt;/);
});

test("the sender calls the email API with AfuCloud as sender and a stable idempotency key", async () => {
  let request;
  await withMockFetch(async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ id: "email-test-id" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const response = await sendTransactionalEmail(
      { RESEND_API_KEY: "test-api-key" },
      {
        id: "outbox-id",
        event_key: "account-welcome:test-user",
        recipient_email: "user@example.test",
        recipient_name: "Alex",
        template_key: "welcome",
        payload: {},
        attempts: 0,
      },
    );
    assert.equal(response.status, 200);
  });

  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(new Headers(request.init.headers).get("authorization"), "Bearer test-api-key");
  assert.equal(new Headers(request.init.headers).get("idempotency-key"), "account-welcome:test-user");
  const payload = JSON.parse(String(request.init.body));
  assert.equal(payload.from, "AfuCloud <no-reply@afuchat.com>");
  assert.deepEqual(payload.to, ["user@example.test"]);
  assert.match(payload.html, /afucloud-email-logo\.png/);
  assert.doesNotMatch(`${payload.subject}\n${payload.html}\n${payload.text}`, /supabase|resend|cloudflare|whop/i);
});

test("welcome messages are queued only for confirmed email addresses", async () => {
  const queued = [];
  const db = {
    async getUserById() {
      return { user_id: "user-1", email: "user@example.test", name: "Alex", email_verified: true };
    },
    async enqueueEmailOutbox(message) {
      queued.push(message);
    },
  };

  assert.equal(await enqueueEmailForUser(db, {
    eventKey: "account-welcome:user-1",
    userId: "user-1",
    template: "welcome",
  }), true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].template_key, "welcome");
  assert.equal(queued[0].recipient_email, "user@example.test");

  db.getUserById = async () => ({
    user_id: "unconfirmed",
    email: "unconfirmed@example.test",
    email_verified: false,
  });
  assert.equal(await enqueueEmailForUser(db, {
    eventKey: "account-welcome:unconfirmed",
    userId: "unconfirmed",
    template: "welcome",
  }), false);
  assert.equal(queued.length, 1);
});

test("expiry scheduling queues only the 30, 7, 1, and 0 day notices with stable keys", async () => {
  const now = new Date("2026-11-27T06:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;
  const offsets = [30, 7, 1, 0, 3, -2];
  const queued = new Map();
  const db = {
    async listRegisteredOrdersExpiringBetween() {
      return offsets.map((offset, index) => ({
        id: `order-${offset}`,
        user_id: `user-${index}`,
        hostname: `example-${offset}.test`,
        registration_expires_at: new Date(now.getTime() + offset * day).toISOString(),
      }));
    },
    async getUserById(userId) {
      return { user_id: userId, email: `${userId}@example.test`, name: "Alex", email_verified: true };
    },
    async enqueueEmailOutbox(message) {
      if (queued.has(message.event_key)) return null;
      queued.set(message.event_key, message);
      return message;
    },
  };

  assert.equal(await enqueueDomainExpirationEmails(db, now), 4);
  assert.deepEqual([...queued.keys()].sort(), [
    "domain-expiration:order-0:0",
    "domain-expiration:order-1:1",
    "domain-expiration:order-30:30",
    "domain-expiration:order-7:7",
  ]);
  assert.equal(queued.get("domain-expiration:order-0:0").template_key, "domain_expired");
  assert.equal(queued.get("domain-expiration:order-7:7").template_key, "domain_expiry_reminder");

  await enqueueDomainExpirationEmails(db, now);
  assert.equal(queued.size, 4);
});

test("database outbox requests are scoped and use idempotent inserts and conditional claims", async () => {
  const requests = [];
  const database = createDbClient({
    SUPABASE_URL: "https://database.example.test",
    SUPABASE_SERVICE_KEY: "test-service-key",
    SUPABASE_DB_SCHEMA: "afucloud",
  });

  await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    return new Response(JSON.stringify([{ id: "outbox-1", attempts: 1 }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    await database.enqueueEmailOutbox({ event_key: "account-welcome:user-1" });
    const claimed = await database.claimEmailOutbox("outbox-1", 0, "2026-11-27T06:00:00.000Z");
    assert.equal(claimed.id, "outbox-1");
  });

  assert.equal(requests.length, 2);
  assert.match(requests[0].url.pathname, /\/rest\/v1\/email_outbox$/);
  assert.equal(requests[0].url.searchParams.get("on_conflict"), "event_key");
  assert.match(new Headers(requests[0].init.headers).get("Prefer"), /resolution=ignore-duplicates/);
  assert.equal(new Headers(requests[0].init.headers).get("Content-Profile"), "afucloud");
  assert.equal(requests[1].url.searchParams.get("status"), "eq.pending");
  assert.equal(requests[1].url.searchParams.get("available_at"), "lte.2026-11-27T06:00:00.000Z");
  assert.equal(JSON.parse(String(requests[1].init.body)).status, "processing");
});

test("scheduled delivery retries temporary provider failures instead of dropping messages", async () => {
  const requests = [];
  await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.hostname === "api.resend.com") {
      return new Response("temporary error", { status: 503 });
    }

    if (init.method === "GET") {
      if (url.searchParams.get("status") === "eq.pending") {
        return new Response(JSON.stringify([{
          id: "outbox-1",
          event_key: "account-welcome:user-1",
          recipient_email: "user@example.test",
          recipient_name: "Alex",
          template_key: "welcome",
          payload: {},
          attempts: 0,
        }]), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    }

    if (url.searchParams.get("status") === "eq.pending") {
      return new Response(JSON.stringify([{
        id: "outbox-1",
        event_key: "account-welcome:user-1",
        recipient_email: "user@example.test",
        recipient_name: "Alex",
        template_key: "welcome",
        payload: {},
        attempts: 1,
      }]), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  }, async () => {
    await runScheduledEmailJobs("*/5 * * * *", {
      SUPABASE_URL: "https://database.example.test",
      SUPABASE_SERVICE_KEY: "test-service-key",
      RESEND_API_KEY: "test-api-key",
    }, createDbClient({
      SUPABASE_URL: "https://database.example.test",
      SUPABASE_SERVICE_KEY: "test-service-key",
    }), sendTransactionalEmail);
  });

  const retry = requests.find(({ init, url }) =>
    url.pathname.endsWith("/email_outbox") &&
    init.method === "PATCH" &&
    url.searchParams.get("status") === "eq.processing" &&
    !url.searchParams.has("updated_at"),
  );
  assert.ok(retry, "a failed provider response should update the claimed queue item");
  assert.equal(JSON.parse(String(retry.init.body)).status, "pending");
  assert.equal(JSON.parse(String(retry.init.body)).last_error, "email_http_503");
  assert.ok(requests.some(({ url }) => url.hostname === "api.resend.com"));
});
