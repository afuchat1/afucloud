-- Store the customer-selected registrar term and confirmed registration dates.
ALTER TABLE afucloud.domain_registration_orders
  ADD COLUMN IF NOT EXISTS registration_years integer NOT NULL DEFAULT 1
    CHECK (registration_years BETWEEN 1 AND 10);
ALTER TABLE afucloud.domain_registration_orders
  ADD COLUMN IF NOT EXISTS whop_purchase_url text;
ALTER TABLE afucloud.domain_registration_orders
  ADD COLUMN IF NOT EXISTS registration_created_at timestamptz;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM afucloud.domain_registration_orders
    WHERE status IN ('creating_checkout', 'pending_payment', 'paid', 'registering', 'processing', 'manual_review', 'registered')
    GROUP BY user_id, hostname
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active domain orders exist; review them before applying the AfuCloud registration-term migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS domain_registration_orders_user_hostname_active_unique
  ON afucloud.domain_registration_orders (user_id, hostname)
  WHERE status IN ('creating_checkout', 'pending_payment', 'paid', 'registering', 'processing', 'manual_review', 'registered');
