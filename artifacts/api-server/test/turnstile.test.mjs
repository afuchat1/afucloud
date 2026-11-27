import assert from "node:assert/strict";
import test from "node:test";
import {
  getTurnstileSiteKey,
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

test("Preview API uses the documented Turnstile test site key", () => {
  assert.equal(getTurnstileSiteKey({ NODE_ENV: "development" }), "1x00000000000000000000AA");
  assert.equal(getTurnstileSiteKey({ NODE_ENV: "production" }), "");
  assert.equal(getTurnstileSiteKey({}), "");
  assert.equal(getTurnstileSiteKey({
    NODE_ENV: "production",
    TURNSTILE_SITE_KEY: "public-site-key",
  }), "public-site-key");
});

test("production verification fails closed when its secret is missing", async () => {
  let requests = 0;
  await withMockFetch(async () => {
    requests += 1;
    return new Response("{}");
  }, async () => {
    assert.equal(await verifyTurnstileToken("token", "afu_login", undefined, {
      NODE_ENV: "production",
    }), "unavailable");
    assert.equal(await verifyTurnstileToken("", "afu_login", undefined, {
      NODE_ENV: "development",
    }), "invalid");
  });
  assert.equal(requests, 0);
});

test("Preview API verifies the action using the test key pair", async () => {
  await withMockFetch(async (input, init) => {
    assert.equal(String(input), "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.secret, "1x0000000000000000000000000000000AA");
    assert.equal(payload.response, "preview-token");
    return new Response(JSON.stringify({
      success: true,
      action: "afu_register",
      hostname: "localhost",
    }), { status: 200 });
  }, async () => {
    assert.equal(await verifyTurnstileToken(
      "preview-token",
      "afu_register",
      undefined,
      { NODE_ENV: "development" },
    ), "verified");
  });
});

test("Preview API rejects provider token and action failures", async () => {
  await withMockFetch(async () => new Response(JSON.stringify({
    success: false,
    "error-codes": ["invalid-input-response"],
  }), { status: 200 }), async () => {
    assert.equal(await verifyTurnstileToken(
      "bad-token",
      "afu_login",
      undefined,
      { NODE_ENV: "development" },
    ), "invalid");
  });

  await withMockFetch(async () => new Response(JSON.stringify({
    success: true,
    action: "afu_resend",
    hostname: "localhost",
  }), { status: 200 }), async () => {
    assert.equal(await verifyTurnstileToken(
      "token",
      "afu_login",
      undefined,
      { NODE_ENV: "development" },
    ), "invalid");
  });
});
