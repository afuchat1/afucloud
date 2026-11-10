---
name: Live Supabase schema and staging
description: Connected production catalog facts that affect multi-product work and isolated staging
---

# Live Supabase schema and staging

The connected Supabase project contains a much broader multi-product catalog than the local Drizzle schema index. The 2026-09-25 live inventory found 201 tables in `afuchat`, 23 in `afuai`, 11 in `afucloud`, shared `accounts` and `auth` schemas, and multiple additional domain schemas. Product-related entities are not always in a schema named after the product.

**Why:** The local schema index only represents AfuCloud plus shared auth/profile tables, so it is not a reliable inventory for cross-product dashboard work.

**How to apply:** Inspect the live catalog and product API contracts before adding product navigation, routes, or generic data management. Do not infer table coverage from local Drizzle exports.

The connected Supabase project had no recorded migrations and no development branches when inspected on 2026-09-25. Supabase branches apply tracked migrations and do not copy production data, so creating a branch from this state would not reproduce the populated product schema.

**Why:** A blank staging database could make Worker/frontend testing misleading or nonfunctional.

**How to apply:** Do not create a staging branch until a schema-only baseline is versioned and validated, or an existing isolated staging project is identified. Keep staging data isolated; never seed it by copying production user records.

On 2026-11-10, live inspection showed RLS enabled on all 13 current `afucloud` tables. `anon` and `authenticated` had neither schema usage nor table grants; `service_role` had the required access.

**Why:** The earlier RLS inventory became stale. Verify live policy and grant state before making security or API-exposure decisions.

**How to apply:** Query current `pg_class` RLS flags, schema privileges, and table privileges before changing them. Do not apply blanket grants or RLS changes.

The local migration files do not guarantee that an external Supabase production schema is current. On 2026-10-01, `afucloud.cloudflare_connections` was absent even though its migration existed locally; after explicit approval, the table was added and verified with RLS and the required `service_role` access.

**Why:** The missing relation prevented the Cloudflare OAuth callback from persisting a successful connection.

**How to apply:** Verify live relations and role privileges before diagnosing PostgREST-backed features. For external production changes, use the narrow approved migration and verify the resulting schema and service-role access before committing it.

The Supabase PostgREST configuration originally exposed `accounts,afuchat` but omitted `afucloud`, while the AfuCloud Worker sends `Accept-Profile: afucloud`. This caused 406 responses for AfuCloud table lookups. On 2026-11-10, `afucloud` was appended while preserving the existing schema list.

**Why:** A valid database schema and service-role grants are not enough if PostgREST does not expose the requested schema.

**How to apply:** Before diagnosing PostgREST 406s, compare the request's `Accept-Profile` with the project's live `db_schema` setting. Append only the required schema and preserve existing entries. Check RLS and grants before exposing it; the current AfuCloud tables have RLS enabled and no `anon`/`authenticated` privileges.