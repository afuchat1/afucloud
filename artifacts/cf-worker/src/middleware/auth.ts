import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { Env, AuthVariables } from "../types";
import { verifyAccessToken, extractBearerToken, hashToken } from "../lib/auth";
import { createDbClient } from "../lib/db";

export const DASHBOARD_ACCESS_COOKIE = "afucloud_dashboard_access";
export const DASHBOARD_REFRESH_COOKIE = "afucloud_dashboard_refresh";
export const DASHBOARD_CSRF_COOKIE = "afucloud_dashboard_csrf";
export const DASHBOARD_CSRF_HEADER = "x-afu-csrf";

type AuthContext = Context<{ Bindings: Env; Variables: AuthVariables }>;

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

function hasValidCsrf(c: AuthContext): boolean {
  const cookie = getCookie(c, DASHBOARD_CSRF_COOKIE);
  const header = c.req.header(DASHBOARD_CSRF_HEADER);
  return typeof cookie === "string" && typeof header === "string" && constantTimeEqual(cookie, header);
}

async function authenticateDashboardCookie(c: AuthContext): Promise<{ error: string; status: 401 | 403 } | null> {
  const token = getCookie(c, DASHBOARD_ACCESS_COOKIE);
  if (!token) return { error: "Unauthorized", status: 401 };

  const payload = await verifyAccessToken(token, c.env);
  if (!payload) return { error: "Dashboard session expired", status: 401 };

  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method.toUpperCase()) && !hasValidCsrf(c)) {
    return { error: "A valid dashboard CSRF token is required", status: 403 };
  }

  c.set("userId", payload.userId);
  c.set("email", payload.email);
  c.set("authKind", "dashboard_session");
  c.set("scopes", ["account:*"]);
  return null;
}

export const requireCsrf = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  if (!hasValidCsrf(c)) return c.json({ error: "A valid dashboard CSRF token is required" }, 403);
  await next();
});

export const rejectDeveloperCredential = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  if (c.req.header("Authorization")) {
    return c.json({ error: "Developer API credentials cannot access dashboard session routes" }, 403);
  }
  await next();
});

export const requireAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const authorization = c.req.header("Authorization");
  if (!authorization) {
    const error = await authenticateDashboardCookie(c);
    if (error) return c.json({ error: error.error }, error.status);
    await next();
    return;
  }

  const token = extractBearerToken(authorization);
  if (!token) return c.json({ error: "Use a personal account token or project API key" }, 401);

  const dashboardPayload = await verifyAccessToken(token, c.env);
  if (dashboardPayload) {
    return c.json({ error: "Dashboard sessions cannot be used as developer API tokens" }, 403);
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
    c.set("scopes", personalToken.scopes?.length ? personalToken.scopes : ["account:*"]);
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

export const requireDashboardSession = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  if (c.req.header("Authorization")) {
    return c.json({ error: "Developer API credentials cannot access dashboard session routes" }, 403);
  }
  const error = await authenticateDashboardCookie(c);
  if (error) return c.json({ error: error.error }, error.status);
  await next();
});

export const requireAccountAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const kind = c.get("authKind");
  const scopes = c.get("scopes") ?? [];
  if (kind !== "dashboard_session" && !(kind === "personal_token" && scopes.includes("account:*"))) {
    return c.json({ error: "An account access token is required for this operation" }, 403);
  }
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

export function hasScope(c: { get: (key: "authKind" | "scopes") => "dashboard_session" | "personal_token" | "project_key" | string[] }, scope: string): boolean {
  const kind = c.get("authKind");
  if (kind !== "project_key") return true;
  const scopes = c.get("scopes") as string[];
  return scopes.includes(scope) || scopes.includes("project:*") || scopes.includes("account:*");
}