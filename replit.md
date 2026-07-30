# AfuCloud

A developer-first cloud platform for storing, processing, managing, and delivering digital assets. Phase 1 focuses on the Images platform, with a full SaaS dashboard, REST API, and Cloudflare R2 object storage.

## Run & Operate

- `pnpm --filter @workspace/afucloud run dev` — run the frontend (React + Vite)
- `pnpm --filter @workspace/api-server run dev` — run the API server (Express 5, port from $PORT)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only, requires POSTGRES_URL)

## Required Environment Variables

- `POSTGRES_URL` — Supabase PostgreSQL connection string (set in Replit env vars)
- `JWT_SECRET` — JWT signing secret (set in Replit env vars)
- `CLOUDFLARE_ACCOUNT_ID` — Cloudflare account ID for R2 (set in Replit env vars)
- `CLOUDFLARE_R2_ACCESS_KEY_ID` — R2 S3-compatible access key (set in Replit env vars)
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` — R2 S3-compatible secret key (set in Replit env vars)
- `R2_BUCKET_NAME` — R2 bucket name, defaults to `afucloud-images`
- `R2_PUBLIC_URL` — (optional) public CDN URL for the R2 bucket

## Infrastructure

- **Database**: Supabase PostgreSQL (project: `wjdkeiazhlxcnqtxjdry`, region: us-east-1)
- **Object storage**: Cloudflare R2 bucket `afucloud-images`
- **Frontend**: React + Vite + shadcn/ui + Tailwind v4
- **Backend**: Express 5 + Drizzle ORM

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 with Zod validation
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/openapi.yaml`)
- Frontend auth: JWT stored in `localStorage` as `afucloud_token`
- Storage: Cloudflare R2 (S3-compatible) with pre-signed PUT URLs

## Where Things Live

- `artifacts/afucloud/` — React frontend (SaaS dashboard)
- `artifacts/api-server/` — Express API server
- `lib/db/` — Drizzle ORM schema + migrations (source of truth for DB schema)
- `lib/api-spec/` — OpenAPI 3.1 spec (source of truth for API contract)
- `lib/api-zod/` — Zod schemas generated from OpenAPI spec (for API validation)
- `lib/api-client-react/` — React Query hooks generated from OpenAPI spec (for frontend)

## Architecture Decisions

- API-first design: all behavior defined in `lib/api-spec/openapi.yaml`, code generated from it
- Storage abstraction in `artifacts/api-server/src/lib/storage.ts` — provider-agnostic interface
- JWT-only auth (no Supabase Auth) — custom auth through the AfuCloud API
- Environment variable `POSTGRES_URL` is used instead of `DATABASE_URL` (Replit reserves that name for its built-in PG)
- All secrets stored as Replit env vars (minimum required to run; Cloudflare R2 creds needed at server startup)

## Design

- Cream/warm background (`#FAF8F5`) with flat UI (no shadows)
- Primary: teal (`hsl(173, 70%, 35%)`)
- Fonts: DM Sans (body), Satoshi (display), JetBrains Mono (code)

## User Preferences

- Cream + flat UI aesthetic with advanced UX and layouts
- All infrastructure secrets stored as Replit env vars (Supabase + Cloudflare)
- Build as a full SaaS platform (developer-first cloud storage)
