import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { apiKeysTable, db, personalTokensTable, projectsTable } from "@workspace/db";
import { hashToken, verifyAccessToken } from "../lib/auth";

export interface AuthRequest extends Request {
  userId?: string;
  userEmail?: string;
  authKind?: "jwt" | "personal_token" | "project_key";
  projectId?: string;
  scopes?: string[];
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.authKind = "jwt";
    req.scopes = ["account:*"];
    next();
    return;
  } catch {
    // Dashboard JWTs are not the only supported developer credential.
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
      req.scopes = personalToken.scopes ?? ["account:*"];
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
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireAccountAuth(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.authKind === "project_key") {
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
