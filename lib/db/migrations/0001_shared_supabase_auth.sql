-- Shared Afu identity migration for the Supabase database.
-- The migration is transactional and preserves legacy AfuCloud rows.

CREATE SCHEMA IF NOT EXISTS afucloud;

-- This project already has a shared profile table. The fallback definition is
-- for environments where it has not been created yet.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  name text,
  avatar text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_user_id_key ON public.profiles(user_id);

-- Keep Supabase's signup trigger compatible with the shared profile shape.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, full_name)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'name', split_part(COALESCE(new.email, 'user'), '@', 1)),
    COALESCE(new.raw_user_meta_data->>'name', split_part(COALESCE(new.email, 'user'), '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$function$;

-- Move product tables from public only when an afucloud copy does not exist.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects', 'images', 'api_keys', 'personal_tokens',
    'refresh_tokens', 'password_reset_tokens', 'webhooks', 'activity_logs'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NOT NULL
       AND to_regclass('afucloud.' || table_name) IS NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA afucloud', table_name);
    END IF;
  END LOOP;
END $$;

CREATE TEMP TABLE afucloud_user_map (
  old_id uuid PRIMARY KEY,
  auth_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

-- Existing AfuCloud-only identities are promoted into auth.users. Their
-- existing password hashes are preserved so users can still sign in.
INSERT INTO afucloud_user_map (old_id, auth_id)
SELECT u.id, COALESCE(a.id, gen_random_uuid())
FROM afucloud.users u
LEFT JOIN auth.users a ON lower(a.email) = lower(u.email);

-- Drop legacy FKs before changing the IDs they protect.
ALTER TABLE afucloud.projects DROP CONSTRAINT IF EXISTS projects_user_id_users_id_fk;
ALTER TABLE afucloud.personal_tokens DROP CONSTRAINT IF EXISTS personal_tokens_user_id_users_id_fk;
ALTER TABLE afucloud.refresh_tokens DROP CONSTRAINT IF EXISTS refresh_tokens_user_id_users_id_fk;
ALTER TABLE afucloud.activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_users_id_fk;
ALTER TABLE afucloud.password_reset_tokens DROP CONSTRAINT IF EXISTS password_reset_tokens_user_id_users_id_fk;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
SELECT m.auth_id, 'authenticated', 'authenticated', u.email, u.password_hash,
       CASE WHEN u.email_verified THEN COALESCE(u.updated_at, now()) END,
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('name', u.name), u.created_at, u.updated_at
FROM afucloud_user_map m
JOIN afucloud.users u ON u.id = m.old_id
WHERE NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = m.auth_id);

INSERT INTO public.profiles (user_id, email, name, full_name, avatar, created_at, updated_at)
SELECT m.auth_id, u.email, u.name, u.name, u.avatar, u.created_at, u.updated_at
FROM afucloud_user_map m
JOIN afucloud.users u ON u.id = m.old_id
ON CONFLICT (user_id) DO UPDATE SET
  email = COALESCE(public.profiles.email, EXCLUDED.email),
  name = COALESCE(public.profiles.name, EXCLUDED.name),
  full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name),
  avatar = COALESCE(public.profiles.avatar, EXCLUDED.avatar),
  updated_at = GREATEST(public.profiles.updated_at, EXCLUDED.updated_at);

UPDATE afucloud.projects t SET user_id = m.auth_id FROM afucloud_user_map m WHERE t.user_id = m.old_id;
UPDATE afucloud.personal_tokens t SET user_id = m.auth_id FROM afucloud_user_map m WHERE t.user_id = m.old_id;
UPDATE afucloud.refresh_tokens t SET user_id = m.auth_id FROM afucloud_user_map m WHERE t.user_id = m.old_id;
UPDATE afucloud.activity_logs t SET user_id = m.auth_id FROM afucloud_user_map m WHERE t.user_id = m.old_id;
UPDATE afucloud.password_reset_tokens t SET user_id = m.auth_id FROM afucloud_user_map m WHERE t.user_id = m.old_id;

ALTER TABLE afucloud.projects ADD CONSTRAINT projects_user_id_auth_users_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE afucloud.personal_tokens ADD CONSTRAINT personal_tokens_user_id_auth_users_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE afucloud.refresh_tokens ADD CONSTRAINT refresh_tokens_user_id_auth_users_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE afucloud.activity_logs ADD CONSTRAINT activity_logs_user_id_auth_users_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE afucloud.password_reset_tokens ADD CONSTRAINT password_reset_tokens_user_id_auth_users_id_fk FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Keep non-credential legacy data for audit/rollback, but remove the old
-- password source so auth.users is the only credential store.
ALTER TABLE afucloud.users RENAME TO users_legacy;
ALTER TABLE afucloud.users_legacy DROP COLUMN IF EXISTS password_hash;