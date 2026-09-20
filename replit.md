# AfuCloud

A developer-first cloud platform for storing, processing, managing, and delivering digital assets. Phase 1 focuses on the Images platform, with a full SaaS dashboard, REST API, and Cloudflare R2 object storage.

## Run & Operate

- `pnpm --filter @workspace/afucloud run dev` — run the frontend (React + Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server (Express 5, port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, requires the target Supabase connection variables)

## Required Environment Variables

- `SUPABASE_DB_PASSWORD` — target Supabase database password (secret)
- `SUPABASE_DB_HOST` — target Supabase pooler host
- `SUPABASE_DB_USER` — target Supabase project-qualified database user
- `SUPABASE_DB_PORT` — target Supabase database port
- `SUPABASE_DB_NAME` — target Supabase database name
- `JWT_SECRET` — JWT signing secret (set in Replit env vars)
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID for R2 (set in Replit env vars)
- `CLOUDFLARE_R2_ACCESS_KEY_ID` — R2 S3-compatible access key (set in Replit env vars)
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` — R2 S3-compatible secret key (set in Replit env vars)
- `R2_BUCKET_NAME` — R2 bucket name, defaults to `afucloud-images`
- `R2_PUBLIC_URL` — (optional) public CDN URL for the R2 bucket

## Infrastructure

- **Database**: Supabase PostgreSQL (project: `poijhidfekwfthyksatp`, region: eu-west-1), with AfuCloud identity and platform data in the `afucloud` schema; other products use their own schemas and reference the same user ID
- **Object storage**: Cloudflare R2 bucket `afucloud-images`
- **Frontend**: React + Vite + shadcn/ui + Tailwind v4
- **Dev backend**: Express 5 + Drizzle ORM (`artifacts/api-server/`)
- **Prod backend**: Cloudflare Worker (Hono) (`artifacts/cf-worker/`) — deployed to Cloudflare's edge

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with Zod validation (dev) / Hono on CF Workers (prod)
- DB: PostgreSQL + Drizzle ORM (dev) / Supabase REST (prod worker)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Frontend auth: JWT stored in `localStorage` as `afucloud_token`
- Shared auth: the API and Cloudflare Worker both authenticate against the shared `afucloud.users` table; other product schemas link their records by the same user ID; both bcrypt and the Worker-compatible `pbkdf2:<salt>:<hash>` password formats are supported
- Password migration: successful API login transparently migrates legacy bcrypt hashes to PBKDF2 so the same user works across all AfuCloud platforms
- Storage: Cloudflare R2 (S3-compatible) with pre-signed PUT URLs

## Where Things Live

- `artifacts/afucloud/` — React frontend (SaaS dashboard)
- `artifacts/api-server/` — Express API server (development)
- `artifacts/cf-worker/` — Cloudflare Worker edge API (production)
- `lib/db/` — Drizzle ORM schema + migrations (source of truth for DB schema)
- `lib/api-spec/` — OpenAPI 3.1 spec (source of truth for API contract)
- `lib/api-zod/` — Zod schemas generated from OpenAPI spec (for API validation)
- `lib/api-client-react/` — React Query hooks generated from OpenAPI spec (for frontend)

## Cloudflare Worker — Deployment

The CF Worker in `artifacts/cf-worker/` is the production edge API. It uses Hono + Supabase REST + aws4fetch.

### One-time secrets setup (run from `artifacts/cf-worker/`):

```bash
cd artifacts/cf-worker
npx wrangler secret put JWT_SECRET
npx wrangler secret put SUPABASE_SERVICE_KEY   # service_role key from Supabase dashboard
npx wrangler secret put CLOUDFLARE_R2_SECRET_ACCESS_KEY
```

### Deploy:

```bash
pnpm --filter @workspace/cf-worker run deploy
# or directly:
cd artifacts/cf-worker && npx wrangler deploy
```

### Local dev (port 8787):

```bash
pnpm --filter @workspace/cf-worker run dev
```

### Environment variables in `wrangler.toml` (non-secret):

- `SUPABASE_URL` — `https://poijhidfekwfthyksatp.supabase.co`
- `CLOUDFLARE_ACCOUNT_ID` — `42e79186125e8ff83e51f15816e074de`
- `CLOUDFLARE_R2_ACCESS_KEY_ID` — R2 access key ID
- `R2_BUCKET_NAME` — `afucloud-images`
- `R2_PUBLIC_URL` — (optional) public CDN URL

## Architecture Decisions

- API-first design: all behavior defined in `lib/api-spec/openapi.yaml`, code generated from it
- Storage abstraction in `artifacts/api-server/src/lib/storage.ts` — provider-agnostic interface
- JWT-only auth (no Supabase Auth) — custom auth through the AfuCloud API
- The app uses the target Supabase connection variables and `search_path=afucloud,public`; existing target `public` tables are intentionally preserved
- All secrets stored as Replit env vars (minimum required to run; Cloudflare R2 creds needed at server startup)
- CF Worker uses PBKDF2 (Web Crypto) for password hashing; bcrypt hashes from the Express API will require a password reset

## Design

- Cream/warm background (`#FAF8F5`) with flat UI (no shadows)
- Primary: teal (`hsl(173, 70%, 35%)`)
- Fonts: DM Sans (body), Satoshi (display), JetBrains Mono (code)

## User Preferences

- Cream + flat UI aesthetic with advanced UX and layouts
- All infrastructure secrets stored as Replit env vars (Supabase + Cloudflare)
- Build as a full SaaS platform (developer-first cloud storage)
