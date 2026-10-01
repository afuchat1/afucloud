import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { signInWithSupabase, signUpWithSupabase, updatePasswordWithSupabase } from "../lib/supabase-auth";
import {
  signAccessToken,
  generateSecureToken,
  hashToken,
  refreshTokenExpiresAt,
} from "../lib/auth";
import {
  DASHBOARD_ACCESS_COOKIE,
  DASHBOARD_CSRF_COOKIE,
  DASHBOARD_REFRESH_COOKIE,
  requireCsrf,
  requireDashboardSession,
  rejectDeveloperCredential,
} from "../middleware/auth";

const auth = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
const ACCESS_COOKIE_MAX_AGE = 60 * 60;
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

function sessionCookieOptions(c: { env: Env }, httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    secure: c.env.NODE_ENV !== "development",
    sameSite: c.env.NODE_ENV === "development" ? "Lax" as const : "None" as const,
    path: "/",
    maxAge,
  };
}

function setDashboardCookies(c: { env: Env }, accessToken: string, refreshToken: string): void {
  setCookie(c as never, DASHBOARD_ACCESS_COOKIE, accessToken, sessionCookieOptions(c, true, ACCESS_COOKIE_MAX_AGE));
  setCookie(c as never, DASHBOARD_REFRESH_COOKIE, refreshToken, sessionCookieOptions(c, true, REFRESH_COOKIE_MAX_AGE));
}

function clearDashboardCookies(c: { env: Env }): void {
  const options = { path: "/", secure: c.env.NODE_ENV !== "development" };
  deleteCookie(c as never, DASHBOARD_ACCESS_COOKIE, options);
  deleteCookie(c as never, DASHBOARD_REFRESH_COOKIE, options);
  deleteCookie(c as never, DASHBOARD_CSRF_COOKIE, options);
}

function responseUser(user: {
  user_id: string;
  email: string;
  name: string;
  avatar: string | null;
  email_verified: boolean;
  created_at: string;
}) {
  return {
    id: user.user_id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    emailVerified: user.email_verified,
    createdAt: user.created_at,
  };
}

function getAuthName(email: string, metadata: unknown): string {
  const values = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  const name = values.name ?? values.full_name ?? values.display_name;
  return typeof name === "string" && name.trim() ? name.trim() : email.split("@")[0];
}

async function ensureAfuCloudProfile(
  db: ReturnType<typeof createDbClient>,
  authUser: { id: string; email?: string; user_metadata?: Record<string, unknown>; email_confirmed_at?: string | null },
) {
  const existing = await db.getUserById(authUser.id);
  if (existing) return existing;

  const email = authUser.email?.trim().toLowerCase();
  if (!email) throw new Error("Supabase Auth user has no email address");

  return db.createUser({
    user_id: authUser.id,
    email,
    name: getAuthName(email, authUser.user_metadata),
    email_verified: Boolean(authUser.email_confirmed_at),
  });
}

auth.get("/csrf", rejectDeveloperCredential, async (c) => {
  const existing = getCookie(c, DASHBOARD_CSRF_COOKIE);
  const csrfToken = typeof existing === "string" && /^[a-f0-9]{64}$/i.test(existing)
    ? existing
    : generateSecureToken();
  setCookie(c, DASHBOARD_CSRF_COOKIE, csrfToken, sessionCookieOptions(c, false, REFRESH_COOKIE_MAX_AGE));
  return c.json({ csrfToken });
});

auth.post("/register", rejectDeveloperCredential, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { password, name } = body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || typeof password !== "string" || typeof name !== "string" || !name.trim()) {
    return c.json({ error: "email, password, and name are required" }, 400);
  }
  if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);

  const db = createDbClient(c.env);
  const existing = await db.getUserByEmail(email);
  if (existing) return c.json({ error: "Email already registered" }, 409);

  const authUser = await signUpWithSupabase(c.env, email, password, name.trim());
  if (!authUser) return c.json({ error: "Unable to create account" }, 400);
  const user = await ensureAfuCloudProfile(db, authUser);
  const accessToken = await signAccessToken({ userId: user.user_id, email: user.email }, c.env);
  const rawRefresh = generateSecureToken();
  await db.createRefreshToken({
    user_id: user.user_id,
    token_hash: await hashToken(rawRefresh),
    expires_at: refreshTokenExpiresAt(),
  });
  await db.logActivity({ user_id: user.user_id, action: "register", resource: "user", resource_id: user.user_id });

  setDashboardCookies(c, accessToken, rawRefresh);
  return c.json({ user: responseUser(user) }, 201);
});

auth.post("/login", rejectDeveloperCredential, requireCsrf, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { password } = body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || typeof password !== "string") return c.json({ error: "email and password are required" }, 400);

  const db = createDbClient(c.env);
  const sharedAuthUser = await signInWithSupabase(c.env, email, password);
  if (!sharedAuthUser) return c.json({ error: "Invalid credentials" }, 401);
  const user = await ensureAfuCloudProfile(db, sharedAuthUser);
  const accessToken = await signAccessToken({ userId: user.user_id, email: user.email }, c.env);
  const rawRefresh = generateSecureToken();
  await db.createRefreshToken({
    user_id: user.user_id,
    token_hash: await hashToken(rawRefresh),
    expires_at: refreshTokenExpiresAt(),
  });
  await db.logActivity({ user_id: user.user_id, action: "login", resource: "user", resource_id: user.user_id });

  setDashboardCookies(c, accessToken, rawRefresh);
  return c.json({ user: responseUser(user) });
});

auth.post("/logout", rejectDeveloperCredential, requireCsrf, async (c) => {
  const refreshToken = getCookie(c, DASHBOARD_REFRESH_COOKIE);
  if (refreshToken) {
    const db = createDbClient(c.env);
    await db.deleteRefreshTokenByHash(await hashToken(refreshToken));
  }
  clearDashboardCookies(c);
  return c.json({ message: "Logged out" });
});

auth.post("/refresh", rejectDeveloperCredential, requireCsrf, async (c) => {
  const refreshToken = getCookie(c, DASHBOARD_REFRESH_COOKIE);
  if (!refreshToken) {
    clearDashboardCookies(c);
    return c.json({ error: "Dashboard session expired" }, 401);
  }

  const db = createDbClient(c.env);
  const record = await db.getRefreshToken(await hashToken(refreshToken));
  if (!record || new Date(record.expires_at) < new Date()) {
    clearDashboardCookies(c);
    return c.json({ error: "Invalid or expired dashboard session" }, 401);
  }
  const user = await db.getUserById(record.user_id);
  if (!user) {
    clearDashboardCookies(c);
    return c.json({ error: "User not found" }, 401);
  }

  const accessToken = await signAccessToken({ userId: user.user_id, email: user.email }, c.env);
  const newRaw = generateSecureToken();
  await db.deleteRefreshToken(record.id);
  await db.createRefreshToken({
    user_id: user.user_id,
    token_hash: await hashToken(newRaw),
    expires_at: refreshTokenExpiresAt(),
  });

  setDashboardCookies(c, accessToken, newRaw);
  return c.json({ user: responseUser(user) });
});

auth.get("/me", requireDashboardSession, async (c) => {
  const db = createDbClient(c.env);
  const user = await db.getUserById(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  return c.json(responseUser(user));
});

auth.patch("/me/update", requireDashboardSession, async (c) => {
  const { name, avatar } = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (avatar !== undefined) updates.avatar = avatar;
  const db = createDbClient(c.env);
  const user = await db.updateUser(c.get("userId"), updates);
  return c.json(responseUser(user));
});

auth.patch("/me/password", requireDashboardSession, async (c) => {
  const { currentPassword, newPassword } = await c.req.json().catch(() => ({}));
  if (typeof currentPassword !== "string" || typeof newPassword !== "string") {
    return c.json({ error: "currentPassword and newPassword are required" }, 400);
  }
  if (newPassword.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);

  const db = createDbClient(c.env);
  const user = await db.getUserById(c.get("userId"));
  if (!user) return c.json({ error: "User not found" }, 404);
  const authenticatedUser = await signInWithSupabase(c.env, user.email, currentPassword);
  if (!authenticatedUser) return c.json({ error: "Current password is incorrect" }, 401);
  const updated = await updatePasswordWithSupabase(c.env, user.user_id, newPassword);
  if (!updated) return c.json({ error: "Unable to update password right now" }, 502);
  return c.json({ message: "Password updated successfully" });
});

export default auth;