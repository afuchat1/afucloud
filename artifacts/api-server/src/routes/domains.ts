import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import crypto from "crypto";
import { db, domainsTable, hostnamesTable, storageContainersTable } from "@workspace/db";
import { requireAccountAuth, requireAuth, type AuthRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();
const DEFAULT_CDN_TARGET = "cdn.afuchat.com";
const DNS_LOOKUP_TIMEOUT_MS = 5_000;
const HTTPS_CHECK_TIMEOUT_MS = 5_000;

router.use("/v1/domains", requireAuth, requireAccountAuth);

function normalizeDomain(input: string): string {
  const value = input.trim();
  if (!value || value.length > 2_048) return "";

  const withoutScheme = value.replace(/^https?:\/\//i, "");
  const authority = withoutScheme.split(/[/?#]/, 1)[0] ?? "";
  const suffix = withoutScheme.slice(authority.length);
  if (!authority || authority.includes("@") || authority.includes(":") || (suffix && suffix !== "/")) return "";

  try {
    return new URL(`https://${authority}`).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

function isRootDomain(domain: string): boolean {
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  return labels.length >= 2 &&
    !labels.every(label => /^\d+$/.test(label)) &&
    (labels.at(-1)?.length ?? 0) >= 2 &&
    labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

function normalizeDnsName(name: string): string {
  return name.trim().toLowerCase().replace(/\.+$/, "");
}

function cdnTarget(): string {
  const target = normalizeDnsName(process.env.AFU_CDN_TARGET ?? DEFAULT_CDN_TARGET);
  if (!target.endsWith(".afuchat.com")) {
    throw new Error("AFU_CDN_TARGET must use the afuchat.com service domain");
  }
  return target;
}

function apiDomain(domain: typeof domainsTable.$inferSelect, hostnames: typeof hostnamesTable.$inferSelect[]) {
  return {
    id: domain.id,
    hostname: domain.hostname,
    verificationStatus: domain.verificationStatus,
    sslStatus: domain.sslStatus,
    dnsStatus: domain.dnsStatus,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    dnsRecord: {
      type: "TXT",
      name: "_afu-verification",
      fqdn: `_afu-verification.${domain.hostname}`,
      value: domain.verificationToken,
    },
    hostnames: hostnames.map(apiHostname),
    createdAt: domain.createdAt.toISOString(),
  };
}

function apiHostname(hostname: typeof hostnamesTable.$inferSelect) {
  return {
    id: hostname.id,
    hostname: hostname.hostname,
    service: hostname.service,
    serviceId: hostname.serviceId,
    status: hostname.status,
    sslStatus: hostname.sslStatus,
    dnsStatus: hostname.dnsStatus,
    dnsRecord: {
      type: "CNAME",
      name: hostname.hostname,
      value: cdnTarget(),
    },
    createdAt: hostname.createdAt.toISOString(),
  };
}

async function findOwnedDomain(id: string, userId: string) {
  const [domain] = await db.select().from(domainsTable)
    .where(and(eq(domainsTable.id, id), eq(domainsTable.userId, userId))).limit(1);
  return domain;
}

router.get("/v1/domains", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domains = await db.select().from(domainsTable)
    .where(eq(domainsTable.userId, req.userId!))
    .orderBy(desc(domainsTable.createdAt));
  const result = await Promise.all(domains.map(async domain => {
    const hosts = await db.select().from(hostnamesTable)
      .where(and(eq(hostnamesTable.domainId, domain.id), eq(hostnamesTable.userId, req.userId!)))
      .orderBy(desc(hostnamesTable.createdAt));
    return apiDomain(domain, hosts);
  }));
  res.json(result);
});

router.post("/v1/domains", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const hostname = normalizeDomain(String(req.body?.hostname ?? ""));
  if (!isRootDomain(hostname)) {
    res.status(400).json({ error: "Enter a valid root domain, such as example.com" });
    return;
  }
  const [existing] = await db.select().from(domainsTable)
    .where(and(eq(domainsTable.userId, req.userId!), eq(domainsTable.hostname, hostname))).limit(1);
  if (existing) {
    res.status(409).json({ error: "That domain is already connected to your account" });
    return;
  }
  const token = `afu_verify_${crypto.randomBytes(18).toString("hex")}`;
  const [domain] = await db.insert(domainsTable).values({
    userId: req.userId!,
    hostname,
    verificationToken: token,
  }).returning();
  res.status(201).json(apiDomain(domain, []));
});

router.post("/v1/domains/:id/verify", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.id as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }

  let verified = false;
  try {
    const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
    dnsUrl.searchParams.set("name", `_afu-verification.${domain.hostname}`);
    dnsUrl.searchParams.set("type", "TXT");
    const dnsRes = await fetch(dnsUrl, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
    });
    if (!dnsRes.ok) throw new Error("DNS lookup failed");
    const dns = await dnsRes.json() as { Answer?: Array<{ data?: string }> };
    verified = (dns.Answer ?? []).some(answer => {
      const value = (answer.data ?? "")
        .replace(/"\s*"/g, "")
        .replace(/^"|"$/g, "")
        .replace(/\\"/g, '"');
      return value === domain.verificationToken;
    });
  } catch {
    res.status(502).json({ error: "DNS verification service is temporarily unavailable" });
    return;
  }

  if (!verified) {
    res.status(422).json({
      error: "Verification record not found",
      dnsRecord: { type: "TXT", name: "_afu-verification", fqdn: `_afu-verification.${domain.hostname}`, value: domain.verificationToken },
    });
    return;
  }
  const [updated] = await db.update(domainsTable).set({
    verificationStatus: "verified",
    sslStatus: "pending",
    dnsStatus: "configured",
    verifiedAt: new Date(),
  }).where(eq(domainsTable.id, domain.id)).returning();
  const hosts = await db.select().from(hostnamesTable).where(eq(hostnamesTable.domainId, domain.id));
  res.json(apiDomain(updated, hosts));
});

router.get("/v1/domains/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.id as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  const hosts = await db.select().from(hostnamesTable)
    .where(and(eq(hostnamesTable.domainId, domain.id), eq(hostnamesTable.userId, req.userId!)));
  res.json(apiDomain(domain, hosts));
});

router.post("/v1/domains/:id/hostnames", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.id as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  if (domain.verificationStatus !== "verified") {
    res.status(409).json({ error: "Verify the root domain before adding hostnames" });
    return;
  }
  const label = String(req.body?.label ?? "").trim().toLowerCase().replace(/\.$/, "");
  const service = String(req.body?.service ?? "unconnected");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) {
    res.status(400).json({ error: "Enter a valid hostname label, such as cdn or www" });
    return;
  }
  const hostname = `${label}.${domain.hostname}`;
  const [existing] = await db.select().from(hostnamesTable).where(
    and(eq(hostnamesTable.userId, req.userId!), eq(hostnamesTable.hostname, hostname)),
  ).limit(1);
  if (existing) { res.status(409).json({ error: "That hostname already exists" }); return; }
  const [created] = await db.insert(hostnamesTable).values({
    domainId: domain.id,
    userId: req.userId!,
    hostname,
    service,
  }).returning();
  res.status(201).json(apiHostname(created));
});

router.post("/v1/domains/:domainId/hostnames/:hostnameId/verify", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.domainId as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  const [hostname] = await db.select().from(hostnamesTable).where(and(
    eq(hostnamesTable.id, req.params.hostnameId as string),
    eq(hostnamesTable.domainId, domain.id),
    eq(hostnamesTable.userId, req.userId!),
  )).limit(1);
  if (!hostname) { res.status(404).json({ error: "Hostname not found" }); return; }
  let active = false;
  try {
    const dnsUrl = new URL("https://cloudflare-dns.com/dns-query");
    dnsUrl.searchParams.set("name", hostname.hostname);
    dnsUrl.searchParams.set("type", "CNAME");
    const dnsRes = await fetch(dnsUrl, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(DNS_LOOKUP_TIMEOUT_MS),
    });
    if (!dnsRes.ok) throw new Error("DNS lookup failed");
    const dns = await dnsRes.json() as { Answer?: Array<{ data?: string }> };
    const expected = cdnTarget();
    active = (dns.Answer ?? []).some(answer => normalizeDnsName(answer.data ?? "") === expected);
  } catch {
    res.status(502).json({ error: "DNS verification service is temporarily unavailable" });
    return;
  }
  if (!active) {
    await db.update(hostnamesTable).set({
      status: "pending",
      sslStatus: "pending",
      dnsStatus: "pending",
    }).where(eq(hostnamesTable.id, hostname.id));
    res.status(422).json({
      error: "CNAME record not found",
      dnsRecord: { type: "CNAME", name: hostname.hostname, value: cdnTarget() },
    });
    return;
  }
  let sslActive = false;
  try {
    const httpsResponse = await fetch(`https://${hostname.hostname}/`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(HTTPS_CHECK_TIMEOUT_MS),
    });
    sslActive = httpsResponse.status < 500 && httpsResponse.status !== 421;
  } catch {
    // A DNS match alone does not mean the hostname's TLS certificate is ready.
  }
  const [updated] = await db.update(hostnamesTable).set({
    status: sslActive ? "active" : "pending",
    sslStatus: sslActive ? "active" : "pending",
    dnsStatus: "configured",
  }).where(eq(hostnamesTable.id, hostname.id)).returning();
  res.json(apiHostname(updated));
});

router.patch("/v1/domains/:domainId/hostnames/:hostnameId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.domainId as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  const [hostname] = await db.select().from(hostnamesTable).where(and(
    eq(hostnamesTable.id, req.params.hostnameId as string),
    eq(hostnamesTable.domainId, domain.id),
    eq(hostnamesTable.userId, req.userId!),
  )).limit(1);
  if (!hostname) { res.status(404).json({ error: "Hostname not found" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body?.service !== undefined) updates.service = req.body.service;
  if (req.body?.serviceId !== undefined) updates.serviceId = req.body.serviceId || null;
  const [updated] = await db.update(hostnamesTable).set(updates).where(eq(hostnamesTable.id, hostname.id)).returning();
  res.json(apiHostname(updated));
});

router.delete("/v1/domains/:domainId/hostnames/:hostnameId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.domainId as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  await db.delete(hostnamesTable).where(and(
    eq(hostnamesTable.id, req.params.hostnameId as string),
    eq(hostnamesTable.domainId, domain.id),
    eq(hostnamesTable.userId, req.userId!),
  ));
  res.json({ message: "Hostname removed" });
});

router.delete("/v1/domains/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const domain = await findOwnedDomain(req.params.id as string, req.userId!);
  if (!domain) { res.status(404).json({ error: "Domain not found" }); return; }
  const domainHostnames = await db.select({ id: hostnamesTable.id }).from(hostnamesTable)
    .where(and(eq(hostnamesTable.domainId, domain.id), eq(hostnamesTable.userId, req.userId!)));
  const [linked] = domainHostnames.length > 0
    ? await db.select({ id: storageContainersTable.id }).from(storageContainersTable)
      .where(and(eq(storageContainersTable.userId, req.userId!), inArray(storageContainersTable.cdnHostnameId, domainHostnames.map(h => h.id)))).limit(1)
    : [];
  if (linked) {
    res.status(409).json({ error: "Disconnect this domain from its storage containers before removing it" });
    return;
  }
  await db.delete(domainsTable).where(eq(domainsTable.id, domain.id));
  res.json({ message: "Domain removed" });
});

export default router;