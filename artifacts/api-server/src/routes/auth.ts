import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { authUsersTable, db, profilesTable, refreshTokensTable } from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
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
  type AuthRequest,
} from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import crypto from "crypto";

const router: IRouter = Router();
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 1000;
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

function sessionCookieOptions(httpOnly: boolean, maxAge: number) {
  return {
    httpOnly,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function setDashboardCookies(
  res: Parameters<Parameters<typeof router.post>[1]>[1],
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(DASHBOARD_ACCESS_COOKIE, accessToken, sessionCookieOptions(true, ACCESS_COOKIE_MAX_AGE));
  res.cookie(DASHBOARD_REFRESH_COOKIE, refreshToken, sessionCookieOptions(true, REFRESH_COOKIE_MAX_AGE));
}

function clearDashboardCookies(res: Parameters<Parameters<typeof router.post>[1]>[1]): void {
  const options = sessionCookieOptions(true, 0);
  res.clearCookie(DASHBOARD_ACCESS_COOKIE, options);
  res.clearCookie(DASHBOARD_REFRESH_COOKIE, options);
  res.clearCookie(DASHBOARD_CSRF_COOKIE, { ...options, httpOnly: false });
}

router.get("/v1/dashboard/session/csrf", rejectDeveloperCredential, (req: AuthRequest, res): void => {
  const existing = req.cookies?.[DASHBOARD_CSRF_COOKIE];
  const csrfToken = typeof existing === "string" && /^[a-f0-9]{64}$/i.test(existing)
    ? existing
    : generateSecureToken();
  res.cookie(DASHBOARD_CSRF_COOKIE, csrfToken, sessionCookieOptions(false, REFRESH_COOKIE_MAX_AGE));
  res.json({ csrfToken });
});

type AuthMetadata = Record<string, unknown>;

function getAuthName(email: string, metadata: unknown): string {
  const values = metadata && typeof metadata === "object" ? metadata as AuthMetadata : {};
  const name = values.name ?? values.full_name ?? values.display_name;
  return typeof name === "string" && name.trim() ? name.trim() : email.split("@")[0];
}

function authUnavailable(res: Parameters<Parameters<typeof router.post>[1]>[1], operation: string, error: unknown): void {
  const cause = error instanceof Error && "cause" in error
    ? (error as Error & { cause?: unknown }).cause
    : undefined;
  logger.error({
    operation,
    code: cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined,
    message: error instanceof Error ? error.message : String(error),
  }, "Authentication dependency unavailable");
  res.status(503).json({ error: "Authentication service temporarily unavailable" });
}

async function ensureAfuCloudProfile(authUser: typeof authUsersTable.$inferSelect) {
  const [existing] = await db.select().from(profilesTable).where(eq(profilesTable.userId, authUser.id)).limit(1);
  const email = authUser.email?.trim().toLowerCase();
  if (!email) throw new Error("Supabase Auth user has no email address");
  const authName = getAuthName(email, authUser.rawUserMetaData);

  if (existing) {
    const updates: Partial<{
      email: string;
      emailVerified: boolean;
      name: string;
      fullName: string;
    }> = {};
    if (existing.email !== email) updates.email = email;
    if (authUser.emailConfirmedAt && !existing.emailVerified) updates.emailVerified = true;
    if (!existing.name) updates.name = authName;
    if (!existing.fullName) updates.fullName = authName;
    if (Object.keys(updates).length === 0) return existing;

    const [updated] = await db.update(profilesTable)
      .set(updates)
      .where(eq(profilesTable.userId, authUser.id))
      .returning();
    return updated ?? existing;
  }

  const emailMatches = await db.select().from(profilesTable)
    .where(sql`lower(${profilesTable.email}) = ${email}`)
    .limit(2);
  if (emailMatches.length > 1) {
    throw new Error("Multiple shared profiles use the Supabase Auth email");
  }
  const emailMatch = emailMatches[0];
  if (emailMatch) {
    if (emailMatch.userId === authUser.id) return emailMatch;
    if (emailMatch.userId != null) {
      throw new Error("Supabase Auth email is already linked to a different user");
    }
    if (!authUser.emailConfirmedAt || emailMatch.id !== authUser.id) {
      throw new Error("Unlinked shared profile cannot be safely claimed by this Auth user");
    }

    const [claimed] = await db.update(profilesTable)
      .set({
        id: authUser.id,
        userId: authUser.id,
        email,
        emailVerified: true,
        name: emailMatch.name ?? authName,
        fullName: emailMatch.fullName ?? authName,
      })
      .where(and(
        eq(profilesTable.id, emailMatch.id),
        sql`lower(${profilesTable.email}) = ${email}`,
        isNull(profilesTable.userId),
      ))
      .returning();
    if (claimed) return claimed;

    const [concurrentlyLinked] = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, authUser.id))
      .limit(1);
    if (concurrentlyLinked) return concurrentlyLinked;
    throw new Error("Shared profile changed before it could be linked");
  }

  try {
    const [profile] = await db.insert(profilesTable).values({
      id: authUser.id,
      userId: authUser.id,
      email,
      emailVerified: Boolean(authUser.emailConfirmedAt),
      name: authName,
      fullName: authName,
    }).returning();
    if (!profile) throw new Error("Shared profile creation returned no row");
    return profile;
  } catch (error) {
    const [concurrentProfile] = await db.select().from(profilesTable)
      .where(eq(profilesTable.userId, authUser.id))
      .limit(1);
    if (concurrentProfile) return concurrentProfile;
    throw error;
  }
}

function toApiUser(
  authUser: typeof authUsersTable.$inferSelect,
  profile: typeof profilesTable.$inferSelect,
) {
  return {
    id: authUser.id,
    email: authUser.email ?? profile.email,
    name: profile.name ?? profile.fullName ?? authUser.email?.split("@")[0] ?? "User",
    avatar: profile.avatar ?? profile.avatarUrl,
    emailVerified: Boolean(authUser.emailConfirmedAt),
    createdAt: authUser.createdAt,
  };
}

async function findSharedAuthUser(email: string) {
  try {
    const [authUser] = await db
      .select()
      .from(authUsersTable)
      .where(sql`lower(${authUsersTable.email}) = ${email}`)
      .limit(1);
    return authUser;
  } catch (error) {
    const cause = error instanceof Error && "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
    console.error("Shared auth lookup failed", {
      code: cause && typeof cause === "object" && "code" in cause ? (cause as { code?: unknown }).code : undefined,
      message: cause instanceof Error ? cause.message : error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// Dashboard session routes are intentionally separate from developer bearer-token routes.
router.post("/v1/dashboard/session/register", rejectDeveloperCredential, requireCsrf, async (req, res): Promise<void> => {
  const { password, name } = req.body ?? {};
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !password || !name) {
    res.status(400).json({ error: "email, password, and name are required" });
    return;
  }
  if (typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const existing = await findSharedAuthUser(email);
  if (existing) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const encryptedPassword = await hashPassword(password);
  const now = new Date();
  const [authUser] = await db.insert(authUsersTable).values({
    id: crypto.randomUUID(),
    aud: "authenticated",
    role: "authenticated",
    email,
    encryptedPassword,
    rawAppMetaData: { provider: "email", providers: ["email"] },
    createdAt: now,
    updatedAt: now,
    rawUserMetaData: { name },
  }).returning();
  const user = await ensureAfuCloudProfile(authUser);
  const accessToken = signAccessToken({ userId: authUser.id, email: authUser.email ?? email });
  const rawRefresh = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: authUser.id,
    tokenHash: hashToken(rawRefresh),
    expiresAt: refreshTokenExpiresAt(),
  });
  setDashboardCookies(res, accessToken, rawRefresh);
  res.status(201).json({ user: toApiUser(authUser, user) });
});

router.post("/v1/dashboard/session/login", rejectDeveloperCredential, requireCsrf, async (req, res): Promise<void> => {
  const { password } = req.body ?? {};
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  try {
    const sharedAuthUser = await findSharedAuthUser(email);
    if (!sharedAuthUser) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const valid = await verifyPassword(password, sharedAuthUser.encryptedPassword);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const user = await ensureAfuCloudProfile(sharedAuthUser);
    const accessToken = signAccessToken({ userId: sharedAuthUser.id, email: sharedAuthUser.email ?? email });
    const rawRefresh = generateSecureToken();
    await db.insert(refreshTokensTable).values({
      userId: sharedAuthUser.id,
      tokenHash: hashToken(rawRefresh),
      expiresAt: refreshTokenExpiresAt(),
    });
    setDashboardCookies(res, accessToken, rawRefresh);
    res.json({ user: toApiUser(sharedAuthUser, user) });
  } catch (error) {
    authUnavailable(res, "auth.login", error);
  }
});

router.post("/v1/dashboard/session/logout", rejectDeveloperCredential, requireCsrf, async (req, res): Promise<void> => {
  const refreshToken = req.cookies?.[DASHBOARD_REFRESH_COOKIE];
  if (typeof refreshToken === "string" && refreshToken.length > 0) {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, hashToken(refreshToken)));
  }
  clearDashboardCookies(res);
  res.json({ message: "Logged out" });
});

router.post("/v1/dashboard/session/refresh", rejectDeveloperCredential, requireCsrf, async (req, res): Promise<void> => {
  const refreshToken = req.cookies?.[DASHBOARD_REFRESH_COOKIE];
  if (!refreshToken) {
    clearDashboardCookies(res);
    res.status(401).json({ error: "Dashboard session expired" });
    return;
  }
  const [record] = await db.select().from(refreshTokensTable)
    .where(eq(refreshTokensTable.tokenHash, hashToken(refreshToken))).limit(1);
  if (!record || record.expiresAt < new Date()) {
    clearDashboardCookies(res);
    res.status(401).json({ error: "Invalid or expired dashboard session" });
    return;
  }
  const [authUser] = await db.select().from(authUsersTable).where(eq(authUsersTable.id, record.userId)).limit(1);
  if (!authUser) {
    clearDashboardCookies(res);
    res.status(401).json({ error: "User not found" });
    return;
  }
  const user = await ensureAfuCloudProfile(authUser);
  const accessToken = signAccessToken({ userId: authUser.id, email: authUser.email ?? "" });
  const newRaw = generateSecureToken();
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, record.id));
  await db.insert(refreshTokensTable).values({
    userId: authUser.id,
    tokenHash: hashToken(newRaw),
    expiresAt: refreshTokenExpiresAt(),
  });
  setDashboardCookies(res, accessToken, newRaw);
  res.json({ user: toApiUser(authUser, user) });
});

router.get("/v1/dashboard/session/me", requireDashboardSession, async (req: AuthRequest, res): Promise<void> => {
  const [authUser] = await db.select().from(authUsersTable).where(eq(authUsersTable.id, req.userId!)).limit(1);
  if (!authUser) { res.status(404).json({ error: "User not found" }); return; }
  const profile = await ensureAfuCloudProfile(authUser);
  res.json(toApiUser(authUser, profile));
});

// PATCH /v1/auth/me/update
router.patch("/v1/dashboard/session/me/update", requireDashboardSession, async (req: AuthRequest, res): Promise<void> => {
  const { name, avatar } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (avatar !== undefined) updates.avatar = avatar;
  const [profile] = await db.update(profilesTable).set(updates).where(eq(profilesTable.userId, req.userId!)).returning();
  const [authUser] = await db.select().from(authUsersTable).where(eq(authUsersTable.id, req.userId!)).limit(1);
  if (!profile || !authUser) { res.status(404).json({ error: "User not found" }); return; }
  res.json(toApiUser(authUser, profile));
});

// PATCH /v1/auth/me/password
router.patch("/v1/dashboard/session/me/password", requireDashboardSession, async (req: AuthRequest, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const [authUser] = await db.select().from(authUsersTable).where(eq(authUsersTable.id, req.userId!)).limit(1);
  if (!authUser) { res.status(404).json({ error: "User not found" }); return; }
  const valid = await verifyPassword(currentPassword, authUser.encryptedPassword);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const encryptedPassword = await hashPassword(newPassword);
  await db.update(authUsersTable)
    .set({ encryptedPassword, updatedAt: new Date() })
    .where(eq(authUsersTable.id, req.userId!));
  res.json({ message: "Password updated successfully" });
});

export default router;
