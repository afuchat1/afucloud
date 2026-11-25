import type { Env } from "../types";

export interface SupabaseAuthUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
}

interface AuthResponse {
  user?: SupabaseAuthUser;
  access_token?: string;
  error?: string | { message?: string; code?: string };
  error_description?: string;
  message?: string;
  msg?: string;
  code?: string;
  error_code?: string;
}

export class SupabaseAuthError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null = null) {
    super(message);
    this.name = "SupabaseAuthError";
  }
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
    throw new Error("Supabase public auth key is not configured");
  }
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

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
  return response?.user ?? null;
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
  if (!response.user) throw new Error("Supabase Auth did not return a user");
  return response.user;
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