---
name: R2 CORS and image serving
description: How upload CORS and image display are wired for AfuCloud's R2 integration
---

# R2 CORS and Image Serving

## CORS for browser uploads
R2 does not allow browser PUT by default. `configureBucketCors()` in `artifacts/api-server/src/lib/storage.ts` is called on server startup (non-blocking) using S3 PutBucketCors with SigV4 signing. It sets AllowedOrigin=*, AllowedMethod=GET/PUT/DELETE/HEAD, AllowedHeader=*.

**Why:** Without this, direct browser-to-R2 pre-signed PUT requests fail with a network error (XHR onerror fires = CORS block).

**How to apply:** Call `configureBucketCors()` in `artifacts/api-server/src/index.ts` after the server starts listening (already done). Errors are logged as warnings, not fatal.

## Public image serving
Published AfuCloud image responses and copied links use `https://img.afuchat.com/<object-key>`, preserving key slashes and URL-encoding individual path segments. The custom domain is connected to the `afucloud-images` R2 bucket. The frontend normalizes legacy `/v1/storage/:key` image URLs to this public URL in production.

**Why:** Image API redirects are not the public object URL the user needs to preview or copy. The active R2 custom domain serves the same object key directly.

**How to apply:** Keep image response serialization and the image-detail copy/display path on `img.afuchat.com`. The Express API may retain its API route only for credential-free local development files; do not return it as a published image URL. No Supabase URL migration is needed because the URL is derived from `storage_key`.
