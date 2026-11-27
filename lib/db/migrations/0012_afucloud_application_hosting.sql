-- Add application hosting without reusing or changing image-delivery projects.
CREATE SCHEMA IF NOT EXISTS afucloud;

CREATE TABLE IF NOT EXISTS afucloud.github_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  installation_id text NOT NULL UNIQUE,
  account_login text NOT NULL,
  account_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS github_installations_user_id_idx
  ON afucloud.github_installations(user_id);

CREATE TABLE IF NOT EXISTS afucloud.hosting_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS afucloud.hosting_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  github_installation_id uuid NOT NULL REFERENCES afucloud.github_installations(id) ON DELETE CASCADE,
  github_repository_id text NOT NULL,
  repository_full_name text NOT NULL,
  repository_private boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  slug text NOT NULL,
  production_branch text NOT NULL,
  root_directory text NOT NULL DEFAULT '.',
  framework text NOT NULL DEFAULT 'auto',
  runtime text NOT NULL DEFAULT 'static'
    CHECK (runtime IN ('static', 'worker', 'node', 'python')),
  provider text NOT NULL DEFAULT 'cloudflare_pages'
    CHECK (provider IN ('cloudflare_pages', 'cloudflare_workers', 'cloudflare_containers')),
  install_command text,
  build_command text,
  output_directory text,
  run_command text,
  preview_deployments_enabled boolean NOT NULL DEFAULT true,
  provider_project_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hosting_projects_owner_slug_unique UNIQUE (user_id, slug)
);
CREATE INDEX IF NOT EXISTS hosting_projects_repository_idx
  ON afucloud.hosting_projects(github_repository_id);
CREATE INDEX IF NOT EXISTS hosting_projects_user_id_idx
  ON afucloud.hosting_projects(user_id);

CREATE TABLE IF NOT EXISTS afucloud.hosting_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES afucloud.hosting_projects(id) ON DELETE CASCADE,
  source_deployment_id uuid REFERENCES afucloud.hosting_deployments(id) ON DELETE SET NULL,
  environment text NOT NULL CHECK (environment IN ('production', 'preview')),
  trigger text NOT NULL CHECK (trigger IN ('manual', 'push', 'pull_request', 'redeploy', 'rollback')),
  branch text NOT NULL,
  commit_sha text NOT NULL,
  commit_message text,
  pull_request_number integer,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'deploying', 'ready', 'failed', 'cancelled')),
  provider text NOT NULL
    CHECK (provider IN ('cloudflare_pages', 'cloudflare_workers', 'cloudflare_containers')),
  provider_deployment_id text,
  deployment_url text,
  preview_url text,
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 5),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lease_token_hash text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hosting_deployments_project_created_idx
  ON afucloud.hosting_deployments(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS hosting_deployments_queue_idx
  ON afucloud.hosting_deployments(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS hosting_deployments_lease_idx
  ON afucloud.hosting_deployments(locked_at);

CREATE TABLE IF NOT EXISTS afucloud.hosting_deployment_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES afucloud.hosting_deployments(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence >= 0),
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  stage text NOT NULL,
  message text NOT NULL CHECK (length(message) <= 8000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hosting_deployment_logs_sequence_unique UNIQUE (deployment_id, sequence)
);
CREATE INDEX IF NOT EXISTS hosting_deployment_logs_deployment_idx
  ON afucloud.hosting_deployment_logs(deployment_id, created_at);

CREATE TABLE IF NOT EXISTS afucloud.hosting_environment_variables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES afucloud.hosting_projects(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('production', 'preview')),
  name text NOT NULL CHECK (name ~ '^[A-Za-z_][A-Za-z0-9_]{0,127}$'),
  encrypted_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hosting_environment_variables_name_unique UNIQUE (project_id, environment, name)
);
CREATE INDEX IF NOT EXISTS hosting_environment_variables_project_idx
  ON afucloud.hosting_environment_variables(project_id);

CREATE TABLE IF NOT EXISTS afucloud.hosting_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES afucloud.hosting_projects(id) ON DELETE CASCADE,
  hostname text NOT NULL UNIQUE,
  verification_token text NOT NULL,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed')),
  ssl_status text NOT NULL DEFAULT 'pending'
    CHECK (ssl_status IN ('pending', 'active', 'failed')),
  provider_domain_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS hosting_domains_project_idx
  ON afucloud.hosting_domains(project_id);

CREATE TABLE IF NOT EXISTS afucloud.hosting_webhook_deliveries (
  delivery_id text PRIMARY KEY,
  event text NOT NULL,
  installation_id text,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS afucloud.hosting_rate_limits (
  bucket_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE OR REPLACE FUNCTION afucloud.consume_hosting_rate_limit(p_bucket_key text, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afucloud, pg_temp
AS $$
DECLARE
  current_count integer;
  current_window timestamptz := date_trunc('minute', clock_timestamp());
BEGIN
  INSERT INTO hosting_rate_limits(bucket_key, window_started_at, request_count)
  VALUES (p_bucket_key, current_window, 1)
  ON CONFLICT (bucket_key) DO UPDATE SET
    window_started_at = CASE
      WHEN hosting_rate_limits.window_started_at < current_window THEN current_window
      ELSE hosting_rate_limits.window_started_at
    END,
    request_count = CASE
      WHEN hosting_rate_limits.window_started_at < current_window THEN 1
      ELSE hosting_rate_limits.request_count + 1
    END
  RETURNING request_count INTO current_count;
  RETURN current_count <= p_limit;
END;
$$;
REVOKE ALL ON FUNCTION afucloud.consume_hosting_rate_limit(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION afucloud.consume_hosting_rate_limit(text, integer) TO service_role;

CREATE OR REPLACE FUNCTION afucloud.claim_hosting_deployment(p_lease_token_hash text)
RETURNS SETOF afucloud.hosting_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afucloud, pg_temp
AS $$
DECLARE
  claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM hosting_deployments
  WHERE status = 'queued' AND available_at <= now()
  ORDER BY available_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE hosting_deployments
  SET status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      lease_token_hash = p_lease_token_hash,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = claimed_id
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION afucloud.claim_hosting_deployment(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION afucloud.claim_hosting_deployment(text) TO service_role;

GRANT USAGE ON SCHEMA afucloud TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA afucloud TO service_role;
