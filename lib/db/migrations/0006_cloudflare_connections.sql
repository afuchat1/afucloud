-- Encrypted per-account Cloudflare OAuth tokens for DNS zone management.
-- No Cloudflare access or refresh token is stored in plaintext.

CREATE TABLE IF NOT EXISTS afucloud.cloudflare_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_access_token text NOT NULL,
  encrypted_refresh_token text,
  access_expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cloudflare_connections_user_id_idx
  ON afucloud.cloudflare_connections(user_id);

-- This table is accessed by the trusted API service role only. With no client
-- policies, browser/anon credentials cannot read or modify OAuth credentials.
ALTER TABLE afucloud.cloudflare_connections ENABLE ROW LEVEL SECURITY;