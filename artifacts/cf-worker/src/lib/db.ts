// Lightweight Supabase REST API client for Cloudflare Workers
import type { Env } from "../types";

export type DbClient = ReturnType<typeof createDbClient>;

export function createDbClient(env: Env) {
  const baseUrl = `${env.SUPABASE_URL}/rest/v1`;
  const schema = env.SUPABASE_DB_SCHEMA ?? "afucloud";
  const headers: Record<string, string> = {
    apikey: env.SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    "Content-Type": "application/json",
    "Accept-Profile": schema,
    "Content-Profile": schema,
  };

  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    extraHeaders?: Record<string, string>,
    profileSchema = schema,
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...headers,
        "Accept-Profile": profileSchema,
        "Content-Profile": profileSchema,
        ...extraHeaders,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function fetchAllRows<T>(path: string, pageSize = 1000): Promise<T[]> {
    const rows: T[] = [];
    const separator = path.includes("?") ? "&" : "?";

    for (let offset = 0; ; offset += pageSize) {
      const response = await request(`${path}${separator}limit=${pageSize}&offset=${offset}`);
      if (!response.ok) throw new Error(`Supabase query failed: HTTP ${response.status}`);
      const page = await response.json() as T[];
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  async function getUserById(id: string) {
    const r = await request(`/profiles?user_id=eq.${id}&limit=1`, "GET", undefined, undefined, "accounts");
    if (!r.ok) throw new Error(`Shared profile lookup failed: HTTP ${r.status}`);
    const rows = await r.json() as any[];
    return rows[0] ?? null;
  }

  async function linkUnlinkedUser(id: string, userId: string, email: string) {
    const r = await request(
      `/profiles?id=eq.${encodeURIComponent(id)}&email=eq.${encodeURIComponent(email)}&user_id=is.null`,
      "PATCH",
      { user_id: userId, email_verified: true },
      { Prefer: "return=representation" },
      "accounts",
    );
    if (!r.ok) throw new Error(`Shared profile link failed: HTTP ${r.status}`);
    const rows = await r.json() as any[];
    return rows[0] ?? null;
  }

  return {
    // ── Users ──────────────────────────────────────────────────────────────
    async getUserByEmail(email: string) {
      const r = await request(`/profiles?email=ilike.${encodeURIComponent(email)}&limit=1`, "GET", undefined, undefined, "accounts");
      if (!r.ok) throw new Error(`Shared profile lookup failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getUserById(id: string) {
      return getUserById(id);
    },
    async linkUnlinkedUser(id: string, userId: string, email: string) {
      return linkUnlinkedUser(id, userId, email);
    },
    async createUser(data: {
      id?: string;
      user_id: string;
      email: string;
      name: string;
      email_verified?: boolean;
    }) {
      const r = await request("/profiles", "POST", data, { Prefer: "return=representation" }, "accounts");
      if (!r.ok) {
        // Supabase's auth trigger can create this profile concurrently with
        // the sign-in/signup repair path. Only recover when the conflicting
        // row belongs to this exact Auth user; never attach by email alone.
        if (r.status === 409) {
          const existing = await getUserById(data.user_id);
          if (existing) return existing;

          // PostgREST's duplicate response can identify the conflicting
          // constraint. Log only schema metadata, never its key values.
          const conflict = await r.clone().json().catch(() => ({})) as {
            code?: unknown;
            message?: unknown;
            details?: unknown;
          };
          const message = typeof conflict.message === "string" ? conflict.message : "";
          const details = typeof conflict.details === "string" ? conflict.details : "";
          const rawConstraint = message.match(/unique constraint ["']([^"']+)["']/i)?.[1];
          const rawColumns = details.match(/Key \(([^)]+)\)=/)?.[1];
          const constraint = rawConstraint && /^[A-Za-z0-9_.]+$/.test(rawConstraint) ? rawConstraint : null;
          const keyColumns = rawColumns
            ?.split(",")
            .map((column) => column.trim())
            .filter((column) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(column)) ?? [];
          console.warn("[AfuCloud Auth] shared profile insert conflict", {
            code: typeof conflict.code === "string" ? conflict.code : null,
            constraint,
            keyColumns,
          });
        }
        throw new Error(`Shared profile creation failed: HTTP ${r.status}`);
      }
      const rows = await r.json() as any[];
      if (!rows[0]) throw new Error("Shared profile creation returned no row");
      return rows[0];
    },
    async updateUser(id: string, data: Record<string, unknown>) {
      const r = await request(`/profiles?user_id=eq.${id}`, "PATCH", data, { Prefer: "return=representation" }, "accounts");
      if (!r.ok) throw new Error(`Shared profile update failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0];
    },

    // ── Refresh Tokens ──────────────────────────────────────────────────────
    async getRefreshToken(tokenHash: string) {
      const r = await request(`/refresh_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async createRefreshToken(data: { user_id: string; token_hash: string; expires_at: string }) {
      const r = await request("/refresh_tokens", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async deleteRefreshToken(id: string) {
      await request(`/refresh_tokens?id=eq.${id}`, "DELETE");
    },
    async deleteRefreshTokenByHash(tokenHash: string) {
      await request(`/refresh_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}`, "DELETE");
    },
    async deleteRefreshTokensByUserId(userId: string) {
      await request(`/refresh_tokens?user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    },

    // ── Projects ────────────────────────────────────────────────────────────
    async getProjects(userId: string) {
      const r = await request(`/projects?user_id=eq.${userId}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async getProject(id: string, userId: string) {
      const r = await request(`/projects?id=eq.${id}&user_id=eq.${userId}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getProjectOwnerId(id: string) {
      const r = await request(`/projects?id=eq.${encodeURIComponent(id)}&select=user_id&limit=1`);
      const rows = await r.json() as Array<{ user_id?: string }>;
      return rows[0]?.user_id ?? null;
    },
    async createProject(data: { name: string; slug: string; description?: string; user_id: string }) {
      const r = await request("/projects", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateProject(id: string, data: Record<string, unknown>) {
      const r = await request(`/projects?id=eq.${id}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async deleteProject(id: string) {
      await request(`/projects?id=eq.${id}`, "DELETE");
    },

    // ── Images ──────────────────────────────────────────────────────────────
    async getImages(projectId: string, filters: Record<string, string> = {}) {
      let q = `/images?project_id=eq.${projectId}&deleted_at=is.null&order=created_at.desc`;
      if (filters.search) q += `&name=ilike.*${filters.search}*`;
      if (filters.format) q += `&format=eq.${filters.format}`;
      if (filters.album) q += `&album=eq.${filters.album}`;
      if (filters.favorite === "true") q += `&favorite=eq.true`;
      const limit = Math.min(200, parseInt(filters.limit ?? "50", 10) || 50);
      const page = Math.max(1, parseInt(filters.page ?? "1", 10) || 1);
      q += `&limit=${limit}&offset=${(page - 1) * limit}`;
      const r = await request(q, "GET", undefined, { Prefer: "count=exact" });
      const totalHeader = r.headers.get("Content-Range")?.split("/")[1];
      const rows = await r.json() as any[];
      return { images: rows, total: totalHeader ? parseInt(totalHeader, 10) : rows.length };
    },
    async getImage(id: string, projectId: string) {
      const r = await request(`/images?id=eq.${id}&project_id=eq.${projectId}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getDeletedImages(projectId: string) {
      const r = await request(`/images?project_id=eq.${projectId}&deleted_at=not.is.null&order=deleted_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async createImage(data: Record<string, unknown>) {
      const r = await request("/images", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateImage(id: string, data: Record<string, unknown>) {
      const r = await request(`/images?id=eq.${id}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async softDeleteImage(id: string) {
      const r = await request(`/images?id=eq.${id}`, "PATCH", { deleted_at: new Date().toISOString() }, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async restoreImage(id: string) {
      const r = await request(`/images?id=eq.${id}`, "PATCH", { deleted_at: null }, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async hardDeleteImage(id: string) {
      const r = await request(`/images?id=eq.${id}`, "DELETE", undefined, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async emptyTrash(projectId: string) {
      const r = await request(
        `/images?project_id=eq.${projectId}&deleted_at=not.is.null`,
        "DELETE",
        undefined,
        { Prefer: "return=representation" },
      );
      return r.json() as Promise<any[]>;
    },
    async getImageStats(projectId: string) {
      const [all, deleted] = await Promise.all([
        fetchAllRows<{ size: number | null; favorite: boolean }>(
          `/images?project_id=eq.${encodeURIComponent(projectId)}&deleted_at=is.null&select=size,favorite`,
        ),
        fetchAllRows<{ id: string }>(
          `/images?project_id=eq.${encodeURIComponent(projectId)}&deleted_at=not.is.null&select=id`,
        ),
      ]);
      return {
        totalImages: all.length,
        storageUsed: all.reduce((sum, image) => sum + (image.size ?? 0), 0),
        favoriteImages: all.filter(image => image.favorite).length,
        deletedImages: deleted.length,
        apiRequests: 0,
        bandwidth: 0,
      };
    },
    async getImageUploadEvents(userId: string, projectIds: string[], since: Date) {
      if (projectIds.length === 0) return [] as Array<{ created_at: string }>;

      const params = new URLSearchParams({
        user_id: `eq.${userId}`,
        project_id: projectIds.length === 1 ? `eq.${projectIds[0]}` : `in.(${projectIds.join(",")})`,
        action: "eq.upload",
        resource: "eq.image",
        created_at: `gte.${since.toISOString()}`,
        select: "created_at",
        order: "created_at.asc",
      });
      return fetchAllRows<{ created_at: string }>(`/activity_logs?${params.toString()}`);
    },

    // ── API Keys ────────────────────────────────────────────────────────────
    async getApiKeys(projectId: string) {
      const r = await request(`/api_keys?project_id=eq.${projectId}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async createApiKey(data: Record<string, unknown>) {
      const r = await request("/api_keys", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async revokeApiKey(id: string, projectId: string) {
      await request(`/api_keys?id=eq.${id}&project_id=eq.${projectId}`, "DELETE");
    },
    async getApiKeyByHash(keyHash: string) {
      const r = await request(`/api_keys?key_hash=eq.${encodeURIComponent(keyHash)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async touchApiKey(id: string) {
      await request(`/api_keys?id=eq.${encodeURIComponent(id)}`, "PATCH", {
        last_used_at: new Date().toISOString(),
      });
    },

    // ── Personal Tokens ─────────────────────────────────────────────────────
    async getPersonalTokens(userId: string) {
      const r = await request(`/personal_tokens?user_id=eq.${userId}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async createPersonalToken(data: Record<string, unknown>) {
      const r = await request("/personal_tokens", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async revokePersonalToken(id: string, userId: string) {
      await request(`/personal_tokens?id=eq.${id}&user_id=eq.${userId}`, "PATCH", {
        revoked_at: new Date().toISOString(),
      });
    },
    async getPersonalTokenByHash(tokenHash: string) {
      const r = await request(`/personal_tokens?token_hash=eq.${encodeURIComponent(tokenHash)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async touchPersonalToken(id: string) {
      await request(`/personal_tokens?id=eq.${encodeURIComponent(id)}`, "PATCH", {
        last_used_at: new Date().toISOString(),
      });
    },

    // ── Webhooks ────────────────────────────────────────────────────────────
    async getWebhooks(projectId: string) {
      const r = await request(`/webhooks?project_id=eq.${projectId}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async createWebhook(data: Record<string, unknown>) {
      const r = await request("/webhooks", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateWebhook(id: string, projectId: string, data: Record<string, unknown>) {
      const r = await request(`/webhooks?id=eq.${id}&project_id=eq.${projectId}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async deleteWebhook(id: string, projectId: string) {
      await request(`/webhooks?id=eq.${id}&project_id=eq.${projectId}`, "DELETE");
    },

    // ── Domains and hostnames ────────────────────────────────────────────────
    async getDomains(userId: string) {
      const r = await request(`/domains?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async getDomain(id: string, userId: string) {
      const r = await request(`/domains?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async createDomain(data: Record<string, unknown>) {
      const r = await request("/domains", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateDomain(id: string, userId: string, data: Record<string, unknown>) {
      const r = await request(`/domains?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async deleteDomain(id: string, userId: string) {
      await request(`/domains?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    },
    async getDomainRegistrationOrders(userId: string) {
      const r = await request(`/domain_registration_orders?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=100`);
      if (!r.ok) throw new Error(`Domain registration order lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<any[]>;
    },
    async getActiveDomainRegistrationOrdersByHostname(hostname: string) {
      const r = await request(
        `/domain_registration_orders?hostname=eq.${encodeURIComponent(hostname)}&status=in.(creating_checkout,pending_payment,paid,registering,processing,manual_review,registered)&order=created_at.desc&limit=1`,
      );
      if (!r.ok) throw new Error(`Domain registration order lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<any[]>;
    },
    async getActiveDomainRegistrationOrdersByPrefix(prefix: string) {
      const filters = new URLSearchParams({
        select: "hostname,status",
        hostname: `like.${prefix}.%`,
        status: "in.(creating_checkout,pending_payment,paid,registering,processing,manual_review,registered)",
        order: "created_at.desc",
        limit: "100",
      });
      const r = await request(`/domain_registration_orders?${filters.toString()}`);
      if (!r.ok) throw new Error(`Domain registration order lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<any[]>;
    },
    async getDomainRegistrationOrder(id: string, userId: string) {
      const r = await request(`/domain_registration_orders?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      if (!r.ok) throw new Error(`Domain registration order lookup failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async createDomainRegistrationOrder(data: Record<string, unknown>) {
      const r = await request("/domain_registration_orders", "POST", data, { Prefer: "return=representation" });
      if (!r.ok) throw new Error(`Domain registration order could not be created: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async updateDomainRegistrationOrder(
      id: string,
      userId: string,
      data: Record<string, unknown>,
      expectedStatus?: string,
    ) {
      const statusFilter = expectedStatus ? `&status=eq.${encodeURIComponent(expectedStatus)}` : "";
      const r = await request(
        `/domain_registration_orders?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}${statusFilter}`,
        "PATCH",
        { ...data, updated_at: new Date().toISOString() },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Domain registration order could not be updated: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async listRegisteredOrdersExpiringBetween(from: string, through: string) {
      const query = new URLSearchParams({
        status: "eq.registered",
        and: `(registration_expires_at.gte.${from},registration_expires_at.lte.${through})`,
        select: "id,user_id,hostname,registration_years,registration_expires_at",
        order: "registration_expires_at.asc",
        limit: "1000",
      });
      const r = await request(`/domain_registration_orders?${query.toString()}`);
      if (!r.ok) throw new Error(`Domain expiration lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<any[]>;
    },

    // ── Transactional email outbox ──────────────────────────────────────────
    async enqueueEmailOutbox(data: Record<string, unknown>) {
      const r = await request(
        "/email_outbox?on_conflict=event_key",
        "POST",
        data,
        { Prefer: "resolution=ignore-duplicates,return=representation" },
      );
      if (!r.ok) throw new Error(`Transactional email could not be queued: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async listDueEmailOutbox(now: string, limit = 20) {
      const query = new URLSearchParams({
        status: "eq.pending",
        available_at: `lte.${now}`,
        order: "available_at.asc,created_at.asc",
        limit: String(limit),
      });
      const r = await request(`/email_outbox?${query.toString()}`);
      if (!r.ok) throw new Error(`Transactional email queue lookup failed: HTTP ${r.status}`);
      return r.json() as Promise<any[]>;
    },
    async claimEmailOutbox(id: string, attempts: number, now: string) {
      const r = await request(
        `/email_outbox?id=eq.${encodeURIComponent(id)}&status=eq.pending&available_at=lte.${encodeURIComponent(now)}`,
        "PATCH",
        { status: "processing", attempts: attempts + 1, last_attempt_at: now, updated_at: now },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Transactional email could not be claimed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async markEmailOutboxSent(id: string, now: string) {
      const r = await request(
        `/email_outbox?id=eq.${encodeURIComponent(id)}&status=eq.processing`,
        "PATCH",
        { status: "sent", sent_at: now, updated_at: now, last_error: null },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Transactional email completion could not be saved: HTTP ${r.status}`);
    },
    async retryEmailOutbox(id: string, availableAt: string, errorCode: string, now: string) {
      const r = await request(
        `/email_outbox?id=eq.${encodeURIComponent(id)}&status=eq.processing`,
        "PATCH",
        { status: "pending", available_at: availableAt, last_error: errorCode, updated_at: now },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Transactional email retry could not be scheduled: HTTP ${r.status}`);
    },
    async failEmailOutbox(id: string, errorCode: string, now: string) {
      const r = await request(
        `/email_outbox?id=eq.${encodeURIComponent(id)}&status=eq.processing`,
        "PATCH",
        { status: "failed", last_error: errorCode, updated_at: now },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Transactional email failure could not be recorded: HTTP ${r.status}`);
    },
    async recoverStaleEmailOutbox(staleBefore: string, now: string) {
      const r = await request(
        `/email_outbox?status=eq.processing&updated_at=lt.${encodeURIComponent(staleBefore)}`,
        "PATCH",
        { status: "pending", available_at: now, updated_at: now, last_error: "stale_claim_recovered" },
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Stale transactional emails could not be recovered: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows.length;
    },
    async getBillingSubscription(userId: string) {
      const r = await request(`/billing_subscriptions?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      if (!r.ok) throw new Error(`Billing subscription lookup failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async upsertBillingSubscription(data: Record<string, unknown>) {
      const r = await request(
        "/billing_subscriptions?on_conflict=user_id",
        "POST",
        data,
        { Prefer: "resolution=merge-duplicates,return=representation" },
      );
      if (!r.ok) throw new Error(`Billing subscription could not be saved: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getApiKeyCountForUser(userId: string) {
      const projects = await fetchAllRows<{ id: string }>(
        `/projects?user_id=eq.${encodeURIComponent(userId)}&select=id`,
      );
      if (projects.length === 0) return 0;
      const projectIds = projects.map(project => project.id).join(",");
      const params = new URLSearchParams({
        project_id: `in.(${projectIds})`,
        select: "id",
      });
      const keys = await fetchAllRows<{ id: string }>(`/api_keys?${params.toString()}`);
      return keys.length;
    },
    async getHostnames(domainId: string, userId: string) {
      const r = await request(`/hostnames?domain_id=eq.${encodeURIComponent(domainId)}&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async getHostname(id: string, domainId: string, userId: string) {
      const r = await request(`/hostnames?id=eq.${encodeURIComponent(id)}&domain_id=eq.${encodeURIComponent(domainId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getHostnamesForCdn(userId: string, id?: string) {
      const idFilter = id ? `&id=eq.${encodeURIComponent(id)}` : "";
      const r = await request(`/hostnames?user_id=eq.${encodeURIComponent(userId)}${idFilter}&service=eq.cdn&limit=1`);
      return r.json() as Promise<any[]>;
    },
    async createHostname(data: Record<string, unknown>) {
      const r = await request("/hostnames", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateHostname(id: string, userId: string, data: Record<string, unknown>) {
      const r = await request(`/hostnames?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async deleteHostname(id: string, domainId: string, userId: string) {
      await request(`/hostnames?id=eq.${encodeURIComponent(id)}&domain_id=eq.${encodeURIComponent(domainId)}&user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    },

    // ── Cloudflare OAuth connections ─────────────────────────────────────────
    async getCloudflareConnection(userId: string) {
      const r = await request(`/cloudflare_connections?user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      if (!r.ok) throw new Error(`Cloudflare connection lookup failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async upsertCloudflareConnection(data: Record<string, unknown>) {
      const r = await request(
        "/cloudflare_connections?on_conflict=user_id",
        "POST",
        data,
        { Prefer: "resolution=merge-duplicates,return=representation" },
      );
      if (!r.ok) throw new Error(`Cloudflare connection save failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async updateCloudflareConnection(userId: string, data: Record<string, unknown>) {
      const r = await request(
        `/cloudflare_connections?user_id=eq.${encodeURIComponent(userId)}`,
        "PATCH",
        data,
        { Prefer: "return=representation" },
      );
      if (!r.ok) throw new Error(`Cloudflare connection update failed: HTTP ${r.status}`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async deleteCloudflareConnection(userId: string) {
      const r = await request(`/cloudflare_connections?user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
      if (!r.ok) throw new Error(`Cloudflare connection removal failed: HTTP ${r.status}`);
    },

    // ── Storage containers and objects ────────────────────────────────────────
    async getStorageContainers(userId: string) {
      const r = await request(`/storage_containers?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc`);
      return r.json() as Promise<any[]>;
    },
    async getStorageContainer(id: string, userId: string) {
      const r = await request(`/storage_containers?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async createStorageContainer(data: Record<string, unknown>) {
      const r = await request("/storage_containers", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateStorageContainer(id: string, userId: string, data: Record<string, unknown>) {
      const r = await request(`/storage_containers?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async deleteStorageContainer(id: string, userId: string) {
      await request(`/storage_containers?id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    },
    async getStorageObjects(containerId: string, userId: string, prefix = "") {
      const filters = [
        `container_id=eq.${encodeURIComponent(containerId)}`,
        `user_id=eq.${encodeURIComponent(userId)}`,
        "order=is_folder.asc,name.asc",
      ];
      if (prefix) filters.push(`object_key=like.${encodeURIComponent(`${prefix.replace(/\/+$/, "")}/*`)}`);
      const r = await request(`/storage_objects?${filters.join("&")}`);
      return r.json() as Promise<any[]>;
    },
    async getStorageObject(id: string, containerId: string, userId: string) {
      const r = await request(`/storage_objects?id=eq.${encodeURIComponent(id)}&container_id=eq.${encodeURIComponent(containerId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async getStorageObjectByKey(objectKey: string, containerId: string, userId: string) {
      const r = await request(`/storage_objects?object_key=eq.${encodeURIComponent(objectKey)}&container_id=eq.${encodeURIComponent(containerId)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async createStorageObject(data: Record<string, unknown>) {
      const r = await request("/storage_objects", "POST", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0];
    },
    async updateStorageObject(id: string, containerId: string, userId: string, data: Record<string, unknown>) {
      const r = await request(`/storage_objects?id=eq.${encodeURIComponent(id)}&container_id=eq.${encodeURIComponent(containerId)}&user_id=eq.${encodeURIComponent(userId)}`, "PATCH", data, { Prefer: "return=representation" });
      const rows = await r.json() as any[];
      return rows[0] ?? null;
    },
    async deleteStorageObject(id: string, containerId: string, userId: string) {
      await request(`/storage_objects?id=eq.${encodeURIComponent(id)}&container_id=eq.${encodeURIComponent(containerId)}&user_id=eq.${encodeURIComponent(userId)}`, "DELETE");
    },

    // ── Activity Logs ───────────────────────────────────────────────────────
    async getActivity(userId: string, limit = 50, projectId?: string) {
      const projectFilter = projectId ? `&project_id=eq.${encodeURIComponent(projectId)}` : "";
      const r = await request(`/activity_logs?user_id=eq.${encodeURIComponent(userId)}${projectFilter}&order=created_at.desc&limit=${limit}`);
      return r.json() as Promise<any[]>;
    },
    async logActivity(data: {
      user_id: string;
      project_id?: string;
      action: string;
      resource: string;
      resource_id?: string;
      metadata?: unknown;
    }) {
      await request("/activity_logs", "POST", data).catch(() => {});
    },
  };
}
