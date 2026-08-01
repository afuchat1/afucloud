---
name: CF Worker Architecture
description: Cloudflare Worker edge API — design decisions, secrets setup, and bcrypt migration
---

## Architecture
- Location: `artifacts/cf-worker/`
- Framework: Hono (not Express — Workers don't run Node.js servers)
- DB: Supabase REST API via `createDbClient()` in `src/lib/db.ts` (no TCP, no Drizzle, no postgres-js)
- Auth: `jose` for JWT (Web Crypto, no jsonwebtoken)
- Passwords: PBKDF2 via Web Crypto for new users; `bcryptjs` (nodejs_compat) for existing bcrypt users
- Storage: `aws4fetch` for R2 pre-signed URLs; R2 binding (`IMAGES_BUCKET`) for deletes

## Password migration (bcrypt → PBKDF2)
- Express API creates bcrypt hashes (`$2b$...`)
- Worker's `verifyPassword` handles both: PBKDF2 natively, bcrypt via `bcryptjs` dynamic import
- `isBcryptHash()` returns true for `$2` prefix
- Login route transparently re-hashes to PBKDF2 on first successful Worker login
- **Why:** Workers don't have Node crypto natively; PBKDF2 uses Web Crypto API; bcrypt needs nodejs_compat

## wrangler.toml non-secret vars (already set)
- `SUPABASE_URL`, `SUPABASE_PROJECT_ID`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_R2_ACCESS_KEY_ID`, `R2_BUCKET_NAME`

## Secrets (must set before deploying)
```
wrangler secret put SUPABASE_SERVICE_KEY   # Supabase service role key
wrangler secret put JWT_SECRET             # Same value as Express API's JWT_SECRET
wrangler secret put CLOUDFLARE_R2_SECRET_ACCESS_KEY
```

## Local dev
- Copy `.dev.vars.example` → `.dev.vars`, fill in the 3 secrets
- Run: `pnpm --filter @workspace/cf-worker run dev`

## Production deploy
1. `cd artifacts/cf-worker && wrangler secret put SUPABASE_SERVICE_KEY` (etc.)
2. Uncomment the `routes` block in `wrangler.toml` with `api.afuchat.com/*`
3. `wrangler deploy`

## Env binding name
- R2 binding is `IMAGES_BUCKET` (not `R2_BUCKET`) — defined in wrangler.toml `[[r2_buckets]]`
