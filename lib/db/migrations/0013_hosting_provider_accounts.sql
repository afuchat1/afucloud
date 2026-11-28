-- Keep customer-owned Pages resources scoped to the Cloudflare account they chose.
ALTER TABLE afucloud.github_installations
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE afucloud.hosting_projects
  ADD COLUMN IF NOT EXISTS provider_account_id text;

ALTER TABLE afucloud.hosting_deployments
  ADD COLUMN IF NOT EXISTS source_delivery_id text;

ALTER TABLE afucloud.hosting_oauth_states
  ADD COLUMN IF NOT EXISTS github_user_id text,
  ADD COLUMN IF NOT EXISTS github_login text,
  ADD COLUMN IF NOT EXISTS github_access_token_encrypted text;

ALTER TABLE afucloud.hosting_domains
  ALTER COLUMN verification_token DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS hosting_deployments_project_delivery_unique
  ON afucloud.hosting_deployments(project_id, source_delivery_id)
  WHERE source_delivery_id IS NOT NULL;

ALTER TABLE afucloud.hosting_webhook_deliveries
  DROP CONSTRAINT IF EXISTS hosting_webhook_deliveries_status_check;
ALTER TABLE afucloud.hosting_webhook_deliveries
  ADD CONSTRAINT hosting_webhook_deliveries_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'ignored', 'failed'));

CREATE OR REPLACE FUNCTION afucloud.claim_hosting_deployment_by_id(
  p_deployment_id uuid,
  p_lease_token_hash text
)
RETURNS SETOF afucloud.hosting_deployments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afucloud, pg_temp
AS $$
BEGIN
  RETURN QUERY
  UPDATE hosting_deployments
  SET status = 'running',
      attempts = attempts + 1,
      locked_at = now(),
      lease_token_hash = p_lease_token_hash,
      started_at = COALESCE(started_at, now()),
      updated_at = now()
  WHERE id = p_deployment_id
    AND status = 'queued'
    AND available_at <= now()
  RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION afucloud.claim_hosting_deployment_by_id(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION afucloud.claim_hosting_deployment_by_id(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION afucloud.claim_hosting_webhook_delivery(
  p_delivery_id text,
  p_event text,
  p_installation_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afucloud, pg_temp
AS $$
DECLARE
  claimed_id text;
BEGIN
  INSERT INTO hosting_webhook_deliveries(delivery_id, event, installation_id, status)
  VALUES (p_delivery_id, p_event, p_installation_id, 'processing')
  ON CONFLICT (delivery_id) DO UPDATE SET
    event = EXCLUDED.event,
    installation_id = EXCLUDED.installation_id,
    status = 'processing',
    received_at = now()
  WHERE hosting_webhook_deliveries.status = 'failed'
     OR (
       hosting_webhook_deliveries.status = 'processing'
       AND hosting_webhook_deliveries.received_at < now() - interval '5 minutes'
     )
  RETURNING delivery_id INTO claimed_id;

  RETURN claimed_id IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION afucloud.claim_hosting_webhook_delivery(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION afucloud.claim_hosting_webhook_delivery(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION afucloud.recover_stale_hosting_deployments()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = afucloud, pg_temp
AS $$
DECLARE
  recovered integer;
BEGIN
  UPDATE hosting_deployments
  SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
      available_at = CASE
        WHEN attempts >= max_attempts THEN available_at
        ELSE now() + interval '30 seconds'
      END,
      error_code = CASE WHEN attempts >= max_attempts THEN 'runner_lease_expired' ELSE error_code END,
      error_message = CASE
        WHEN attempts >= max_attempts THEN 'The deployment worker stopped before completing this attempt.'
        ELSE error_message
      END,
      locked_at = NULL,
      lease_token_hash = NULL,
      updated_at = now()
  WHERE status = 'running'
    AND locked_at < now() - interval '10 minutes';

  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;
REVOKE ALL ON FUNCTION afucloud.recover_stale_hosting_deployments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION afucloud.recover_stale_hosting_deployments() TO service_role;
