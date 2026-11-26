import type { Env } from "../types";

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
}

interface AuthResponse {
  user?: SupabaseAuthUser;
  data?: {
    user?: SupabaseAuthUser;
    session?: unknown;
  };
  id?: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
  access_token?: string;
  error?: string | { message?: string; code?: string };
  error_description?: string;
  message?: string;
  msg?: string;
  code?: string;
  error_code?: string;
}

export class SupabaseAuthError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "SupabaseAuthError";
    this.status = status;
    this.code = code;
  }
}

function authUserFromResponse(data: AuthResponse): SupabaseAuthUser | null {
  const nestedUser = data.user ?? data.data?.user;
  if (nestedUser && typeof nestedUser.id === "string" && nestedUser.id) return nestedUser;
  if (typeof data.id === "string" && data.id) return data as SupabaseAuthUser;
  return null;
}

function authErrorMessage(data: AuthResponse | null): string {
  if (typeof data?.msg === "string") return data.msg;
  if (typeof data?.message === "string") return data.message;
  if (typeof data?.error_description === "string") return data.error_description;
  if (typeof data?.error === "string") return data.error;
  if (data?.error && typeof data.error === "object" && typeof data.error.message === "string") {
    return data.error.message;
  }
  return "Supabase Auth request failed";
}

async function authRequest(env: Env, path: string, body: Record<string, unknown>): Promise<AuthResponse> {
  if (!env.SUPABASE_ANON_KEY) {
    throw new SupabaseAuthError("AfuCloud authentication is temporarily unavailable", 503, "auth_not_configured");
  }
  let response: Response;
  try {
    response = await fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SupabaseAuthError("AfuCloud authentication is temporarily unavailable", 503, "auth_upstream_unavailable");
  }

  const data = await response.json().catch(() => null) as AuthResponse | null;
  if (!response.ok) {
    const error = typeof data?.error === "object" ? data.error : null;
    throw new SupabaseAuthError(
      authErrorMessage(data),
      response.status,
      data?.error_code ?? data?.code ?? error?.code ?? null,
    );
  }
  return data ?? {};
}

export async function signInWithSupabase(
  env: Env,
  email: string,
  password: string,
): Promise<SupabaseAuthUser | null> {
  const response = await authRequest(env, "/token?grant_type=password", { email, password });
  return authUserFromResponse(response);
}

export async function signUpWithSupabase(
  env: Env,
  email: string,
  password: string,
  name: string,
  redirectTo: string,
): Promise<SupabaseAuthUser> {
  const response = await authRequest(env, `/signup?redirect_to=${encodeURIComponent(redirectTo)}`, {
    email,
    password,
    data: { name },
  });
  const user = authUserFromResponse(response);
  if (!user) {
    throw new SupabaseAuthError("Signup response did not include a user", 502, "signup_user_missing");
  }
  return user;
}

export async function verifySignupEmailWithSupabase(
  env: Env,
  tokenHash: string,
): Promise<SupabaseAuthUser> {
  const response = await authRequest(env, "/verify", {
    token_hash: tokenHash,
    type: "email",
  });
  const user = authUserFromResponse(response);
  if (!user) {
    throw new SupabaseAuthError("Confirmation response did not include a user", 502, "confirmation_user_missing");
  }
  return user;
}

export async function resendSignupConfirmation(
  env: Env,
  email: string,
  redirectTo: string,
): Promise<void> {
  await authRequest(
    env,
    `/resend?type=signup&redirect_to=${encodeURIComponent(redirectTo)}`,
    { email },
  );
}

export async function updatePasswordWithSupabase(env: Env, userId: string, password: string): Promise<boolean> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return response.ok;
}