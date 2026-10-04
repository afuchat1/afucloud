interface WorkerService {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  AFUCLOUD_API: WorkerService;
}

function belongsToAfuCloud(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/healthz" ||
    pathname === "/afucloud" ||
    pathname.startsWith("/afucloud/") ||
    pathname === "/v1" ||
    pathname.startsWith("/v1/")
  );
}

function notFound(pathname: string): Response {
  return Response.json(
    {
      error: "Not found",
      path: pathname,
      timestamp: new Date().toISOString(),
      api_version: "v1",
    },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!belongsToAfuCloud(pathname)) return notFound(pathname);

    try {
      // Forward the original URL, method, headers, and body unchanged. This
      // keeps /v1 clients and the product-scoped /afucloud/v1 API compatible.
      return await env.AFUCLOUD_API.fetch(request);
    } catch (error) {
      console.error("[Afu API Gateway] AfuCloud service binding failed", error);
      return Response.json(
        { error: "Service temporarily unavailable", product: "afucloud" },
        { status: 502, headers: { "Cache-Control": "no-store" } },
      );
    }
  },
};