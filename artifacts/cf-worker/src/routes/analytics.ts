import { Hono } from "hono";
import type { Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { requireAuth } from "../middleware/auth";

const analytics = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// GET /v1/analytics/overview
analytics.get("/overview", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const userId = c.get("userId");
  const projects = await db.getProjects(userId);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [projectStats, uploadEvents] = await Promise.all([
    Promise.all(projects.map((project: any) => db.getImageStats(project.id))),
    db.getImageUploadEvents(userId, projects.map((project: any) => project.id), sevenDaysAgo),
  ]);
  const totalImages = projectStats.reduce((sum, stats) => sum + stats.totalImages, 0);
  const totalStorageUsed = projectStats.reduce((sum, stats) => sum + stats.storageUsed, 0);

  return c.json({
    totalProjects: projects.length,
    totalImages,
    totalStorageUsed,
    totalBandwidth: 0,
    totalApiRequests: 0,
    recentUploads: uploadEvents.length,
  });
});

// GET /v1/projects/:projectId/analytics
analytics.get("/projects/:projectId", requireAuth, async (c) => {
  const projectId = c.req.param("projectId");
  const db = createDbClient(c.env);
  const project = await db.getProject(projectId, c.get("userId"));
  if (!project) return c.json({ error: "Project not found" }, 404);

  const period = c.req.query("period") ?? "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const stats = await db.getImageStats(projectId);

  const periodStart = new Date();
  periodStart.setUTCHours(0, 0, 0, 0);
  periodStart.setUTCDate(periodStart.getUTCDate() - (days - 1));
  const uploadEvents = await db.getImageUploadEvents(c.get("userId"), [projectId], periodStart);
  const uploadsByDate = new Map<string, number>();
  for (const event of uploadEvents) {
    const date = new Date(event.created_at).toISOString().slice(0, 10);
    uploadsByDate.set(date, (uploadsByDate.get(date) ?? 0) + 1);
  }

  const dailyStats = Array.from({ length: days }, (_, i) => {
    const date = new Date(periodStart);
    date.setUTCDate(date.getUTCDate() + i);
    const dateKey = date.toISOString().slice(0, 10);
    return { date: dateKey, uploads: uploadsByDate.get(dateKey) ?? 0, downloads: 0, bandwidth: 0 };
  });

  return c.json({
    uploads: stats.totalImages,
    downloads: 0,
    storageUsed: stats.storageUsed,
    bandwidth: 0,
    apiRequests: 0,
    dailyStats,
  });
});

export default analytics;
