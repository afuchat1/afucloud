import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import cdnWorker, { objectKeyFromPath } from "./src/index.ts";
import { publicStorageObjectUrl as apiStorageObjectUrl } from "../../artifacts/api-server/src/lib/public-storage-url.ts";
import { publicStorageObjectUrl as workerStorageObjectUrl } from "../../artifacts/cf-worker/src/lib/public-storage-url.ts";
import { resolveImageUrl, resolveStorageObjectUrl } from "../../artifacts/afucloud/src/lib/api-base.ts";

test("API and production Worker generate the canonical object bucket URL", () => {
  const objectKey = "containers/user-id/container-id/folder/my file.png";
  const expected = "https://cdn.afuchat.com/cloud/object/user-id/container-id/folder/my%20file.png";

  assert.equal(apiStorageObjectUrl(objectKey, null), expected);
  assert.equal(workerStorageObjectUrl(objectKey, null), expected);
  assert.equal(apiStorageObjectUrl(objectKey, "cdn.afuchat.com"), expected);
  assert.equal(workerStorageObjectUrl(objectKey, "img.afuchat.com"), expected);
});

test("file object links always use the canonical public CDN URL", () => {
  const objectKey = "containers/user-id/container-id/file.bin";
  assert.equal(
    apiStorageObjectUrl(objectKey, "assets.example.com"),
    "https://cdn.afuchat.com/cloud/object/user-id/container-id/file.bin",
  );
  assert.equal(
    workerStorageObjectUrl(objectKey, "assets.example.com"),
    "https://cdn.afuchat.com/cloud/object/user-id/container-id/file.bin",
  );
});

test("storage file previews and copied links normalize old API/storage paths to the CDN", () => {
  const expected = "https://cdn.afuchat.com/cloud/object/user-id/container-id/file%20name.png";
  assert.equal(
    resolveStorageObjectUrl("/api/v1/storage/containers%2Fuser-id%2Fcontainer-id%2Ffile%20name.png"),
    expected,
  );
  assert.equal(
    resolveStorageObjectUrl("https://cdn.afuchat.com/cloud/storage/user-id/container-id/file%20name.png"),
    expected,
  );
  assert.equal(resolveStorageObjectUrl(expected), expected);
});

test("image previews remain on the image CDN path, not the API gateway", () => {
  const imageUrl = "https://cdn.afuchat.com/cloud/images/user-id/project-id/image-id.png";
  assert.equal(resolveImageUrl("https://api.afuchat.com/cloud/images/user-id/project-id/image-id.png"), imageUrl);
  assert.equal(resolveImageUrl("/api/cloud/images/user-id/project-id/image-id.png"), imageUrl);
  assert.equal(objectKeyFromPath("/cloud/images/user-id/project-id/image-id.png"), "user-id/project-id/image-id.png");
});

test("the CDN worker reads objects from the R2 container prefix", async () => {
  let requestedKey = "";
  const objectBody = new TextEncoder().encode("bucket object");
  const response = await cdnWorker.fetch(
    new Request("https://cdn.afuchat.com/cloud/object/user-id/container-id/file.txt"),
    {
      IMAGES_BUCKET: {
        head: async () => null,
        get: async (key) => {
          requestedKey = key;
          return {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(objectBody);
                controller.close();
              },
            }),
            size: objectBody.length,
            etag: "test-etag",
            httpEtag: '"test-etag"',
            uploaded: new Date(),
            httpMetadata: { cacheControl: "public, max-age=300" },
            writeHttpMetadata(headers) {
              headers.set("Content-Type", "text/plain");
            },
          };
        },
      },
    },
  );

  assert.equal(requestedKey, "containers/user-id/container-id/file.txt");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "bucket object");
});

test("legacy storage URLs remain readable while new files use /cloud/object", () => {
  assert.equal(
    objectKeyFromPath("/cloud/storage/user-id/container-id/file.txt"),
    "containers/user-id/container-id/file.txt",
  );
  assert.equal(
    objectKeyFromPath("/cloud/object/user-id/container-id/file.txt"),
    "containers/user-id/container-id/file.txt",
  );
  assert.equal(objectKeyFromPath("/cloud/object/../private.txt"), null);
});

test("Cloudflare routes keep /cloud/* on the CDN worker, not the API gateway", async () => {
  const cdnConfig = await readFile(new URL("./wrangler.toml", import.meta.url), "utf8");
  const apiGatewayConfig = await readFile(new URL("../api-gateway/wrangler.toml", import.meta.url), "utf8");

  assert.match(cdnConfig, /pattern = "cdn\.afuchat\.com\/cloud\/\*"/);
  assert.doesNotMatch(apiGatewayConfig, /cdn\.afuchat\.com/);
});
