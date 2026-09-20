import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { authUsersTable, db, usersTable, refreshTokensTable } from "@workspace/db";
import {
  hashPassword,
  verifyPassword,
  isBcryptHash,
  hashPbkdf2Password,
  signAccessToken,
  generateSecureToken,
  hashToken,
  refreshTokenExpiresAt,
} from "../lib/auth";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

const SUPABASE_PROFILE_PASSWORD_MARKER = "supabase-auth:";

type AuthMetadata = Record<string, unknown>;

function getAuthName(email: string, metadata: unknown): string {
  const values = metadata && typeof metadata === "object" ? metadata as AuthMetadata : {};
  const name = values.name ?? values.full_name ?? values.display_name;
  return typeof name === "string" && name.trim() ? name.trim() : email.split("@")[0];
}

async function ensureAfuCloudProfile(authUser: typeof authUsersTable.$inferSelect) {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, authUser.id)).limit(1);
  if (existing) return existing;

  const email = authUser.email?.trim().toLowerCase();
  if (!email) throw new Error("Supabase Auth user has no email address");

  const [emailMatch] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (emailMatch) {
    throw new Error("Supabase Auth email is already linked to a different AfuCloud user");
  }

  const [profile] = await db.insert(usersTable).values({
    id: authUser.id,
    email,
    name: getAuthName(email, authUser.rawUserMetaData),
    passwordHash: `${SUPABASE_PROFILE_PASSWORD_MARKER}${authUser.id}`,
    emailVerified: Boolean(authUser.emailConfirmedAt),
  }).returning();
  return profile;
}

async function findSharedAuthUser(email: string) {
  const [authUser] = await db
    .select()
    .from(authUsersTable)
    .where(eq(authUsersTable.email, email))
    .limit(1);
  return authUser;
}

// POST /v1/auth/register
router.post("/v1/auth/register", async (req, res): Promise<void> => {
  const { password, name } = req.body ?? {};
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !password || !name) {
    res.status(400).json({ error: "email, password, and name are required" });
    return;
  }
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
  if (existing.length > 0) {
    res.status(409).json({ error: "Email already registered" });
    return;
  }
  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(usersTable).values({ email, name, passwordHash }).returning();
  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  const rawRefresh = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: hashToken(rawRefresh),
    expiresAt: refreshTokenExpiresAt(),
  });
  res.status(201).json({
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, emailVerified: user.emailVerified, createdAt: user.createdAt },
    accessToken,
    refreshToken: rawRefresh,
  });
});

// POST /v1/auth/login
router.post("/v1/auth/login", async (req, res): Promise<void> => {
  const { password } = req.body ?? {};
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!email || !password) {
    res.status(400).json({ error: "email and password are required" });
    return;
  }
  const sharedAuthUser = await findSharedAuthUser(email);
  let user;

  if (sharedAuthUser) {
    const valid = await verifyPassword(password, sharedAuthUser.encryptedPassword);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    user = await ensureAfuCloudProfile(sharedAuthUser);
  } else {
    // Compatibility for the two older accounts created before Supabase Auth
    // became the shared identity source.
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
  }
  // The shared worker uses PBKDF2. Migrate older bcrypt credentials after a
  // successful login so every AfuCloud service can verify the same account.
  if (isBcryptHash(user.passwordHash)) {
    await db
      .update(usersTable)
      .set({ passwordHash: await hashPbkdf2Password(password) })
      .where(eq(usersTable.id, user.id));
  }
  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  const rawRefresh = generateSecureToken();
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: hashToken(rawRefresh),
    expiresAt: refreshTokenExpiresAt(),
  });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, emailVerified: user.emailVerified, createdAt: user.createdAt },
    accessToken,
    refreshToken: rawRefresh,
  });
});

// POST /v1/auth/logout
router.post("/v1/auth/logout", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  if (refreshToken) {
    await db.delete(refreshTokensTable).where(eq(refreshTokensTable.tokenHash, hashToken(refreshToken)));
  }
  res.json({ message: "Logged out" });
});

// POST /v1/auth/refresh
router.post("/v1/auth/refresh", async (req, res): Promise<void> => {
  const { refreshToken } = req.body ?? {};
  if (!refreshToken) {
    res.status(400).json({ error: "refreshToken is required" });
    return;
  }
  const [record] = await db.select().from(refreshTokensTable)
    .where(eq(refreshTokensTable.tokenHash, hashToken(refreshToken))).limit(1);
  if (!record || record.expiresAt < new Date()) {
    res.status(401).json({ error: "Invalid or expired refresh token" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, record.userId)).limit(1);
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  const accessToken = signAccessToken({ userId: user.id, email: user.email });
  const newRaw = generateSecureToken();
  await db.delete(refreshTokensTable).where(eq(refreshTokensTable.id, record.id));
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: hashToken(newRaw),
    expiresAt: refreshTokenExpiresAt(),
  });
  res.json({
    user: { id: user.id, email: user.email, name: user.name, avatar: user.avatar, emailVerified: user.emailVerified, createdAt: user.createdAt },
    accessToken,
    refreshToken: newRaw,
  });
});

// GET /v1/auth/me
router.get("/v1/auth/me", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, emailVerified: user.emailVerified, createdAt: user.createdAt });
});

// PATCH /v1/auth/me/update
router.patch("/v1/auth/me/update", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { name, avatar } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (avatar !== undefined) updates.avatar = avatar;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.userId!)).returning();
  res.json({ id: user.id, email: user.email, name: user.name, avatar: user.avatar, emailVerified: user.emailVerified, createdAt: user.createdAt });
});

// PATCH /v1/auth/me/password
router.patch("/v1/auth/me/password", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword are required" });
    return;
  }
  if (newPassword.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.userId!)).limit(1);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }
  const passwordHash = await hashPassword(newPassword);
  await db.update(usersTable).set({ passwordHash }).where(eq(usersTable.id, req.userId!));
  res.json({ message: "Password updated successfully" });
});

// POST /v1/auth/forgot-password (stub)
router.post("/v1/auth/forgot-password", async (_req, res): Promise<void> => {
  res.json({ message: "If that email exists, a reset link has been sent." });
});

// POST /v1/auth/reset-password (stub)
router.post("/v1/auth/reset-password", async (_req, res): Promise<void> => {
  res.json({ message: "Password reset successfully." });
});

export default router;
