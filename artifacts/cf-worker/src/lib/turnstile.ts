import type { Env } from "../types";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const DEVELOPMENT_SITE_KEY = "1x00000000000000000000AA";
const DEVELOPMENT_SECRET_KEY = "1x0000000000000000000000000000000AA";

export type TurnstileVerification = "verified" | "invalid" | "unavailable";

export function isTurnstileEnforced(env: Env): boolean {
  return env.TURNSTILE_ENFORCEMENT_ENABLED?.trim().toLowerCase() !== "false";
}

export function getTurnstileSiteKey(env: Env): string {
  const configured = env.TURNSTILE_SITE_KEY?.trim();
  if (configured) return configured;
  return env.NODE_ENV === "development" ? DEVELOPMENT_SITE_KEY : "";
}

export async function verifyTurnstileToken(
  env: Env,
  token: unknown,
  expectedAction: string,
  remoteIp?: string,
): Promise<TurnstileVerification> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
    || (env.NODE_ENV === "development" ? DEVELOPMENT_SECRET_KEY : "");
  if (!secret) return "unavailable";
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return "invalid";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
      signal: controller.signal,
    });
    if (!response.ok) return "unavailable";

    const result = await response.json() as {
      success?: unknown;
      action?: unknown;
      hostname?: unknown;
      "error-codes"?: unknown;
    };
    if (result.success !== true) {
      const errorCodes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
      return errorCodes.some((code) =>
        code === "internal-error" || code === "missing-input-secret" || code === "invalid-input-secret"
      ) ? "unavailable" : "invalid";
    }
    if (typeof result.action === "string" && result.action !== expectedAction) return "invalid";

    if (env.NODE_ENV !== "development") {
      let expectedHostname = "cloud.afuchat.com";
      try {
        expectedHostname = new URL(env.PUBLIC_SITE_URL ?? "https://cloud.afuchat.com").hostname.toLowerCase();
      } catch {}
      if (typeof result.hostname !== "string" || result.hostname.toLowerCase() !== expectedHostname) {
        return "invalid";
      }
    }

    return "verified";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
  }
}
