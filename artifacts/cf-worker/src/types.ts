import type { Context } from "hono";
import type { createDbClient } from "./lib/db";

export interface Env {
  // Vars
  SUPABASE_URL: string;
  SUPABASE_PROJECT_ID: string;
  SUPABASE_DB_SCHEMA?: string;
  R2_BUCKET_NAME: string;
  CLOUDFLARE_ACCOUNT_ID: string;
  CLOUDFLARE_R2_ACCESS_KEY_ID: string;
  API_BASE_URL?: string;
  DASHBOARD_ALLOWED_ORIGINS?: string;
  NODE_ENV: string;
  AFU_CUSTOM_HOSTNAME_TARGET?: string;
  CLOUDFLARE_OAUTH_CLIENT_ID?: string;
  CLOUDFLARE_OAUTH_REDIRECT_URI?: string;
  DOMAIN_REGISTRATION_MARKUP_PERCENT?: string;
  WHOP_COMPANY_ID?: string;
  WHOP_PRODUCT_ID?: string;
  WHOP_PRO_PLAN_ID?: string;
  WHOP_BUSINESS_PLAN_ID?: string;

  // Secrets
  SUPABASE_SERVICE_KEY: string;
  JWT_SECRET: string;
  CLOUDFLARE_R2_SECRET_ACCESS_KEY: string;
  CLOUDFLARE_OAUTH_CLIENT_SECRET?: string;
  CLOUDFLARE_OAUTH_STATE_SECRET?: string;
  CLOUDFLARE_TOKEN_ENCRYPTION_KEY?: string;
  CLOUDFLARE_REGISTRAR_API_TOKEN?: string;
  WHOP_API_KEY?: string;

  // Bindings
  IMAGES_BUCKET: R2Bucket;
}

export interface AuthVariables {
  userId: string;
  email: string;
  authKind: "dashboard_session" | "personal_token" | "project_key";
  projectId?: string;
  scopes: string[];
}

export type AppContext = Context<{ Bindings: Env; Variables: AuthVariables }>;
export type DbClient = ReturnType<typeof createDbClient>;
