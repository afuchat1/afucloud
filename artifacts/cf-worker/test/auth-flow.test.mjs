import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  signUpWithSupabase,
  SupabaseAuthError,
  verifySignupEmailWithSupabase,
} from "../src/lib/supabase-auth.ts";
import { createDbClient } from "../src/lib/db.ts";

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

test("profile creation recovers a duplicate only for the same Auth user", async () => {
  const profile = {
    id: "test-user-id",
    user_id: "test-user-id",
    email: "user@example.test",
    name: "Test User",
    email_verified: true,
  };
  let requests = 0;

  await withMockFetch(async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    assert.equal(new Headers(init.headers).get("Content-Profile"), "accounts");

    if (requests === 1) {
      assert.equal(init.method, "POST");
      assert.equal(url.pathname, "/rest/v1/profiles");
      assert.deepEqual(JSON.parse(String(init.body)), profile);
      return new Response(JSON.stringify({ code: "23505" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    assert.equal(init.method, "GET");
    assert.equal(url.pathname, "/rest/v1/profiles");
    assert.equal(url.searchParams.get("user_id"), "eq.test-user-id");
    return new Response(JSON.stringify([profile]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const db = createDbClient({
      SUPABASE_URL: "https://database-provider.invalid",
      SUPABASE_SERVICE_KEY: "test-service-key",
    });
    const result = await db.createUser(profile);
    assert.deepEqual(result, profile);
  });
  assert.equal(requests, 2);
});

test("profile creation does not recover a duplicate owned by another user", async () => {
  let requests = 0;

  await withMockFetch(async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    if (requests === 1) {
      assert.equal(init.method, "POST");
      return new Response(JSON.stringify({ code: "23505" }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }

    assert.equal(init.method, "GET");
    assert.equal(url.searchParams.get("user_id"), "eq.test-user-id");
    return new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const db = createDbClient({
      SUPABASE_URL: "https://database-provider.invalid",
      SUPABASE_SERVICE_KEY: "test-service-key",
    });
    await assert.rejects(
      db.createUser({
        id: "test-user-id",
        user_id: "test-user-id",
        email: "user@example.test",
        name: "Test User",
      }),
      /Shared profile creation failed: HTTP 409/,
    );
  });
  assert.equal(requests, 2);
});

test("a confirmed email match can claim only a still-unlinked profile", async () => {
  const unlinkedProfile = {
    id: "profile-row-id",
    user_id: null,
    email: "User@Example.Test",
    name: "Test User",
  };
  let requests = 0;

  await withMockFetch(async (input, init) => {
    requests += 1;
    const url = new URL(String(input));
    assert.equal(new Headers(init.headers).get("Content-Profile"), "accounts");

    if (requests === 1) {
      assert.equal(init.method, "GET");
      assert.equal(url.searchParams.get("email"), "ilike.user@example.test");
      assert.equal(url.searchParams.get("limit"), "1");
      return new Response(JSON.stringify([unlinkedProfile]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    assert.equal(init.method, "PATCH");
    assert.equal(url.searchParams.get("id"), "eq.profile-row-id");
    assert.equal(url.searchParams.get("email"), "eq.User@Example.Test");
    assert.equal(url.searchParams.get("user_id"), "is.null");
    assert.deepEqual(JSON.parse(String(init.body)), {
      user_id: "test-user-id",
      email_verified: true,
    });
    return new Response(JSON.stringify([{
      ...unlinkedProfile,
      user_id: "test-user-id",
      email_verified: true,
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }, async () => {
    const db = createDbClient({
      SUPABASE_URL: "https://database-provider.invalid",
      SUPABASE_SERVICE_KEY: "test-service-key",
    });
    const candidate = await db.getUserByEmail("user@example.test");
    assert.equal(candidate.id, "profile-row-id");
    const linked = await db.linkUnlinkedUser(candidate.id, "test-user-id", candidate.email);
    assert.equal(linked.user_id, "test-user-id");
    assert.equal(linked.email_verified, true);
  });
  assert.equal(requests, 2);
});
