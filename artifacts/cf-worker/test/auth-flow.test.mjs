import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  signUpWithSupabase,
  SupabaseAuthError,
  verifySignupEmailWithSupabase,
} from "../src/lib/supabase-auth.ts";

const env = {
  SUPABASE_URL: "https://auth-provider.invalid",
  SUPABASE_ANON_KEY: "test-anon-key",
};

const directUser = {
  id: "test-user-id",
  email: "user@example.test",
  user_metadata: { name: "Test User" },
  email_confirmed_at: null,
};

async function withMockFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("signup accepts the direct user payload returned by GoTrue", async () => {
  await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auth/v1/signup");
    assert.equal(url.searchParams.get("redirect_to"), "https://cloud.afuchat.com/login?confirmed=1");
    assert.equal(new Headers(init.headers).get("apikey"), env.SUPABASE_ANON_KEY);
    return new Response(JSON.stringify(directUser), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const user = await signUpWithSupabase(
      env,
      "user@example.test",
      "test-password",
      "Test User",
      "https://cloud.afuchat.com/login?confirmed=1",
    );
    assert.equal(user.id, directUser.id);
    assert.equal(user.email, directUser.email);
    assert.equal(user.email_confirmed_at, null);
  });
});

test("signup continues to accept a nested user payload", async () => {
  await withMockFetch(async () => new Response(JSON.stringify({ user: directUser }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }), async () => {
    const user = await signUpWithSupabase(
      env,
      "user@example.test",
      "test-password",
      "Test User",
      "https://cloud.afuchat.com/login?confirmed=1",
    );
    assert.equal(user.id, directUser.id);
  });
});

test("email confirmation sends the one-time token in a server-side POST body", async () => {
  const tokenHash = "a".repeat(64);
  await withMockFetch(async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/auth/v1/verify");
    assert.equal(url.search, "");
    assert.equal(String(input).includes(tokenHash), false);
    assert.deepEqual(JSON.parse(String(init.body)), { token_hash: tokenHash, type: "email" });
    return new Response(JSON.stringify({ user: { ...directUser, email_confirmed_at: "2026-11-26T00:00:00Z" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const user = await verifySignupEmailWithSupabase(env, tokenHash);
    assert.equal(user.id, directUser.id);
    assert.ok(user.email_confirmed_at);
  });
});

test("signup network failures are classified without exposing provider details", async () => {
  await withMockFetch(async () => {
    throw new TypeError("simulated network failure");
  }, async () => {
    await assert.rejects(
      signUpWithSupabase(
        env,
        "user@example.test",
        "test-password",
        "Test User",
        "https://cloud.afuchat.com/login?confirmed=1",
      ),
      (error) => error instanceof SupabaseAuthError
        && error.status === 503
        && error.code === "auth_upstream_unavailable"
        && !error.message.includes("auth-provider.invalid"),
    );
  });
});

test("confirmation email template links only to AfuCloud", async () => {
  const template = await readFile(new URL("../email-templates/confirmation.html", import.meta.url), "utf8");
  assert.match(template, /https:\/\/cloud\.afuchat\.com\/auth\/confirm#token_hash=\{\{ \.TokenHash \}\}/);
  assert.doesNotMatch(template, /ConfirmationURL|supabase\.co/i);
});
