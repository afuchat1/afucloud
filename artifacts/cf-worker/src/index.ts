import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import type { Env } from "./types";

import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";
import imageRoutes from "./routes/images";
import apiKeyRoutes from "./routes/apikeys";
import tokenRoutes from "./routes/tokens";
import webhookRoutes from "./routes/webhooks";
import analyticsRoutes from "./routes/analytics";
import activityRoutes from "./routes/activity";
import storageRoutes from "./routes/storage";
import domainRoutes from "./routes/domains";
import storageContainerRoutes from "./routes/storage-containers";
import domainRegistrationRoutes from "./routes/domain-registrations";
import billingRoutes from "./routes/billing";
import publicAssetRoutes from "./routes/public-assets";

const app = new Hono<{ Bindings: Env }>();

// ── Global middleware ─────────────────────────────────────────────────────────
app.use("*", logger());
app.use("/cloud/*", async (c, next) => {
  await next();
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Range, If-None-Match, If-Modified-Since, If-Range");
  c.header("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag");
  c.header("Access-Control-Max-Age", "86400");
  c.res.headers.delete("Access-Control-Allow-Credentials");
});
app.use("*", secureHeaders());
const allowedOrigins = new Set([
  "https://afuchat.com",
  "https://www.afuchat.com",
]);

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      if (!origin) return origin;
      const configured = new Set(
        (c.env.DASHBOARD_ALLOWED_ORIGINS ?? "").split(",").map((item: string) => item.trim()).filter(Boolean),
      );
      if (allowedOrigins.has(origin) || configured.has(origin)) return origin;
      try {
        const url = new URL(origin);
        if (url.protocol === "https:" && (url.hostname === "afuchat.com" || url.hostname.endsWith(".afuchat.com"))) return origin;
      } catch {}
      return null;
    },
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Afu-CSRF"],
    credentials: true,
    exposeHeaders: ["Content-Range", "X-AfuCloud-Request-Id"],
    maxAge: 86400,
  }),
);

// ── Request ID ────────────────────────────────────────────────────────────────
app.use("*", async (c, next) => {
  c.res.headers.set("X-AfuCloud-Request-Id", crypto.randomUUID());
  c.res.headers.set("X-AfuCloud-Version", "v1");
  await next();
});

// ── Health ────────────────────────────────────────────────────────────────────
app.get("/", (c) =>
  c.json({
    name: "AfuCloud API",
    status: "ok",
    version: "v1",
    health: "/healthz",
  }),
);

app.get("/healthz", (c) =>
  c.json({ status: "ok", timestamp: new Date().toISOString(), version: "v1" }),
);

// Shared CDN hostname paths enter this existing AfuCloud Worker and use the
// same product-owned R2 binding as the API; no separate CDN Worker is needed.
app.route("/cloud", publicAssetRoutes);

// Keep the legacy /v1 API while adding the product-identifying
// /afucloud/v1 prefix required by the shared API routing architecture.
function mountApiRoutes(prefix: string) {
  app.route(`${prefix}/dashboard/session`, authRoutes);
  app.route(`${prefix}/projects`, projectRoutes);
  app.route(`${prefix}/analytics`, analyticsRoutes);
  app.route(`${prefix}/tokens`, tokenRoutes);
  app.route(`${prefix}/activity`, activityRoutes);
  app.route(`${prefix}/storage`, storageRoutes);
  app.route(`${prefix}/domains`, domainRoutes);
  app.route(`${prefix}/domains/registrations`, domainRegistrationRoutes);
  app.route(`${prefix}/billing`, billingRoutes);
  app.route(`${prefix}/storage-containers`, storageContainerRoutes);

  // Images: /{prefix}/projects/:projectId/images/*
  const imageApp = new Hono<{ Bindings: Env }>();
  imageApp.route("/:projectId/images", imageRoutes);
  app.route(`${prefix}/projects`, imageApp);

  // API Keys: /{prefix}/projects/:projectId/api-keys/*
  const apiKeyApp = new Hono<{ Bindings: Env }>();
  apiKeyApp.route("/:projectId/api-keys", apiKeyRoutes);
  app.route(`${prefix}/projects`, apiKeyApp);

  // Webhooks: /{prefix}/projects/:projectId/webhooks/*
  const webhookApp = new Hono<{ Bindings: Env }>();
  webhookApp.route("/:projectId/webhooks", webhookRoutes);
  app.route(`${prefix}/projects`, webhookApp);

  // Project analytics: /{prefix}/analytics/projects/:projectId
  app.route(`${prefix}/analytics`, analyticsRoutes);
}

mountApiRoutes("/v1");
mountApiRoutes("/afucloud/v1");

// ── 404 ───────────────────────────────────────────────────────────────────────
app.notFound((c) =>
  c.json(
    {
      error: "Not found",
      path: c.req.path,
      timestamp: new Date().toISOString(),
      api_version: "v1",
    },
    404,
  ),
);

// ── Error handler ─────────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error("[AfuCloud Worker Error]", err);
  return c.json(
    {
      error: "Internal server error",
      timestamp: new Date().toISOString(),
      api_version: "v1",
    },
    500,
  );
});

export default app;
