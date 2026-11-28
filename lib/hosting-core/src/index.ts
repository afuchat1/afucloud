const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
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

export async function hashText(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  const keyBytes = base64UrlToBytes(encodedKey);
  if (keyBytes.length !== 32) {
    throw new Error("HOSTING_ENCRYPTION_KEY must be a 32-byte base64url value");
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptHostingSecret(value: string, encodedKey: string): Promise<string> {
  const key = await encryptionKey(encodedKey);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(value),
  );
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function decryptHostingSecret(encrypted: string, encodedKey: string): Promise<string> {
  const [version, ivValue, ciphertextValue, ...extra] = encrypted.split(".");
  if (version !== "v1" || !ivValue || !ciphertextValue || extra.length) {
    throw new Error("Stored hosting secret has an unsupported format");
  }
  const key = await encryptionKey(encodedKey);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlToBytes(ivValue)) },
    key,
    toArrayBuffer(base64UrlToBytes(ciphertextValue)),
  );
  return decoder.decode(plaintext);
}

export async function verifyGitHubWebhookSignature(
  body: string,
  signatureHeader: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !/^sha256=[a-f0-9]{64}$/i.test(signatureHeader)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(body)),
  );
  return constantTimeEqual(`sha256=${hex(signature)}`, signatureHeader.toLowerCase());
}

function pemBytes(privateKey: string): ArrayBuffer {
  const contents = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  return toArrayBuffer(base64UrlToBytes(contents.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")));
}

export async function createGitHubAppJwt(appId: string, privateKey: string): Promise<string> {
  if (!appId || !privateKey) throw new Error("GitHub App credentials are not configured");
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    iat: now - 30,
    exp: now + 8 * 60,
    iss: appId,
  })));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export interface GitHubInstallationToken {
  token: string;
  expires_at: string;
}

export interface GitHubRepository {
  id: number;
  full_name: string;
  name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string; id?: number };
}

export interface GitHubInstallation {
  id: number;
  account: { login: string; type: string };
}

async function githubJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(12_000),
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "AfuCloud-Hosting",
      ...Object.fromEntries(new Headers(init.headers).entries()),
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub request failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getGitHubUser(token: string): Promise<{ id: number; login: string }> {
  const user = await githubJson<{ id?: number; login?: string }>("https://api.github.com/user", token);
  if (!Number.isSafeInteger(user.id) || typeof user.login !== "string") {
    throw new Error("GitHub user authorization returned an incomplete identity");
  }
  return { id: user.id as number, login: user.login };
}

export async function userCanAccessGitHubInstallation(
  token: string,
  installationId: string,
): Promise<boolean> {
  for (let page = 1; page <= 10; page += 1) {
    const result = await githubJson<{ installations?: Array<{ id?: number }> }>(
      `https://api.github.com/user/installations?per_page=100&page=${page}`,
      token,
    );
    const installations = Array.isArray(result.installations) ? result.installations : [];
    if (installations.some(item => String(item.id) === installationId)) return true;
    if (installations.length < 100) return false;
  }
  return false;
}

export async function createGitHubInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<GitHubInstallationToken> {
  const appJwt = await createGitHubAppJwt(appId, privateKey);
  return githubJson<GitHubInstallationToken>(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    appJwt,
    {
      method: "POST",
      body: JSON.stringify({ permissions: { contents: "read", metadata: "read", pull_requests: "read" } }),
      headers: { "content-type": "application/json" },
    },
  );
}

export async function getGitHubInstallationDetails(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<GitHubInstallation> {
  const appJwt = await createGitHubAppJwt(appId, privateKey);
  return githubJson<GitHubInstallation>(
    `https://api.github.com/app/installations/${encodeURIComponent(installationId)}`,
    appJwt,
  );
}

export async function listGitHubInstallationRepositories(token: string): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const response = await githubJson<{ repositories?: GitHubRepository[] }>(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    const batch = Array.isArray(response.repositories) ? response.repositories : [];
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
  return repositories;
}

export async function listGitHubRepositoryBranches(
  token: string,
  repositoryFullName: string,
): Promise<string[]> {
  const [owner, name] = repositoryFullName.split("/");
  if (!owner || !name || repositoryFullName.split("/").length !== 2) {
    throw new Error("Invalid GitHub repository name");
  }
  const names: string[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const branches = await githubJson<Array<{ name?: string }>>(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches?per_page=100&page=${page}`,
      token,
    );
    names.push(...branches.flatMap(branch => typeof branch.name === "string" ? [branch.name] : []));
    if (branches.length < 100) return names;
  }
  return names;
}

export async function getGitHubRepositoryBranch(
  token: string,
  repositoryFullName: string,
  branchName: string,
): Promise<{ name: string; commitSha: string }> {
  const [owner, name] = repositoryFullName.split("/");
  if (!owner || !name || repositoryFullName.split("/").length !== 2 || !branchName || branchName.length > 255) {
    throw new Error("Invalid GitHub branch");
  }
  const branch = await githubJson<{
    name?: string;
    commit?: { sha?: string };
  }>(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/branches/${encodeURIComponent(branchName)}`,
    token,
  );
  if (typeof branch.name !== "string" || typeof branch.commit?.sha !== "string") {
    throw new Error("GitHub branch details were incomplete");
  }
  return { name: branch.name, commitSha: branch.commit.sha };
}

export async function readGitHubRepositoryFile(
  token: string,
  repositoryFullName: string,
  filePath: string,
): Promise<string | null> {
  const [owner, name] = repositoryFullName.split("/");
  if (!owner || !name || repositoryFullName.split("/").length !== 2 || !isSafeRelativePath(filePath)) {
    throw new Error("Invalid GitHub repository file path");
  }
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "AfuCloud-Hosting",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub file lookup failed with HTTP ${response.status}`);
  const result = await response.json() as { type?: unknown; size?: unknown; encoding?: unknown; content?: unknown };
  if (result.type !== "file" || result.encoding !== "base64" || typeof result.content !== "string") {
    return null;
  }
  if (typeof result.size === "number" && result.size > 128_000) return null;
  try {
    return decoder.decode(base64UrlToBytes(result.content.replace(/\+/g, "-").replace(/\//g, "_").replace(/\s/g, "").replace(/=+$/g, "")));
  } catch {
    return null;
  }
}

export function isSafeRelativePath(value: string): boolean {
  return value === "." ||
    (value.length > 0 &&
      value.length <= 240 &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every(part => part !== "" && part !== "." && part !== ".."));
}

export function redactSecretValues(message: string, secrets: string[]): string {
  let redacted = message;
  for (const secret of secrets) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted.slice(0, 8000);
}
