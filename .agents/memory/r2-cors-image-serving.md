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
New AfuCloud image URLs use `https://cdn.afuchat.com/cloud/images/<object-key>`, preserving key slashes and URL-encoding individual path segments. The `afucloud-cdn` Worker serves this path from the `afucloud-images` bucket. Container objects use the canonical `https://cdn.afuchat.com/cloud/object/<public-key>` path; the Worker maps them back to `containers/<public-key>`. `/cloud/storage/<public-key>` remains a read-only compatibility alias for older links and must not be generated for new files.

The existing `cdn.afuchat.com` root remains attached to `afuchat-media`; only `/cloud/*` is routed to AfuCloud. The `img.afuchat.com` custom domain remains attached to `afucloud-images` so previously issued image links continue working. The frontend normalizes legacy `/v1/storage/:key` URLs to `/cloud/images` or `/cloud/object` in production and displays/copies the same CDN URL used by file previews.

**Why:** AfuCloud needs a product-scoped CDN path without taking over the shared CDN hostname's existing root bucket or invalidating old image links.

**How to apply:** Generate new image links under `/cloud/images` and container links under `/cloud/object`. Keep `/cloud/storage` as a compatibility alias only, keep the root CDN association and legacy `img.afuchat.com` domain unchanged, and run `pnpm run test:cdn-path-contract` before changing these paths. The Express API may retain its API route only for credential-free local development files; do not return it as a published image URL. No Supabase URL migration is needed because the URL is derived from `storage_key`.
