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
All AfuCloud platforms use the shared `afucloud.users` table. The API accepts both bcrypt and the Worker-compatible PBKDF2 password format; successful API login migrates bcrypt credentials to PBKDF2. Other platform schemas should store the same user UUID rather than duplicate credentials.
