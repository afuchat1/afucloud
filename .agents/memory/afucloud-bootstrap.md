---
name: AfuCloud infrastructure bootstrap
description: Infrastructure IDs and key decisions for AfuCloud
---

# AfuCloud Bootstrap

## Supabase
- Project ID: poijhidfekwfthyksatp, region: eu-west-1
- AfuCloud tables and the canonical shared user table are in the `afucloud` schema.
- The same database also contains `blog` and public AfuAds tables.

## Cloudflare R2
- Bucket: afucloud-images (created via S3 PUT, credentials in Replit env vars)

## Key Decision
The API uses the target project's pooler variables (`SUPABASE_DB_HOST`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_PORT`, `SUPABASE_DB_NAME`) and `search_path=afucloud,public`. This prevents the app from falling back to a different Supabase project.

## Shared authentication
Supabase's `auth.users` is the canonical identity source for existing cross-platform accounts. The API verifies its bcrypt hashes directly, while the Cloudflare Worker delegates verification to Supabase Auth. `afucloud.users` is an application profile keyed by the same UUID; older AfuCloud-only accounts remain a compatibility path.

**Why:** The target database has the existing shared accounts in `auth.users`, while `afucloud.users` contains only a separate small set of AfuCloud-created accounts.

**How to apply:** New product records should reference the Supabase Auth UUID. Do not create separate credential tables or copy Supabase passwords into product schemas.
