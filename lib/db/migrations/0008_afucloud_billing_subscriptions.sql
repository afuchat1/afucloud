-- Minimal AfuCloud mapping to a membership verified against Whop.
CREATE TABLE IF NOT EXISTS afucloud.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tier_key text NOT NULL CHECK (tier_key IN ('pro', 'business')),
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN (
      'creating_checkout', 'pending_payment', 'checkout_failed', 'active',
      'trialing', 'past_due', 'canceling', 'paused', 'completed',
      'canceled', 'expired', 'unresolved'
    )),
  whop_plan_id text,
  whop_checkout_configuration_id text,
  whop_membership_id text,
  whop_payment_id text,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  manage_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_checkout_unique
  ON afucloud.billing_subscriptions (whop_checkout_configuration_id)
  WHERE whop_checkout_configuration_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS billing_subscriptions_membership_unique
  ON afucloud.billing_subscriptions (whop_membership_id)
  WHERE whop_membership_id IS NOT NULL;

ALTER TABLE afucloud.billing_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE afucloud.billing_subscriptions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE afucloud.billing_subscriptions TO service_role;