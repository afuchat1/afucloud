import { createMiddleware } from "hono/factory";
import type { Env, AuthVariables } from "../types";
import { verifyAccessToken, extractBearerToken, hashToken } from "../lib/auth";
import { createDbClient } from "../lib/db";

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const token = extractBearerToken(c.req.header("Authorization") ?? null);
  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const payload = await verifyAccessToken(token, c.env);
  if (payload) {
    c.set("userId", payload.userId);
    c.set("email", payload.email);
    c.set("authKind", "jwt");
    c.set("scopes", ["account:*"]);
    await next();
    return;
  }

  const db = createDbClient(c.env);
  const tokenHash = await hashToken(token);
  const personalToken = await db.getPersonalTokenByHash(tokenHash);
  if (personalToken) {
    if (personalToken.revoked_at || (personalToken.expires_at && new Date(personalToken.expires_at) <= new Date())) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    c.set("userId", personalToken.user_id);
    c.set("email", "");
    c.set("authKind", "personal_token");
    c.set("scopes", personalToken.scopes ?? ["account:*"]);
    await db.touchPersonalToken(personalToken.id);
    await next();
    return;
  }

  const apiKey = await db.getApiKeyByHash(tokenHash);
  if (!apiKey) return c.json({ error: "Invalid or expired token" }, 401);
  const ownerId = await db.getProjectOwnerId(apiKey.project_id);
  if (!ownerId) return c.json({ error: "The API key project no longer exists" }, 401);
  c.set("userId", ownerId);
  c.set("email", "");
  c.set("authKind", "project_key");
  c.set("projectId", apiKey.project_id);
  c.set("scopes", apiKey.scopes ?? []);
  await db.touchApiKey(apiKey.id);
  await next();
});

export const requireAccountAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const kind = c.get("authKind");
  if (kind === "project_key") return c.json({ error: "An account access token is required for this operation" }, 403);
  await next();
});

export const requireProjectAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const kind = c.get("authKind");
  const projectId = c.req.param("projectId") ?? c.req.param("id") ?? c.req.param("containerId");
  if (kind === "project_key" && c.get("projectId") !== projectId) {
    return c.json({ error: "This API key is restricted to its project" }, 403);
  }
  await next();
});

export function hasScope(c: { get: (key: "authKind" | "scopes") => "jwt" | "personal_token" | "project_key" | string[] }, scope: string): boolean {
  const kind = c.get("authKind");
  if (kind !== "project_key") return true;
  const scopes = c.get("scopes") as string[];
  return scopes.includes(scope) || scopes.includes("project:*") || scopes.includes("account:*");
}
