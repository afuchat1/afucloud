import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { apiKeysTable, db, personalTokensTable, projectsTable } from "@workspace/db";
import { hashToken, verifyAccessToken } from "../lib/auth";

export const DASHBOARD_ACCESS_COOKIE = "afucloud_dashboard_access";
export const DASHBOARD_REFRESH_COOKIE = "afucloud_dashboard_refresh";
export const DASHBOARD_CSRF_COOKIE = "afucloud_dashboard_csrf";
export const DASHBOARD_CSRF_HEADER = "x-afu-csrf";

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  authKind?: "dashboard_session" | "personal_token" | "project_key";
  projectId?: string;
  scopes?: string[];
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function hasValidCsrf(req: AuthRequest): boolean {
  const cookie = req.cookies?.[DASHBOARD_CSRF_COOKIE];
  const header = req.get(DASHBOARD_CSRF_HEADER);
  return typeof cookie === "string" && typeof header === "string" && safeEqual(cookie, header);
}

export function requireCsrf(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!hasValidCsrf(req)) {
    res.status(403).json({ error: "A valid dashboard CSRF token is required" });
    return;
  }
  next();
}

export function rejectDeveloperCredential(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.headers.authorization) {
    res.status(403).json({ error: "Developer API credentials cannot access dashboard session routes" });
    return;
  }
  next();
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (header) {
    if (!header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Use a personal account token or project API key" });
      return;
    }

    const token = header.slice(7);
    try {
      verifyAccessToken(token);
      res.status(403).json({ error: "Dashboard sessions cannot be used as developer API tokens" });
      return;
    } catch {
      // Continue with the developer-token lookup below.
    }

    try {
      const tokenHash = hashToken(token);
      const [personalToken] = await db.select().from(personalTokensTable)
        .where(eq(personalTokensTable.tokenHash, tokenHash)).limit(1);
      if (personalToken) {
        if (personalToken.revokedAt || (personalToken.expiresAt && personalToken.expiresAt <= new Date())) {
          res.status(401).json({ error: "Invalid or expired token" });
          return;
        }
        req.userId = personalToken.userId;
        req.userEmail = "";
        req.authKind = "personal_token";
        req.scopes = personalToken.scopes?.length ? personalToken.scopes : ["account:*"];
        await db.update(personalTokensTable).set({ lastUsedAt: new Date() })
          .where(eq(personalTokensTable.id, personalToken.id));
        next();
        return;
      }

      const [apiKey] = await db.select({
        id: apiKeysTable.id,
        projectId: apiKeysTable.projectId,
        userId: projectsTable.userId,
        scopes: apiKeysTable.scopes,
      }).from(apiKeysTable)
        .innerJoin(projectsTable, eq(projectsTable.id, apiKeysTable.projectId))
        .where(eq(apiKeysTable.keyHash, tokenHash)).limit(1);
      if (!apiKey) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      req.userId = apiKey.userId;
      req.userEmail = "";
      req.authKind = "project_key";
      req.projectId = apiKey.projectId;
      req.scopes = apiKey.scopes ?? [];
      await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, apiKey.id));
      next();
      return;
    } catch {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  }

  const sessionToken = req.cookies?.[DASHBOARD_ACCESS_COOKIE];
  if (!sessionToken) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const payload = verifyAccessToken(sessionToken);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.authKind = "dashboard_session";
    req.scopes = ["account:*"];
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !hasValidCsrf(req)) {
      res.status(403).json({ error: "A valid dashboard CSRF token is required" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Dashboard session expired" });
  }
}

export function requireDashboardSession(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.headers.authorization) {
    res.status(403).json({ error: "Developer API credentials cannot access dashboard session routes" });
    return;
  }
  void requireAuth(req, res, (error?: unknown) => {
    if (error) {
      next(error);
      return;
    }
    if (req.authKind !== "dashboard_session") {
      res.status(403).json({ error: "A dashboard session is required" });
      return;
    }
    next();
  });
}

export function requireAccountAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (
    req.authKind !== "dashboard_session" &&
    !(req.authKind === "personal_token" && req.scopes?.includes("account:*"))
  ) {
    res.status(403).json({ error: "An account access token is required for this operation" });
    return;
  }
  next();
}

export function requireProjectAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  const projectId = req.params.projectId ?? req.params.id ?? req.params.containerId;
  if (req.authKind === "project_key" && req.projectId !== projectId) {
    res.status(403).json({ error: "This API key is restricted to its project" });
    return;
  }
  next();
}
