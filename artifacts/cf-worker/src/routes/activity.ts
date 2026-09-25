import { Hono } from "hono";
import type { Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { requireAuth } from "../middleware/auth";

const activity = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

// GET /v1/activity
activity.get("/", requireAuth, async (c) => {
  const limit = Math.min(200, parseInt(c.req.query("limit") ?? "50", 10) || 50);
  const projectId = c.req.query("projectId");
  const db = createDbClient(c.env);
  const logs = await db.getActivity(c.get("userId"), limit, projectId);
  return c.json(logs.map((log: any) => ({
    id: log.id,
    userId: log.user_id,
    projectId: log.project_id,
    action: log.action,
    resource: log.resource,
    resourceId: log.resource_id,
    metadata: log.metadata,
    createdAt: log.created_at,
  })));
});

export default activity;
