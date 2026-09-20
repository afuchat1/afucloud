# AfuCloud

A developer-first cloud platform for storing, processing, managing, and delivering digital assets. Phase 1 focuses on the Images platform, with a full SaaS dashboard, REST API, and Cloudflare R2 object storage.

## Run & Operate

- `pnpm --filter @workspace/afucloud run dev` — run the frontend (React + Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server (Express 5, port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, requires the target Supabase connection variables)

## Replit Boundary

- Replit is used only for source editing, dependency installation, and frontend preview.
- The production frontend sends API requests directly to `https://api.afuchat.com`.
- Replit does not host the production API, connect to Supabase, access R2, or handle production credentials.
- Do not put AfuCloud secrets, database URLs, or storage credentials in `.replit`, Replit environment variables, or frontend build variables.
- Production secrets are stored only in the Cloudflare Worker secret store.
- The Express server under `artifacts/api-server/` is an inactive local compatibility server. It requires explicitly supplied local credentials and is not part of production.

## Infrastructure

- **Database**: Supabase PostgreSQL (project: `poijhidfekwfthyksatp`, region: eu-west-1), with shared identities in Supabase's `auth.users`; AfuCloud profile and platform data lives in the `afucloud` schema, and other products reference the same auth user ID
- **Object storage**: Cloudflare R2 bucket `afucloud-images`
- **Frontend**: React + Vite + shadcn/ui + Tailwind v4
- **Local compatibility backend**: Express 5 + Drizzle ORM (`artifacts/api-server/`), inactive by default
- **Prod backend**: Cloudflare Worker (Hono) (`artifacts/cf-worker/`) — deployed to Cloudflare's edge

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with Zod validation (dev) / Hono on CF Workers (prod)
- DB: PostgreSQL + Drizzle ORM (dev) / Supabase REST (prod worker)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Frontend auth: JWT stored in `localStorage` as `afucloud_token`
- Shared auth: Supabase's `auth.users` is the only identity and credential source for AfuChat, AfuMail, AfuAI, AfuCloud, and AfuAds. Shared profile data lives in `public.profiles` keyed by `user_id`; AfuCloud domain tables live under `afucloud.*` and reference `auth.users(id)` directly
- Password migration: legacy AfuCloud-only bcrypt hashes still migrate to the Worker-compatible PBKDF2 format; Supabase Auth accounts remain owned by Supabase Auth
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

### One-time secrets setup (run from a trusted deployment machine or CI, never stored in Replit):

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
- App sessions use AfuCloud access/refresh tokens, but credentials and identity remain in Supabase Auth's `auth.users`; no product schema may add a password or product-specific user table
- The app uses the target Supabase connection variables and explicitly schema-qualified tables: `public.profiles` for shared profile data and `afucloud.*` for AfuCloud domain data
- Production secrets exist only in the Cloudflare Worker secret store; Replit has no production secret dependency
- CF Worker uses PBKDF2 (Web Crypto) for password hashing; bcrypt hashes from the Express API will require a password reset

## Design

- Cream/warm background (`#FAF8F5`) with flat UI (no shadows)
- Primary: teal (`hsl(173, 70%, 35%)`)
- Fonts: DM Sans (body), Satoshi (display), JetBrains Mono (code)

## User Preferences

- Cream + flat UI aesthetic with advanced UX and layouts
- All infrastructure secrets stored as Replit env vars (Supabase + Cloudflare)
- Build as a full SaaS platform (developer-first cloud storage)
