-- Paid domain registration orders for AfuCloud.
-- Registrant contact data is submitted directly to Cloudflare and is not stored here.
CREATE TABLE IF NOT EXISTS afucloud.domain_registration_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  status text NOT NULL DEFAULT 'creating_checkout'
    CHECK (status IN (
      'creating_checkout', 'pending_payment', 'paid', 'registering',
      'processing', 'registered', 'registration_failed', 'checkout_failed',
      'refunded', 'manual_review'
    )),
  currency text NOT NULL DEFAULT 'USD',
  registrar_cost numeric(12, 2) NOT NULL,
  renewal_registrar_cost numeric(12, 2) NOT NULL,
  retail_price numeric(12, 2) NOT NULL,
  renewal_retail_price numeric(12, 2) NOT NULL,
  whop_checkout_configuration_id text,
  whop_plan_id text,
  whop_payment_id text,
  cloudflare_registration_id text,
  cloudflare_registration_status text,
  registration_expires_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS domain_registration_orders_checkout_unique
  ON afucloud.domain_registration_orders (whop_checkout_configuration_id)
  WHERE whop_checkout_configuration_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS domain_registration_orders_payment_unique
  ON afucloud.domain_registration_orders (whop_payment_id)
  WHERE whop_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS domain_registration_orders_user_created_idx
  ON afucloud.domain_registration_orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_registration_orders_user_status_idx
  ON afucloud.domain_registration_orders (user_id, status);

ALTER TABLE afucloud.domain_registration_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE afucloud.domain_registration_orders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE afucloud.domain_registration_orders TO service_role;