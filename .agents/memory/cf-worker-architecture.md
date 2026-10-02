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

## Deployment token scope
- Wrangler deploy requires a Cloudflare API token with `Account → Workers Scripts → Edit` for the target account and `Zone → Workers Routes → Edit` for the routed zone. A token can read/list a Worker while still being unable to upload a new version.

**Why:** Cloudflare separates Worker read access from version upload and route mutation access; a successful token verification or Worker listing does not prove deployment authority.

**How to apply:** Include the target account and zone explicitly when creating the token, leave client-IP filtering empty for Replit-originated deploys, and verify the live route returns an auth response rather than `Not found` after deployment.

## Cloudflare OAuth client provisioning
- Creating or updating an OAuth client requires the account-level `OAuth Client Write` permission. A token that can list OAuth clients may still receive 403 on create.
- Public visibility requires client URL domain verification by TXT record. Verification is asynchronous, and Cloudflare locks the client URL's domain once verification completes.
- If the public homepage redirects from the apex to `www`, use the apex as `client_uri` so the ownership TXT record can be published without conflicting with a `www` CNAME. The redirect remains a valid homepage URL.
- Cloudflare returns the OAuth client secret only once; write the client ID and secret directly to the production Worker secret bindings, never to Replit Secrets or frontend code.

**Why:** OAuth client read/write permissions are separate, and public-client verification can leave a newly created client private while Cloudflare polls DNS.

**How to apply:** Confirm write access before provisioning. Set the final client URL before verification, add the exact TXT value Cloudflare returns, keep generated credentials in Worker secrets, and promote only when Cloudflare reports the domain verified.

## Env binding name
- R2 binding is `IMAGES_BUCKET` (not `R2_BUCKET`) — defined in wrangler.toml `[[r2_buckets]]`

## Whop payment credentials
- Production domain-registration checkout runs in the Cloudflare Worker and uses the user's existing Whop account API key as a Worker secret. Company and product IDs are non-secret Worker variables.
- The Replit Whop connector is broker-managed, does not OAuth into the user's existing Whop account, and is not callable from the production Cloudflare runtime.
- AfuCloud subscriptions use the user's existing AfuChat Whop business and its AfuChat product; do not switch accounts or create another product without approval.

**Why:** The user chose their existing Whop account while keeping the canonical Cloudflare Worker as the production API; the Replit connector's generated account would be a different merchant account.

**How to apply:** Keep payment verification and refund calls in the Worker. Do not route production checkout through the Replit connector or store the Whop API key in frontend code or Replit environment variables. Confirm the account and product if either is changed.

- Whop payment-list filters require `account_id`; the live API rejects `company_id` with HTTP 400. Keep the existing `WHOP_COMPANY_ID` env name if useful, but send its value as `account_id` in GET query parameters.

**Why:** AfuCloud's production billing lookup failed because Whop explicitly rejected `company_id` and directed the caller to `account_id`.

**How to apply:** Use `account_id` for payment-list query filters. Do not globally rename request-body fields; verify each endpoint's expected payload separately.
