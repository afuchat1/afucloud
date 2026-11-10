import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import gateway from "./src/index.ts";

test("dashboard session requests are forwarded to the AfuCloud API unchanged", async () => {
  const url = "https://api.afuchat.com/afucloud/v1/dashboard/session/me";
  const cookie = "afucloud_dashboard_access=session-cookie";
  let forwardedUrl = "";
  let forwardedCookie = "";

  const response = await gateway.fetch(
    new Request(url, { headers: { Cookie: cookie } }),
    {
      AFUCLOUD_API: {
        fetch: async (request) => {
          forwardedUrl = request.url;
          forwardedCookie = request.headers.get("Cookie") ?? "";
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        },
      },
    },
  );

  assert.equal(forwardedUrl, url);
  assert.equal(forwardedCookie, cookie);
  assert.equal(response.status, 401);
});

test("gateway config matches the live catch-all without taking over the API root", async () => {
  const config = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");

  assert.match(config, /^name = "afu-api"$/m);
  assert.match(config, /pattern = "api\.afuchat\.com\/\*"/);
  assert.doesNotMatch(config, /pattern = "api\.afuchat\.com"/);
  assert.match(config, /service = "afucloud-api"/);
});
