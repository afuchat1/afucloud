import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ilike, isNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { db, domainsTable, hostnamesTable, storageContainersTable, storageObjectsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/requireAuth";
import { copyObject, buildStorageKey, deleteObject, generateUploadUrl } from "../lib/storage";

const router: IRouter = Router();

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function containerPrefix(containerId: string, userId: string): string {
  return `containers/${userId}/${containerId}/`;
}

function relativeObjectKey(objectKey: string, containerId: string, userId: string): string {
  const prefix = containerPrefix(containerId, userId);
  return objectKey.startsWith(prefix) ? objectKey.slice(prefix.length) : objectKey;
}

function publicObjectKey(objectKey: string): string {
  return objectKey.startsWith("containers/") ? objectKey.slice("containers/".length) : objectKey;
}

function encodeObjectPath(objectKey: string): string {
  return objectKey.split("/").map(segment => encodeURIComponent(segment)).join("/");
}

type CdnResolution = { hostname: string | null; error: string | null };

function normalizeTimestamp(value: Date | string | null | undefined, fallback?: Date | string | null): string {
  for (const candidate of [value, fallback]) {
    if (candidate == null || candidate === "") continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date().toISOString();
}

function mediaKind(contentType: string | null | undefined, name: string): "image" | "video" | "other" {
  const normalizedType = contentType?.toLowerCase() ?? "";
  if (normalizedType.startsWith("image/") || /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(name)) return "image";
  if (normalizedType.startsWith("video/") || /\.(avi|m4v|mkv|mov|mp4|mpeg|mpg|webm)$/i.test(name)) return "video";
  return "other";
}

function publicHostname(contentType: string | null | undefined, name: string, configuredHostname: string | null): string {
  const kind = mediaKind(contentType, name);
  const defaultHostname = kind === "image"
    ? "img.afuchat.com"
    : kind === "video"
      ? "vid.afuchat.com"
      : "cdn.afuchat.com";
  if (!configuredHostname) return defaultHostname;

  const configured = configuredHostname.toLowerCase().replace(/\.$/, "");
  if (configured === "img.afuchat.com") return kind === "image" ? configured : defaultHostname;
  if (configured === "vid.afuchat.com") return kind === "video" ? configured : defaultHostname;
  if (configured === "cdn.afuchat.com") return kind === "other" ? configured : defaultHostname;
  return configured;
}

function objectApi(object: typeof storageObjectsTable.$inferSelect, containerId: string, cdn: CdnResolution) {
  const relativeKey = relativeObjectKey(object.objectKey, containerId, object.userId);
  const publicKey = publicObjectKey(object.objectKey);
  const encodedPublicKey = encodeObjectPath(publicKey);
  const publicUrl = object.isFolder
    ? null
    : `https://${publicHostname(object.contentType, object.name, cdn.hostname)}/${encodedPublicKey}`;

  return {
    id: object.id,
    containerId,
    key: publicUrl,
    storageKey: object.objectKey,
    path: relativeKey,
    name: (object.name || relativeKey.split("/").pop() || "").split("/").pop() || "",
    contentType: object.contentType,
    size: object.size,
    etag: object.etag,
    isFolder: object.isFolder,
    url: publicUrl,
    createdAt: normalizeTimestamp(object.createdAt),
    updatedAt: normalizeTimestamp(object.updatedAt, object.createdAt),
    cdnError: cdn.error,
  };
}

async function ownedContainer(id: string, userId: string) {
  const [container] = await db.select().from(storageContainersTable)
    .where(and(eq(storageContainersTable.id, id), eq(storageContainersTable.userId, userId))).limit(1);
  return container;
}

async function resolveContainerCdn(container: typeof storageContainersTable.$inferSelect): Promise<CdnResolution> {
  if (!container.cdnEnabled) return { hostname: null, error: null };
  if (!container.cdnHostnameId) return { hostname: null, error: "CDN is enabled, but no hostname is selected." };
  const [hostname] = await db.select().from(hostnamesTable).where(and(
    eq(hostnamesTable.id, container.cdnHostnameId),
    eq(hostnamesTable.userId, container.userId),
    eq(hostnamesTable.service, "cdn"),
  )).limit(1);
  if (!hostname) {
    return { hostname: null, error: "The selected hostname is missing, not owned by this account, or is not configured for CDN service." };
  }
  const [domain] = await db.select().from(domainsTable).where(and(
    eq(domainsTable.id, hostname.domainId),
    eq(domainsTable.userId, container.userId),
  )).limit(1);
  if (domain?.verificationStatus !== "verified") {
    return { hostname: null, error: "The selected hostname's root domain is not verified." };
  }
  if (hostname.status !== "active" || hostname.sslStatus !== "active" || hostname.dnsStatus !== "configured") {
    return { hostname: null, error: "The selected hostname is not ready: hostname, SSL, and DNS must all be active/configured." };
  }
  return { hostname: hostname.hostname.replace(/\.$/, ""), error: null };
}

function validRelativePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  const segments = path.split("/");
  if (!path || segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return null;
  return path;
}

async function ensureFolder(containerId: string, userId: string, relativePath: string) {
  const objectKey = `${containerPrefix(containerId, userId)}${relativePath}`;
  const [existing] = await db.select().from(storageObjectsTable).where(and(
    eq(storageObjectsTable.containerId, containerId),
    eq(storageObjectsTable.userId, userId),
    eq(storageObjectsTable.objectKey, objectKey),
  )).limit(1);
  if (existing) {
    if (!existing.isFolder) throw new Error(`A file already exists at folder path "${relativePath}".`);
    return existing;
  }
  try {
    const [created] = await db.insert(storageObjectsTable).values({
      containerId,
      userId,
      objectKey,
      name: relativePath.split("/").pop()!,
      isFolder: true,
    }).returning();
    return created;
  } catch (error) {
    const [raced] = await db.select().from(storageObjectsTable).where(and(
      eq(storageObjectsTable.containerId, containerId),
      eq(storageObjectsTable.userId, userId),
      eq(storageObjectsTable.objectKey, objectKey),
    )).limit(1);
    if (raced?.isFolder) return raced;
    throw error;
  }
}

async function ensureParentFolders(containerId: string, userId: string, relativePath: string): Promise<void> {
  const segments = relativePath.split("/");
  for (let length = 1; length < segments.length; length++) {
    await ensureFolder(containerId, userId, segments.slice(0, length).join("/"));
  }
}

router.get("/v1/storage-containers", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const containers = await db.select().from(storageContainersTable)
    .where(eq(storageContainersTable.userId, req.userId!))
    .orderBy(desc(storageContainersTable.createdAt));
  const result = await Promise.all(containers.map(async container => {
    const [{ count, bytes }] = await db.select({
      count: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${storageObjectsTable.size}), 0)`,
    }).from(storageObjectsTable).where(and(eq(storageObjectsTable.containerId, container.id), eq(storageObjectsTable.isFolder, false)));
    const cdn = await resolveContainerCdn(container);
    return { ...container, objectCount: Number(count), storageUsed: Number(bytes), cdnUrl: cdn.hostname ? `https://${cdn.hostname}` : null, cdnError: cdn.error };
  }));
  res.json(result);
});

router.post("/v1/storage-containers", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const name = String(req.body?.name ?? "").trim();
  if (name.length < 2) { res.status(400).json({ error: "Container name is required" }); return; }
  const slug = slugify(name);
  const [existing] = await db.select().from(storageContainersTable)
    .where(and(eq(storageContainersTable.userId, req.userId!), eq(storageContainersTable.slug, slug))).limit(1);
  if (existing) { res.status(409).json({ error: "A container with that name already exists" }); return; }
  const [container] = await db.insert(storageContainersTable).values({
    userId: req.userId!,
    name,
    slug,
    description: req.body?.description || null,
    projectId: req.body?.projectId || null,
  }).returning();
  res.status(201).json({ ...container, objectCount: 0, storageUsed: 0, cdnUrl: null });
});

router.get("/v1/storage-containers/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const cdn = await resolveContainerCdn(container);
  res.json({ ...container, cdnUrl: cdn.hostname ? `https://${cdn.hostname}` : null, cdnError: cdn.error });
});

router.patch("/v1/storage-containers/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const updates: Record<string, unknown> = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) { res.status(400).json({ error: "Name cannot be empty" }); return; }
    updates.name = name;
    updates.slug = slugify(name);
  }
  if (req.body?.description !== undefined) updates.description = req.body.description || null;
  if (req.body?.accessMode !== undefined && ["private", "public"].includes(req.body.accessMode)) updates.accessMode = req.body.accessMode;
  const [updated] = await db.update(storageContainersTable).set(updates).where(eq(storageContainersTable.id, container.id)).returning();
  const cdn = await resolveContainerCdn(updated);
  res.json({ ...updated, cdnUrl: cdn.hostname ? `https://${cdn.hostname}` : null, cdnError: cdn.error });
});

router.delete("/v1/storage-containers/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const objects = await db.select().from(storageObjectsTable).where(and(eq(storageObjectsTable.containerId, container.id), eq(storageObjectsTable.isFolder, false)));
  await Promise.allSettled(objects.map(object => deleteObject(object.objectKey)));
  await db.delete(storageContainersTable).where(eq(storageContainersTable.id, container.id));
  res.json({ message: "Container deleted" });
});

router.get("/v1/storage-containers/:id/objects", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const prefix = String(req.query.prefix ?? "").replace(/^\/+|\/+$/g, "");
  const basePrefix = containerPrefix(container.id, req.userId!);
  const storagePrefix = prefix ? `${basePrefix}${prefix}/` : basePrefix;
  const objects = await db.select().from(storageObjectsTable)
    .where(and(
      eq(storageObjectsTable.containerId, container.id),
      ilike(storageObjectsTable.objectKey, `${storagePrefix}%`),
    ))
    .orderBy(asc(storageObjectsTable.isFolder), asc(storageObjectsTable.name));
  const directObjects = objects.filter(object => {
    const relative = relativeObjectKey(object.objectKey, container.id, req.userId!);
    const current = prefix ? relative.slice(prefix.length + 1) : relative;
    return current.length > 0 && !current.includes("/");
  });
  const cdn = await resolveContainerCdn(container);
  res.json({ prefix, cdnError: cdn.error, objects: directObjects.map(object => objectApi(object, container.id, cdn)) });
});

router.post("/v1/storage-containers/:id/folders", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const name = validRelativePath(req.body?.name);
  if (!name) { res.status(400).json({ error: "Enter a valid folder path" }); return; }
  try {
    const segments = name.split("/");
    let folder: typeof storageObjectsTable.$inferSelect | null = null;
    for (let length = 1; length <= segments.length; length++) {
      folder = await ensureFolder(container.id, req.userId!, segments.slice(0, length).join("/"));
    }
    const cdn = await resolveContainerCdn(container);
    res.status(201).json(objectApi(folder!, container.id, cdn));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to create folder" });
  }
});

router.post("/v1/storage-containers/:id/upload-url", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const name = validRelativePath(req.body?.name);
  const contentType = String(req.body?.contentType ?? "application/octet-stream");
  if (!name) { res.status(400).json({ error: "Enter a valid object path" }); return; }
  const objectId = crypto.randomUUID();
  const key = `containers/${req.userId}/${container.id}/${name}`;
  const uploadUrl = await generateUploadUrl(key, contentType);
  res.json({ uploadUrl, objectId, key, name });
});

router.post("/v1/storage-containers/:id/objects/confirm", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const name = validRelativePath(req.body?.name);
  const key = String(req.body?.key ?? "");
  const expectedKey = name ? `${containerPrefix(container.id, req.userId!)}${name}` : "";
  if (!name || key !== expectedKey) {
    res.status(400).json({ error: "Invalid object confirmation" }); return;
  }
  try {
    await ensureParentFolders(container.id, req.userId!, name);
    const [existing] = await db.select().from(storageObjectsTable).where(and(
      eq(storageObjectsTable.containerId, container.id),
      eq(storageObjectsTable.userId, req.userId!),
      eq(storageObjectsTable.objectKey, key),
    )).limit(1);
    if (existing?.isFolder) { res.status(409).json({ error: "A folder already exists at this object path" }); return; }
    const details = {
      name: name.split("/").pop()!,
      contentType: req.body?.contentType || null,
      size: Number(req.body?.size ?? 0),
      etag: req.body?.etag || null,
      updatedAt: new Date(),
    };
    const [object] = existing
      ? await db.update(storageObjectsTable).set(details).where(eq(storageObjectsTable.id, existing.id)).returning()
      : await db.insert(storageObjectsTable).values({
          containerId: container.id,
          userId: req.userId!,
          objectKey: key,
          ...details,
        }).returning();
    res.status(existing ? 200 : 201).json(objectApi(object, container.id, await resolveContainerCdn(container)));
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Unable to confirm uploaded object" });
  }
});

router.get("/v1/storage-containers/:containerId/objects/:objectId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.containerId as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const [object] = await db.select().from(storageObjectsTable).where(and(
    eq(storageObjectsTable.id, req.params.objectId as string),
    eq(storageObjectsTable.containerId, container.id),
    eq(storageObjectsTable.userId, req.userId!),
  )).limit(1);
  if (!object) { res.status(404).json({ error: "Object not found" }); return; }
  res.json(objectApi(object, container.id, await resolveContainerCdn(container)));
});

router.patch("/v1/storage-containers/:containerId/objects/:objectId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.containerId as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const [object] = await db.select().from(storageObjectsTable).where(and(
    eq(storageObjectsTable.id, req.params.objectId as string),
    eq(storageObjectsTable.containerId, container.id),
    eq(storageObjectsTable.userId, req.userId!),
  )).limit(1);
  if (!object) { res.status(404).json({ error: "Object not found" }); return; }
  const name = String(req.body?.name ?? object.name).trim().replace(/^\/+/, "");
  if (!name || name.includes("..")) { res.status(400).json({ error: "Invalid object name" }); return; }
  const prefix = object.objectKey.includes("/") ? object.objectKey.slice(0, object.objectKey.lastIndexOf("/") + 1) : "";
  const nextKey = object.isFolder
    ? `${containerPrefix(container.id, req.userId!)}${name}`
    : `${prefix}${name}`;
  if (!object.isFolder && nextKey !== object.objectKey) {
    await copyObject(object.objectKey, nextKey);
    await deleteObject(object.objectKey);
  }
  const [updated] = await db.update(storageObjectsTable).set({
    name,
    objectKey: nextKey,
    updatedAt: new Date(),
  }).where(eq(storageObjectsTable.id, object.id)).returning();
  res.json(objectApi(updated, container.id, await resolveContainerCdn(container)));
});

router.delete("/v1/storage-containers/:containerId/objects/:objectId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.containerId as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const [object] = await db.select().from(storageObjectsTable).where(and(
    eq(storageObjectsTable.id, req.params.objectId as string),
    eq(storageObjectsTable.containerId, container.id),
    eq(storageObjectsTable.userId, req.userId!),
  )).limit(1);
  if (!object) { res.status(404).json({ error: "Object not found" }); return; }
  if (!object.isFolder) await deleteObject(object.objectKey).catch(() => {});
  await db.delete(storageObjectsTable).where(eq(storageObjectsTable.id, object.id));
  res.json({ message: "Object deleted" });
});

router.patch("/v1/storage-containers/:id/cdn", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const container = await ownedContainer(req.params.id as string, req.userId!);
  if (!container) { res.status(404).json({ error: "Container not found" }); return; }
  const enabled = Boolean(req.body?.enabled);
  if (!enabled) {
    const [updated] = await db.update(storageContainersTable).set({
      cdnEnabled: false,
      cdnHostnameId: null,
      cdnStatus: "disabled",
    }).where(eq(storageContainersTable.id, container.id)).returning();
    res.json({ ...updated, cdnUrl: null, cdnError: null });
    return;
  }
  const hostnameId = String(req.body?.hostnameId ?? "");
  const [hostname] = await db.select().from(hostnamesTable).innerJoin(domainsTable, eq(hostnamesTable.domainId, domainsTable.id)).where(and(
    eq(hostnamesTable.id, hostnameId),
    eq(hostnamesTable.userId, req.userId!),
    eq(hostnamesTable.service, "cdn"),
    eq(domainsTable.userId, req.userId!),
    eq(domainsTable.verificationStatus, "verified"),
  )).limit(1);
  if (!hostname) { res.status(400).json({ error: "Select one of your verified CDN hostnames" }); return; }
  if (hostname.hostnames.status !== "active" || hostname.hostnames.sslStatus !== "active" || hostname.hostnames.dnsStatus !== "configured") {
    res.status(400).json({ error: "The selected hostname is not ready: verify its DNS and SSL status first" });
    return;
  }
  const [updated] = await db.update(storageContainersTable).set({
    cdnEnabled: true,
    cdnHostnameId: hostname.hostnames.id,
    cdnStatus: "active",
  }).where(eq(storageContainersTable.id, container.id)).returning();
  res.json({ ...updated, cdnUrl: `https://${hostname.hostnames.hostname}`, cdnStatus: "active", cdnError: null });
});

export default router;