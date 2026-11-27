import assert from "node:assert/strict";
import test from "node:test";
import {
  getTurnstileSiteKey,
  isTurnstileEnforced,
  verifyTurnstileToken,
} from "../src/lib/turnstile.ts";

async function withMockFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("Turnstile uses the documented test site key only outside production", () => {
  assert.equal(getTurnstileSiteKey({ NODE_ENV: "development" }), "1x00000000000000000000AA");
  assert.equal(getTurnstileSiteKey({ NODE_ENV: "production" }), "");
  assert.equal(getTurnstileSiteKey({}), "");
  assert.equal(getTurnstileSiteKey({
    NODE_ENV: "production",
    TURNSTILE_SITE_KEY: "public-site-key",
  }), "public-site-key");
});

test("Turnstile enforcement stays on unless the rollout flag explicitly disables it", () => {
  assert.equal(isTurnstileEnforced({ NODE_ENV: "production" }), true);
  assert.equal(isTurnstileEnforced({
    NODE_ENV: "production",
    TURNSTILE_ENFORCEMENT_ENABLED: "false",
  }), false);
  assert.equal(isTurnstileEnforced({
    NODE_ENV: "production",
    TURNSTILE_ENFORCEMENT_ENABLED: "true",
  }), true);
});

test("production verification rejects missing secrets and malformed tokens without a network call", async () => {
  let requests = 0;
  await withMockFetch(async () => {
    requests += 1;
    return new Response("{}");
  }, async () => {
    assert.equal(await verifyTurnstileToken(
      { NODE_ENV: "production" },
      "valid-looking-token",
      "afu_login",
    ), "unavailable");
    assert.equal(await verifyTurnstileToken(
      { NODE_ENV: "development" },
      "",
      "afu_login",
    ), "invalid");
    assert.equal(await verifyTurnstileToken(
      { NODE_ENV: "development" },
      "x".repeat(2049),
      "afu_login",
    ), "invalid");
  });
  assert.equal(requests, 0);
});

test("Siteverify accepts a matching action and production hostname", async () => {
  const productionEnv = {
    NODE_ENV: "production",
    TURNSTILE_SECRET_KEY: "test-secret",
    PUBLIC_SITE_URL: "https://cloud.afuchat.com",
  };
  await withMockFetch(async (input, init) => {
    assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(init.method, "POST");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.secret, "test-secret");
    assert.equal(payload.response, "single-use-token");
    assert.equal(payload.remoteip, "203.0.113.5");
    return new Response(JSON.stringify({
      success: true,
      action: "afu_login",
      hostname: "cloud.afuchat.com",
    }), { status: 200 });
  }, async () => {
    assert.equal(await verifyTurnstileToken(
      productionEnv,
      "single-use-token",
      "afu_login",
      "203.0.113.5",
    ), "verified");
  });
});

test("Siteverify rejects wrong actions and production hostnames", async () => {
  await withMockFetch(async () => new Response(JSON.stringify({
    success: true,
    action: "afu_resend",
    hostname: "cloud.afuchat.com",
  }), { status: 200 }), async () => {
    assert.equal(await verifyTurnstileToken({
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "test-secret",
    }, "token", "afu_login"), "invalid");
  });

  await withMockFetch(async () => new Response(JSON.stringify({
    success: true,
    action: "afu_login",
    hostname: "attacker.example",
  }), { status: 200 }), async () => {
    assert.equal(await verifyTurnstileToken({
      NODE_ENV: "production",
      TURNSTILE_SECRET_KEY: "test-secret",
    }, "token", "afu_login"), "invalid");
  });
});

test("Siteverify distinguishes rejected tokens from provider outages", async () => {
  await withMockFetch(async () => new Response(JSON.stringify({
    success: false,
    "error-codes": ["invalid-input-response"],
  }), { status: 200 }), async () => {
    assert.equal(await verifyTurnstileToken({
      NODE_ENV: "development",
    }, "bad-token", "afu_login"), "invalid");
  });

  await withMockFetch(async () => new Response("upstream error", { status: 503 }), async () => {
    assert.equal(await verifyTurnstileToken({
      NODE_ENV: "development",
    }, "token", "afu_login"), "unavailable");
  });
});
