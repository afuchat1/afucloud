import { Hono } from "hono";
import type { Env } from "../types";

const publicAssets = new Hono<{ Bindings: Env }>();

const CACHE_CONTROL = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

function responseHeaders(): Headers {
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Range, If-None-Match, If-Modified-Since, If-Range");
  headers.set("Access-Control-Expose-Headers", "Accept-Ranges, Content-Length, Content-Range, ETag");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Cross-Origin-Resource-Policy", "cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return headers;
}

function errorResponse(status: number, message: string, extraHeaders?: HeadersInit): Response {
  const headers = responseHeaders();
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  return Response.json({ error: message }, { status, headers });
}

function objectKeyFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/cloud\/(images|storage)\/(.+)$/);
  if (!match) return null;

  let segments: string[];
  try {
    segments = match[2].split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        segment.includes("\0"),
    )
  ) {
    return null;
  }

  const key = segments.join("/");
  return match[1] === "storage" ? `containers/${key}` : key;
}

function setObjectHeaders(object: R2Object, headers: Headers): void {
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", object.httpMetadata?.cacheControl ?? CACHE_CONTROL);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
}

function contentRange(object: R2Object): { value: string; length: number } | null {
  const range = object.range;
  if (!range) return null;

  const length =
    "length" in range && typeof range.length === "number"
      ? range.length
      : "suffix" in range && typeof range.suffix === "number"
        ? Math.min(range.suffix, object.size)
        : null;
  const offset =
    "offset" in range && typeof range.offset === "number"
      ? range.offset
      : length !== null
        ? object.size - length
        : null;

  if (length === null || offset === null || length < 1) return null;
  return {
    value: `bytes ${offset}-${offset + length - 1}/${object.size}`,
    length,
  };
}

async function serveAsset(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return errorResponse(405, "Method not allowed", { Allow: "GET, HEAD, OPTIONS" });
  }

  const key = objectKeyFromPath(new URL(request.url).pathname);
  if (!key) return errorResponse(404, "Not found");

  try {
    if (request.method === "HEAD") {
      const object = await env.IMAGES_BUCKET.head(key);
      if (!object) return errorResponse(404, "Not found");

      const headers = responseHeaders();
      setObjectHeaders(object, headers);
      headers.set("Content-Length", String(object.size));
      return new Response(null, { status: 200, headers });
    }

    const object = request.headers.has("Range")
      ? await env.IMAGES_BUCKET.get(key, { range: request.headers })
      : await env.IMAGES_BUCKET.get(key);
    if (!object) return errorResponse(404, "Not found");

    const headers = responseHeaders();
    setObjectHeaders(object, headers);
    const partial = contentRange(object);
    if (partial) {
      headers.set("Content-Range", partial.value);
      headers.set("Content-Length", String(partial.length));
      return new Response(object.body, { status: 206, headers });
    }

    headers.set("Content-Length", String(object.size));
    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    console.error("[AfuCloud CDN] R2 read failed", error);
    return errorResponse(502, "Storage temporarily unavailable");
  }
}

publicAssets.on(["GET", "HEAD"], "/*", (c) => serveAsset(c.req.raw, c.env));

publicAssets.options("/*", () => new Response(null, { status: 204, headers: responseHeaders() }));

export default publicAssets;