/**
 * Storage abstraction layer.
 * Currently implements Cloudflare R2 via S3-compatible API.
 * Replace implementations without changing the interface.
 */
import crypto from "crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? "";
const SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "afucloud-images";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "";

export function getPublicUrl(key: string): string {
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${key}`;
  return `/api/v1/storage/${encodeURIComponent(key)}`;
}

/**
 * Generate an S3-compatible pre-signed PUT URL for Cloudflare R2.
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    return `/api/v1/storage/dev-upload/${encodeURIComponent(key)}`;
  }

  const endpoint = `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const region = "auto";
  const service = "s3";

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const credential = `${ACCESS_KEY_ID}/${credentialScope}`;

  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresInSeconds),
    "X-Amz-SignedHeaders": "host",
  });

  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const canonicalRequest = [
    "PUT",
    `/${BUCKET_NAME}/${key}`,
    params.toString(),
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = getSignatureKey(SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  params.append("X-Amz-Signature", signature);
  return `${endpoint}/${BUCKET_NAME}/${key}?${params.toString()}`;
}

/**
 * Permanently delete an object from R2. No-op in dev mode (missing creds).
 */
export async function deleteObject(key: string): Promise<void> {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    // Dev mode: skip actual deletion
    return;
  }

  const region = "auto";
  const service = "s3";
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;
  const EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const canonicalRequest = [
    "DELETE",
    `/${BUCKET_NAME}/${key}`,
    "",
    `host:${host}\nx-amz-content-sha256:${EMPTY_HASH}\nx-amz-date:${amzDate}\n`,
    "host;x-amz-content-sha256;x-amz-date",
    EMPTY_HASH,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const signingKey = getSignatureKey(SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY_ID}/${credentialScope}`,
    `SignedHeaders=host;x-amz-content-sha256;x-amz-date`,
    `Signature=${signature}`,
  ].join(", ");

  const res = await fetch(`${endpoint}/${BUCKET_NAME}/${key}`, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": EMPTY_HASH,
      "x-amz-date": amzDate,
      Host: host,
    },
  });

  // R2 returns 204 on success; 404 is also fine (already gone)
  if (!res.ok && res.status !== 204 && res.status !== 404) {
    throw new Error(`R2 delete failed: ${res.status}`);
  }
}

function getSignatureKey(key: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}

export function buildStorageKey(userId: string, projectId: string, imageId: string, ext: string): string {
  return `${userId}/${projectId}/${imageId}.${ext}`;
}
