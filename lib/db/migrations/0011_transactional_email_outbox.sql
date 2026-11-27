-- Durable, idempotent queue for first-party AfuCloud transactional email.
CREATE TABLE IF NOT EXISTS afucloud.email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  recipient_name text,
  template_key text NOT NULL CHECK (template_key IN (
    'welcome',
    'domain_verified',
    'domain_registered',
    'domain_registration_review',
    'domain_registration_refunded',
    'domain_expiry_reminder',
    'domain_expired'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_outbox_event_key_unique UNIQUE (event_key)
);

CREATE INDEX IF NOT EXISTS email_outbox_pending_due_idx
  ON afucloud.email_outbox (status, available_at, created_at);

ALTER TABLE afucloud.email_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE afucloud.email_outbox FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE afucloud.email_outbox TO service_role;
