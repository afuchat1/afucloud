import { Hono } from "hono";
import type { Env, AuthVariables } from "../types";
import { createDbClient } from "../lib/db";
import { requireAuth } from "../middleware/auth";
import { copyObject, deleteObject, generateUploadUrl } from "../lib/storage";

const storageContainers = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

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

function normalizeTimestamp(value: unknown, fallback?: unknown): string {
  for (const candidate of [value, fallback]) {
    if (candidate == null || candidate === "") continue;
    const date = candidate instanceof Date ? candidate : new Date(candidate as string | number);
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

function objectApi(object: any, containerId: string, cdn: CdnResolution) {
  const relativeKey = relativeObjectKey(object.object_key, containerId, object.user_id);
  const publicKey = publicObjectKey(object.object_key);
  const encodedPublicKey = encodeObjectPath(publicKey);
  const publicUrl = object.is_folder
    ? null
    : `https://${publicHostname(object.content_type, object.name, cdn.hostname)}/${encodedPublicKey}`;

  return {
    id: object.id,
    containerId,
    key: publicUrl,
    storageKey: object.object_key,
    path: relativeKey,
    name: String(object.name ?? relativeKey.split("/").pop() ?? "").split("/").pop() ?? "",
    contentType: object.content_type ?? null,
    size: Number(object.size ?? 0),
    etag: object.etag ?? null,
    isFolder: object.is_folder,
    url: publicUrl,
    createdAt: normalizeTimestamp(object.created_at),
    updatedAt: normalizeTimestamp(object.updated_at, object.created_at),
    cdnError: cdn.error,
  };
}

async function resolveCdn(db: ReturnType<typeof createDbClient>, container: any, userId: string): Promise<CdnResolution> {
  if (!container.cdn_enabled) return { hostname: null, error: null };
  if (!container.cdn_hostname_id) {
    return { hostname: null, error: "CDN is enabled, but no hostname is selected." };
  }
  const hostnames = await db.getHostnamesForCdn(userId, container.cdn_hostname_id);
  const hostname = hostnames[0];
  if (!hostname) {
    return { hostname: null, error: "The selected hostname is missing, not owned by this account, or is not configured for CDN service." };
  }
  const domain = await db.getDomain(hostname.domain_id, userId);
  if (domain?.verification_status !== "verified") {
    return { hostname: null, error: "The selected hostname's root domain is not verified." };
  }
  if (hostname.status !== "active" || hostname.ssl_status !== "active" || hostname.dns_status !== "configured") {
    return { hostname: null, error: "The selected hostname is not ready: hostname, SSL, and DNS must all be active/configured." };
  }
  return { hostname: String(hostname.hostname).replace(/\.$/, ""), error: null };
}

function containerApi(container: any, containerStats: { objectCount: number; storageUsed: number }, cdn: CdnResolution) {
  return {
    id: container.id,
    projectId: container.project_id ?? null,
    name: container.name,
    slug: container.slug,
    description: container.description ?? null,
    accessMode: container.access_mode ?? "private",
    cdnEnabled: Boolean(container.cdn_enabled),
    cdnHostnameId: container.cdn_hostname_id ?? null,
    cdnStatus: container.cdn_status ?? (container.cdn_enabled ? "pending" : "disabled"),
    createdAt: normalizeTimestamp(container.created_at),
    updatedAt: normalizeTimestamp(container.updated_at, container.created_at),
    ...containerStats,
    cdnUrl: cdn.hostname ? `https://${cdn.hostname}` : null,
    cdnError: cdn.error,
  };
}

function validRelativePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/^\/+|\/+$/g, "");
  const segments = path.split("/");
  if (!path || segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("\\"))) return null;
  return path;
}

async function ensureFolder(db: ReturnType<typeof createDbClient>, container: any, userId: string, relativePath: string) {
  const objectKey = `${containerPrefix(container.id, userId)}${relativePath}`;
  const existing = await db.getStorageObjectByKey(objectKey, container.id, userId);
  if (existing) {
    if (!existing.is_folder) throw new Error(`A file already exists at folder path "${relativePath}".`);
    return existing;
  }
  try {
    return await db.createStorageObject({
      container_id: container.id,
      user_id: userId,
      object_key: objectKey,
      name: relativePath.split("/").pop(),
      is_folder: true,
    });
  } catch (error) {
    const raced = await db.getStorageObjectByKey(objectKey, container.id, userId);
    if (raced?.is_folder) return raced;
    throw error;
  }
}

async function ensureParentFolders(db: ReturnType<typeof createDbClient>, container: any, userId: string, relativePath: string) {
  const segments = relativePath.split("/");
  for (let length = 1; length < segments.length; length++) {
    await ensureFolder(db, container, userId, segments.slice(0, length).join("/"));
  }
}

async function stats(db: ReturnType<typeof createDbClient>, container: any, userId: string) {
  const objects = await db.getStorageObjects(container.id, userId);
  const files = objects.filter(object => !object.is_folder);
  return {
    objectCount: files.length,
    storageUsed: files.reduce((total, object) => total + Number(object.size ?? 0), 0),
  };
}

storageContainers.get("/", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const containers = await db.getStorageContainers(c.get("userId"));
  return c.json(await Promise.all(containers.map(async container => {
    const containerStats = await stats(db, container, c.get("userId"));
    return containerApi(container, containerStats, await resolveCdn(db, container, c.get("userId")));
  })));
});

storageContainers.post("/", requireAuth, async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (name.length < 2) return c.json({ error: "Container name is required" }, 400);
  const slug = slugify(name);
  const db = createDbClient(c.env);
  const existing = (await db.getStorageContainers(c.get("userId"))).find(container => container.slug === slug);
  if (existing) return c.json({ error: "A container with that name already exists" }, 409);
  const created = await db.createStorageContainer({
    user_id: c.get("userId"),
    name,
    slug,
    description: body.description || null,
    project_id: body.projectId || null,
  });
  return c.json(containerApi(created, { objectCount: 0, storageUsed: 0 }, { hostname: null, error: null }), 201);
});

storageContainers.get("/:id", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  return c.json(containerApi(container, await stats(db, container, c.get("userId")), await resolveCdn(db, container, c.get("userId"))));
});

storageContainers.patch("/:id", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return c.json({ error: "Name cannot be empty" }, 400);
    updates.name = name;
    updates.slug = slugify(name);
  }
  if (body.description !== undefined) updates.description = body.description || null;
  if (body.accessMode !== undefined && ["private", "public"].includes(body.accessMode)) updates.access_mode = body.accessMode;
  const updated = await db.updateStorageContainer(container.id, c.get("userId"), updates);
  return c.json(containerApi(updated, await stats(db, updated, c.get("userId")), await resolveCdn(db, updated, c.get("userId"))));
});

storageContainers.delete("/:id", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const objects = await db.getStorageObjects(container.id, c.get("userId"));
  await Promise.allSettled(objects.filter(object => !object.is_folder).map(object => deleteObject(object.object_key, c.env)));
  await db.deleteStorageContainer(container.id, c.get("userId"));
  return c.json({ message: "Container deleted" });
});

storageContainers.get("/:id/objects", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const prefix = (c.req.query("prefix") ?? "").replace(/^\/+|\/+$/g, "");
  const storagePrefix = prefix
    ? `${containerPrefix(container.id, c.get("userId"))}${prefix}`
    : containerPrefix(container.id, c.get("userId"));
  const objects = (await db.getStorageObjects(container.id, c.get("userId"), storagePrefix)).filter(object => {
    const relative = relativeObjectKey(object.object_key, container.id, c.get("userId"));
    const current = prefix ? relative.slice(prefix.length + 1) : relative;
    return current.length > 0 && !current.includes("/");
  });
  const cdn = await resolveCdn(db, container, c.get("userId"));
  return c.json({ prefix, cdnError: cdn.error, objects: objects.map(object => objectApi(object, container.id, cdn)) });
});

storageContainers.post("/:id/folders", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const name = validRelativePath((await c.req.json().catch(() => ({}))).name);
  if (!name) return c.json({ error: "Enter a valid folder path" }, 400);
  try {
    const segments = name.split("/");
    let folder: any = null;
    for (let length = 1; length <= segments.length; length++) {
      folder = await ensureFolder(db, container, c.get("userId"), segments.slice(0, length).join("/"));
    }
    const cdn = await resolveCdn(db, container, c.get("userId"));
    return c.json(objectApi(folder, container.id, cdn), 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to create folder" }, 409);
  }
});

storageContainers.post("/:id/upload-url", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = validRelativePath(body.name);
  const contentType = String(body.contentType ?? "application/octet-stream");
  if (!name) return c.json({ error: "Enter a valid object path" }, 400);
  const key = `containers/${c.get("userId")}/${container.id}/${name}`;
  const uploadUrl = await generateUploadUrl(key, contentType, c.env);
  return c.json({ uploadUrl, objectId: crypto.randomUUID(), key, name });
});

storageContainers.post("/:id/objects/confirm", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = validRelativePath(body.name);
  const key = String(body.key ?? "");
  const prefix = `containers/${c.get("userId")}/${container.id}/`;
  if (!name || key !== `${prefix}${name}`) return c.json({ error: "Invalid object confirmation" }, 400);
  const userId = c.get("userId");
  try {
    await ensureParentFolders(db, container, userId, name);
    const existing = await db.getStorageObjectByKey(key, container.id, userId);
    if (existing?.is_folder) return c.json({ error: "A folder already exists at this object path" }, 409);
    const object = existing
      ? await db.updateStorageObject(existing.id, container.id, userId, {
          name: name.split("/").pop(),
          content_type: body.contentType || null,
          size: Number(body.size ?? 0),
          etag: body.etag || null,
          updated_at: new Date().toISOString(),
        })
      : await db.createStorageObject({
          container_id: container.id,
          user_id: userId,
          object_key: key,
          name: name.split("/").pop(),
          content_type: body.contentType || null,
          size: Number(body.size ?? 0),
          etag: body.etag || null,
        });
    return c.json(objectApi(object, container.id, await resolveCdn(db, container, userId)), existing ? 200 : 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Unable to confirm uploaded object" }, 409);
  }
});

storageContainers.get("/:containerId/objects/:objectId", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("containerId"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const object = await db.getStorageObject(c.req.param("objectId"), container.id, c.get("userId"));
  if (!object) return c.json({ error: "Object not found" }, 404);
  return c.json(objectApi(object, container.id, await resolveCdn(db, container, c.get("userId"))));
});

storageContainers.patch("/:containerId/objects/:objectId", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("containerId"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const object = await db.getStorageObject(c.req.param("objectId"), container.id, c.get("userId"));
  if (!object) return c.json({ error: "Object not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? object.name).trim().replace(/^\/+/, "");
  if (!name || name.includes("..")) return c.json({ error: "Invalid object name" }, 400);
  const prefix = object.object_key.includes("/") ? object.object_key.slice(0, object.object_key.lastIndexOf("/") + 1) : "";
  const nextKey = object.is_folder
    ? `${containerPrefix(container.id, c.get("userId"))}${name}`
    : `${prefix}${name}`;
  if (!object.is_folder && nextKey !== object.object_key) {
    await copyObject(object.object_key, nextKey, c.env);
    await deleteObject(object.object_key, c.env);
  }
  const updated = await db.updateStorageObject(object.id, container.id, c.get("userId"), {
    name,
    object_key: nextKey,
    updated_at: new Date().toISOString(),
  });
  return c.json(objectApi(updated, container.id, await resolveCdn(db, container, c.get("userId"))));
});

storageContainers.delete("/:containerId/objects/:objectId", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("containerId"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const object = await db.getStorageObject(c.req.param("objectId"), container.id, c.get("userId"));
  if (!object) return c.json({ error: "Object not found" }, 404);
  if (!object.is_folder) await deleteObject(object.object_key, c.env).catch(() => {});
  await db.deleteStorageObject(object.id, container.id, c.get("userId"));
  return c.json({ message: "Object deleted" });
});

storageContainers.patch("/:id/cdn", requireAuth, async (c) => {
  const db = createDbClient(c.env);
  const container = await db.getStorageContainer(c.req.param("id"), c.get("userId"));
  if (!container) return c.json({ error: "Container not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  if (!body.enabled) {
    const updated = await db.updateStorageContainer(container.id, c.get("userId"), {
      cdn_enabled: false,
      cdn_hostname_id: null,
      cdn_status: "disabled",
    });
    return c.json(containerApi(updated, await stats(db, updated, c.get("userId")), { hostname: null, error: null }));
  }
  const hostnameId = String(body.hostnameId ?? "");
  const hostnames = await db.getHostnamesForCdn(c.get("userId"), hostnameId);
  const hostname = hostnames.find(item => item.service === "cdn" && item.status === "active");
  const domain = hostname ? await db.getDomain(hostname.domain_id, c.get("userId")) : null;
  if (!hostname || !domain || domain.verification_status !== "verified") {
    return c.json({ error: "Select a CDN hostname on one of your verified domains." }, 400);
  }
  if (hostname.ssl_status !== "active" || hostname.dns_status !== "configured") {
    return c.json({ error: "The selected hostname is not ready: verify its DNS and SSL status first." }, 400);
  }
  const updated = await db.updateStorageContainer(container.id, c.get("userId"), {
    cdn_enabled: true,
    cdn_hostname_id: hostname.id,
    cdn_status: "active",
  });
  return c.json(containerApi(updated, await stats(db, updated, c.get("userId")), { hostname: hostname.hostname, error: null }));
});

export default storageContainers;