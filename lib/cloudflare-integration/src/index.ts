const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const CLOUDFLARE_OAUTH_SCOPES = [
  "zone.read",
  "dns_records.read",
  "dns_records.write",
  "offline_access",
] as const;

export const CLOUDFLARE_DNS_RECORD_TYPES = [
  "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC",
  "MX", "NAPTR", "NS", "PTR", "SMIMEA", "SRV", "SSHFP", "SVCB", "TLSA",
  "TXT", "URI",
] as const;

export interface OAuthEnvironment {
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string;
  CLOUDFLARE_OAUTH_REDIRECT_URI?: string;
  CLOUDFLARE_OAUTH_STATE_SECRET?: string;
  CLOUDFLARE_TOKEN_ENCRYPTION_KEY?: string;
}

export interface CloudflareTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

export interface DnsRecordInput {
  type?: unknown;
  name?: unknown;
  content?: unknown;
  data?: unknown;
  ttl?: unknown;
  proxied?: unknown;
  priority?: unknown;
  comment?: unknown;
  tags?: unknown;
}

export class CloudflareRequestError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = "CloudflareRequestError";
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

export function randomUrlSafeToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function constantTimeEqual(left: string, right: string): boolean {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createOAuthState(
  userId: string,
  signingSecret: string,
  returnOrigin?: string,
): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    userId,
    expiresAt: Math.floor(Date.now() / 1000) + 600,
    nonce: randomUrlSafeToken(16),
    ...(returnOrigin ? { returnOrigin } : {}),
  })));
  const key = await hmacKey(signingSecret);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
  return `${payload}.${bytesToBase64Url(signature)}`;
}

export async function verifyOAuthStateClaims(
  state: string,
  signingSecret: string,
): Promise<{ userId: string; returnOrigin: string | null } | null> {
  const [payload, signature, ...extra] = state.split(".");
  if (!payload || !signature || extra.length) return null;
  try {
    const key = await hmacKey(signingSecret);
    const valid = await crypto.subtle.verify("HMAC", key, toArrayBuffer(base64UrlToBytes(signature)), encoder.encode(payload));
    if (!valid) return null;
    const claims = JSON.parse(decoder.decode(base64UrlToBytes(payload))) as {
      userId?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
      returnOrigin?: unknown;
    };
    if (
      typeof claims.userId !== "string" ||
      typeof claims.expiresAt !== "number" ||
      claims.expiresAt < Math.floor(Date.now() / 1000) ||
      typeof claims.nonce !== "string" ||
      (claims.returnOrigin !== undefined && typeof claims.returnOrigin !== "string")
    ) return null;
    return {
      userId: claims.userId,
      returnOrigin: typeof claims.returnOrigin === "string" ? claims.returnOrigin : null,
    };
  } catch {
    return null;
  }
}

export async function verifyOAuthState(state: string, signingSecret: string): Promise<string | null> {
  return (await verifyOAuthStateClaims(state, signingSecret))?.userId ?? null;
}

export async function createPkcePairForState(
  state: string,
  signingSecret: string,
): Promise<{ verifier: string; challenge: string }> {
  const key = await hmacKey(signingSecret);
  const verifierSignature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`afucloud-cloudflare-pkce-v1:${state}`),
  );
  const verifier = bytesToBase64Url(new Uint8Array(verifierSignature));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return { verifier, challenge: bytesToBase64Url(digest) };
}

export function isCloudflareOAuthConfigured(env: OAuthEnvironment): boolean {
  return Boolean(
    env.CLOUDFLARE_OAUTH_CLIENT_ID &&
    env.CLOUDFLARE_OAUTH_CLIENT_SECRET &&
    env.CLOUDFLARE_OAUTH_REDIRECT_URI &&
    env.CLOUDFLARE_OAUTH_STATE_SECRET &&
    env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY,
  );
}

export function getEncryptionKeyBytes(env: OAuthEnvironment): Uint8Array {
  const encodedKey = env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY;
  if (!encodedKey) throw new Error("Cloudflare token encryption is not configured");
  const keyBytes = base64UrlToBytes(encodedKey);
  if (keyBytes.length !== 32) throw new Error("Cloudflare token encryption key must be 32 bytes, base64url encoded");
  return keyBytes;
}

export async function encryptToken(token: string, env: OAuthEnvironment): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(getEncryptionKeyBytes(env)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(token));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptToken(encrypted: string, env: OAuthEnvironment): Promise<string> {
  const [version, ivText, ciphertextText, ...extra] = encrypted.split(".");
  if (version !== "v1" || !ivText || !ciphertextText || extra.length) {
    throw new Error("Stored Cloudflare token has an unsupported format");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(getEncryptionKeyBytes(env)),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlToBytes(ivText)) },
    key,
    toArrayBuffer(base64UrlToBytes(ciphertextText)),
  );
  return decoder.decode(plaintext);
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomUrlSafeToken(48);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
  return { verifier, challenge: bytesToBase64Url(digest) };
}

export function createCloudflareAuthorizationUrl(input: {
  env: OAuthEnvironment;
  state: string;
  codeChallenge: string;
}): string {
  const { CLOUDFLARE_OAUTH_CLIENT_ID: clientId, CLOUDFLARE_OAUTH_REDIRECT_URI: redirectUri } = input.env;
  if (!clientId || !redirectUri) throw new Error("Cloudflare OAuth client is not configured");
  const url = new URL("https://dash.cloudflare.com/oauth2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CLOUDFLARE_OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function tokenEndpointRequest(body: URLSearchParams, env: OAuthEnvironment): Promise<CloudflareTokenResponse> {
  const clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID;
  const clientSecret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Cloudflare OAuth client is not configured");
  const response = await fetch("https://dash.cloudflare.com/oauth2/token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const result = await response.json().catch(() => ({})) as CloudflareTokenResponse & { error?: string };
  if (!response.ok || typeof result.access_token !== "string" || typeof result.expires_in !== "number") {
    throw new CloudflareRequestError("Cloudflare authorization could not be completed", response.status >= 400 ? 502 : 502);
  }
  return result;
}

export async function exchangeAuthorizationCode(
  code: string,
  verifier: string,
  env: OAuthEnvironment,
): Promise<CloudflareTokenResponse> {
  const redirectUri = env.CLOUDFLARE_OAUTH_REDIRECT_URI;
  if (!redirectUri) throw new Error("Cloudflare OAuth redirect URI is not configured");
  return tokenEndpointRequest(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  }), env);
}

export async function refreshCloudflareToken(
  refreshToken: string,
  env: OAuthEnvironment,
): Promise<CloudflareTokenResponse> {
  return tokenEndpointRequest(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }), env);
}

export async function revokeCloudflareToken(token: string, env: OAuthEnvironment): Promise<void> {
  const clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID;
  const clientSecret = env.CLOUDFLARE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Cloudflare OAuth client is not configured");
  const response = await fetch("https://dash.cloudflare.com/oauth2/revoke", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token, token_type_hint: "refresh_token" }),
  });
  if (!response.ok) throw new CloudflareRequestError("Cloudflare token revocation failed", 502);
}

export interface CloudflareApiEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
  result_info?: { page?: number; per_page?: number; count?: number; total_count?: number; total_pages?: number };
}

export async function cloudflareApi<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<CloudflareApiEnvelope<T>> {
  const url = new URL(path.replace(/^\/+/, ""), "https://api.cloudflare.com/client/v4/");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const envelope = await response.json().catch(() => ({})) as CloudflareApiEnvelope<T>;
  if (!response.ok || envelope.success !== true) {
    const providerMessage = envelope.errors?.find(error => error.message)?.message;
    throw new CloudflareRequestError(providerMessage || "Cloudflare rejected the DNS request", response.status || 502);
  }
  return envelope;
}

function normalizeRecordName(input: unknown, zoneName: string): string {
  if (typeof input !== "string" || !input.trim()) throw new Error("Record name is required");
  const raw = input.trim().toLowerCase().replace(/\.$/, "");
  const zone = zoneName.toLowerCase().replace(/\.$/, "");
  const fqdn = raw === "@" || raw === zone || raw.endsWith(`.${zone}`)
    ? raw === "@" ? zone : raw
    : `${raw}.${zone}`;
  if (fqdn !== zone && !fqdn.endsWith(`.${zone}`)) {
    throw new Error("Record name must be inside the selected zone");
  }
  if (fqdn.length > 253) throw new Error("Record name is too long");
  const labels = fqdn.split(".");
  if (labels.some(label =>
    label.length < 1 ||
    label.length > 63 ||
    !/^[a-z0-9_*](?:[a-z0-9_*-]*[a-z0-9_*])?$/.test(label),
  )) {
    throw new Error("Record name contains an invalid DNS label");
  }
  return fqdn;
}

export function buildDnsRecordPayload(input: DnsRecordInput, zoneName: string): Record<string, unknown> {
  const type = typeof input.type === "string" ? input.type.trim().toUpperCase() : "";
  if (!CLOUDFLARE_DNS_RECORD_TYPES.includes(type as typeof CLOUDFLARE_DNS_RECORD_TYPES[number])) {
    throw new Error("Choose a DNS record type supported by Cloudflare");
  }
  const name = normalizeRecordName(input.name, zoneName);
  const content = input.content;
  const data = input.data;
  if (data !== undefined && data !== null && (typeof data !== "object" || Array.isArray(data))) {
    throw new Error("Advanced record data must be a JSON object");
  }
  if ((content === undefined || content === null || String(content).trim() === "") && data == null) {
    throw new Error("Record content or advanced data is required");
  }
  if (content !== undefined && content !== null && String(content).length > 4096) {
    throw new Error("Record content exceeds Cloudflare's 4,096 byte DNS wire-format limit");
  }
  if (data != null && JSON.stringify(data).length > 8192) {
    throw new Error("Advanced record data is too large");
  }

  const payload: Record<string, unknown> = { type, name };
  if (content !== undefined && content !== null) payload.content = String(content);
  if (data != null) payload.data = data;
  if (input.ttl !== undefined && input.ttl !== null) {
    const ttl = Number(input.ttl);
    if (!Number.isInteger(ttl) || (ttl !== 1 && (ttl < 60 || ttl > 86400))) {
      throw new Error("TTL must be Auto (1) or between 60 and 86,400 seconds");
    }
    payload.ttl = ttl;
  }
  if (input.proxied !== undefined && input.proxied !== null) {
    if (typeof input.proxied !== "boolean") throw new Error("Proxy status must be true or false");
    if (input.proxied && !["A", "AAAA", "CNAME"].includes(type)) {
      throw new Error("Only A, AAAA, and CNAME records can be proxied");
    }
    payload.proxied = input.proxied;
  }
  if (input.priority !== undefined && input.priority !== null && input.priority !== "") {
    const priority = Number(input.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 65535) {
      throw new Error("Priority must be a whole number from 0 to 65,535");
    }
    if (!["MX", "URI"].includes(type)) throw new Error("Priority is only supported for MX and URI records");
    payload.priority = priority;
  }
  if (input.comment !== undefined && input.comment !== null && input.comment !== "") {
    if (typeof input.comment !== "string" || input.comment.length > 2000) {
      throw new Error("Comment must be 2,000 characters or fewer");
    }
    payload.comment = input.comment;
  }
  if (input.tags !== undefined && input.tags !== null) {
    if (!Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some(tag => typeof tag !== "string" || tag.length > 100)) {
      throw new Error("Tags must be an array of at most 20 strings, each 100 characters or fewer");
    }
    payload.tags = input.tags;
  }
  return payload;
}

export function assertCloudflareId(value: string): string {
  if (!/^[a-f0-9]{32}$/i.test(value)) throw new Error("Invalid Cloudflare identifier");
  return value;
}