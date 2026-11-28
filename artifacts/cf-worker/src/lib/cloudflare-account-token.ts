import type { DbClient, Env } from "../types";
import {
  CloudflareRequestError,
  decryptToken,
  encryptToken,
  getEncryptionKeyBytes,
  isCloudflareOAuthConfigured,
  refreshCloudflareToken,
  type CloudflareTokenResponse,
  type OAuthEnvironment,
} from "@workspace/cloudflare-integration";

function oauthEnv(env: Env): OAuthEnvironment {
  return env;
}

function oauthConfiguration(env: Env): OAuthEnvironment {
  const settings = oauthEnv(env);
  if (!isCloudflareOAuthConfigured(settings)) {
    throw new CloudflareRequestError("Cloudflare authorization is not configured", 503);
  }
  try {
    getEncryptionKeyBytes(settings);
  } catch {
    throw new CloudflareRequestError("Cloudflare token encryption is not configured correctly", 503);
  }
  return settings;
}

export async function getCloudflareUserAccessToken(
  db: DbClient,
  userId: string,
  env: Env,
): Promise<string> {
  if (!env.CLOUDFLARE_TOKEN_ENCRYPTION_KEY) {
    throw new CloudflareRequestError("Cloudflare token encryption is not configured", 503);
  }
  const connection = await db.getCloudflareConnection(userId);
  if (!connection) throw new CloudflareRequestError("Connect a Cloudflare account first", 401);

  const expiresAt = Date.parse(connection.access_expires_at);
  if (!Number.isFinite(expiresAt)) {
    throw new CloudflareRequestError("Cloudflare connection is invalid. Reconnect Cloudflare.", 401);
  }
  if (expiresAt <= Date.now() + 60_000) {
    if (!connection.encrypted_refresh_token) {
      throw new CloudflareRequestError("Cloudflare access expired. Reconnect Cloudflare.", 401);
    }
    const settings = oauthConfiguration(env);
    const refreshToken = await decryptToken(connection.encrypted_refresh_token, settings);
    let refreshed: CloudflareTokenResponse;
    try {
      refreshed = await refreshCloudflareToken(refreshToken, settings);
    } catch {
      throw new CloudflareRequestError("Cloudflare access expired. Reconnect Cloudflare.", 401);
    }
    const nextRefreshToken = refreshed.refresh_token ?? refreshToken;
    await db.updateCloudflareConnection(userId, {
      encrypted_access_token: await encryptToken(refreshed.access_token, settings),
      encrypted_refresh_token: await encryptToken(nextRefreshToken, settings),
      access_expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      scopes: refreshed.scope ? refreshed.scope.split(/\s+/).filter(Boolean) : connection.scopes,
      updated_at: new Date().toISOString(),
    });
    return refreshed.access_token;
  }

  return decryptToken(connection.encrypted_access_token, oauthEnv(env));
}
