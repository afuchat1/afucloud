import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, eq } from "drizzle-orm";
import {
  assertCloudflareId,
  buildDnsRecordPayload,
  CLOUDFLARE_DASHBOARD_ORIGIN,
  CLOUDFLARE_DNS_RECORD_TYPES,
  CloudflareRequestError,
  cloudflareApi,
  createCloudflareAuthorizationUrl,
  createOAuthState,
  createPkcePairForState,
  decryptToken,
  encryptToken,
  exchangeAuthorizationCode,
  isCloudflareOAuthConfigured,
  refreshCloudflareToken,
  revokeCloudflareToken,
  verifyOAuthStateClaims,
} from "@workspace/cloudflare-integration";
import {
  cloudflareConnectionsTable,
  db,
  domainsTable,
  hostnamesTable,
} from "@workspace/db";
import { requireAccountAuth, requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const DEFAULT_CUSTOM_HOSTNAME_TARGET = "verify.afuchat.com";

type CloudflareZone = { id: string; name: string; status: string };
type CloudflareRecord = {
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
  created_on?: string | null;
  modified_on?: string | null;
};
type DnsAnswer = { data?: string };

function oauthEnv() {
  return {
    CLOUDFLARE_OAUTH_CLIENT_ID: process.env.CLOUDFLARE_OAUTH_CLIENT_ID,
    CLOUDFLARE_OAUTH_CLIENT_SECRET: process.env.CLOUDFLARE_OAUTH_CLIENT_SECRET,
    CLOUDFLARE_OAUTH_REDIRECT_URI: process.env.CLOUDFLARE_OAUTH_REDIRECT_URI,
    CLOUDFLARE_TOKEN_ENCRYPTION_KEY: process.env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY,
  };
}

function oauthStateSecret(): string {
  return process.env.CLOUDFLARE_OAUTH_STATE_SECRET ??
    process.env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY ??
    "";
}

function requireConfiguration(): void {
  if (!isCloudflareOAuthConfigured(oauthEnv()) || !oauthStateSecret()) {
    throw new Error("Cloudflare OAuth is not configured");
  }
}

function guarded(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, _next: NextFunction): void => {
    void handler(req, res).catch(error => {
      const status = typeof error === "object" && error !== null && "status" in error
        ? Number((error as { status: unknown }).status)
        : 0;
      if (status >= 400 && status < 500) {
        res.status(status).json({ error: error instanceof Error ? error.message : "Request failed" });
        return;
      }
      if (error instanceof Error && error.message.includes("not configured")) {
        res.status(503).json({ error: "Cloudflare integration is not configured" });
        return;
      }
      res.status(502).json({ error: "Cloudflare service is temporarily unavailable" });
    });
  };
}

function isAllowedReturnOrigin(origin: string, req: Request): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin || url.username || url.password || (url.port && url.port !== "443")) return false;
    const host = url.hostname.toLowerCase();
    if (host === "afuchat.com" || host.endsWith(".afuchat.com")) return true;

    const configuredDomain = process.env.REPLIT_DEV_DOMAIN?.toLowerCase().replace(/:\d+$/, "");
    const requestHost = (req.get("x-forwarded-host")?.split(",")[0] ?? req.get("host") ?? "")
      .trim().toLowerCase().replace(/:\d+$/, "");
    const exactDomain = configuredDomain || requestHost;
    return Boolean(exactDomain && host === exactDomain && (host.endsWith(".replit.dev") || host.endsWith(".replit.app")));
  } catch {
    return false;
  }
}

async function findConnection(userId: string) {
  const [connection] = await db.select().from(cloudflareConnectionsTable)
    .where(eq(cloudflareConnectionsTable.userId, userId)).limit(1);
  return connection;
}

async function accessTokenFor(userId: string): Promise<string> {
  requireConfiguration();
  const connection = await findConnection(userId);
  if (!connection) throw Object.assign(new Error("Cloudflare connection not found"), { status: 404 });
  let accessToken = await decryptToken(connection.encryptedAccessToken, oauthEnv());
  if (connection.accessExpiresAt.getTime() <= Date.now() + 60_000) {
    if (!connection.encryptedRefreshToken) throw Object.assign(new Error("Cloudflare connection expired"), { status: 401 });
    const refreshToken = await decryptToken(connection.encryptedRefreshToken, oauthEnv());
    const refreshed = await refreshCloudflareToken(refreshToken, oauthEnv());
    accessToken = refreshed.access_token;
    await db.update(cloudflareConnectionsTable).set({
      encryptedAccessToken: await encryptToken(refreshed.access_token, oauthEnv()),
      encryptedRefreshToken: refreshed.refresh_token
        ? await encryptToken(refreshed.refresh_token, oauthEnv())
        : connection.encryptedRefreshToken,
      accessExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000),
      scopes: refreshed.scope?.split(/\s+/).filter(Boolean) ?? connection.scopes,
      updatedAt: new Date(),
    }).where(eq(cloudflareConnectionsTable.id, connection.id));
  }
  return accessToken;
}

async function ownedDomain(req: Request, userId: string) {
  const [domain] = await db.select().from(domainsTable).where(and(
    eq(domainsTable.id, req.params.domainId as string),
    eq(domainsTable.userId, userId),
  )).limit(1);
  if (!domain) throw Object.assign(new Error("Domain not found"), { status: 404 });
  return domain;
}

async function zoneForDomain(accessToken: string, domainName: string): Promise<CloudflareZone> {
  const zones: CloudflareZone[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const envelope = await cloudflareApi<CloudflareZone[]>(accessToken,
      `zones?name=${encodeURIComponent(domainName)}&page=${page}&per_page=50`);
    zones.push(...(envelope.result ?? []));
    const pages = envelope.result_info?.total_pages ?? 1;
    if (page >= pages || envelope.result.length < 50) break;
  }
  const zone = zones.find(item => item.name.toLowerCase() === domainName.toLowerCase());
  if (!zone) throw Object.assign(new Error("Cloudflare zone not found"), { status: 404 });
  return { ...zone, id: assertCloudflareId(zone.id) };
}

async function recordsInZone(accessToken: string, zoneId: string): Promise<CloudflareRecord[]> {
  const records: CloudflareRecord[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const envelope = await cloudflareApi<CloudflareRecord[]>(accessToken,
      `zones/${zoneId}/dns_records?page=${page}&per_page=100`);
    records.push(...(envelope.result ?? []));
    const pages = envelope.result_info?.total_pages ?? 1;
    if (page >= pages || envelope.result.length < 100) break;
  }
  return records;
}

async function publicDns(name: string, type: string): Promise<string[]> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Public DNS lookup failed");
  const result = await response.json() as { Answer?: DnsAnswer[] };
  return (result.Answer ?? []).map(answer => String(answer.data ?? "")).filter(Boolean);
}

function normalizeDnsValue(value: string, type: string): string {
  const unquoted = value.replace(/"\s*"/g, "").replace(/^"|"$/g, "").replace(/\\"/g, '"').trim();
  return type === "CNAME" || type === "NS" || type === "PTR"
    ? unquoted.toLowerCase().replace(/\.$/, "")
    : unquoted;
}

function hostnameDnsTarget(): string {
  const target = normalizeDnsName(
    process.env.AFU_CUSTOM_HOSTNAME_TARGET ?? DEFAULT_CUSTOM_HOSTNAME_TARGET,
  );
  const labels = target.split(".");
  if (
    !target.endsWith(".afuchat.com") ||
    target.length > 253 ||
    labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  ) {
    throw Object.assign(new Error("Hostname DNS target is not configured correctly"), { status: 503 });
  }
  return target;
}

function normalizeDnsName(value: string): string {
  return value.trim().toLowerCase().replace(/\.+$/, "");
}

function recordVisible(record: CloudflareRecord, answers: string[]): boolean {
  if (record.proxied && ["A", "AAAA", "CNAME"].includes(record.type)) return answers.length > 0;
  const expected = normalizeDnsValue(record.content, record.type);
  return answers.some(answer => normalizeDnsValue(answer, record.type) === expected);
}

function apiRecord(record: CloudflareRecord) {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    content: record.content,
    ttl: record.ttl,
    proxied: record.proxied ?? null,
    priority: record.priority ?? null,
    comment: record.comment ?? null,
    tags: record.tags ?? [],
    ...(record.data ? { data: record.data } : {}),
    created_on: record.created_on ?? null,
    modified_on: record.modified_on ?? null,
  };
}

function apiZone(zone: CloudflareZone) {
  return { id: zone.id, name: zone.name, status: zone.status };
}

function recordId(value: string): string {
  try { return assertCloudflareId(value); } catch {
    throw Object.assign(new Error("Invalid Cloudflare record identifier"), { status: 400 });
  }
}

function sendKnownError(res: Response, error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : 0;
  if (status >= 400 && status < 500) {
    res.status(status).json({ error: error instanceof Error ? error.message : "Request failed" });
    return true;
  }
  return false;
}

// OAuth providers return to the configured callback URI without a dashboard
// session, so dispatch that callback before account-authenticated API routes.
router.use((req: Request, res: Response, next: NextFunction) => {
  if (req.method !== "GET") { next(); return; }
  const redirectUri = process.env.CLOUDFLARE_OAUTH_REDIRECT_URI;
  if (!redirectUri) { next(); return; }
  let callbackPath: string;
  try { callbackPath = new URL(redirectUri).pathname.replace(/^\/api(?=\/)/, ""); } catch { next(); return; }
  if (req.path !== callbackPath || !("code" in req.query || "error" in req.query)) { next(); return; }
  void (async () => {
    let origin: string | null = null;
    try {
      requireConfiguration();
      const state = typeof req.query.state === "string" ? req.query.state : "";
      const claims = await verifyOAuthStateClaims(state, oauthStateSecret());
      if (!claims || !claims.returnOrigin) {
        res.status(400).send("Cloudflare authorization state is invalid or expired");
        return;
      }
      origin = claims.returnOrigin;
      if (req.query.error || typeof req.query.code !== "string") {
        res.redirect(302, `${origin}/domains?cloudflare=error`);
        return;
      }
      const pair = await createPkcePairForState(state, oauthStateSecret());
      const tokens = await exchangeAuthorizationCode(req.query.code, pair.verifier, oauthEnv());
      const values = {
        userId: claims.userId,
        encryptedAccessToken: await encryptToken(tokens.access_token, oauthEnv()),
        encryptedRefreshToken: tokens.refresh_token ? await encryptToken(tokens.refresh_token, oauthEnv()) : null,
        accessExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
        updatedAt: new Date(),
      };
      await db.insert(cloudflareConnectionsTable).values(values).onConflictDoUpdate({
        target: cloudflareConnectionsTable.userId,
        set: {
          encryptedAccessToken: values.encryptedAccessToken,
          encryptedRefreshToken: values.encryptedRefreshToken,
          accessExpiresAt: values.accessExpiresAt,
          scopes: values.scopes,
          updatedAt: values.updatedAt,
        },
      });
      res.redirect(302, `${origin}/domains?cloudflare=connected`);
    } catch {
      if (origin) res.redirect(302, `${origin}/domains?cloudflare=error`);
      else res.status(503).send("Cloudflare authorization could not be completed");
    }
  })();
});

router.use("/v1/cloudflare", requireAuth, requireAccountAuth);
router.use("/v1/domains/:domainId", requireAuth, requireAccountAuth);

router.post("/v1/cloudflare/connect", guarded(async (req, res) => {
  requireConfiguration();
  const origin = CLOUDFLARE_DASHBOARD_ORIGIN;
  if (!origin || !isAllowedReturnOrigin(origin, req)) {
    res.status(400).json({ error: "A trusted HTTPS AfuChat or Replit return origin is required" });
    return;
  }
  const userId = (req as AuthRequest).userId!;
  const state = await createOAuthState(userId, oauthStateSecret(), origin);
  const pkce = await createPkcePairForState(state, oauthStateSecret());
  const authorizationUrl = createCloudflareAuthorizationUrl({
    env: oauthEnv(),
    state,
    codeChallenge: pkce.challenge,
  });
  res.json({ authorizationUrl });
}));

router.get("/v1/cloudflare/connection", guarded(async (req, res) => {
  requireConfiguration();
  const connection = await findConnection((req as AuthRequest).userId!);
  res.json({
    connected: Boolean(connection),
    expiresAt: connection?.accessExpiresAt.toISOString() ?? null,
    scopes: connection?.scopes ?? [],
  });
}));

router.delete("/v1/cloudflare/connection", guarded(async (req, res) => {
  requireConfiguration();
  const userId = (req as AuthRequest).userId!;
  const connection = await findConnection(userId);
  if (connection) {
    const token = connection.encryptedRefreshToken
      ? await decryptToken(connection.encryptedRefreshToken, oauthEnv())
      : await decryptToken(connection.encryptedAccessToken, oauthEnv());
    await revokeCloudflareToken(token, oauthEnv());
    await db.delete(cloudflareConnectionsTable).where(eq(cloudflareConnectionsTable.id, connection.id));
  }
  res.json({ message: "Cloudflare connection removed" });
}));

router.get("/v1/cloudflare/zones", guarded(async (req, res) => {
  const accessToken = await accessTokenFor((req as AuthRequest).userId!);
  const zones: CloudflareZone[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await cloudflareApi<CloudflareZone[]>(accessToken, `zones?page=${page}&per_page=50`);
    zones.push(...(result.result ?? []));
    if (page >= (result.result_info?.total_pages ?? 1) || result.result.length < 50) break;
  }
  res.json(zones.map(zone => ({ ...apiZone(zone), id: assertCloudflareId(zone.id) })));
}));

router.get("/v1/domains/:domainId/dns-records", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const search = String(req.query.search ?? "").toLowerCase();
    const type = String(req.query.type ?? "").toUpperCase();
    if (type && !CLOUDFLARE_DNS_RECORD_TYPES.includes(type as typeof CLOUDFLARE_DNS_RECORD_TYPES[number])) {
      res.status(400).json({ error: "Unsupported DNS record type" }); return;
    }
    const records = (await recordsInZone(accessToken, zone.id)).filter(record =>
      (!search || record.name.toLowerCase().includes(search) || record.content.toLowerCase().includes(search)) &&
      (!type || record.type === type));
    res.json({ zone: apiZone(zone), records: records.map(apiRecord), total: records.length });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}));

router.post("/v1/domains/:domainId/hostnames/auto-configure", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    if (domain.verificationStatus !== "verified") {
      res.status(409).json({ error: "Verify the root domain before configuring hostname DNS" });
      return;
    }

    const hostnames = await db.select().from(hostnamesTable).where(and(
      eq(hostnamesTable.domainId, domain.id),
      eq(hostnamesTable.userId, userId),
      eq(hostnamesTable.service, "cdn"),
    ));
    const target = hostnameDnsTarget();
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const records = await recordsInZone(accessToken, zone.id);
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
    const saveDnsStatus = async (hostnameId: string) => {
      const [updated] = await db.update(hostnamesTable).set({ dnsStatus: "configured" }).where(and(
        eq(hostnamesTable.id, hostnameId),
        eq(hostnamesTable.domainId, domain.id),
        eq(hostnamesTable.userId, userId),
      )).returning({ id: hostnamesTable.id });
      return Boolean(updated);
    };

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
      let record: CloudflareRecord | null = null;
      let createdByThisRequest = false;
      let upstreamStatus = 0;
      try {
        const created = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records`, {
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
          const latest = await recordsInZone(accessToken, zone.id);
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

    res.json({
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
    if (!sendKnownError(res, error)) throw error;
  }
}));

router.post("/v1/domains/:domainId/dns-records", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const payload = buildDnsRecordPayload(req.body ?? {}, zone.name);
    const result = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records`, {
      method: "POST", body: JSON.stringify(payload),
    });
    res.status(201).json(apiRecord(result.result));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    if (error instanceof Error && !(error.name === "CloudflareRequestError")) {
      res.status(400).json({ error: error.message }); return;
    }
    throw error;
  }
}));

router.patch("/v1/domains/:domainId/dns-records/:recordId", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const id = recordId(req.params.recordId as string);
    const current = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records/${id}`);
    if (
      current.result.id !== id ||
      (current.result.name.toLowerCase() !== domain.hostname.toLowerCase() &&
        !current.result.name.toLowerCase().endsWith(`.${domain.hostname.toLowerCase()}`))
    ) {
      res.status(404).json({ error: "DNS record not found in this domain's Cloudflare zone" }); return;
    }
    const payload = buildDnsRecordPayload(req.body ?? {}, zone.name);
    const result = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records/${id}`, {
      method: "PATCH", body: JSON.stringify(payload),
    });
    res.json(apiRecord(result.result));
  } catch (error) {
    if (sendKnownError(res, error)) return;
    if (error instanceof Error && error.name !== "CloudflareRequestError") {
      res.status(400).json({ error: error.message }); return;
    }
    throw error;
  }
}));

router.delete("/v1/domains/:domainId/dns-records/:recordId", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const id = recordId(req.params.recordId as string);
    const result = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records/${id}`);
    if (!result.result.name.toLowerCase().endsWith(`.${domain.hostname}`) && result.result.name.toLowerCase() !== domain.hostname) {
      res.status(404).json({ error: "DNS record not found in this domain's Cloudflare zone" }); return;
    }
    await cloudflareApi(accessToken, `zones/${zone.id}/dns_records/${id}`, { method: "DELETE" });
    res.json({ message: "DNS record deleted" });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}));

router.post("/v1/domains/:domainId/dns-records/:recordId/verify", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const id = recordId(req.params.recordId as string);
    const { result: record } = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records/${id}`);
    const answers = await publicDns(record.name, record.type);
    res.json({
      recordId: id,
      cloudflareVerified: true,
      publiclyVisible: recordVisible(record, answers),
      answers,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}));

router.post("/v1/domains/:domainId/auto-configure", guarded(async (req, res) => {
  try {
    const userId = (req as AuthRequest).userId!;
    const domain = await ownedDomain(req, userId);
    const accessToken = await accessTokenFor(userId);
    const zone = await zoneForDomain(accessToken, domain.hostname);
    const name = `_afu-verification.${domain.hostname}`;
    const existing = (await recordsInZone(accessToken, zone.id)).find(record =>
      record.type === "TXT" && record.name.toLowerCase() === name.toLowerCase() &&
      normalizeDnsValue(record.content, "TXT") === domain.verificationToken);
    let record = existing;
    let created = false;
    if (!record) {
      const payload = buildDnsRecordPayload({
        type: "TXT", name: "_afu-verification", content: domain.verificationToken, ttl: 1,
      }, zone.name);
      const response = await cloudflareApi<CloudflareRecord>(accessToken, `zones/${zone.id}/dns_records`, {
        method: "POST", body: JSON.stringify(payload),
      });
      record = response.result;
      created = true;
    }
    const verifiedRecords = await recordsInZone(accessToken, zone.id);
    const confirmed = verifiedRecords.some(item =>
      item.type === "TXT" && item.name.toLowerCase() === name.toLowerCase() &&
      normalizeDnsValue(item.content, "TXT") === domain.verificationToken);
    if (!confirmed) throw new Error("Cloudflare did not confirm the domain verification record");
    let answers: string[] = [];
    try { answers = await publicDns(name, "TXT"); } catch { /* Cloudflare configuration is independent of public propagation. */ }
    await db.update(domainsTable).set({
      verificationStatus: "verified",
      sslStatus: "pending",
      dnsStatus: "configured",
      verifiedAt: new Date(),
    }).where(and(eq(domainsTable.id, domain.id), eq(domainsTable.userId, userId)));
    res.json({
      record: apiRecord(record),
      created,
      publiclyVisible: answers.some(answer => normalizeDnsValue(answer, "TXT") === domain.verificationToken),
      message: "The ownership TXT record is configured in Cloudflare; public DNS visibility is reported separately.",
    });
  } catch (error) {
    if (!sendKnownError(res, error)) throw error;
  }
}));

export default router;