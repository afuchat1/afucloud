/**
 * Storage abstraction layer.
 * Currently generates signed URLs for Cloudflare R2.
 * Replace the implementation without changing the interface.
 */
import crypto from "crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "";
const ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? "";
const SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? "";
const BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "afucloud-images";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL ?? "";

export function getPublicUrl(key: string): string {
  if (R2_PUBLIC_URL) return `${R2_PUBLIC_URL}/${key}`;
  // Fallback: serve via API proxy
  return `/api/v1/storage/${encodeURIComponent(key)}`;
}

/**
 * Generate an S3-compatible pre-signed PUT URL for Cloudflare R2.
 * Returns the upload URL and the storage key.
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  if (!ACCOUNT_ID || !ACCESS_KEY_ID || !SECRET_ACCESS_KEY) {
    // Dev mode: return a mock URL that accepts any PUT request
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
