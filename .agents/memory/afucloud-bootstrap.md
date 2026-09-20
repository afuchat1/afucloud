---
name: AfuCloud infrastructure bootstrap
description: Infrastructure IDs and key decisions for AfuCloud
---

# AfuCloud Bootstrap

## Supabase
- Project ID: poijhidfekwfthyksatp, region: eu-west-1
- AfuCloud tables are in the `afucloud` schema; shared profiles are in `public.profiles`.
- The same database also contains `blog` and public AfuAds tables.

## Cloudflare R2
- Bucket: afucloud-images (created via S3 PUT, credentials in Replit env vars)

## Key Decision
The API uses the target project's pooler variables (`SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`) and explicit schema-qualified tables. `search_path` is only a raw-SQL fallback.

## Shared authentication
Supabase's `auth.users` is the only identity and credential source. `public.profiles.user_id` links shared profile data to Auth, and every AfuCloud `user_id` foreign key points directly to `auth.users.id`. The former credential table is retained only as `afucloud.users_legacy` without its password column.

**Why:** AfuChat, AfuMail, AfuAI, AfuCloud, and AfuAds must resolve the same account UUID regardless of product schema; separate product users create broken ownership and duplicate credentials.

**How to apply:** New product tables must reference `auth.users(id)` directly. Never add password columns to product schemas or use `public.profiles.id` as the Auth identity.
