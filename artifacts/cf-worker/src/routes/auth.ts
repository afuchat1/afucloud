import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono } from "hono";
import type { Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { getTurnstileSiteKey, verifyTurnstileToken } from "../lib/turnstile";
import {
  resendSignupConfirmation,
  signInWithSupabase,
  signUpWithSupabase,
  SupabaseAuthError,
  updatePasswordWithSupabase,
  verifySignupEmailWithSupabase,
} from "../lib/supabase-auth";
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
const DEFAULT_PUBLIC_SITE_URL = "https://cloud.afuchat.com";

function confirmationRedirectUrl(env: Env): string {
  let siteUrl = DEFAULT_PUBLIC_SITE_URL;
  try {
    const configured = new URL(env.PUBLIC_SITE_URL ?? DEFAULT_PUBLIC_SITE_URL);
    if (configured.protocol === "https:" && configured.hostname === "cloud.afuchat.com") {
      siteUrl = configured.origin;
    }
  } catch {}
  const redirect = new URL("/login", siteUrl);
  redirect.searchParams.set("confirmed", "1");
  return redirect.toString();
}

function normalizedAuthError(error: unknown): { status: number | null; code: string | null; text: string } {
  if (!(error instanceof SupabaseAuthError)) return { status: null, code: null, text: "" };
  return {
    status: error.status,
    code: error.code,
    text: `${error.code ?? ""} ${error.message}`.toLowerCase(),
  };
}

function signUpFailure(error: unknown): {
  status: 400 | 409 | 429 | 503;
  message: string;
  confirmationMayHaveBeenSent?: boolean;
} {
  const authError = normalizedAuthError(error);
  if (/already registered|already exists|user_already_exists/.test(authError.text)) {
    return { status: 409, message: "An Afu account already uses this email. Sign in instead." };
  }
  if (/invalid email|email_address_invalid/.test(authError.text)) {
    return { status: 400, message: "Enter a valid email address." };
  }
  if (/password.*(weak|short|characters)|weak_password/.test(authError.text)) {
    return { status: 400, message: "Choose a stronger password and try again." };
  }
  if (/rate.?limit|over_email_send_rate_limit/.test(authError.text) || authError.status === 429) {
    return { status: 429, message: "Too many confirmation emails were requested. Wait a few minutes and try again." };
  }
  if (/signup.*(disabled|not allowed)|signups_not_allowed/.test(authError.text)) {
    return { status: 503, message: "New account registration is temporarily unavailable." };
  }
  if (authError.code === "auth_not_configured" || authError.status === 401 || authError.status === 403) {
    return { status: 503, message: "New account registration is temporarily unavailable." };
  }
  if (!authError.status || authError.status >= 500) {
    return {
      status: 503,
      message: "We couldn't confirm whether signup completed. Check your email for a confirmation link; if none arrived, request another.",
      confirmationMayHaveBeenSent: true,
    };
  }
  return { status: 400, message: "We couldn't create the account. Check your details and try again." };
}

function loginFailure(error: unknown): { status: 401 | 403 | 503; message: string } {
  const authError = normalizedAuthError(error);
  if (/email not confirmed|email_not_confirmed/.test(authError.text)) {
    return { status: 403, message: "Confirm your email address before signing in. Use the link in your confirmation email." };
  }
  if (authError.status === 400 || authError.status === 401) {
    return { status: 401, message: "Invalid email or password." };
  }
  return { status: 503, message: "AfuCloud could not sign you in right now. Please try again shortly." };
}

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
  const email = authUser.email?.trim().toLowerCase();
  if (!email) throw new Error("Supabase Auth user has no email address");
  if (existing) {
    const updates: Record<string, unknown> = {};
    if (existing.email !== email) updates.email = email;
    if (authUser.email_confirmed_at && !existing.email_verified) updates.email_verified = true;
    const metadata = authUser.user_metadata ?? {};
    const candidateName = metadata.name ?? metadata.full_name ?? metadata.display_name;
    const name = typeof candidateName === "string" ? candidateName.trim() : "";
    if (name && existing.name !== name) updates.name = name;
    return Object.keys(updates).length
      ? (await db.updateUser(authUser.id, updates)) ?? { ...existing, ...updates }
      : existing;
  }

  // Some legacy Auth triggers created an email-only profile before the
  // shared user_id link was installed. Claim it only after Supabase confirms
  // the email, and only while the profile remains unlinked.
  if (authUser.email_confirmed_at) {
    const emailProfile = await db.getUserByEmail(email);
    const profileEmail = typeof emailProfile?.email === "string"
      ? emailProfile.email.trim().toLowerCase()
      : "";
    if (emailProfile && profileEmail === email && emailProfile.user_id === authUser.id) {
      return emailProfile;
    }
    if (emailProfile && profileEmail === email && emailProfile.user_id == null && emailProfile.id) {
      const linked = await db.linkUnlinkedUser(emailProfile.id, authUser.id, emailProfile.email);
      if (linked) return linked;
      const concurrentlyLinked = await db.getUserById(authUser.id);
      if (concurrentlyLinked) return concurrentlyLinked;
    }
    if (emailProfile && profileEmail === email && emailProfile.user_id) {
      console.error("[AfuCloud Auth] shared email profile belongs to another Auth user");
      throw new Error("Shared profile identity conflict");
    }
  }

  return db.createUser({
    id: authUser.id,
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
  return c.json({ csrfToken, turnstileSiteKey: getTurnstileSiteKey(c.env) });
});

auth.post("/register", rejectDeveloperCredential, requireCsrf, async (c) => {
  const payload = await c.req.json().catch(() => null);
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const { password, name } = body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || typeof password !== "string" || typeof name !== "string" || !name.trim()) {
    return c.json({ error: "email, password, and name are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return c.json({ error: "Password must be at least 8 characters" }, 400);

  const verification = await verifyTurnstileToken(
    c.env,
    body.turnstileToken,
    "afu_register",
    c.req.header("CF-Connecting-IP"),
  );
  if (verification !== "verified") {
    return c.json({
      error: verification === "unavailable"
        ? "Human verification is temporarily unavailable. Please try again shortly."
        : "Complete the Cloudflare human verification and try again.",
    }, verification === "unavailable" ? 503 : 403);
  }

  const db = createDbClient(c.env);
  let existing;
  try {
    existing = await db.getUserByEmail(email);
  } catch {
    console.error("[AfuCloud Auth] shared profile lookup failed before signup");
    return c.json({ error: "Registration is temporarily unavailable. Please try again shortly." }, 503);
  }
  if (existing) return c.json({ error: "An Afu account already uses this email. Sign in instead." }, 409);

  let authUser;
  try {
    authUser = await signUpWithSupabase(c.env, email, password, name.trim(), confirmationRedirectUrl(c.env));
  } catch (error) {
    const failure = signUpFailure(error);
    const authError = normalizedAuthError(error);
    console.error("[AfuCloud Auth] sign-up rejected", { status: authError.status, code: authError.code });
    return c.json({
      error: failure.message,
      ...(failure.confirmationMayHaveBeenSent ? { confirmationMayHaveBeenSent: true } : {}),
    }, failure.status);
  }
  const confirmationRequired = !authUser.email_confirmed_at;
  let user;
  try {
    user = await ensureAfuCloudProfile(db, authUser);
  } catch {
    console.error("[AfuCloud Auth] shared profile setup deferred after signup");
    if (confirmationRequired) return c.json({ confirmationRequired: true, email }, 202);
    return c.json({ error: "Your account was created, but setup could not finish. Please sign in shortly." }, 503);
  }
  await db.logActivity({ user_id: user.user_id, action: "register", resource: "user", resource_id: user.user_id });

  if (confirmationRequired) {
    return c.json({ confirmationRequired: true, email: user.email }, 202);
  }

  const accessToken = await signAccessToken({ userId: user.user_id, email: user.email }, c.env);
  const rawRefresh = generateSecureToken();
  await db.createRefreshToken({
    user_id: user.user_id,
    token_hash: await hashToken(rawRefresh),
    expires_at: refreshTokenExpiresAt(),
  });
  setDashboardCookies(c, accessToken, rawRefresh);
  return c.json({ user: responseUser(user) }, 201);
});

auth.post("/resend-confirmation", rejectDeveloperCredential, requireCsrf, async (c) => {
  const payload = await c.req.json().catch(() => null);
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Enter a valid email address." }, 400);
  }

  const verification = await verifyTurnstileToken(
    c.env,
    body.turnstileToken,
    "afu_resend",
    c.req.header("CF-Connecting-IP"),
  );
  if (verification !== "verified") {
    return c.json({
      error: verification === "unavailable"
        ? "Human verification is temporarily unavailable. Please try again shortly."
        : "Complete the Cloudflare human verification and try again.",
    }, verification === "unavailable" ? 503 : 403);
  }

  try {
    await resendSignupConfirmation(c.env, email, confirmationRedirectUrl(c.env));
  } catch (error) {
    const authError = normalizedAuthError(error);
    console.warn("[AfuCloud Auth] confirmation resend rejected", { status: authError.status, code: authError.code });
    if (/rate.?limit|over_email_send_rate_limit/.test(authError.text) || authError.status === 429) {
      return c.json({ error: "Too many confirmation emails were requested. Wait a few minutes and try again." }, 429);
    }
    if (!authError.status || authError.status >= 500) {
      return c.json({ error: "Could not send a confirmation email right now. Please try again shortly." }, 503);
    }
  }

  return c.json({ message: "If this account needs verification, a confirmation email has been sent." }, 202);
});

auth.post("/confirm-email", rejectDeveloperCredential, requireCsrf, async (c) => {
  const payload = await c.req.json().catch(() => null);
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const tokenHash = typeof body.tokenHash === "string" ? body.tokenHash.trim() : "";
  if (!/^[A-Za-z0-9._~-]{20,256}$/.test(tokenHash)) {
    return c.json({ error: "This confirmation link is invalid or expired. Request a new email." }, 400);
  }

  let authUser;
  try {
    authUser = await verifySignupEmailWithSupabase(c.env, tokenHash);
  } catch (error) {
    const authError = normalizedAuthError(error);
    console.warn("[AfuCloud Auth] email confirmation rejected", { status: authError.status, code: authError.code });
    if (authError.status === 429) {
      return c.json({ error: "Too many confirmation attempts. Wait a few minutes and try again." }, 429);
    }
    if ([400, 401, 403, 404].includes(authError.status ?? -1)) {
      return c.json({ error: "This confirmation link is invalid or expired. Request a new email." }, 400);
    }
    return c.json({ error: "We couldn't confirm your email right now. Please try again shortly." }, 503);
  }

  try {
    await ensureAfuCloudProfile(createDbClient(c.env), authUser);
  } catch {
    // The Supabase token is one-time. Keep the confirmation successful and let
    // sign-in retry shared-profile provisioning if the database is unavailable.
    console.error("[AfuCloud Auth] shared profile setup deferred after email confirmation");
  }
  return c.json({ confirmed: true });
});

auth.post("/login", rejectDeveloperCredential, requireCsrf, async (c) => {
  const payload = await c.req.json().catch(() => null);
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const { password } = body;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || typeof password !== "string") return c.json({ error: "email and password are required" }, 400);

  const verification = await verifyTurnstileToken(
    c.env,
    body.turnstileToken,
    "afu_login",
    c.req.header("CF-Connecting-IP"),
  );
  if (verification !== "verified") {
    return c.json({
      error: verification === "unavailable"
        ? "Human verification is temporarily unavailable. Please try again shortly."
        : "Complete the Cloudflare human verification and try again.",
    }, verification === "unavailable" ? 503 : 403);
  }

  const db = createDbClient(c.env);
  let sharedAuthUser;
  try {
    sharedAuthUser = await signInWithSupabase(c.env, email, password);
  } catch (error) {
    const failure = loginFailure(error);
    const authError = normalizedAuthError(error);
    console.warn("[AfuCloud Auth] sign-in rejected", { status: authError.status, code: authError.code });
    return c.json({ error: failure.message }, failure.status);
  }
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