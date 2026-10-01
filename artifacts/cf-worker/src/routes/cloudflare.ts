import { Hono } from "hono";
import type { DbClient, Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { requireAccountAuth, requireAuth } from "../middleware/auth";
import {
  assertCloudflareId,
  buildDnsRecordPayload,
  CLOUDFLARE_DASHBOARD_ORIGIN,
  cloudflareApi,
  CloudflareRequestError,
  createCloudflareAuthorizationUrl,
  createOAuthState,
  createPkcePairForState,
  decryptToken,
  encryptToken,
  exchangeAuthorizationCode,
  getEncryptionKeyBytes,
  isCloudflareOAuthConfigured,
  refreshCloudflareToken,
  revokeCloudflareToken,
  verifyOAuthStateClaims,
  type CloudflareApiEnvelope,
  type CloudflareTokenResponse,
  type OAuthEnvironment,
} from "@workspace/cloudflare-integration";

type WorkerContext = { Bindings: Env; Variables: AuthVariables };
type CloudflareZone = { id: string; name: string; status: string };
type DnsRecord = {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  proxied?: boolean | null;
  priority?: number | null;
  comment?: string | null;
  tags?: string[];
  data?: Record<string, unknown>;
  [key: string]: unknown;
};

const cloudflare = new Hono<WorkerContext>();
const dns = new Hono<WorkerContext>();
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const CLOUDFLARE_PAGE_SIZE = 100;

function oauthEnv(env: Env): OAuthEnvironment {
  return env;
}

function validReturnOrigin(value: string | undefined, env: Env): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== value) return null;
    const host = url.hostname.toLowerCase();
    const explicit = new Set((env.DASHBOARD_ALLOWED_ORIGINS ?? "")
      .split(",").map(origin => origin.trim()).filter(Boolean));
    if (
      host === "afuchat.com" ||
      host.endsWith(".afuchat.com") ||
      host.endsWith(".replit.dev") ||
      explicit.has(value)
    ) return url.origin;
  } catch {
    return null;
  }
  return null;
}

function oauthStateSecret(env: Env): string {
  if (!env.CLOUDFLARE_OAUTH_STATE_SECRET) {
    throw new CloudflareRequestError("Cloudflare authorization is not configured", 503);
  }
  return env.CLOUDFLARE_OAUTH_STATE_SECRET;
}

function oauthConfiguration(env: Env): OAuthEnvironment {
  const settings = oauthEnv(env);
  if (!isCloudflareOAuthConfigured(settings)) {
    throw new CloudflareRequestError("Cloudflare authorization is not configured", 503);
  }
  try {
    getEncryptionKeyBytes(settings);
  } catch {
    throw new CloudflareRequestError("Cloudflare token encryption is not configured correctly", 503);
  }
  return settings;
}

function publicError(error: unknown): { status: number; message: string } {
  if (error instanceof CloudflareRequestError) {
    if (error.status === 401 || error.status === 403) {
      return { status: 409, message: "Cloudflare access expired or lacks DNS permissions. Reconnect Cloudflare and approve DNS access." };
    }
    if (error.status === 404) return { status: 404, message: "Cloudflare resource not found in the connected zone" };
    if (error.status === 503) return { status: 503, message: error.message };
  }
  return { status: 502, message: "Cloudflare could not complete the request. Try again shortly." };
}

function safeHttpStatus(error: unknown): number | undefined {
  if (error instanceof CloudflareRequestError) return error.upstreamStatus;
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/\bHTTP ([1-5]\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

async function getAccessToken(db: DbClient, userId: string, env: Env): Promise<string> {
  if (!env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY) {
    throw new CloudflareRequestError("Cloudflare token encryption is not configured", 503);
  }
  const connection = await db.getCloudflareConnection(userId);
  if (!connection) throw new CloudflareRequestError("Connect a Cloudflare account first", 401);

  const expiresAt = Date.parse(connection.access_expires_at);
  if (!Number.isFinite(expiresAt)) {
    throw new CloudflareRequestError("Cloudflare connection is invalid. Reconnect Cloudflare.", 401);
  }
  if (expiresAt <= Date.now() + 60_000) {
    if (!connection.encrypted_refresh_token) {
      throw new CloudflareRequestError("Cloudflare access expired. Reconnect Cloudflare.", 401);
    }
    const settings = oauthConfiguration(env);
    const refreshToken = await decryptToken(connection.encrypted_refresh_token, settings);
    let refreshed: CloudflareTokenResponse;
    try {
      refreshed = await refreshCloudflareToken(refreshToken, settings);
    } catch {
      throw new CloudflareRequestError("Cloudflare access expired. Reconnect Cloudflare.", 401);
    }
    const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
    await db.updateCloudflareConnection(userId, {
      encrypted_access_token: await encryptToken(refreshed.access_token, settings),
      encrypted_refresh_token: await encryptToken(nextRefreshToken, settings),
      access_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      scopes: refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : connection.scopes,
      updated_at: new Date().toISOString(),
    });
    return refreshed.access_token;
  }

  return decryptToken(connection.encrypted_access_token, oauthEnv(env));
}

async function listZones(accessToken: string): Promise<CloudflareZone[]> {
  const zones: CloudflareZone[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await cloudflareApi<CloudflareZone[]>(
      accessToken,
      `zones?per_page=50&page=${page}`,
    );
    zones.push(...(result.result ?? []));
    const totalPages = result.result_info?.total_pages;
    if (totalPages ? page >= totalPages : (result.result ?? []).length < 50) return zones;
  }
  throw new CloudflareRequestError("Too many Cloudflare zones to list safely", 502);
}

async function findZone(accessToken: string, domainName: string): Promise<CloudflareZone | null> {
  const result = await cloudflareApi<CloudflareZone[]>(
    accessToken,
    `zones?name=${encodeURIComponent(domainName)}&per_page=50&page=1`,
  );
  return (result.result ?? []).find(zone => zone.name.toLowerCase() === domainName.toLowerCase()) ?? null;
}

async function listRecords(accessToken: string, zoneId: string): Promise<DnsRecord[]> {
  const records: DnsRecord[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await cloudflareApi<DnsRecord[]>(
      accessToken,
      `zones/${zoneId}/dns_records?per_page=${CLOUDFLARE_PAGE_SIZE}&page=${page}`,
    );
    records.push(...(result.result ?? []));
    const totalPages = result.result_info?.total_pages;
    if (totalPages ? page >= totalPages : (result.result ?? []).length < CLOUDFLARE_PAGE_SIZE) return records;
  }
  throw new CloudflareRequestError("Too many DNS records to list safely", 502);
}

async function publicDnsAnswers(name: string, type: string): Promise<string[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new CloudflareRequestError("Public DNS lookup failed", 502);
  const result = await response.json() as { Answer?: Array<{ data?: string }> };
  return (result.Answer ?? []).map(answer => answer.data ?? "").filter(Boolean);
}

function normalizeTxt(value: string): string {
  return value.replace(/"\s*"/g, "").replace(/^"|"$/g, "").replace(/\\"/g, '"');
}

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function hostnameDnsTarget(env: Env): string {
  const target = normalizeDnsName(env.AFU_CUSTOM_HOSTNAME_TARGET ?? "verify.afuchat.com");
  const labels = target.split(".");
  if (
    !target.endsWith(".afuchat.com") ||
    target.length > 253 ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw new CloudflareRequestError("Hostname DNS target is not configured correctly", 503);
  }
  return target;
}

async function ownedDomainContext(
  db: DbClient,
  userId: string,
  domainId: string,
  accessToken: string,
) {
  const domain = await db.getDomain(domainId, userId);
  if (!domain) return { domain: null, zone: null };
  const zone = await findZone(accessToken, domain.hostname);
  return { domain, zone };
}

cloudflare.get("/callback", async c => {
  const state = c.req.query("state") ?? "";
  const claims = await verifyOAuthStateClaims(state, c.env.CLOUDFLARE_OAUTH_STATE_SECRET ?? "");
  const returnOrigin = validReturnOrigin(claims?.returnOrigin ?? undefined, c.env);
  if (!claims || !returnOrigin) return c.text("Cloudflare authorization state is invalid or expired.", 400);

  const redirect = (result: string) => {
    const destination = new URL("/domains", returnOrigin);
    destination.searchParams.set("cloudflare", result);
    return c.redirect(destination.toString(), 302);
  };
  if (c.req.query("error")) return redirect("denied");
  const code = c.req.query("code");
  if (!code) {
    console.error(JSON.stringify({
      event: "cloudflare.oauth.callback_failed",
      stage: "authorization_response",
      reason: "authorization_code_missing",
    }));
    return redirect("failed");
  }

  let stage = "configuration";
  try {
    const settings = oauthConfiguration(c.env);
    const { verifier } = await createPkcePairForState(state, oauthStateSecret(c.env));
    stage = "authorization_code_exchange";
    const token = await exchangeAuthorizationCode(code, verifier, settings);
    stage = "token_encryption";
    const encryptedAccessToken = await encryptToken(token.access_token, settings);
    const encryptedRefreshToken = token.refresh_token ? await encryptToken(token.refresh_token, settings) : null;
    stage = "connection_persistence";
    const db = createDbClient(c.env);
    await db.upsertCloudflareConnection({
      user_id: claims.userId,
      encrypted_access_token: encryptedAccessToken,
      encrypted_refresh_token: encryptedRefreshToken,
      access_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : [],
      updated_at: new Date().toISOString(),
    });
    return redirect("connected");
  } catch (error) {
    console.error(JSON.stringify({
      event: "cloudflare.oauth.callback_failed",
      stage,
      errorName: error instanceof Error ? error.name : "UnknownError",
      httpStatus: safeHttpStatus(error),
      oauthError: error instanceof CloudflareRequestError ? error.code : undefined,
    }));
    return redirect("failed");
  }
});

cloudflare.get("/connection", requireAuth, requireAccountAuth, async c => {
  const db = createDbClient(c.env);
  const connection = await db.getCloudflareConnection(c.get("userId"));
  return c.json({
    connected: Boolean(connection),
    expiresAt: connection?.access_expires_at ?? null,
    scopes: connection?.scopes ?? [],
  });
});

cloudflare.post("/connect", requireAuth, requireAccountAuth, async c => {
  try {
    const settings = oauthConfiguration(c.env);
    const origin = validReturnOrigin(CLOUDFLARE_DASHBOARD_ORIGIN, c.env);
    if (!origin) return c.json({ error: "Open Cloudflare authorization from the AfuCloud dashboard" }, 400);
    const secret = oauthStateSecret(c.env);
    const state = await createOAuthState(c.get("userId"), secret, origin);
    const pkce = await createPkcePairForState(state, secret);
    return c.json({
      authorizationUrl: createCloudflareAuthorizationUrl({
        env: settings,
        state,
        codeChallenge: pkce.challenge,
      }),
    });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

cloudflare.delete("/connection", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const userId = c.get("userId");
    const connection = await db.getCloudflareConnection(userId);
    if (connection) {
      const settings = oauthConfiguration(c.env);
      const encrypted = connection.encrypted_refresh_token ?? connection.encrypted_access_token;
      await revokeCloudflareToken(await decryptToken(encrypted, settings), settings);
      await db.deleteCloudflareConnection(userId);
    }
    return c.json({ message: "Cloudflare account disconnected" });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

cloudflare.get("/zones", requireAuth, requireAccountAuth, async c => {
  try {
    const token = await getAccessToken(createDbClient(c.env), c.get("userId"), c.env);
    const zones = await listZones(token);
    return c.json(zones.map(zone => ({ id: zone.id, name: zone.name, status: zone.status })));
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.get("/:domainId/dns-records", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const { domain, zone } = await ownedDomainContext(db, c.get("userId"), c.req.param("domainId"), token);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);
    const records = await listRecords(token, zone.id);
    const search = (c.req.query("search") ?? "").trim().toLowerCase();
    const type = (c.req.query("type") ?? "").trim().toUpperCase();
    const filtered = records.filter(record =>
      (!type || record.type.toUpperCase() === type) &&
      (!search || record.name.toLowerCase().includes(search) || record.content.toLowerCase().includes(search)),
    );
    return c.json({
      zone: { id: zone.id, name: zone.name, status: zone.status },
      records: filtered,
      total: filtered.length,
    });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.post("/:domainId/hostnames/auto-configure", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const userId = c.get("userId");
    const domain = await db.getDomain(c.req.param("domainId"), userId);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (domain.verification_status !== "verified") {
      return c.json({ error: "Verify the root domain before configuring hostname DNS" }, 409);
    }

    const hostnames = (await db.getHostnames(domain.id, userId))
      .filter(hostname => hostname.service === "cdn");
    const target = hostnameDnsTarget(c.env);
    const token = await getAccessToken(db, userId, c.env);
    const zone = await findZone(token, domain.hostname);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);

    const records = await listRecords(token, zone.id);
    const rootName = normalizeDnsName(domain.hostname);
    const results: Array<{
      hostnameId: string;
      hostname: string;
      status: "created" | "already_configured" | "conflict" | "failed";
      message: string;
      recordId: string | null;
    }> = [];
    const matchingRecords = (hostname: string) =>
      records.filter(record => normalizeDnsName(record.name) === normalizeDnsName(hostname));
    const saveDnsStatus = async (hostnameId: string) =>
      Boolean(await db.updateHostname(hostnameId, userId, { dns_status: "configured" }));

    for (const [index, hostname] of hostnames.entries()) {
      const name = normalizeDnsName(hostname.hostname);
      const labels = name.split(".");
      const hostLabels = labels.slice(0, -rootName.split(".").length);
      if (
        !name.endsWith(`.${rootName}`) ||
        name.length > 253 ||
        hostLabels.length !== 1 ||
        !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostLabels[0] ?? "")
      ) {
        results.push({
          hostnameId: hostname.id,
          hostname: hostname.hostname,
          status: "failed",
          message: "The saved hostname is outside this domain or invalid; no DNS record was changed.",
          recordId: null,
        });
        continue;
      }

      const current = matchingRecords(hostname.hostname);
      if (current.length > 0) {
        const correct = current.length === 1 &&
          current[0].type.toUpperCase() === "CNAME" &&
          normalizeDnsName(current[0].content) === target &&
          !current[0].proxied;
        if (!correct) {
          results.push({
            hostnameId: hostname.id,
            hostname: hostname.hostname,
            status: "conflict",
            message: "An existing DNS record conflicts with the required DNS-only CNAME; no record was changed.",
            recordId: null,
          });
          continue;
        }

        const saved = await saveDnsStatus(hostname.id).catch(() => false);
        results.push({
          hostnameId: hostname.id,
          hostname: hostname.hostname,
          status: saved ? "already_configured" : "failed",
          message: saved
            ? "The matching CNAME is already configured."
            : "The CNAME is configured in Cloudflare, but AfuCloud could not update hostname status. Retry is safe.",
          recordId: current[0].id,
        });
        continue;
      }

      const payload = buildDnsRecordPayload({
        type: "CNAME",
        name,
        content: target,
        ttl: 1,
        proxied: false,
        comment: "AfuCloud CDN hostname",
      }, zone.name);
      let record: DnsRecord | null = null;
      let createdByThisRequest = false;
      let upstreamStatus = 0;
      try {
        const created = await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        record = created.result;
        createdByThisRequest = true;
        records.push(record);
      } catch (error) {
        upstreamStatus = error instanceof CloudflareRequestError ? error.status : 0;
        // A concurrent request may have created the same record after our initial zone read.
        try {
          const latest = await listRecords(token, zone.id);
          const concurrent = latest.filter(item => normalizeDnsName(item.name) === name);
          if (
            concurrent.length === 1 &&
            concurrent[0].type.toUpperCase() === "CNAME" &&
            normalizeDnsName(concurrent[0].content) === target &&
            !concurrent[0].proxied
          ) {
            record = concurrent[0];
            records.push(record);
          } else if (concurrent.length > 0) {
            results.push({
              hostnameId: hostname.id,
              hostname: hostname.hostname,
              status: "conflict",
              message: "An existing DNS record conflicts with the required DNS-only CNAME; no record was changed.",
              recordId: null,
            });
            continue;
          }
        } catch {
          // Preserve a failed result if Cloudflare cannot be checked again.
        }
      }

      if (!record) {
        const failureMessage = upstreamStatus === 401 || upstreamStatus === 403
          ? "Cloudflare denied DNS write access. Reconnect and approve DNS write permission, then retry."
          : upstreamStatus === 429
            ? "Cloudflare rate-limited DNS changes. Retry shortly."
            : upstreamStatus >= 500
              ? "Cloudflare is temporarily unavailable. Retry shortly."
              : "Cloudflare could not create the CNAME. Retry or check the zone permissions.";
        results.push({
          hostnameId: hostname.id,
          hostname: hostname.hostname,
          status: "failed",
          message: failureMessage,
          recordId: null,
        });
        if (upstreamStatus === 401 || upstreamStatus === 403 || upstreamStatus === 429 || upstreamStatus >= 500) {
          for (const pending of hostnames.slice(index + 1)) {
            results.push({
              hostnameId: pending.id,
              hostname: pending.hostname,
              status: "failed",
              message: failureMessage,
              recordId: null,
            });
          }
          break;
        }
        continue;
      }

      const saved = await saveDnsStatus(hostname.id).catch(() => false);
      results.push({
        hostnameId: hostname.id,
        hostname: hostname.hostname,
        status: saved ? (createdByThisRequest ? "created" : "already_configured") : "failed",
        message: saved
          ? (createdByThisRequest ? "CNAME created in Cloudflare." : "The matching CNAME was created by a concurrent request.")
          : "The CNAME is configured in Cloudflare, but AfuCloud could not update hostname status. Retry is safe.",
        recordId: record.id,
      });
    }

    return c.json({
      domainId: domain.id,
      target,
      total: results.length,
      created: results.filter(result => result.status === "created").length,
      unchanged: results.filter(result => result.status === "already_configured").length,
      conflicts: results.filter(result => result.status === "conflict").length,
      failed: results.filter(result => result.status === "failed").length,
      results,
    });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.post("/:domainId/dns-records", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const { domain, zone } = await ownedDomainContext(db, c.get("userId"), c.req.param("domainId"), token);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);
    let payload: Record<string, unknown>;
    try {
      payload = buildDnsRecordPayload(await c.req.json(), zone.name);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid DNS record" }, 400);
    }
    const result = await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return c.json(result.result, 201);
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.patch("/:domainId/dns-records/:recordId", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const { domain, zone } = await ownedDomainContext(db, c.get("userId"), c.req.param("domainId"), token);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);
    let recordId: string;
    let payload: Record<string, unknown>;
    try {
      recordId = assertCloudflareId(c.req.param("recordId"));
      payload = buildDnsRecordPayload(await c.req.json(), zone.name);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid DNS record" }, 400);
    }
    await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records/${recordId}`);
    const result = await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records/${recordId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    return c.json(result.result);
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.delete("/:domainId/dns-records/:recordId", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const { domain, zone } = await ownedDomainContext(db, c.get("userId"), c.req.param("domainId"), token);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);
    let recordId: string;
    try {
      recordId = assertCloudflareId(c.req.param("recordId"));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid Cloudflare record ID" }, 400);
    }
    await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records/${recordId}`);
    await cloudflareApi<unknown>(token, `zones/${zone.id}/dns_records/${recordId}`, { method: "DELETE" });
    return c.json({ message: "DNS record deleted" });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.post("/:domainId/dns-records/:recordId/verify", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const { domain, zone } = await ownedDomainContext(db, c.get("userId"), c.req.param("domainId"), token);
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);
    let recordId: string;
    try {
      recordId = assertCloudflareId(c.req.param("recordId"));
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid Cloudflare record ID" }, 400);
    }
    const result = await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records/${recordId}`);
    const answers = await publicDnsAnswers(result.result.name, result.result.type);
    return c.json({
      recordId,
      cloudflareVerified: true,
      publiclyVisible: answers.length > 0,
      answers,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

dns.post("/:domainId/auto-configure", requireAuth, requireAccountAuth, async c => {
  try {
    const db = createDbClient(c.env);
    const token = await getAccessToken(db, c.get("userId"), c.env);
    const domain = await db.getDomain(c.req.param("domainId"), c.get("userId"));
    if (!domain) return c.json({ error: "Domain not found" }, 404);
    const zone = await findZone(token, domain.hostname);
    if (!zone) return c.json({ error: "This domain is not an accessible Cloudflare zone for the connected account" }, 409);

    const recordName = `_afu-verification.${domain.hostname}`;
    const records = await listRecords(token, zone.id);
    let record = records.find(item =>
      item.type === "TXT" &&
      item.name.toLowerCase() === recordName.toLowerCase() &&
      normalizeTxt(item.content) === domain.verification_token,
    );
    let created = false;
    if (!record) {
      const payload = buildDnsRecordPayload({
        type: "TXT",
        name: "_afu-verification",
        content: domain.verification_token,
        ttl: 1,
        proxied: false,
      }, zone.name);
      const result = await cloudflareApi<DnsRecord>(token, `zones/${zone.id}/dns_records`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      record = result.result;
      created = true;
    }

    await db.updateDomain(domain.id, c.get("userId"), {
      verification_status: "verified",
      ssl_status: "pending",
      dns_status: "configured",
      verified_at: new Date().toISOString(),
    });
    let answers: string[] = [];
    try {
      answers = await publicDnsAnswers(recordName, "TXT");
    } catch {
      // Cloudflare accepted the record; public propagation may still be pending.
    }
    const publiclyVisible = answers.some(answer => normalizeTxt(answer) === domain.verification_token);
    return c.json({
      record,
      created,
      publiclyVisible,
      message: publiclyVisible
        ? "Cloudflare added the ownership record and public DNS can see it."
        : "Cloudflare added the ownership record. Public DNS propagation is still pending.",
    });
  } catch (error) {
    const result = publicError(error);
    return c.json({ error: result.message }, result.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
  }
});

export { cloudflare as cloudflareRoutes, dns as cloudflareDnsRoutes };