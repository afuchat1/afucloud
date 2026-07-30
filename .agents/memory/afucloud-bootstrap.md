---
name: AfuCloud infrastructure bootstrap
description: Infrastructure IDs and key decisions for AfuCloud
---

# AfuCloud Bootstrap

## Supabase
- Project ID: wjdkeiazhlxcnqtxjdry, region: us-east-1, org: pxddaggvstdcwhpkdpzl

## Cloudflare R2
- Bucket: afucloud-images (created via S3 PUT, credentials in Replit env vars)

## Key Decision
POSTGRES_URL used instead of DATABASE_URL (Replit reserves DATABASE_URL for built-in PG). Code in lib/db/src/index.ts reads `process.env.POSTGRES_URL ?? process.env.DATABASE_URL`.
